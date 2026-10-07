"""The GST page's summary: what it says it files (M18, M29)."""

from decimal import Decimal as D

from django.contrib.auth.models import User
from django.urls import reverse
from rest_framework.test import APITestCase

from billing.models import Business, Customer, Invoice, LineItem


class GstSummaryCase(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="summary", password="pw", is_superuser=True, is_staff=True)
        self.client.force_authenticate(user=self.user)
        self.business = Business.objects.create(name="LODHA JEWELLERS", gst_number="08ABCDE1234A1Z5", state_name="RAJASTHAN")
        self.buyer = Customer.objects.create(name="LOCAL BUYER", state_name="RAJASTHAN")
        self.supplier = Customer.objects.create(name="SUPPLIER LTD", gst_number="08AAECD1234K1Z2", state_name="RAJASTHAN")
        self.mumbai = Customer.objects.create(name="MUMBAI BUYER", gst_number="27ABCDE1234A1Z5", state_name="MAHARASHTRA")

    def _bill(self, party, kind, number, taxable, cgst=0, sgst=0, igst=0, hsn="711319", business=None,
              date="2026-07-10"):
        inv = Invoice.objects.create(
            business=business or self.business, customer=party, invoice_number=number, invoice_date=date,
            type_of_invoice=kind, total_amount=D(taxable) + D(cgst) + D(sgst) + D(igst))
        LineItem.objects.create(
            invoice=inv, customer=party, product_name="Gold", hsn_code=hsn, gst_tax_rate=D("0.03"),
            quantity=D("1"), rate=D(taxable), cgst=D(cgst), sgst=D(sgst), igst=D(igst),
            amount=inv.total_amount)
        return inv

    def _summary(self, **params):
        base = {"start_date": "2026-07-01", "end_date": "2026-07-31", "business_id": self.business.id}
        base.update(params)
        r = self.client.get(reverse("invoice-gst-summary"), {k: v for k, v in base.items() if v is not None})
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        return r.data


class HsnSummaryTest(GstSummaryCase):
    def test_the_hsn_summary_counts_sales_only(self):
        """M18: 10 lakh of HSN 7113 sold and 8 lakh bought showed 18 lakh, in
        the Summary tab's HSN table and the CA CSV built from it."""
        self._bill(self.buyer, "outward", "S-1", "1000000", cgst="15000", sgst="15000", hsn="711319")
        self._bill(self.supplier, "inward", "P-1", "800000", cgst="12000", sgst="12000", hsn="711319")
        rows = self._summary()["hsn_summary"]
        self.assertEqual([(r["hsn_code"], r["taxable"], r["count"]) for r in rows], [("711319", 1000000.0, 1)])


