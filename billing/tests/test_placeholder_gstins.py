"""H12: "NA", "URP" and other placeholders are not GSTINs.

state_code took the first two characters of any gst_number, so a local walk-in
saved with "NA" was booked as IGST and filed in GSTR-1 with pos "NA", which
the portal rejects. Bulk import matched customers on any GST string, so two
different walk-ins typed with "URP" landed on one customer. Four "is this
B2B?" tests disagreed (length == 15, >= 15, any non-empty).
"""

from datetime import date
from decimal import Decimal as D
from io import StringIO

from django.core.management import call_command
from django.urls import reverse

from billing.constants import INVOICE_TYPE_OUTWARD
from billing.models import Business, Customer, Invoice, LineItem
from billing.reconciliation import rollup
from billing.tax_rules import has_gstin, is_interstate, state_code
from billing.tests.test_base import BaseAPITestCase

LODHA = "08ABCDE1234A1Z5"


class GstinShapeTest(BaseAPITestCase):
    def test_a_gstin_is_fifteen_characters_with_a_state_code(self):
        self.assertTrue(has_gstin(LODHA))
        self.assertTrue(has_gstin(" 08abcde1234a1z5 "))
        for junk in ("", None, "NA", "URP", "-", "08ABCDE1234A1Z", "UNREGISTERED123"):
            with self.subTest(junk=junk):
                self.assertFalse(has_gstin(junk))

    def test_a_placeholder_has_no_state_code(self):
        self.assertEqual(state_code(Customer(gst_number="NA", state_name="")), "")
        self.assertEqual(state_code(Customer(gst_number="URP", state_name="RAJASTHAN")), "08")

    def test_a_local_walk_in_saved_with_NA_is_intra_state(self):
        biz = Business(gst_number=LODHA, state_name="RAJASTHAN")
        self.assertFalse(is_interstate(biz, Customer(gst_number="NA", state_name="RAJASTHAN")))
        self.assertFalse(is_interstate(biz, Customer(gst_number="NA", state_name="")))


class PlaceholderSaleTest(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.biz = Business.objects.create(name="LODHA JEWELLERS", gst_number=LODHA, state_name="RAJASTHAN")
        self.walk_in = Customer.objects.create(name="WALK-IN", gst_number="NA", state_name="RAJASTHAN")
        self.walk_in.businesses.add(self.biz)

    def test_the_sale_books_cgst_and_sgst(self):
        resp = self.client.post(reverse("invoice-list"), {
            "business": self.biz.id, "customer": self.walk_in.id, "invoice_number": "NA-1",
            "invoice_date": "2026-07-10", "type_of_invoice": INVOICE_TYPE_OUTWARD,
            "line_items": [{"product_name": "Gold", "hsn_code": "711319", "gst_tax_rate": "0.03",
                            "quantity": "1", "rate": "10000", "unit": "gms",
                            "cgst": "0", "sgst": "0", "igst": "300", "amount": "10300"}],
        }, format="json")
        self.assertEqual(resp.status_code, 201, resp.data)
        li = LineItem.objects.get(invoice_id=resp.data["id"])
        self.assertEqual((li.cgst, li.sgst, li.igst), (D("150"), D("150"), D("0")))

    def test_gstr1_files_it_in_b2cs_under_the_firms_state(self):
        inv = Invoice.objects.create(business=self.biz, customer=self.walk_in, invoice_number="NA-2",
                                     invoice_date="2026-07-10", type_of_invoice=INVOICE_TYPE_OUTWARD,
                                     total_amount=D("10300"))
        LineItem.objects.create(invoice=inv, customer=self.walk_in, product_name="Gold", hsn_code="711319",
                                gst_tax_rate=D("0.03"), quantity=D("1"), rate=D("10000"),
                                cgst=D("150"), sgst=D("150"), igst=0, amount=D("10300"))
        resp = self.client.get(reverse("invoice-gstr1-portal-json"), {"business_id": self.biz.id, "month": 7, "year": 2026})
        self.assertEqual(resp.status_code, 200, resp.data)
        f = resp.data["file"]
        self.assertNotIn("b2b", f)
        self.assertEqual([(r["sply_ty"], r["pos"]) for r in f["b2cs"]], [("INTRA", "08")])

    def test_the_gstr1_export_does_not_call_it_b2b(self):
        inv = Invoice.objects.create(business=self.biz, customer=self.walk_in, invoice_number="NA-3",
                                     invoice_date="2026-07-10", type_of_invoice=INVOICE_TYPE_OUTWARD,
                                     total_amount=D("10300"))
        LineItem.objects.create(invoice=inv, customer=self.walk_in, product_name="Gold", hsn_code="711319",
                                gst_tax_rate=D("0.03"), quantity=D("1"), rate=D("10000"),
                                cgst=D("150"), sgst=D("150"), igst=0, amount=D("10300"))
        resp = self.client.get(reverse("invoice-gstr-export"), {"business_id": self.biz.id})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["gstr1"]["b2b"], [])


