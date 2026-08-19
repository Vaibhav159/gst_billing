"""GSTIN validation, derivation, and the lookup endpoint."""

from unittest.mock import patch

from django.core.cache import cache
from django.test import override_settings
from django.urls import reverse

from billing.gstin import check_digit, derive, validate
from billing.tests.test_base import BaseAPITestCase

# Known-real: the firm's own GSTIN (repo docs) and GSTN's documented example.
REAL = ["08AAGPL3375F1ZO", "27AAPFU0939F1ZV"]

GSTN_PAYLOAD = {
    "flag": True,
    "message": "GSTIN found",
    "data": {
        "gstin": "08AAGPL3375F1ZO",
        "lgnm": "LODHA JEWELLERS",
        "tradeNam": "LODHA JEWELLERS",
        "sts": "Active",
        "dty": "Regular",
        "rgdt": "01/07/2017",
        "pradr": {"addr": {"bno": "12", "st": "Bapu Bazar", "loc": "Udaipur",
                           "dst": "Udaipur", "pncd": "313001"}},
    },
}


class GstinValidationTest(BaseAPITestCase):
    def test_known_real_gstins_pass(self):
        for g in REAL:
            ok, reason = validate(g)
            self.assertTrue(ok, f"{g}: {reason}")

    def test_flipped_check_digit_fails(self):
        g = REAL[0]
        bad = g[:14] + ("A" if g[14] != "A" else "B")
        ok, reason = validate(bad)
        self.assertFalse(ok)
        self.assertIn("typo", reason)

    def test_wrong_length_and_shape(self):
        self.assertFalse(validate("08AAGPL3375F1Z")[0])       # 14 chars
        self.assertFalse(validate("XXAAGPL3375F1ZO")[0])      # non-numeric state
        self.assertFalse(validate("")[0])

    def test_unknown_state_code(self):
        # keep the checksum valid for a '00' prefix so the state check is what fails
        body = "00AAGPL3375F1Z"
        ok, reason = validate(body + check_digit(body))
        self.assertFalse(ok)
        self.assertIn("state code", reason)

    def test_lowercase_input_is_normalised(self):
        self.assertTrue(validate(REAL[0].lower())[0])

    def test_derive(self):
        d = derive("08AAGPL3375F1ZO")
        self.assertEqual(d["state_code"], "08")
        self.assertEqual(d["state_name"], "RAJASTHAN")
        self.assertEqual(d["pan"], "AAGPL3375F")


@override_settings(GSTIN_API_KEY="", GSTIN_API_URL="https://example.invalid/check")
class GstinEndpointTest(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        cache.clear()

    def _get(self, g):
        return self.client.get(reverse("gstin-lookup", args=[g]))

    def test_invalid_gstin_is_200_with_reason(self):
        r = self._get("08AAGPL3375F1ZZ")
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.data["valid"])
        self.assertIn("typo", r.data["reason"])

    def test_derived_mode_without_key(self):
        r = self._get("08AAGPL3375F1ZO")
        self.assertTrue(r.data["valid"])
        self.assertEqual(r.data["source"], "checksum")
        self.assertEqual(r.data["state_name"], "RAJASTHAN")
        self.assertEqual(r.data["pan"], "AAGPL3375F")
        self.assertIn("GSTIN_API_KEY", r.data["hint"])

    @override_settings(GSTIN_API_KEY="k-test")
    def test_provider_mode_fills_names_and_caches(self):
        with patch("billing.gstin.requests.get") as mock_get:
            mock_get.return_value.json.return_value = GSTN_PAYLOAD
            r1 = self._get("08AAGPL3375F1ZO")
            r2 = self._get("08AAGPL3375F1ZO")
        self.assertEqual(r1.data["source"], "provider")
        self.assertEqual(r1.data["legal_name"], "LODHA JEWELLERS")
        self.assertEqual(r1.data["status"], "Active")
        self.assertIn("Bapu Bazar", r1.data["address"])
        self.assertIn("313001", r1.data["address"])
        self.assertEqual(r2.data["source"], "cache")
        self.assertEqual(mock_get.call_count, 1, "second hit must come from cache")

    @override_settings(GSTIN_API_KEY="k-test")
    def test_provider_failure_still_returns_derived_fields(self):
        with patch("billing.gstin.requests.get", side_effect=OSError("down")):
            r = self._get("08AAGPL3375F1ZO")
        self.assertTrue(r.data["valid"])
        self.assertEqual(r.data["source"], "checksum")
        self.assertEqual(r.data["pan"], "AAGPL3375F")

    def test_requires_auth(self):
        from rest_framework.test import APIClient
        r = APIClient().get(reverse("gstin-lookup", args=["08AAGPL3375F1ZO"]))
        self.assertEqual(r.status_code, 401)


