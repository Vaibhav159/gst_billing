"""X-55 leftovers: SQL totals of quantity x rate round each line half-up to paise before adding."""

from decimal import Decimal as D

from django.urls import reverse

from billing.models import Invoice, LineItem
from billing.tests.test_gst_summary_returns import GstSummaryCase


class LineRoundedTaxableTest(GstSummaryCase):
    """1.5 x 0.15 = 0.225 per line: 0.23 + 0.23 = 0.46, where the raw sum rounds to 0.45."""

    def setUp(self):
        super().setUp()
        for kind, party, number in (("outward", self.buyer, "S-1"), ("inward", self.supplier, "P-1")):
            inv = Invoice.objects.create(business=self.business, customer=party, invoice_number=number,
                                         invoice_date="2026-07-10", type_of_invoice=kind, total_amount=D("0.46"))
            for _ in range(2):
                LineItem.objects.create(invoice=inv, customer=party, product_name="Gold", hsn_code="711319",
                                        gst_tax_rate=D("0"), quantity=D("1.5"), rate=D("0.15"), amount=D("0.23"))
            setattr(self, kind, inv)

    def test_the_invoice_summary_rounds_each_line(self):
        self.assertEqual(LineItem.get_invoice_summary(self.outward.id)["amount_without_tax"], D("0.46"))

    def test_the_gst_summary_rounds_each_line(self):
        data = self._summary()
        self.assertEqual([slab["taxable"] for slab in data["rate_slabs"]["outward"]], [0.46])
        self.assertEqual([slab["taxable"] for slab in data["rate_slabs"]["inward"]], [0.46])
        self.assertEqual([row["taxable"] for row in data["hsn_summary"]], [0.46])

    def test_the_gstr3b_export_rounds_each_line(self):
        r = self.client.get(reverse("invoice-gstr-export"),
                            {"start_date": "2026-07-01", "end_date": "2026-07-31", "business_id": self.business.id})
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.assertEqual(r.data["gstr3b"]["sup_details"]["osup_det"]["txval"], 0.46)
