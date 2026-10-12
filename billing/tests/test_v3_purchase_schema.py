"""Additive purchase storage keeps old rows and v2 inserts usable."""
from datetime import date

from django.db import models
from django.test import TestCase

from billing.models import Customer, Invoice, ShopSetting
from billing.tests.v3_helpers import buyer, firm, sale


class PurchaseSchemaTests(TestCase):
    def test_existing_purchase_defaults_and_v2_write_boundary(self):
        invoice = sale(firm(), buyer(), "S-1", date(2026, 10, 1), kind="inward")
        self.assertIsNone(invoice.itc_month)
        self.assertTrue(invoice.itc_eligible)
        self.assertFalse(invoice.needs_review)
        self.assertEqual(invoice.source, "")
        for name in ("itc_month", "itc_eligible", "needs_review", "buyer_gstin",
                     "buyer_ack", "linked_sale", "source"):
            self.assertIn(name, Invoice.V3_FIELDS)
            self.assertNotIn(name, Invoice.v2_columns())
        self.assertEqual(list(Invoice.objects.purchases()), [invoice])

    def test_database_defaults_cover_columns_added_to_v2_tables(self):
        from billing.models import InwardCapture
        fields = {Invoice: ("itc_eligible", "needs_review", "buyer_gstin", "buyer_ack", "source"),
                  Customer: ("is_supplier",),
                  InwardCapture: ("read_status", "read_error", "label", "pdf", "pages")}
        for model, names in fields.items():
            for name in names:
                field = model._meta.get_field(name)
                self.assertIsNot(field.db_default, models.NOT_PROVIDED, (model, name))

    def test_reader_schema_has_uploader_idempotency_and_uncapped_log(self):
        from billing.models import AiRead, CapturePage, InwardCapture
        self.assertFalse(InwardCapture._meta.get_field("client_id").unique)
        self.assertTrue(any(tuple(c.fields) == ("captured_by", "client_id") for c in InwardCapture._meta.constraints))
        self.assertTrue(AiRead._meta.get_field("capture").null)
        self.assertFalse(AiRead._meta.get_field("capture").db_constraint)
        self.assertFalse(CapturePage._meta.get_field("capture").db_constraint)
        self.assertFalse(hasattr(ShopSetting(), "ai_reads_month"))
        self.assertFalse(hasattr(ShopSetting(), "ai_reads_minute"))

    def test_read_log_keeps_capture_id_after_capture_purge(self):
        from billing.models import AiRead, InwardCapture
        capture = InwardCapture.objects.create(image="synthetic.jpg")
        capture_id = capture.pk
        read = AiRead.objects.create(capture=capture, kind="capture", ok=True)
        capture.delete()
        read.refresh_from_db()
        self.assertEqual(read.capture_id, capture_id)
