"""Part 4's registry wrapper: one lookup, normalized values, scoped throttling."""
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase, TransactionTestCase
from rest_framework.test import APIRequestFactory, force_authenticate
from rest_framework.throttling import SimpleRateThrottle

from billing.api.registry import RegistryView
from billing.gstin import lookup
from billing.tests.test_base import load_production_settings
from billing.tests.test_gstin import TALLY_PAYLOAD
from billing.tests.test_v3_cacheops import cacheops_on
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person

GSTIN = "08AAGPL3375F1ZO"


class RegistryTests(TestCase):
    def setUp(self):
        cache.clear()
        self.viewer = person("registry-viewer", *ROLE_GROUPS["viewer"])
        self.provider = patch("billing.gstin.requests.post")
        self.post = self.provider.start()
        self.addCleanup(self.provider.stop)
        self.post.return_value.json.return_value = TALLY_PAYLOAD
        self.rates = patch.object(SimpleRateThrottle, "THROTTLE_RATES", {"registry": "120/hour"})
        self.rates.start()
        self.addCleanup(self.rates.stop)
        self.addCleanup(cache.clear)

    def get(self, gstin=GSTIN, user=None):
        request = APIRequestFactory().get(f"/api/registry/{gstin}/")
        force_authenticate(request, self.viewer if user is None else user)
        return RegistryView.as_view()(request, gstin=gstin)

    def test_found_cache_and_on_file_contract(self):
        customer = buyer("Registry customer", gst_number=GSTIN.lower())
        business = firm("LODHA JEWELLERS", gstin=GSTIN, short_name="Lodha")
        first = self.get(GSTIN.lower())
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.data, {
            "gstin": GSTIN, "status": "found", "reason": "", "state_code": "08",
            "state_name": "RAJASTHAN", "pan": "AAGPL3375F", "lookup": "provider",
            "registry": {"legal_name": "LODHA JEWELLERS", "trade_name": "LODHA JEWELLERS",
                         "address": "12, Bapu Bazar, Udaipur - 313001", "city": "Udaipur",
                         "pin_code": "313001", "registered_on": "2017-07-01", "active": True,
                         "status_text": "Active", "taxpayer_type": "Regular", "constitution": "Proprietorship"},
            "on_file": {"customers": [{"id": customer.pk, "name": customer.name, "gst_number": GSTIN.lower(),
                                                 "mobile_number": "", "type": "business"}],
                        "firms": [{"id": business.pk, "name": business.name, "short": "Lodha"}]},
        })
        self.assertEqual(self.get().data["lookup"], "cache")
        self.assertEqual(self.post.call_count, 1)

    def test_invalid_has_null_fields_without_contacting_provider(self):
        for gstin in ("wrong", "08AAGPL3375F1ZZ", "_"):
            data = self.get(gstin).data
            self.assertEqual(data["status"], "invalid")
            self.assertTrue(data["reason"])
            for key in ("state_code", "state_name", "pan", "registry", "lookup", "on_file"):
                self.assertIsNone(data[key])
        self.post.assert_not_called()

    def test_provider_unreachable_or_no_record_keeps_offline_fields(self):
        self.post.side_effect = OSError("mock registry unavailable")
        data = self.get().data
        self.assertEqual((data["status"], data["lookup"], data["registry"]), ("unknown", "unreachable", None))
        self.assertEqual(data["pan"], "AAGPL3375F")
        self.post.side_effect = None
        self.post.return_value.json.return_value = {"status": 0}
        self.assertEqual(self.get().data["status"], "unknown")

    def test_old_cached_answers_get_city_pin_active_and_iso_date(self):
        cache.set("gstin_lookup:" + GSTIN, {"address": "21, Johari Bazar, Jaipur, 302003",
                  "status": "Suspended", "registration_date": "2021-03-15"})
        data = self.get().data["registry"]
        self.assertEqual((data["city"], data["pin_code"], data["active"]), ("Jaipur", "302003", False))
        self.assertEqual(data["registered_on"], "2021-03-15")
        self.post.assert_not_called()

    def test_lookup_enriches_legacy_shape_and_malformed_dates_degrade(self):
        self.post.return_value.json.return_value = {**TALLY_PAYLOAD, "address": "No usable postcode",
            "pincode": "", "gstin_status": "Cancelled", "registration_date": "not-a-date"}
        data = lookup(GSTIN)
        self.assertEqual((data["city"], data["pin_code"], data["active"]), ("", "", False))
        self.assertEqual(data["registered_on"], "")
        self.assertEqual(data["source"], "provider")

    def test_registry_rate_is_120_per_hour_per_person(self):
        for _ in range(120):
            self.assertEqual(self.get("bad").status_code, 200)
        self.assertEqual(self.get("bad").status_code, 429)
        another = person("registry-other", *ROLE_GROUPS["viewer"])
        self.assertEqual(self.get("bad", another).status_code, 200)

    def test_authentication_required(self):
        request = APIRequestFactory().get("/api/registry/bad/")
        self.assertEqual(RegistryView.as_view()(request, gstin="bad").status_code, 401)


class RegistryIntegrationTests(TransactionTestCase):
    def tearDown(self):
        cache.clear()
        super().tearDown()

    def test_registry_reads_around_cacheops_and_bounds_its_path(self):
        user = person("registry-path", *ROLE_GROUPS["viewer"])
        buyer("On file", gst_number=GSTIN)
        firm(gstin=GSTIN)
        client = client_for(user)
        with patch("billing.gstin.requests.post") as post, cacheops_on() as touched:
            post.return_value.json.return_value = TALLY_PAYLOAD
            self.assertEqual(client.get(f"/api/registry/{GSTIN}/").status_code, 200)
            self.assertEqual(client.get("/api/registry/" + "x" * 20 + "/").status_code, 200)
            self.assertEqual(client.get("/api/registry/" + "x" * 21 + "/").status_code, 404)
        self.assertEqual(touched, [])

    def test_production_keeps_the_registry_scope(self):
        self.assertEqual(load_production_settings().REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["registry"], "120/hour")