@override_settings(GSTIN_PROVIDER="cleartax", CLEARTAX_HOST="https://ct.example",
                   CLEARTAX_AUTH_TOKEN="tok-1", CLEARTAX_ENTITY_ID="ent-1",
                   GSTIN_API_KEY="")
class ClearTaxProviderTest(BaseAPITestCase):
    """ClearTax adapter: header auth, top-level GSTN-shaped payload."""

    def setUp(self):
        super().setUp()
        cache.clear()

    def test_cleartax_payload_maps_and_caches(self):
        top_level = dict(GSTN_PAYLOAD["data"])  # ClearTax returns the object unwrapped
        with patch("billing.gstin.requests.get") as mock_get:
            mock_get.return_value.status_code = 200
            mock_get.return_value.json.return_value = top_level
            r1 = self.client.get(reverse("gstin-lookup", args=["08AAGPL3375F1ZO"]))
            r2 = self.client.get(reverse("gstin-lookup", args=["08AAGPL3375F1ZO"]))
        self.assertEqual(r1.data["source"], "provider")
        self.assertEqual(r1.data["legal_name"], "LODHA JEWELLERS")
        self.assertIn("313001", r1.data["address"])
        self.assertEqual(r2.data["source"], "cache")
        self.assertEqual(mock_get.call_count, 1)
        url = mock_get.call_args.args[0]
        self.assertIn("/gst/api/v0.2/taxable_entities/ent-1/gstin_verification", url)
        self.assertEqual(mock_get.call_args.kwargs["headers"]["X-Cleartax-Auth-Token"], "tok-1")

    @override_settings(CLEARTAX_AUTH_TOKEN="")
    def test_missing_cleartax_config_degrades_to_derived_with_hint(self):
        r = self.client.get(reverse("gstin-lookup", args=["08AAGPL3375F1ZO"]))
        self.assertEqual(r.data["source"], "checksum")
        self.assertIn("cleartax", r.data["hint"].lower())


@override_settings(GSTIN_PROVIDER="knowyourgst", KNOWYOURGST_API_KEY="kyg-1",
                   GSTIN_API_KEY="", CLEARTAX_AUTH_TOKEN="")
class KnowYourGstProviderTest(BaseAPITestCase):
    """KnowYourGST uses hyphenated keys and a structured address — its own
    mapping, unlike the two GSTN-shaped providers."""

    PAYLOAD = {
        "gstin": "08AAGPL3375F1ZO",
        "legal-name": "LODHA JEWELLERS",
        "trade-name": "LODHA JEWELLERS",
        "status": "Active",
        "registration-date": "01/07/2017",
        "dealer-type": "Regular",
        "pan": "AAGPL3375F",
        "address": {"street": "Bapu Bazar", "city": "Udaipur",
                    "state": "Rajasthan", "pincode": "313001"},
    }

    def setUp(self):
        super().setUp()
        cache.clear()

    def _call(self, payload, status_code=200):
        with patch("billing.gstin.requests.get") as mock_get:
            mock_get.return_value.status_code = status_code
            mock_get.return_value.json.return_value = payload
            resp = self.client.get(reverse("gstin-lookup", args=["08AAGPL3375F1ZO"]))
        return resp, mock_get

    def test_maps_hyphenated_fields_and_composes_address(self):
        resp, mock_get = self._call(self.PAYLOAD)
        self.assertEqual(resp.data["source"], "provider")
        self.assertEqual(resp.data["legal_name"], "LODHA JEWELLERS")
        self.assertEqual(resp.data["status"], "Active")
        self.assertEqual(resp.data["taxpayer_type"], "Regular")
        for fragment in ("Bapu Bazar", "Udaipur", "Rajasthan", "313001"):
            self.assertIn(fragment, resp.data["address"])
        self.assertEqual(mock_get.call_args.kwargs["headers"]["passthrough"], "kyg-1")

    def test_address_dedupes_repeated_values(self):
        payload = dict(self.PAYLOAD)
        payload["address"] = {"city": "Udaipur", "district": "Udaipur", "pincode": "313001"}
        resp, _ = self._call(payload)
        self.assertEqual(resp.data["address"].count("Udaipur"), 1)

    def test_unknown_address_keys_still_included(self):
        payload = dict(self.PAYLOAD)
        payload["address"] = {"street": "Bapu Bazar", "landmark": "Near Clock Tower"}
        resp, _ = self._call(payload)
        self.assertIn("Near Clock Tower", resp.data["address"])

    def test_empty_result_degrades_to_derived(self):
        resp, _ = self._call({"gstin": "08AAGPL3375F1ZO"})   # no names
        self.assertEqual(resp.data["source"], "checksum")
        self.assertEqual(resp.data["pan"], "AAGPL3375F")

    def test_unknown_provider_name_is_safe(self):
        with override_settings(GSTIN_PROVIDER="not-a-provider"):
            resp = self.client.get(reverse("gstin-lookup", args=["08AAGPL3375F1ZO"]))
        self.assertTrue(resp.data["valid"])
        self.assertEqual(resp.data["source"], "checksum")


