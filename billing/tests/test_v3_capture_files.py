"""The capture-to-bill link is atomic, and each stored file has one identity."""
from datetime import date
from tempfile import TemporaryDirectory

from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from billing.models import CapturePage, InwardCapture
from billing.services.capture_reads import CaptureUsed, capture_summary, consume_capture, purchase_files
from billing.tests.v3_helpers import buyer, firm, sale


def upload(name="bill.pdf"):
    return SimpleUploadedFile(name, b"%PDF-1.4\nsynthetic bill\n", "application/pdf")


class CaptureFilesTest(TestCase):
    def setUp(self):
        self.media = TemporaryDirectory(dir=".")
        self.addCleanup(self.media.cleanup)
        self.override = override_settings(MEDIA_ROOT=self.media.name)
        self.override.enable()
        self.addCleanup(self.override.disable)
        self.bill = sale(firm(), buyer(), "SUP/1", date(2026, 10, 7), kind="inward")
        self.capture = InwardCapture.objects.create(read_status="ready", read_data={"irn": "a" * 64})

    def test_capture_is_consumed_once_with_exact_conflict_reference(self):
        consume_capture(self.capture.pk, self.bill)
        self.capture.refresh_from_db()
        self.assertEqual((self.capture.status, self.capture.invoice_id), ("converted", self.bill.pk))
        with self.assertRaises(CaptureUsed) as caught:
            consume_capture(self.capture.pk, self.bill)
        self.assertEqual(caught.exception.detail["purchase"]["total_amount"], "10300.00")
        self.assertEqual(caught.exception.detail["detail"], "This photo was filled in already, as SUP/1.")

    def test_rollback_puts_the_capture_back(self):
        try:
            with transaction.atomic():
                consume_capture(self.capture.pk, self.bill)
                raise ValueError("later bill failure")
        except ValueError:
            pass
        self.capture.refresh_from_db()
        self.assertEqual((self.capture.status, self.capture.invoice_id), ("new", None))

    def test_discarded_or_missing_capture_cannot_be_consumed(self):
        self.capture.discarded_at = timezone.now()
        self.capture.save(update_fields=["discarded_at"])
        for key in (self.capture.pk, self.capture.pk + 999):
            with self.assertRaises(ValidationError) as caught:
                consume_capture(key, self.bill)
            self.assertEqual(caught.exception.detail, {"capture": ["That photo isn't in the inbox any more."]})

    def test_duplicate_filenames_keep_the_original_name_and_signed_urls(self):
        self.capture.invoice = self.bill
        self.capture.save(update_fields=["invoice"])
        for position in (1, 2):
            page = CapturePage(capture=self.capture, position=position, original_name="IMG_2041.jpg", content_type="image/jpeg", size=3)
            page.file.save("IMG_2041.jpg", ContentFile(b"jpg"))
        files = purchase_files(self.bill)
        self.assertEqual([item["name"] for item in files], ["IMG_2041.jpg"] * 2)
        self.assertEqual([item["id"] for item in files], ["p1", "p2"])
        self.assertNotEqual(files[0]["url"], files[1]["url"])
        self.assertTrue(all("?s=" in item["url"] for item in files))

    def test_capture_summary_contains_the_contract_fields(self):
        summary = capture_summary(self.capture)
        self.assertEqual(set(summary), {"id", "captured_at", "captured_by", "pages", "note", "hint", "pdf", "irn"})
        self.assertEqual(summary["irn"], "a" * 64)

    def test_v2_capture_without_page_rows_keeps_its_photo_visible(self):
        self.capture.invoice = self.bill
        self.capture.image.save("old-bill.pdf", ContentFile(b"%PDF-1.4 synthetic"))
        self.capture.save(update_fields=["invoice"])
        files = purchase_files(self.bill)
        self.assertEqual([(item["id"], item["kind"], item["name"]) for item in files], [("p1", "pdf", "old-bill.pdf")])
        self.assertIsNone(files[0]["preview_url"])
