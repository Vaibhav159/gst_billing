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
