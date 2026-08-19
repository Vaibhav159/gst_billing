"""Product.default_unit — the unit an invoice line adopts when a product is
picked (PR #55's idea, ported to the V2 stack).

LineItem.unit stays deliberately free-text (historical rows say things like
"nos"), so these tests pin the boundary: the Product default is constrained
to the canonical choices, the line item is not.
"""

from django.urls import reverse

from billing.constants import UNIT_CHOICES, UNIT_GMS, UNIT_TO_GRAM
from billing.models import Product
from billing.tests.test_base import BaseAPITestCase


class ProductDefaultUnitTest(BaseAPITestCase):
    def _create(self, **extra):
        payload = {"name": extra.pop("name", "Unit Test Ring"), "hsn_code": "711319",
                   "gst_tax_rate": "0.03", **extra}
        return self.client.post(reverse("product-list"), payload, format="json")

    def test_defaults_to_gms_when_omitted(self):
        resp = self._create(name="Plain Gold Ring")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["default_unit"], UNIT_GMS)
        self.assertEqual(Product.objects.get(id=resp.data["id"]).default_unit, "gms")

    def test_accepts_any_canonical_unit(self):
        resp = self._create(name="Anklet Pair", default_unit="pair")
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["default_unit"], "pair")

    def test_rejects_a_unit_outside_the_canon(self):
        resp = self._create(name="Mystery Item", default_unit="furlongs")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("default_unit", resp.data)

    def test_patch_changes_the_default(self):
        created = self._create(name="Silver Coin", default_unit="pcs")
        url = reverse("product-detail", args=[created.data["id"]])
        resp = self.client.patch(url, {"default_unit": "tola"}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["default_unit"], "tola")

    def test_existing_products_backfilled_to_gms(self):
        # The migration default must cover rows created before the field
        # existed — the fixture product predates any explicit unit.
        resp = self.client.get(
            reverse("product-detail", args=[self.product.id])
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["default_unit"], UNIT_GMS)


class UnitCanonTest(BaseAPITestCase):
    def test_ui_mirror_and_backend_canon_agree(self):
        # sweet-rebuild-suite-main/src/utils/mockData.ts (itemUnits) must list
        # exactly these keys. If this test moves, move the mirror with it.
        self.assertEqual(
            [key for key, _ in UNIT_CHOICES],
            ["gms", "g", "kg", "pcs", "unit", "nos", "mtr", "ltr", "ml",
             "box", "pair", "ct", "oz", "tola", "set", "dozen"],
        )

    def test_gram_conversions_cover_only_mass_units(self):
        # pcs -> grams was the original draft's bug: a count is not a weight.
        self.assertNotIn("pcs", UNIT_TO_GRAM)
        self.assertEqual(UNIT_TO_GRAM["kg"], 1000)
        self.assertEqual(UNIT_TO_GRAM["ct"] * 5, 1)  # 5 carats to the gram
