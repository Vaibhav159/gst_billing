"""GSTR-1 / GSTR-3B export shape and thresholds.

These only bite at filing time, which is the worst moment to discover them.
"""

from decimal import Decimal as D

from django.urls import reverse

from billing.constants import B2CL_THRESHOLD, INVOICE_TYPE_INWARD, INVOICE_TYPE_OUTWARD
from billing.models import Customer, Invoice, LineItem
from billing.tests.test_base import BaseAPITestCase


class GSTRExportTest(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        # The base fixture's business carries GSTIN 22 with state_name
        # MAHARASHTRA — inconsistent, so pick a state that differs from both
        # and the direction is unambiguous either way it is read.
        self.b2c_other_state = Customer.objects.create(
            workspace_id=1, name="WALK-IN KOCHI", gst_number="", state_name="KERALA",
        )
        self.b2c_other_state.businesses.add(self.business)

    def _invoice(self, customer, number, taxable, inv_type=INVOICE_TYPE_OUTWARD, igst=True):
        inv = Invoice.objects.create(
            workspace_id=1, business=self.business, customer=customer,
            invoice_number=number, invoice_date="2026-05-01",
            type_of_invoice=inv_type, total_amount=0,
        )
        taxable = D(str(taxable))
        tax = taxable * D("0.03")
        LineItem.objects.create(
            workspace_id=1, customer=customer, invoice=inv, product_name="Gold",
            hsn_code="711319", gst_tax_rate=D("0.03"), quantity=D("1"), rate=taxable,
            cgst=D("0") if igst else tax / 2, sgst=D("0") if igst else tax / 2,
            igst=tax if igst else D("0"), amount=taxable + tax, unit="gms",
        )
        inv.refresh_from_db()
        return inv

    def _export(self):
        resp = self.client.get(reverse("invoice-gstr-export"))
        self.assertEqual(resp.status_code, 200)
        return resp.data

    def test_b2cl_threshold_is_one_lakh(self):
        self.assertEqual(B2CL_THRESHOLD, 100000)

    def test_interstate_b2c_above_one_lakh_lands_in_b2cl(self):
        # Rs 1.5L: over the current Rs 1L limit, under the old Rs 2.5L one. This
        # is exactly the band that used to be swept into B2CS.
        self._invoice(self.b2c_other_state, "B2CL-1", "150000")
        data = self._export()
        numbers = [i["inum"] for row in data["gstr1"]["b2cl"] for i in row["inv"]]
        self.assertIn("B2CL-1", numbers)

    def test_interstate_b2c_below_the_threshold_stays_out_of_b2cl(self):
        self._invoice(self.b2c_other_state, "SMALL-1", "50000")
        data = self._export()
        numbers = [i["inum"] for row in data["gstr1"]["b2cl"] for i in row["inv"]]
        self.assertNotIn("SMALL-1", numbers)

    def test_itc_is_filed_as_all_other_itc_not_imports(self):
        self._invoice(self.customer, "PUR-1", "10000", inv_type=INVOICE_TYPE_INWARD, igst=False)
        data = self._export()
        types = [row["ty"] for row in data["gstr3b"]["itc_elg"]["itc_avl"]]
        self.assertIn("OTH", types)
        self.assertNotIn("IMPG", types)


class ReportUnitTest(BaseAPITestCase):
    def test_export_rows_carry_the_line_unit_not_hardcoded_grams(self):
        inv = Invoice.objects.create(
            workspace_id=1, business=self.business, customer=self.customer,
            invoice_number="UNIT-1", invoice_date="2026-05-01",
            type_of_invoice=INVOICE_TYPE_OUTWARD, total_amount=0,
        )
        LineItem.objects.create(
            workspace_id=1, customer=self.customer, invoice=inv, product_name="Bangle Set",
            hsn_code="711319", gst_tax_rate=D("0.03"), quantity=D("4"), rate=D("500"),
            cgst=D("30"), sgst=D("30"), igst=D("0"), amount=D("2060"), unit="pcs",
        )
        rows = list(LineItem.get_line_item_data_for_download(
            "2026-04-01", "2027-03-31", self.business
        ))
        row = [r for r in rows if r[0] == "UNIT-1"][0]
        qty_with_unit, rate_with_unit = row[7], row[8]
        self.assertIn("pcs", qty_with_unit)
        self.assertIn("pcs", rate_with_unit)
        self.assertNotIn("gm", qty_with_unit)


class B2CPlaceOfSupplyTest(BaseAPITestCase):
    """B2CL was structurally unreachable: the branch skipped anyone with a
    GSTIN, then derived the customer's state FROM that GSTIN with the seller's
    state as fallback — so every remaining invoice looked intra-state."""

    def setUp(self):
        super().setUp()
        self.local_b2c = Customer.objects.create(
            workspace_id=1, name="WALK-IN LOCAL", gst_number="",
            state_name=self.business.state_name,
        )
        self.far_b2c = Customer.objects.create(
            workspace_id=1, name="WALK-IN FAR", gst_number="", state_name="KERALA",
        )
        for c in (self.local_b2c, self.far_b2c):
            c.businesses.add(self.business)

    def _mk(self, customer, number, taxable, igst):
        inv = Invoice.objects.create(
            workspace_id=1, business=self.business, customer=customer,
            invoice_number=number, invoice_date="2026-05-01",
            type_of_invoice=INVOICE_TYPE_OUTWARD, total_amount=0,
        )
        taxable = D(str(taxable)); tax = taxable * D("0.03")
        LineItem.objects.create(
            workspace_id=1, customer=customer, invoice=inv, product_name="Gold",
            hsn_code="711319", gst_tax_rate=D("0.03"), quantity=D("1"), rate=taxable,
            cgst=D("0") if igst else tax / 2, sgst=D("0") if igst else tax / 2,
            igst=tax if igst else D("0"), amount=taxable + tax, unit="gms",
        )
        inv.refresh_from_db()
        return inv

    def _export(self):
        return self.client.get(reverse("invoice-gstr-export")).data

    def test_unregistered_customer_in_another_state_reaches_b2cl(self):
        self._mk(self.far_b2c, "FAR-BIG", "200000", igst=True)
        rows = self._export()["gstr1"]["b2cl"]
        self.assertTrue(rows, "b2cl was empty — the branch is unreachable again")
        self.assertIn("FAR-BIG", [i["inum"] for r in rows for i in r["inv"]])

    def test_b2cl_place_of_supply_is_the_customer_state_not_the_sellers(self):
        self._mk(self.far_b2c, "FAR-BIG-2", "200000", igst=True)
        row = self._export()["gstr1"]["b2cl"][0]
        self.assertEqual(row["pos"], "32")               # Kerala
        self.assertNotEqual(row["pos"], self.business.gst_number[:2])

    def test_local_unregistered_customer_stays_in_b2cs(self):
        self._mk(self.local_b2c, "LOCAL-BIG", "200000", igst=False)
        data = self._export()
        self.assertNotIn("LOCAL-BIG", [i["inum"] for r in data["gstr1"]["b2cl"] for i in r["inv"]])
        self.assertTrue(data["gstr1"]["b2cs"])

    def test_interstate_b2c_no_longer_leaks_into_b2cs(self):
        self._mk(self.far_b2c, "FAR-SMALL", "5000", igst=True)
        b2cs = self._export()["gstr1"]["b2cs"]
        # It is below the B2CL threshold, but it must not be filed as a local
        # supply under the seller's own state code.
        self.assertNotIn(self.business.gst_number[:2], [r["pos"] for r in b2cs])


class ApiNotFoundTest(BaseAPITestCase):
    """Unknown /api/ paths must fail as JSON 404s, not fall through to the SPA."""

    def test_unknown_api_path_is_a_404_not_the_react_shell(self):
        resp = self.client.get("/api/definitely-not-an-endpoint/")
        self.assertEqual(resp.status_code, 404)
        self.assertNotIn(b"<!DOCTYPE html>", resp.content)

    def test_known_api_path_still_works(self):
        self.assertEqual(self.client.get(reverse("invoice-list")).status_code, 200)

    def test_frontend_routes_still_serve_the_shell(self):
        resp = self.client.get("/billing/invoice/list")
        self.assertEqual(resp.status_code, 200)
