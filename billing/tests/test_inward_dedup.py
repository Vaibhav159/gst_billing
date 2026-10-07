"""M28: one duplicate rule for purchases, whichever door a bill comes in by.

Inward bills, AI import, GSTR-2A import and bulk import each used their own
key, so "SJ-101" through one and "SJ/101" through another both counted, and
their ITC with them. The GSTR-2A importer also booked reverse-charge rows as
ordinary ITC, ignored filed months, and wrote unless told not to.
"""

import json
from datetime import date
from decimal import Decimal as D
from io import StringIO

from django.core.management import call_command
from django.urls import reverse

from billing.models import Customer, FiledPeriod, Invoice
from billing.services.gstr2a_import import import_file
from billing.tests.test_base import BaseAPITestCase
from billing.tests.test_gstr2a_import import portal_file

SUPPLIER_GSTIN = "22CCCCC0000C1Z5"  # the base business is 22 as well


class InwardDuplicateRuleTest(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.supplier = Customer.objects.create(name="SJ GOLD", gst_number=SUPPLIER_GSTIN, state_name="CHHATTISGARH")
        self.supplier.businesses.add(self.business)

    def _inward_form(self, number, date_="2026-05-05", supplier_name="SJ GOLD", gstin=SUPPLIER_GSTIN):
        return self.client.post(reverse("inward-bill-list"), {
            "business_id": self.business.id, "supplier_name": supplier_name, "supplier_gstin": gstin,
            "invoice_number": number, "invoice_date": date_,
            "lines": json.dumps([{"product_name": "Gold bar", "hsn_code": "710813", "quantity": "1",
                                  "rate": "10000", "gst_tax_rate": "0.03", "unit": "gms"}]),
        })

    def test_a_bill_number_is_read_one_way(self):
        from billing.api.inward_bills_service import inward_number_key

        self.assertEqual({inward_number_key(n) for n in ("SJ-101", "sj/101", "SJ 101", " SJ.101 ")}, {"SJ101"})

    def test_ai_import_sees_the_inward_forms_bill(self):
        self.assertEqual(self._inward_form("SJ-101").status_code, 201)
        r = self.client.post(reverse("ai-invoice-create"), {
            "business_id": self.business.id, "type_of_invoice": "inward",
            "invoice_data": {"customer_name": "SJ GOLD", "customer_gst_number": SUPPLIER_GSTIN,
                             "invoice_number": "SJ/101", "invoice_date": "2026-05-06",
                             "line_items": [{"product_name": "Gold bar", "hsn_code": "710813", "quantity": 1,
                                             "rate": 10000, "gst_tax_rate": 0.03}]},
        }, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(r.data.get("duplicate"), r.data)
        self.assertEqual(Invoice.objects.filter(type_of_invoice="inward", customer=self.supplier).count(), 1)

    def test_bulk_import_sees_the_inward_forms_bill(self):
        self.assertEqual(self._inward_form("SJ-101").status_code, 201)
        r = self.client.post(reverse("bulk-invoice-import"), {"business_id": self.business.id, "invoices": [{
            "invoiceNumber": "SJ/101", "invoice_date": "2026-05-07", "customerName": "SJ GOLD",
            "customerGST": SUPPLIER_GSTIN, "type": "INWARD", "total": 10300,
            "items": [{"productName": "Gold bar", "hsn": "710813", "qty": 1, "rate": 10000, "gstRate": 3}],
        }]}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["created"], 0, r.data)
        self.assertEqual(Invoice.objects.filter(type_of_invoice="inward", customer=self.supplier).count(), 1)

    def test_gstr2a_import_sees_the_inward_forms_bill(self):
        self.assertEqual(self._inward_form("SJ-101").status_code, 201)
        result = import_file(portal_file(recipient_gstin=self.business.gst_number, rows=[
            [SUPPLIER_GSTIN, "SJ GOLD", "SJ/101", date(2026, 5, 5), 10300, 10000, 0, 150, 150, 0, "Filed", "No",
             "Chhattisgarh", "22-Chhattisgarh"],
        ]), filename="2A.xlsx", dry_run=False)
        self.assertEqual((result.created_invoices, result.skipped_duplicates), (0, 1), result.errors)

    def test_two_suppliers_may_both_send_bill_001(self):
        other = Customer.objects.create(name="OTHER GOLD", gst_number="22EEEEE0000E1Z5", state_name="CHHATTISGARH")
        self.assertEqual(self._inward_form("001").status_code, 201)
        from billing.api.inward_bills_service import find_duplicate

        self.assertIsNone(find_duplicate(self.business, "001", other, "2026-05-05"))

    def test_the_same_number_next_year_is_a_new_bill(self):
        self.assertEqual(self._inward_form("001", date_="2026-03-31").status_code, 201)
        self.assertEqual(self._inward_form("001", date_="2026-04-01").status_code, 201)


class Gstr2aImportRulesTest(BaseAPITestCase):
    def _file(self, *rows):
        return portal_file(recipient_gstin=self.business.gst_number, rows=list(rows))

    def _row(self, number, rc="No", day=date(2026, 5, 5)):
        return [SUPPLIER_GSTIN, "SJ GOLD", number, day, 10300, 10000, 0, 150, 150, 0, "Filed", rc,
                "Chhattisgarh", "22-Chhattisgarh"]

    def test_a_reverse_charge_row_is_not_booked_as_ordinary_itc(self):
        result = import_file(self._file(self._row("RC-1", rc="Yes"), self._row("N-1")), filename="2A.xlsx", dry_run=False)
        self.assertEqual(result.created_invoices, 1)
        self.assertFalse(Invoice.objects.filter(invoice_number="RC-1").exists())
        self.assertTrue(any("RC-1" in line for line in result.skipped_reverse_charge), result.skipped_reverse_charge)

    def test_a_row_in_a_filed_month_is_skipped_and_listed(self):
        FiledPeriod.objects.create(business=self.business, year=2026, month=5)
        result = import_file(self._file(self._row("L-1"), self._row("J-1", day=date(2026, 6, 3))),
                             filename="2A.xlsx", dry_run=False)
        self.assertEqual(result.created_invoices, 1)
        self.assertFalse(Invoice.objects.filter(invoice_number="L-1").exists())
        self.assertTrue(any("L-1" in line for line in result.skipped_locked), result.skipped_locked)

    def test_the_service_runs_dry_unless_asked_to_write(self):
        import_file(self._file(self._row("D-1")), filename="2A.xlsx")
        self.assertFalse(Invoice.objects.filter(invoice_number="D-1").exists())

    def test_the_command_runs_dry_unless_given_apply(self, tmp_name="2a-dry.xlsx"):
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / tmp_name
            path.write_bytes(self._file(self._row("C-1")).getvalue())
            call_command("import_gstr2a", str(path), stdout=StringIO())
            self.assertFalse(Invoice.objects.filter(invoice_number="C-1").exists())
            call_command("import_gstr2a", str(path), "--apply", stdout=StringIO())
            self.assertEqual(Invoice.objects.get(invoice_number="C-1").total_amount, D("10300"))