class Rule88AUtilisationTest(GstSummaryCase):
    """M29: net payable subtracted credit head by head. With Rs 30,000 of IGST
    credit against Rs 18,000 + 18,000 of CGST/SGST due it showed both heads
    payable in full. Section 49(5) and Rule 88A: IGST credit goes to IGST,
    then to CGST and SGST, before any CGST or SGST credit is used; CGST
    credit never pays SGST, nor SGST credit CGST."""

    def _heads(self, cgst=0, sgst=0, igst=0):
        return {"cgst": D(cgst), "sgst": D(sgst), "igst": D(igst)}

    def test_igst_credit_pays_cgst_and_sgst(self):
        from billing.tax_rules import utilise_itc

        out = utilise_itc(self._heads(18000, 18000, 0), self._heads(0, 0, 30000))
        self.assertEqual(out["cash"], self._heads(0, 6000, 0) | {"total": D("6000")})
        self.assertEqual(out["carry_forward"]["total"], 0)

    def test_igst_credit_goes_first_where_own_credit_falls_short(self):
        from billing.tax_rules import utilise_itc

        out = utilise_itc(self._heads(100, 100, 0), self._heads(100, 0, 150))
        self.assertEqual(out["cash"]["total"], 0)
        self.assertEqual(out["carry_forward"], self._heads(50, 0, 0) | {"total": D("50")})

    def test_cgst_credit_never_pays_sgst(self):
        from billing.tax_rules import utilise_itc

        out = utilise_itc(self._heads(0, 100, 0), self._heads(100, 0, 0))
        self.assertEqual(out["cash"], self._heads(0, 100, 0) | {"total": D("100")})
        self.assertEqual(out["carry_forward"], self._heads(100, 0, 0) | {"total": D("100")})

    def test_cgst_and_sgst_credit_pay_igst_after_their_own_heads(self):
        from billing.tax_rules import utilise_itc

        out = utilise_itc(self._heads(50, 50, 100), self._heads(80, 80, 30))
        self.assertEqual(out["cash"], self._heads(0, 0, 10) | {"total": D("10")})

    def test_the_summary_nets_one_firm_by_rule_88a(self):
        self._bill(self.buyer, "outward", "S-1", "1200000", cgst="18000", sgst="18000")
        self._bill(self.mumbai, "inward", "P-1", "1000000", igst="30000")
        data = self._summary()
        self.assertEqual(data["gstr3b"]["net_payable"], {"cgst": 0.0, "sgst": 6000.0, "igst": 0.0, "total": 6000.0})
        self.assertEqual(data["effective"]["effective_net_tax"], 6000.0)
        self.assertNotIn("gstr1_3b_recon", data)  # it compared the sales with themselves

    def test_all_firms_have_no_net_payable(self):
        other = Business.objects.create(name="SECOND FIRM", gst_number="08AAGPL3375F1ZO", state_name="RAJASTHAN")
        self._bill(self.buyer, "outward", "S-1", "1200000", cgst="18000", sgst="18000")
        self._bill(self.mumbai, "inward", "P-1", "1000000", igst="30000", business=other)
        data = self._summary(business_id=None)
        self.assertIsNone(data["gstr3b"]["net_payable"])
        self.assertIsNone(data["effective"]["effective_net_tax"])
        self.assertIn("one firm", data["net_payable_note"])

    def test_the_3b_export_pays_by_rule_88a_too(self):
        self._bill(self.buyer, "outward", "S-1", "1200000", cgst="18000", sgst="18000")
        self._bill(self.mumbai, "inward", "P-1", "1000000", igst="30000")
        r = self.client.get(reverse("invoice-gstr-export"), {
            "business_id": self.business.id, "start_date": "2026-07-01", "end_date": "2026-07-31"})
        self.assertEqual(r.data["gstr3b"]["tax_pmt"], {"cgst": 0.0, "sgst": 6000.0, "igst": 0.0})


class MonthByMonthTest(GstSummaryCase):
    """Review of M29: GSTR-3B is filed month by month, but over a range (the
    page defaults to the FY) the credit order ran once over the totals, so
    August's credit paid July's tax and the cash due came out short."""

    def test_a_later_months_credit_does_not_pay_an_earlier_months_tax(self):
        self._bill(self.buyer, "outward", "S-1", "1200000", cgst="18000", sgst="18000", date="2026-07-10")
        self._bill(self.mumbai, "inward", "P-1", "1000000", igst="30000", date="2026-08-10")
        data = self._summary(start_date="2026-07-01", end_date="2026-08-31")
        self.assertEqual(data["gstr3b"]["net_payable"], {"cgst": 18000.0, "sgst": 18000.0, "igst": 0.0, "total": 36000.0})
        self.assertEqual(data["gstr3b"]["itc_carry_forward"]["igst"], 30000.0)

    def test_an_earlier_months_credit_carries_into_the_next(self):
        self._bill(self.mumbai, "inward", "P-1", "1000000", igst="30000", date="2026-07-10")
        self._bill(self.buyer, "outward", "S-1", "1200000", cgst="18000", sgst="18000", date="2026-08-10")
        data = self._summary(start_date="2026-07-01", end_date="2026-08-31")
        self.assertEqual(data["gstr3b"]["net_payable"]["total"], 6000.0)
        self.assertEqual(data["effective"]["effective_net_tax"], 6000.0)

    def test_the_3b_export_goes_month_by_month_too(self):
        self._bill(self.buyer, "outward", "S-1", "1200000", cgst="18000", sgst="18000", date="2026-07-10")
        self._bill(self.mumbai, "inward", "P-1", "1000000", igst="30000", date="2026-08-10")
        r = self.client.get(reverse("invoice-gstr-export"), {
            "business_id": self.business.id, "start_date": "2026-07-01", "end_date": "2026-08-31"})
        self.assertEqual(r.data["gstr3b"]["tax_pmt"], {"cgst": 18000.0, "sgst": 18000.0, "igst": 0.0})
