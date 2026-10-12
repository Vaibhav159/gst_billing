from django.test import TestCase

from billing.models import AuditLog, ShopSetting
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person, sale


class RecordsSettingsTest(TestCase):
    def setUp(self):
        self.owner = person("settings-owner", *ROLE_GROUPS["owner"])
        self.client = client_for(self.owner)
        self.firm = firm()

    def test_default_firm_validated_audited_and_noop(self):
        response = self.client.put("/api/shop-settings/", {"default_business": self.firm.pk}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["default_business_name"], self.firm.name)
        self.assertEqual(AuditLog.objects.get(entity="settings").changes["default_business"]["new"], self.firm.name)
        at = ShopSetting.objects.get().updated_at
        self.client.put("/api/shop-settings/", {"default_business": self.firm.pk}, format="json")
        self.assertEqual(AuditLog.objects.count(), 1)
        self.assertEqual(ShopSetting.objects.get().updated_at, at)
        for value in [True, [], "9" * 30, 9999]:
            response = self.client.put("/api/shop-settings/", {"default_business": value}, format="json")
            self.assertEqual(response.status_code, 400)
            self.assertEqual(str(response.data["default_business"][0]), "Pick a firm from the list.")

    def test_a_firm_deleted_while_saving_gives_words_not_a_dangling_default(self):
        from unittest.mock import patch

        from billing.api import shop
        real = shop.valid

        def valid_then_deleted(*args, **kwargs):
            data = real(*args, **kwargs)
            type(self.firm).objects.filter(pk=self.firm.pk).delete()
            return data
        with patch.object(shop, "valid", side_effect=valid_then_deleted):
            response = self.client.put("/api/shop-settings/", {"default_business": self.firm.pk}, format="json")
        self.assertEqual((response.status_code, str(response.data["default_business"][0])), (400, "Pick a firm from the list."))
        self.assertFalse(ShopSetting.objects.filter(default_business_id=self.firm.pk).exists())
        self.assertFalse(AuditLog.objects.exists())

    def test_share_placeholder_words_and_warnings(self):
        for message, words in [
            ("Hi {unknown}", "{unknown} isn't something the app can fill in. Use {customer}, {number}, {total}, {firm} or {date}."),
            ("{x} {y}", "{x}, {y} aren't something the app can fill in. Use {customer}, {number}, {total}, {firm} or {date}."),
            ("Hi {number", "A brace is left open. Each placeholder needs { and }."),
            ("Hi {{number}}", "A brace is left open. Each placeholder needs { and }."),
        ]:
            response = self.client.put("/api/shop-settings/", {"share_message": message}, format="json")
            self.assertEqual(response.status_code, 400)
            self.assertEqual(str(response.data["share_message"][0]), words)
        response = self.client.put("/api/shop-settings/", {"share_message": "From {firm}"}, format="json")
        self.assertEqual(response.data["warnings"], ["Customers find bills by number. Consider adding {number}."])
        response = self.client.put("/api/shop-settings/", {"share_message": "{number}"}, format="json")
        self.assertEqual(response.data["warnings"], [])

    def test_setup_is_read_only_counts_active_and_hides_people(self):
        customer = buyer()
        buyer("Walk-in Customer", customer_type="walkin")
        sale(self.firm, customer, "1", "2026-10-01")
        sale(self.firm, customer, "2", "2026-10-01", status="cancelled")
        response = self.client.get("/api/setup/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["bills"], {"count": 1, "cancelled": 1})
        self.assertEqual(response.data["customers"], {"count": 1, "names": [customer.name]})
        self.assertEqual(response.data["people"], 1)
        self.assertEqual(ShopSetting.objects.count(), 0)
        viewer = client_for(person("settings-viewer", *ROLE_GROUPS["viewer"]))
        self.assertIsNone(viewer.get("/api/setup/").data["people"])
        self.assertEqual(viewer.put("/api/shop-settings/", {"copies": "all"}, format="json").status_code, 403)