@override_settings(GSTIN_PROVIDER="appyflow", APPYFLOW_KEY_SECRET="af-1",
                   GSTIN_API_KEY="", CLEARTAX_AUTH_TOKEN="", KNOWYOURGST_API_KEY="")
class AppyFlowProviderTest(BaseAPITestCase):
    """AppyFlow — largest free tier (50). GSTN-shaped fields inside taxpayerInfo."""

    def setUp(self):
        super().setUp()
        cache.clear()

    def test_taxpayerinfo_wrapper_is_unwrapped(self):
        with patch("billing.gstin.requests.get") as mock_get:
            mock_get.return_value.status_code = 200
            mock_get.return_value.json.return_value = {"taxpayerInfo": GSTN_PAYLOAD["data"]}
            r = self.client.get(reverse("gstin-lookup", args=["08AAGPL3375F1ZO"]))
        self.assertEqual(r.data["source"], "provider")
        self.assertEqual(r.data["legal_name"], "LODHA JEWELLERS")
        self.assertIn("313001", r.data["address"])
        params = mock_get.call_args.kwargs["params"]
        self.assertEqual(params["gstNo"], "08AAGPL3375F1ZO")
        self.assertEqual(params["key_secret"], "af-1")

    def test_error_flag_degrades_to_derived(self):
        with patch("billing.gstin.requests.get") as mock_get:
            mock_get.return_value.status_code = 200
            mock_get.return_value.json.return_value = {"error": True, "message": "quota over"}
            r = self.client.get(reverse("gstin-lookup", args=["08AAGPL3375F1ZO"]))
        self.assertTrue(r.data["valid"])
        self.assertEqual(r.data["source"], "checksum")
        self.assertEqual(r.data["state_name"], "RAJASTHAN")


class GstinCacheTtlTest(BaseAPITestCase):
    """A long TTL is what makes a small free tier last — assert it's honoured."""

    def setUp(self):
        super().setUp()
        cache.clear()

    @override_settings(GSTIN_API_KEY="k", GSTIN_PROVIDER="gstincheck",
                       GSTIN_CACHE_SECONDS=1234)
    def test_configured_ttl_is_passed_to_cache(self):
        with patch("billing.gstin.requests.get") as mock_get, \
             patch("billing.gstin.cache.set") as mock_set:
            mock_get.return_value.json.return_value = GSTN_PAYLOAD
            self.client.get(reverse("gstin-lookup", args=["08AAGPL3375F1ZO"]))
        self.assertEqual(mock_set.call_args.args[2], 1234)

    @override_settings(GSTIN_API_KEY="k", GSTIN_PROVIDER="gstincheck")
    def test_default_ttl_is_180_days(self):
        with patch("billing.gstin.requests.get") as mock_get, \
             patch("billing.gstin.cache.set") as mock_set:
            mock_get.return_value.json.return_value = GSTN_PAYLOAD
            self.client.get(reverse("gstin-lookup", args=["08AAGPL3375F1ZO"]))
        self.assertEqual(mock_set.call_args.args[2], 60 * 60 * 24 * 180)