class PlaceholderImportTest(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.biz = Business.objects.create(name="LODHA JEWELLERS", gst_number=LODHA, state_name="RAJASTHAN")
        self.first = Customer.objects.create(name="WALK-IN ONE", gst_number="URP", state_name="RAJASTHAN")

    def _row(self, number, name):
        return {"invoiceNumber": number, "invoice_date": "2026-05-10", "customerName": name,
                "customerGST": "URP", "type": "OUTWARD", "total": 10300,
                "items": [{"productName": "Silver", "hsn": "711311", "qty": 1, "rate": 10000, "gstRate": 3}]}

    def test_bulk_import_keeps_walk_ins_sharing_URP_apart(self):
        r = self.client.post(reverse("bulk-invoice-import"), {"business_id": self.biz.id, "invoices": [
            self._row("U-1", "WALK-IN TWO"), self._row("U-2", "WALK-IN THREE"),
        ]}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(Invoice.objects.get(invoice_number="U-1").customer.name, "WALK-IN TWO")
        self.assertEqual(Invoice.objects.get(invoice_number="U-2").customer.name, "WALK-IN THREE")
        self.assertEqual(Customer.objects.filter(gst_number="URP").count(), 1)  # only the one already on file

    def test_the_customer_api_stores_a_placeholder_as_blank(self):
        r = self.client.post(reverse("customer-list"), {"name": "WALK-IN FOUR", "gst_number": "URP",
                                                        "state_name": "RAJASTHAN"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(Customer.objects.get(name="WALK-IN FOUR").gst_number, "")

    def test_ai_import_does_not_store_a_placeholder_on_a_new_customer(self):
        r = self.client.post(reverse("ai-invoice-create"), {
            "business_id": self.biz.id, "type_of_invoice": "outward",
            "invoice_data": {"customer_name": "WALK-IN FIVE", "customer_gst_number": "NA",
                             "customer_state_name": "RAJASTHAN", "invoice_number": "AI-NA",
                             "invoice_date": "2026-05-10",
                             "line_items": [{"product_name": "Silver", "hsn_code": "711311", "quantity": 1,
                                             "rate": 10000, "gst_tax_rate": 0.03}]},
        }, format="json")
        self.assertIn(r.status_code, (200, 400), r.data)
        self.assertFalse(Customer.objects.filter(gst_number="NA").exists())


class PlaceholderReconciliationTest(BaseAPITestCase):
    def test_rollup_counts_a_placeholder_as_b2c(self):
        line = {"taxable": D("1000"), "cgst": D("15"), "sgst": D("15"), "igst": D("0"), "rate": D("0.03")}
        res = rollup([{"id": 1, "invoice_number": "R-1", "invoice_date": date(2026, 5, 10), "customer_gstin": "NA",
                       "payment_mode": "cash", "total_amount": D("1030"), "lines": [line]}])
        self.assertEqual(res.rollup["b2b"]["FY"].taxable, D("0"))
        self.assertEqual(res.rollup["b2c"]["FY"].taxable, D("1000"))


class FixPlaceholderGstinsTest(BaseAPITestCase):
    def _run(self, *args):
        out = StringIO()
        call_command("fix_placeholder_gstins", *args, stdout=out)
        return out.getvalue()

    def test_reports_then_blanks_placeholders(self):
        na = Customer.objects.create(name="WALK-IN NA", gst_number="NA", state_name="RAJASTHAN")
        short = Customer.objects.create(name="TYPO", gst_number="08ABCDE1234A1Z", state_name="RAJASTHAN")
        real = Customer.objects.create(name="REAL", gst_number=LODHA, state_name="RAJASTHAN")
        output = self._run()
        self.assertIn("WALK-IN NA", output)
        self.assertIn("TYPO", output)
        self.assertNotIn("REAL", output)
        self.assertIn("Dry run", output)
        na.refresh_from_db()
        self.assertEqual(na.gst_number, "NA")

        self._run("--apply")
        for c, expected in ((na, ""), (short, ""), (real, LODHA)):
            c.refresh_from_db()
            self.assertEqual(c.gst_number, expected)

    def test_a_firm_with_a_placeholder_is_reported_not_blanked(self):
        firm = Business.objects.create(name="NO GSTIN FIRM", gst_number="NA", state_name="RAJASTHAN")
        output = self._run("--apply")
        self.assertIn("NO GSTIN FIRM", output)
        firm.refresh_from_db()
        self.assertEqual(firm.gst_number, "NA")
