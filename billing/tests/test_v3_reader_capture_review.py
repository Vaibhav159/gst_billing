"""Review regressions use synthetic media and mock every provider request."""
import json
from copy import deepcopy
from datetime import date
from io import BytesIO
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image

from billing.models import AiRead, CapturePage, Customer, Invoice, InwardCapture, LineItem
from billing.services.ai_reader import cleaned_read
from billing.services.capture_reads import capture_summary
from billing.tests.test_v3_ai_reader import RAW
from billing.tests.test_v3_capture_files import upload
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person, sale


def photo():
    stream = BytesIO()
    Image.new("RGB", (2, 2), "white").save(stream, "PNG")
    return SimpleUploadedFile("synthetic.png", stream.getvalue(), "image/png")


class ReaderCaptureReviewTests(TestCase):
    def setUp(self):
        self.media = TemporaryDirectory(dir=".")
        self.addCleanup(self.media.cleanup)
        self.override = override_settings(MEDIA_ROOT=self.media.name, AI_READER="", GEMINI_API_KEY="", GEMINI_API_KEYS="")
        self.override.enable()
        self.addCleanup(self.override.disable)
        self.user = person("capture-review-owner", *ROLE_GROUPS["owner"])
        self.client = client_for(self.user)
        self.business = firm()

    def capture(self, **more):
        response = self.client.post("/api/captures/", {"files": [photo()], **more}, format="multipart")
        self.assertEqual(response.status_code, 201, response.data)
        return InwardCapture.objects.get(pk=response.data["id"])

    def legacy_bill(self, capture, **more):
        return self.client.post("/api/inward-bills/", {"business_id": self.business.pk,
            "invoice_number": "REVIEW/1", "invoice_date": "2026-09-01", "supplier_name": "Synthetic supplier",
            "capture_id": capture.pk, "lines": json.dumps([{"product_name": "Packing", "quantity": "1",
                "rate": "100", "gst_tax_rate": "0", "unit": "nos"}]), **more}, format="multipart")

    def test_programming_error_is_logged_with_traceback_and_plain_response(self):
        with patch("billing.utils.AIInvoiceProcessor.process_invoice_pdf", return_value=RAW), \
                patch("billing.services.ai_reader.cleaned_read", side_effect=RuntimeError("synthetic internal bug")), \
                self.assertLogs("billing.services.ai_reader", level="ERROR") as logs:
            response = self.client.post("/api/purchases/read/", {"files": [upload()]}, format="multipart")
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("synthetic internal bug", str(response.data))
        self.assertEqual(logs.records[0].exc_info[0], RuntimeError)
        self.assertFalse(AiRead.objects.get().ok)

    def test_image_reader_gets_v3_and_all_pages(self):
        with patch("billing.utils.AIInvoiceProcessor.process_invoice_image", return_value=RAW) as reader:
            response = self.client.post("/api/purchases/read/", {"files": [photo(), photo()],
                "business_id": self.business.pk}, format="multipart")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["source"], "photo")
        self.assertTrue(reader.call_args.kwargs["v3"])
        self.assertEqual(reader.call_args.kwargs["business_id"], self.business.pk)
        self.assertEqual(len(reader.call_args.kwargs["pages"]), 2)
        self.assertEqual((AiRead.objects.get().ok, AiRead.objects.get().pages), (True, 2))

    def test_read_warns_before_dropping_lines_after_two_hundred(self):
        raw = {**deepcopy(RAW), "lines": deepcopy(RAW["lines"]) * 201, "printed_total": None}
        result = cleaned_read(raw, "photo")
        self.assertEqual(len(result["lines"]), 200)
        self.assertEqual(result["confidence"]["amounts"], "medium")
        self.assertIn("This bill has 201 lines. Only the first 200 are shown; check the bill before saving.", result["notes"])

    def test_irn_keeps_contract_confidence_and_truthful_gstin_warning(self):
        raw = {**RAW, "irn": "a" * 64, "supplier": {"name": "Synthetic", "gst_number": "08AACFU5521R1Z0"}}
        result = cleaned_read(raw, "photo")
        self.assertEqual(result["source"], "e-invoice")
        self.assertEqual(set(result["confidence"].values()), {"high"})
        self.assertTrue(result["notes"])

    def test_modern_capture_list_uses_stored_sizes_without_media_stat(self):
        capture = self.capture()
        page = capture.v3_pages.get()
        with patch.object(page.file.storage, "size", side_effect=AssertionError("list must use page.size")):
            response = self.client.get("/api/captures/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["results"][0]["pages"][0]["size"], page.size)

    def test_regular_capture_list_keeps_contract_cap_and_counts(self):
        InwardCapture.objects.bulk_create([InwardCapture(captured_by=self.user, read_status="ready") for _ in range(101)])
        response = self.client.get("/api/captures/")
        self.assertEqual(set(response.data), {"results", "count", "counts"})
        self.assertEqual((len(response.data["results"]), response.data["count"]), (100, 101))
        self.assertEqual(response.data["counts"]["ready"], 101)

    def test_complete_multipart_size_includes_overhead(self):
        for endpoint in ("/api/captures/", "/api/purchases/read/"):
            response = self.client.post(endpoint, {"files": [upload()]}, format="multipart", CONTENT_LENGTH=str(24 * 1024 * 1024 + 1))
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.data, {"files": ["These pages come to 24 MB. One bill can send at most 24 MB; take fewer or smaller pages."]})
        self.assertFalse(InwardCapture.objects.exists())
        self.assertFalse(AiRead.objects.exists())

    def test_malformed_capture_read_data_has_no_summary_irn(self):
        capture = self.capture()
        for raw in (True, ["bad"], "bad", 7, {"irn": []}):
            with self.subTest(raw=raw):
                capture.read_data = raw
                self.assertEqual(capture_summary(capture)["irn"], "")

    def test_discarded_capture_is_hidden_from_legacy_detail_and_delete(self):
        capture = self.capture()
        InwardCapture.objects.filter(pk=capture.pk).update(discarded_at=timezone.now())
        url = f"/api/inward-captures/{capture.pk}/"
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.delete(url).status_code, 404)
        with patch("billing.utils.AIInvoiceProcessor.process_invoice_image") as reader:
            response = self.client.post("/api/inward-bills/extract/", {"capture_id": capture.pk}, format="multipart")
        self.assertEqual(response.status_code, 404)
        reader.assert_not_called()
        self.assertTrue(InwardCapture.objects.filter(pk=capture.pk).exists())
        self.assertTrue(capture.image.storage.exists(capture.image.name))

    def test_legacy_delete_removes_all_pages_after_commit(self):
        capture = self.capture(files=[photo(), photo()])
        page = capture.v3_pages.order_by("position").last()
        page.preview.save("extra.jpg", ContentFile(b"synthetic preview"))
        files = {(capture.image.storage, capture.image.name)}
        files.update((item.file.storage, item.file.name) for item in capture.v3_pages.all())
        files.update((item.preview.storage, item.preview.name) for item in capture.v3_pages.all() if item.preview)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.delete(f"/api/inward-captures/{capture.pk}/")
            self.assertEqual(response.status_code, 204)
            self.assertTrue(all(storage.exists(name) for storage, name in files))
        self.assertFalse(InwardCapture.objects.filter(pk=capture.pk).exists())
        self.assertFalse(CapturePage.objects.exists())
        self.assertTrue(all(not storage.exists(name) for storage, name in files))

    def test_legacy_delete_rollback_preserves_capture_and_media(self):
        capture = self.capture()
        with self.assertRaises(RuntimeError), transaction.atomic():
            self.assertEqual(self.client.delete(f"/api/inward-captures/{capture.pk}/").status_code, 204)
            raise RuntimeError("rollback")
        self.assertTrue(InwardCapture.objects.filter(pk=capture.pk).exists())
        self.assertTrue(capture.image.storage.exists(capture.image.name))

    def test_legacy_delete_refuses_converted_capture(self):
        capture = self.capture()
        invoice = sale(self.business, buyer(), "USED/1", date(2026, 9, 1), kind="inward")
        InwardCapture.objects.filter(pk=capture.pk).update(status="converted", invoice=invoice)
        response = self.client.delete(f"/api/inward-captures/{capture.pk}/")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "capture_used")
        self.assertTrue(InwardCapture.objects.filter(pk=capture.pk).exists())

    def test_legacy_consumption_refuses_discarded_and_rolls_back_bill(self):
        capture = self.capture()
        InwardCapture.objects.filter(pk=capture.pk).update(discarded_at=timezone.now())
        response = self.legacy_bill(capture)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data, {"capture": ["That photo isn't in the inbox any more."]})
        self.assertFalse(Invoice.objects.exists())
        self.assertFalse(LineItem.objects.exists())
        self.assertFalse(Customer.objects.filter(name="Synthetic supplier").exists())

    def test_legacy_consumption_reuses_shared_lock_and_refuses_second_fill(self):
        capture = self.capture()
        from billing.services.capture_reads import consume_capture
        with patch("billing.services.capture_reads.consume_capture", wraps=consume_capture) as consume:
            response = self.legacy_bill(capture)
        self.assertEqual(response.status_code, 201, response.data)
        consume.assert_called_once()
        invoice = Invoice.objects.get()
        self.assertTrue(invoice.source_file)
        response = self.legacy_bill(capture, invoice_number="REVIEW/2")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "capture_used")
        self.assertEqual(Invoice.objects.count(), 1)

    def test_legacy_consumption_rejects_unknown_capture_without_bill(self):
        capture = InwardCapture(pk=98765)
        self.assertEqual(self.legacy_bill(capture).status_code, 400)
        self.assertFalse(Invoice.objects.exists())
