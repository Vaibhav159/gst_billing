from decimal import Decimal

from django.db import models
from django.test import TestCase

from billing.models import Business, Product, ShopSetting
from billing.tests.test_v3_rollback import v2_insert
from billing.tests.v3_helpers import ROLE_GROUPS, client_for, person


class RecordsFoundationTest(TestCase):
    def test_v2_inserts_get_database_defaults(self):
        pk = v2_insert("product", name="Old gold")
        product = Product.objects.get(pk=pk)
        self.assertEqual((product.kind, product.purity, product.usual_rate, product.purchase_only), (None, "", None, False))
        pk = v2_insert("business", name="OLD FIRM", address="Bazaar", gst_number="08ABCDE1234A1Z5", mobile_number="9000000003")
        business = Business.objects.get(pk=pk)
        self.assertEqual((business.short_name, business.city, business.pin_code, business.jurisdiction, business.declaration, business.signature_on_bills), ("", "", "", "", "", True))
        self.assertIsNone(ShopSetting.load().default_business_id)
        self.assertEqual(Product._meta.get_field("usual_rate").decimal_places, 3)
        self.assertEqual(Product._meta.get_field("usual_rate").max_digits, 15)

    def test_placed_staff_cannot_write_products_or_firms_or_read_audit(self):
        client = client_for(person("placed", *ROLE_GROUPS["staff"]))
        for url, key in [("/api/products/", "product.edit"), ("/api/businesses/", "firm.edit")]:
            response = client.post(url, {}, format="json")
            self.assertEqual(response.status_code, 403, response.data)
            self.assertEqual(response.data["needs"], key)
        self.assertEqual(client.get("/api/audit-logs/").status_code, 403)

    def test_unplaced_editor_keeps_v2_product_write(self):
        client = client_for(person("old-editor", "editor"))
        response = client.post("/api/products/", {"name": "Old silver", "hsn_code": "7113", "gst_tax_rate": "0.03"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(Product.objects.get(name="Old silver").gst_tax_rate, Decimal("0.03"))

    def test_non_null_additions_have_python_and_database_defaults(self):
        for model, names in [(Product, ("purity", "purchase_only")), (Business, ("short_name", "city", "pin_code", "jurisdiction", "declaration", "signature_on_bills"))]:
            for name in names:
                field = model._meta.get_field(name)
                self.assertTrue(field.has_default())
                self.assertIsNot(field.db_default, models.NOT_PROVIDED)

    def test_kind_is_nullable_and_effective_kind_is_read_only_on_v2(self):
        field = Product._meta.get_field("kind")
        self.assertTrue(field.null)
        self.assertIsNone(field.default)
        self.assertIsNone(field.db_default)
        client = client_for(person("kind-owner", *ROLE_GROUPS["owner"]))
        for value in (None, ""):
            response = client.post("/api/products/", {"name": f"Silver {value}", "hsn_code": "7113", "kind": value, "kind_effective": "diamond"}, format="json")
            self.assertEqual(response.status_code, 201, response.data)
            self.assertIsNone(response.data["kind"])
            self.assertEqual(response.data["kind_effective"], "silver")
            product = Product.objects.get(pk=response.data["id"])
            self.assertIsNone(product.kind)
            response = client.patch(f"/api/products/{product.pk}/", {"kind": "packing"}, format="json")
            self.assertEqual((response.data["kind"], response.data["kind_effective"]), ("packing", "packing"))
            response = client.patch(f"/api/products/{product.pk}/", {"kind": None}, format="json")
            self.assertEqual((response.data["kind"], response.data["kind_effective"]), (None, "silver"))

    def test_effective_kind_uses_one_inference_for_both_products_surfaces(self):
        for hsn, name, expected in [("7102", "Stone", "diamond"), ("7106", "Bar", "bullion"),
                                    ("7108", "Bar", "bullion"), ("7113", "Chandi", "silver"),
                                    ("7114", "Gold", "gold"), ("7117", "Silver", "silver"),
                                    ("9983", "Hallmark", "service"), ("9988", "Work", "service"),
                                    ("4819", "Box", "packing"), ("4823", "Box", "packing"),
                                    ("1234", "Unknown", "other")]:
            with self.subTest(hsn=hsn):
                product = Product(name=name, hsn_code=hsn, kind=None)
                self.assertEqual(product.kind_effective, expected)
                product.kind = "other"
                self.assertEqual(product.kind_effective, "other")
