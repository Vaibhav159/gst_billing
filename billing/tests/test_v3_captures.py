"""Synthetic capture lifecycle and media ownership; no reader network calls."""
from datetime import timedelta
from tempfile import TemporaryDirectory
from unittest.mock import patch
from uuid import uuid4

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone

from billing.models import AiRead, AuditLog, CapturePage, InwardCapture
from billing.tests.v3_helpers import ROLE_GROUPS, client_for, firm, person


def upload(name="bill.pdf"):
    return SimpleUploadedFile(name, b"%PDF-1.4\nsynthetic bill\n", "application/pdf")


class CaptureTest(TestCase):
    def setUp(self):
        self.media = TemporaryDirectory(dir=".")
        self.addCleanup(self.media.cleanup)
        self.settings = override_settings(MEDIA_ROOT=self.media.name)
        self.settings.enable()
        self.addCleanup(self.settings.disable)
        self.user = person("capture-counter", *ROLE_GROUPS["staff"])
        self.client = client_for(self.user)
        self.owner = client_for(person("capture-owner", *ROLE_GROUPS["owner"]))
        self.business = firm()

    def make(self, **data):
        return self.client.post("/api/captures/", {"files": [upload()], "client_id": str(uuid4()), **data}, format="multipart")

    def test_upload_first_page_v2_compatibility_and_signed_pages(self):
        response = self.make(business_id=self.business.pk, hint="Bullion", note="stall 14")
        self.assertEqual(response.status_code, 201, response.data)
        data = response.data
        self.assertEqual((data["status"], data["read"], data["pdf"], data["captured_by"]["id"]), ("reading", None, True, self.user.pk))
        self.assertEqual(data["label"], f"Bill photo {data['id']}")
        page = CapturePage.objects.get()
        cap = InwardCapture.objects.get()
        self.assertEqual(cap.image.name, page.file.name)
        self.assertIn("/api/media/", data["pages"][0]["url"])
        self.assertIsNone(data["pages"][0]["preview_url"])
        self.assertEqual(AuditLog.objects.get(entity="capture").details, f"{self.business.name} · 1 page(s)")

    def test_retried_uuid_writes_one_capture_and_one_file(self):
        key = str(uuid4())
        first, second = self.make(client_id=key), self.make(client_id=key)
        self.assertEqual((first.status_code, second.status_code, first.data["id"]), (201, 200, second.data["id"]))
        self.assertEqual((InwardCapture.objects.count(), CapturePage.objects.count()), (1, 1))

    def test_bad_uploads_are_words_and_write_nothing(self):
        for files, words in [([], "Choose a photo (JPEG, PNG or HEIC) or a PDF."),
                             ([upload()] * 9, "A bill can have at most 8 pages here."),
                             ([SimpleUploadedFile("evil.html", b"<script>", "text/html")], "Choose a photo (JPEG, PNG or HEIC) or a PDF.")]:
            response = self.make(files=files)
            self.assertEqual((response.status_code, response.data), (400, {"files": [words]}))
        self.assertEqual(self.make(business_id="nan").data, {"business_id": ["Pick a firm from the list."]})
        self.assertEqual(InwardCapture.objects.count(), 0)

    def test_mime_spoof_and_oversized_file(self):
        fake = SimpleUploadedFile("x.jpg", b"<html>not an image", "image/jpeg")
        self.assertEqual(self.make(files=[fake]).status_code, 400)
        from io import BytesIO

        from PIL import Image
        buffer = BytesIO()
        Image.new("RGB", (1, 1)).save(buffer, "GIF")
        disguised = SimpleUploadedFile("wrong.jpg", buffer.getvalue(), "image/jpeg")
        self.assertEqual(self.make(files=[disguised]).status_code, 400)
        buffer = BytesIO()
        Image.new("RGB", (1, 1)).save(buffer, "PNG")
        broken = bytearray(buffer.getvalue())
        position = broken.index(b"IDAT")
        size = int.from_bytes(broken[position - 4:position], "big")
        broken[position + 4 + size] ^= 1
        corrupt = SimpleUploadedFile("broken.png", bytes(broken), "image/png")
        self.assertEqual(self.make(files=[corrupt]).status_code, 400)
        big = upload()
        big.size = 21 * 1024 * 1024
        from rest_framework.exceptions import ValidationError

        from billing.services.capture_uploads import validate_files
        with self.assertRaises(ValidationError) as caught:
            validate_files([big])
        self.assertEqual(caught.exception.detail, {"files": ["bill.pdf is 21 MB. The most is 20 MB."]})

    def test_own_discard_and_restore_are_idempotent(self):
        key = self.make().data["id"]
        self.assertEqual(self.client.delete(f"/api/captures/{key}/").data["status"], "discarded")
        self.client.delete(f"/api/captures/{key}/")
        self.assertEqual(self.client.get("/api/captures/").data["count"], 0)
        self.assertEqual(self.client.post(f"/api/captures/{key}/restore/").data["status"], "reading")
        self.assertEqual(AuditLog.objects.filter(entity="capture", action="discarded").count(), 1)

    def test_only_owner_can_remove_someone_elses_capture(self):
        key = self.make().data["id"]
        other = client_for(person("other-counter", *ROLE_GROUPS["staff"]))
        response = other.delete(f"/api/captures/{key}/")
        self.assertEqual((response.status_code, response.data["needs"]), (403, "capture.discard"))
        self.assertIn("capture-counter took this photo.", response.data["detail"])
        self.assertEqual(self.owner.delete(f"/api/captures/{key}/").status_code, 200)

    def test_viewer_reads_but_cannot_upload_discard_or_restore(self):
        key = self.make().data["id"]
        self.client = client_for(person("capture-viewer", *ROLE_GROUPS["viewer"]))
        self.assertEqual(self.client.get("/api/captures/").status_code, 200)
        self.assertEqual(self.make().status_code, 403)
        self.assertEqual(self.client.delete(f"/api/captures/{key}/").status_code, 403)
        self.assertEqual(self.client.post(f"/api/captures/{key}/restore/").status_code, 403)

    def test_scope_includes_undecided_and_counts_waiting_before_filter(self):
        self.make()
        self.make(business_id=self.business.pk)
        other = firm("OTHER", gstin="24AABCU9603R1ZP", state="GUJARAT")
        self.make(business_id=other.pk)
        response = self.client.get("/api/captures/", {"business_id": self.business.pk})
        self.assertEqual((response.data["count"], response.data["counts"]), (2, {"reading": 2, "ready": 0, "failed": 0, "no_firm": 1}))
        self.assertEqual(self.client.get("/api/captures/", {"status": "bogus"}).status_code, 400)

    def test_stale_read_projects_failed_and_is_not_written_by_get(self):
        key = self.make().data["id"]
        InwardCapture.objects.filter(pk=key).update(read_started_at=timezone.now() - timedelta(minutes=4))
        response = self.client.get(f"/api/captures/{key}/")
        self.assertEqual((response.data["status"], response.data["problem"]), ("failed", "The reading stopped before it finished."))
        self.assertEqual(InwardCapture.objects.get(pk=key).read_status, "reading")

    def test_new_upload_purges_old_discarded_pages_after_commit(self):
        key = self.make().data["id"]
        self.client.delete(f"/api/captures/{key}/")
        InwardCapture.objects.filter(pk=key).update(discarded_at=timezone.now() - timedelta(days=31))
        page = CapturePage.objects.get()
        read = AiRead.objects.create(user=self.user, kind="capture", pages=1, ok=True, capture_id=key)
        with self.captureOnCommitCallbacks(execute=True):
            self.make()
        self.assertFalse(InwardCapture.objects.filter(pk=key).exists())
        self.assertFalse(page.file.storage.exists(page.file.name))
        read.refresh_from_db()
        self.assertEqual(read.capture_id, key)

    def test_read_running_returns_without_a_second_provider_call(self):
        key = self.make().data["id"]
        InwardCapture.objects.filter(pk=key).update(read_started_at=timezone.now())
        with patch("billing.services.ai_reader.run_read") as reader:
            response = self.client.post(f"/api/captures/{key}/read/")
        self.assertEqual(response.data["status"], "reading")
        reader.assert_not_called()

    def test_discarded_capture_disappears_from_v2_inbox_too(self):
        key = self.make().data["id"]
        self.client.delete(f"/api/captures/{key}/")
        self.assertEqual(self.client.get("/api/inward-captures/").data["count"], 0)

    def test_capture_read_failure_and_success_are_logged(self):
        from billing.tests.test_v3_ai_reader import RAW
        capture = self.client.post("/api/captures/", {"files": [upload()]}, format="multipart").data
        with patch("billing.utils.AIInvoiceProcessor.process_invoice_pdf", side_effect=TimeoutError):
            response = self.client.post(f"/api/captures/{capture['id']}/read/")
        self.assertEqual((response.data["status"], response.data["problem"]), ("failed", "The reader didn't answer in time."))
        with patch("billing.utils.AIInvoiceProcessor.process_invoice_pdf", return_value=RAW):
            response = self.client.post(f"/api/captures/{capture['id']}/read/")
        self.assertEqual(response.data["status"], "ready")
        self.assertEqual(AiRead.objects.filter(ok=True).count(), 1)


    def test_upload_abandoned_before_read_also_expires(self):
        key = self.make().data["id"]
        InwardCapture.objects.filter(pk=key).update(created_at=timezone.now() - timedelta(minutes=4))
        self.assertEqual(self.client.get(f"/api/captures/{key}/").data["status"], "failed")

    def test_completed_capture_never_sends_its_pages_again(self):
        from billing.tests.test_v3_ai_reader import RAW
        key = self.make().data["id"]
        with patch("billing.utils.AIInvoiceProcessor.process_invoice_pdf", return_value=RAW) as provider:
            first = self.client.post(f"/api/captures/{key}/read/")
            second = self.client.post(f"/api/captures/{key}/read/")
        self.assertEqual(first.data["read"], second.data["read"])
        self.assertEqual(provider.call_count, 1)
        self.assertEqual(AiRead.objects.filter(capture_id=key).count(), 1)

    def test_upload_id_belongs_to_the_person_who_sent_it(self):
        key = str(uuid4())
        first = self.make(client_id=key)
        self.client = self.owner
        second = self.make(client_id=key)
        self.assertEqual((first.status_code, second.status_code), (201, 201))
        self.assertNotEqual(first.data["id"], second.data["id"])

    def test_combined_upload_size_has_the_exact_refusal(self):
        from rest_framework.exceptions import ValidationError

        from billing.services.capture_uploads import validate_files
        files = [upload(), upload()]
        for file in files:
            file.size = 13 * 1024 * 1024
        with self.assertRaises(ValidationError) as caught:
            validate_files(files)
        self.assertEqual(caught.exception.detail, {"files": ["These pages come to 26 MB. One bill can send at most 24 MB; take fewer or smaller pages."]})
        for endpoint in ("/api/captures/", "/api/purchases/read/"):
            response = self.client.post(endpoint, {"files": [upload()]}, format="multipart", CONTENT_LENGTH=str(24 * 1024 * 1024 + 1))
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.data, {"files": ["These pages come to 24 MB. One bill can send at most 24 MB; take fewer or smaller pages."]})

    def test_day_summary_is_limited_and_does_not_fetch_media_rows(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        InwardCapture.objects.bulk_create([InwardCapture(captured_by=self.user, read_status="ready", pages=2,
            read_data={"supplier": {"name": "Synthetic Supplier"}, "invoice_number": f"PHOTO/{number}", "lines_total": "103.00", "printed_total": "102.50"}) for number in range(51)])
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get("/api/captures/", {"day": timezone.localdate().isoformat(), "summary": "1", "business_id": self.business.pk})
        self.assertEqual((len(response.data["results"]), response.data["count"]), (50, 51))
        self.assertEqual(set(response.data["results"][0]), {"id", "status", "supplier", "number", "total", "problem", "pages", "who", "when"})
        self.assertEqual(set(response.data), {"count", "next", "previous", "results"})
        self.assertIsNone(response.data["previous"])
        self.assertIn("page=2", response.data["next"])
        second = self.client.get(response.data["next"]).data
        self.assertEqual((len(second["results"]), second["count"], second["next"]), (1, 51, None))
        self.assertIsNotNone(second["previous"])
        self.assertNotIn(second["results"][0]["id"], [row["id"] for row in response.data["results"]])
        capped = self.client.get("/api/captures/", {"summary": "1", "page_size": "100"}).data
        self.assertEqual(len(capped["results"]), 50)
        for page_number in ("3", "invalid", "0"):
            invalid = self.client.get("/api/captures/", {"summary": "1", "page": page_number})
            self.assertEqual(invalid.status_code, 404)
            self.assertEqual(invalid.data, {"detail": f"This list has no page {page_number}."})
        self.assertEqual(response.data["results"][0]["total"], "102.50")
        self.assertFalse(any("billing_capturepage" in query["sql"] for query in queries))
        self.assertLess(len(queries), 8)
        InwardCapture.objects.filter(pk=response.data["results"][0]["id"]).update(read_data={"printed_total": None}, supplier_hint="Only a hint")
        unread = self.client.get("/api/captures/", {"summary": "1"}).data["results"][0]
        self.assertEqual((unread["supplier"], unread["number"], unread["total"]), ("", "", None))
        self.assertEqual(self.client.get("/api/captures/", {"day": "bad", "summary": "1"}).status_code, 400)

    def test_day_filter_uses_ist_midnight(self):
        from datetime import datetime
        from zoneinfo import ZoneInfo
        key = self.make().data["id"]
        InwardCapture.objects.filter(pk=key).update(created_at=datetime(2026, 10, 7, 20, 0, tzinfo=ZoneInfo("UTC")))
        self.assertEqual(self.client.get("/api/captures/", {"day": "2026-10-08", "summary": "1"}).data["count"], 1)
        self.assertEqual(self.client.get("/api/captures/", {"day": "2026-10-07", "summary": "1"}).data["count"], 0)
