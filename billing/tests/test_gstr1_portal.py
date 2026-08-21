"""GSTR-1 portal JSON — the file must import into the GSTN offline tool as-is.

Fixture set covers every classification the portal distinguishes, including
the case the old gstr_export dropped entirely: inter-state B2C at or under
the B2CL threshold, which must land in b2cs as an INTER row.
"""

import json
from decimal import Decimal as D

from django.urls import reverse

from billing.models import Customer, Invoice, LineItem
from billing.tests.test_base import BaseAPITestCase


class Gstr1PortalJsonTest(BaseAPITestCase):
    maxDiff = None

    def setUp(self):
        super().setUp()
        # Business GSTIN 22AAAAA0000A1Z5 → state 22. The base fixture pairs it
        # with state_name MAHARASHTRA; align the name so the B2C direction
        # fallback (state-name comparison) agrees with the GSTIN.
        self.business.state_name = "CHHATTISGARH"
        self.business.save(update_fields=["state_name"])
        self.reg_intra = Customer.objects.create(
            workspace_id=1, name="Registered Intra",
            gst_number="22CCCCC0000C1Z5", state_name="CHHATTISGARH")
        self.reg_inter = Customer.objects.create(
            workspace_id=1, name="Registered Inter",
            gst_number="08DDDDD0000D1Z5", state_name="RAJASTHAN")
        self.b2c_intra = Customer.objects.create(
            workspace_id=1, name="Walk-in Local", state_name="CHHATTISGARH")
        self.b2c_inter_small = Customer.objects.create(
            workspace_id=1, name="Small Outstation", state_name="RAJASTHAN")
        self.b2c_inter_large = Customer.objects.create(
            workspace_id=1, name="Big Outstation", state_name="RAJASTHAN")
        for c in (self.reg_intra, self.reg_inter, self.b2c_intra,
                  self.b2c_inter_small, self.b2c_inter_large):
            c.businesses.add(self.business)

    def _invoice(self, customer, number, taxable, cgst=0, sgst=0, igst=0,
                 date="2026-07-15", hsn="711311", unit="gms"):
        total = D(taxable) + D(cgst) + D(sgst) + D(igst)
        inv = Invoice.objects.create(
            workspace_id=1, business=self.business, customer=customer,
            invoice_number=number, invoice_date=date,
            type_of_invoice="outward", total_amount=total)
        LineItem.objects.create(
            workspace_id=1, customer=customer, invoice=inv,
            product_name="Silver Item", hsn_code=hsn,
            gst_tax_rate=D("0.03"), quantity=D(taxable), rate=D("1"),
            cgst=D(cgst), sgst=D(sgst), igst=D(igst), unit=unit,
            amount=total)
        return inv

    def _get(self, **params):
        base = {"business_id": self.business.id, "month": 7, "year": 2026}
        base.update(params)
        return self.client.get(reverse("invoice-gstr1-portal-json"), base)

    def _standard_fixture(self):
        self._invoice(self.reg_intra, "R-1", "10000", cgst="150", sgst="150")
        self._invoice(self.reg_inter, "R-2", "20000", igst="600")
        self._invoice(self.b2c_intra, "C-1", "5000", cgst="75", sgst="75")
        self._invoice(self.b2c_inter_small, "C-2", "40000", igst="1200")
        self._invoice(self.b2c_inter_large, "C-3", "300000", igst="9000")

    def test_header_and_sections(self):
        self._standard_fixture()
        resp = self._get()
        self.assertEqual(resp.status_code, 200, resp.data)
        f = resp.data["file"]
        self.assertEqual(f["gstin"], "22AAAAA0000A1Z5")
        self.assertEqual(f["fp"], "072026")
        self.assertEqual(sorted(f["b2b"][0]["ctin"] for _ in [0]), [f["b2b"][0]["ctin"]])
        self.assertEqual({g["ctin"] for g in f["b2b"]},
                         {"22CCCCC0000C1Z5", "08DDDDD0000D1Z5"})
        # File must be pure JSON (portal parses it byte-for-byte).
        json.dumps(f)

    def test_b2b_rates_aggregated_and_pos_from_ctin(self):
        self._standard_fixture()
        f = self._get().data["file"]
        inter = next(g for g in f["b2b"] if g["ctin"] == "08DDDDD0000D1Z5")
        inv = inter["inv"][0]
        self.assertEqual(inv["pos"], "08")
        self.assertEqual(inv["rchrg"], "N")
        self.assertEqual(inv["inv_typ"], "R")
        self.assertEqual(inv["itms"], [{"num": 1, "itm_det": {
            "txval": 20000.0, "rt": 3.0, "camt": 0.0, "samt": 0.0,
            "iamt": 600.0, "csamt": 0}}])

    def test_interstate_b2c_under_threshold_lands_in_b2cs_as_inter(self):
        """The bug fix: these sales used to vanish from the return."""
        self._standard_fixture()
        f = self._get().data["file"]
        inter_rows = [b for b in f["b2cs"] if b["sply_ty"] == "INTER"]
        self.assertEqual(len(inter_rows), 1)
        row = inter_rows[0]
        self.assertEqual(row["pos"], "08")
        self.assertEqual(row["txval"], 40000.0)
        self.assertEqual(row["iamt"], 1200.0)
        self.assertNotIn("camt", row)

    def test_intra_b2c_lands_in_b2cs_as_intra(self):
        self._standard_fixture()
        f = self._get().data["file"]
        intra = next(b for b in f["b2cs"] if b["sply_ty"] == "INTRA")
        self.assertEqual(intra["pos"], "22")
        self.assertEqual(intra["txval"], 5000.0)
        self.assertEqual(intra["camt"], 75.0)
        self.assertEqual(intra["samt"], 75.0)
        self.assertNotIn("iamt", intra)

    def test_large_interstate_b2c_lands_in_b2cl_grouped_by_pos(self):
        self._standard_fixture()
        f = self._get().data["file"]
        self.assertEqual(len(f["b2cl"]), 1)
        grp = f["b2cl"][0]
        self.assertEqual(grp["pos"], "08")
        self.assertEqual(grp["inv"][0]["val"], 309000.0)
        self.assertEqual(grp["inv"][0]["itms"][0]["itm_det"]["iamt"], 9000.0)
        self.assertNotIn("camt", grp["inv"][0]["itms"][0]["itm_det"])

    def test_taxable_total_reconciles_across_sections(self):
        self._standard_fixture()
        data = self._get().data
        f = data["file"]
        sections = sum(b["txval"] for b in f["b2cs"])
        sections += sum(i["itm_det"]["txval"]
                        for g in f["b2b"] for v in g["inv"] for i in v["itms"])
        sections += sum(i["itm_det"]["txval"]
                        for g in f["b2cl"] for v in g["inv"] for i in v["itms"])
        self.assertEqual(sections, 375000.0)
        self.assertEqual(data["meta"]["taxable_total"], 375000.0)
        hsn_total = sum(h["txval"] for h in f["hsn"]["data"])
        self.assertEqual(hsn_total, 375000.0)

    def test_hsn_summary_units_and_rates(self):
        self._standard_fixture()
        f = self._get().data["file"]
        rows = f["hsn"]["data"]
        self.assertEqual(len(rows), 1)  # same hsn+uqc+rate everywhere
        self.assertEqual(rows[0]["hsn_sc"], "711311")
        self.assertEqual(rows[0]["uqc"], "GMS")
        self.assertEqual(rows[0]["qty"], 375000.0)

    def test_unfilable_invoices_are_skipped_and_reported(self):
        self._standard_fixture()
        no_number = self._invoice(self.b2c_intra, "TMP", "999", cgst="15", sgst="15")
        no_number.invoice_number = ""
        no_number.save(update_fields=["invoice_number"])
        data = self._get().data
        self.assertEqual(len(data["meta"]["skipped"]), 1)
        self.assertIn("missing invoice number", data["meta"]["skipped"][0])
        intra = next(b for b in data["file"]["b2cs"] if b["sply_ty"] == "INTRA")
        self.assertEqual(intra["txval"], 5000.0, "skipped invoice must not leak into totals")

    def test_month_scoping_excludes_other_months(self):
        self._standard_fixture()
        self._invoice(self.b2c_intra, "AUG-1", "7777", cgst="116.66", sgst="116.66",
                      date="2026-08-02")
        f = self._get().data["file"]
        intra = next(b for b in f["b2cs"] if b["sply_ty"] == "INTRA")
        self.assertEqual(intra["txval"], 5000.0)

    def test_business_without_gstin_is_400(self):
        self.business.gst_number = ""
        self.business.save(update_fields=["gst_number"])
        resp = self._get()
        self.assertEqual(resp.status_code, 400)
        self.assertIn("GSTIN", resp.data["error"])

    def test_missing_month_is_400(self):
        resp = self.client.get(reverse("invoice-gstr1-portal-json"),
                               {"business_id": self.business.id})
        self.assertEqual(resp.status_code, 400)
