"""/api/products/:id/hsn_usage/ — the drill-down behind Top Products' "+N more".

Line items store product_name as text, so HSN drift accumulates silently.
The endpoint groups a product's line history by hsn_code and flags which
rows match the catalog, so the drift can actually be repaired.
"""

from decimal import Decimal as D

from django.urls import reverse

from billing.constants import INVOICE_TYPE_OUTWARD
from billing.models import Invoice, LineItem
from billing.tests.test_base import BaseAPITestCase


class ProductHsnUsageTest(BaseAPITestCase):
    def _invoice(self, number, date):
        return Invoice.objects.create(
            workspace_id=1, business=self.business, customer=self.customer,
            invoice_number=number, invoice_date=date,
            type_of_invoice=INVOICE_TYPE_OUTWARD, total_amount=0,
        )

    def _line(self, invoice, name, hsn, qty=1):
        return LineItem.objects.create(
            workspace_id=1, customer=self.customer, invoice=invoice,
            product_name=name, hsn_code=hsn, gst_tax_rate=D("0.03"),
            quantity=D(str(qty)), rate=D("100"), cgst=D("1.5"), sgst=D("1.5"),
            igst=D("0"), amount=D("103"), unit="gms",
        )

    def _usage(self):
        resp = self.client.get(reverse("product-hsn-usage", args=[self.product.id]))
        self.assertEqual(resp.status_code, 200, getattr(resp, "data", resp))
        return resp.data

    def test_groups_variants_and_flags_catalog_match(self):
        # self.product: name "Test Product", catalog HSN 711319.
        inv1 = self._invoice("HSN-U1", "2026-04-10")
        inv2 = self._invoice("HSN-U2", "2026-05-10")
        self._line(inv1, "Test Product", "711319")
        self._line(inv1, "Test Product", "711319")
        self._line(inv2, "Test Product", "711311")  # the drifted code

        data = self._usage()
        self.assertEqual(data["catalog_hsn"], "711319")
        by_code = {v["hsn_code"]: v for v in data["variants"]}
        self.assertTrue(by_code["711319"]["matches_catalog"])
        self.assertFalse(by_code["711311"]["matches_catalog"])
        # setUp's fixture line also carries 711319, so 2 + 1 = 3 there.
        self.assertEqual(by_code["711319"]["lines"], 3)
        self.assertEqual(by_code["711311"]["lines"], 1)
        # Ordered by usage: the majority code comes first.
        self.assertEqual(data["variants"][0]["hsn_code"], "711319")

    def test_usage_window_dates(self):
        self._line(self._invoice("HSN-U3", "2025-04-01"), "Test Product", "999999")
        self._line(self._invoice("HSN-U4", "2026-01-15"), "Test Product", "999999")
        data = self._usage()
        drifted = next(v for v in data["variants"] if v["hsn_code"] == "999999")
        self.assertEqual(str(drifted["first_used"]), "2025-04-01")
        self.assertEqual(str(drifted["last_used"]), "2026-01-15")

    def test_no_drift_is_a_single_matching_variant(self):
        data = self._usage()  # only the fixture line exists
        self.assertEqual(len(data["variants"]), 1)
        self.assertTrue(data["variants"][0]["matches_catalog"])

    def test_viewer_can_read(self):
        from django.contrib.auth.models import Group, User

        viewer = User.objects.create_user(username="ro", password="x")
        viewer.groups.add(Group.objects.get_or_create(name="viewer")[0])
        self.client.force_authenticate(user=viewer)
        resp = self.client.get(reverse("product-hsn-usage", args=[self.product.id]))
        self.assertEqual(resp.status_code, 200)
