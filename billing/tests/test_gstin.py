"""GSTIN validation, derivation, the Tally-backed lookup, and enrichment."""

from unittest.mock import patch

from django.core.cache import cache
from django.test import override_settings
from django.urls import reverse

from billing.gstin import _fetch_tally, check_digit, derive, enrich_customer, validate
from billing.models import Customer
from billing.tests.test_base import BaseAPITestCase

# Known-real: the firm's own GSTIN (repo docs) and GSTN's documented example.
REAL = ["08AAGPL3375F1ZO", "27AAPFU0939F1ZV"]

TALLY_PAYLOAD = {
    "status": 1,
    "message": "valid GSTIN",
    "gstin": "08AAGPL3375F1ZO",
    "validation_status": "VALID",
    "gstin_status": "Active",
    "trade_name": "LODHA JEWELLERS",
    "legal_name": "LODHA JEWELLERS",
    "registration_type": "Regular",
    "registration_date": "01/07/2017",
    "business_constitution": "Proprietorship",
    "address": "12, Bapu Bazar, Udaipur",
    "state": "Rajasthan",
    "city": "Udaipur",
    "pincode": "313001",
}


class GstinValidationTest(BaseAPITestCase):
    def test_known_real_gstins_pass(self):
        for g in REAL:
            ok, reason = validate(g)
            self.assertTrue(ok, f"{g}: {reason}")

    def test_flipped_check_digit_fails(self):
        for g in REAL:
            bad = g[:-1] + ("A" if g[-1] != "A" else "B")
            ok, reason = validate(bad)
            self.assertFalse(ok)
            self.assertIn("typo", reason)

    def test_wrong_length_and_shape(self):
        for g in ("", "08AAGPL3375F1Z", "08AAGPL3375F1ZO9", "08aagpl3375f1z!"):
            self.assertFalse(validate(g)[0])

    def test_unknown_state_code(self):
        # "45" is unassigned; note "99" IS a real code (Centre jurisdiction).
        body = "45AAGPL3375F1Z"
        g = body + check_digit(body)
        ok, reason = validate(g)
        self.assertFalse(ok)
        self.assertIn("state", reason.lower())

    def test_lowercase_input_is_normalised(self):
        self.assertTrue(validate("08aagpl3375f1zo")[0])

    def test_derive(self):
        d = derive("08AAGPL3375F1ZO")
        self.assertEqual(d["state_code"], "08")
        self.assertEqual(d["state_name"], "RAJASTHAN")
        self.assertEqual(d["pan"], "AAGPL3375F")


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

    def test_tally_lookup_fills_names_and_caches(self):
        with patch("billing.gstin.requests.post") as mock_post:
            mock_post.return_value.json.return_value = TALLY_PAYLOAD
            r1 = self._get("08AAGPL3375F1ZO")
            r2 = self._get("08AAGPL3375F1ZO")
        self.assertEqual(r1.data["source"], "provider")
        self.assertEqual(r1.data["legal_name"], "LODHA JEWELLERS")
        self.assertEqual(r1.data["status"], "Active")
        self.assertEqual(r1.data["constitution"], "Proprietorship")
        self.assertIn("Bapu Bazar", r1.data["address"])
        self.assertIn("313001", r1.data["address"])
        self.assertEqual(r2.data["source"], "cache")
        self.assertEqual(mock_post.call_count, 1, "second hit must come from cache")

    def test_registry_unreachable_degrades_to_derived_with_hint(self):
        with patch("billing.gstin.requests.post", side_effect=OSError("down")):
            r = self._get("08AAGPL3375F1ZO")
        self.assertTrue(r.data["valid"])
        self.assertEqual(r.data["source"], "checksum")
        self.assertEqual(r.data["pan"], "AAGPL3375F")
        self.assertIn("unreachable", r.data["hint"])

    def test_not_registered_payload_degrades_to_derived(self):
        with patch("billing.gstin.requests.post") as mock_post:
            mock_post.return_value.json.return_value = {"status": 0, "message": "invalid GSTIN"}
            r = self._get("08AAGPL3375F1ZO")
        self.assertEqual(r.data["source"], "checksum")
        self.assertNotIn("legal_name", r.data)

    def test_requires_auth(self):
        from rest_framework.test import APIClient

        r = APIClient().get(reverse("gstin-lookup", args=["08AAGPL3375F1ZO"]))
        self.assertEqual(r.status_code, 401)


class TallyMappingTest(BaseAPITestCase):
    def test_pincode_appended_once(self):
        with patch("billing.gstin.requests.post") as mock_post:
            mock_post.return_value.json.return_value = TALLY_PAYLOAD
            d = _fetch_tally("08AAGPL3375F1ZO")
        self.assertEqual(d["address"], "12, Bapu Bazar, Udaipur - 313001")

    def test_pincode_already_inside_address_not_duplicated(self):
        payload = {**TALLY_PAYLOAD, "address": "12, Bapu Bazar, Udaipur, 313001"}
        with patch("billing.gstin.requests.post") as mock_post:
            mock_post.return_value.json.return_value = payload
            d = _fetch_tally("08AAGPL3375F1ZO")
        self.assertEqual(d["address"].count("313001"), 1)

    def test_non_valid_statuses_return_none(self):
        for payload in ({"status": 0}, {"status": 1, "validation_status": "INVALID"}, [], "junk"):
            with patch("billing.gstin.requests.post") as mock_post:
                mock_post.return_value.json.return_value = payload
                self.assertIsNone(_fetch_tally("08AAGPL3375F1ZO"), payload)


class EnrichCustomerTest(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        cache.clear()

    def _cust(self, **kw):
        base = dict(workspace_id=1, name=kw.pop("name", "Enrich Target"),
                    gst_number="08AAGPL3375F1ZO")
        return Customer.objects.create(**{**base, **kw})

    def test_fills_empty_fields_only(self):
        c = self._cust(address="", state_name="", pan_number="")
        with patch("billing.gstin.requests.post") as mock_post:
            mock_post.return_value.json.return_value = TALLY_PAYLOAD
            changed = enrich_customer(c)
        self.assertTrue(changed)
        c.refresh_from_db()
        self.assertIn("Bapu Bazar", c.address)
        self.assertEqual(c.state_name, "RAJASTHAN")
        self.assertEqual(c.pan_number, "AAGPL3375F")

    def test_never_overwrites_human_data(self):
        c = self._cust(name="Curated", address="Hand-typed address",
                       state_name="RAJASTHAN", pan_number="AAGPL3375F")
        with patch("billing.gstin.requests.post") as mock_post:
            mock_post.return_value.json.return_value = TALLY_PAYLOAD
            changed = enrich_customer(c)
        self.assertFalse(changed)
        c.refresh_from_db()
        self.assertEqual(c.address, "Hand-typed address")

    def test_invalid_or_missing_gstin_is_a_noop(self):
        c1 = self._cust(name="No GSTIN", gst_number="")
        c2 = self._cust(name="Bad GSTIN", gst_number="08AAGPL3375F1ZZ")
        self.assertFalse(enrich_customer(c1))
        self.assertFalse(enrich_customer(c2))

    def test_registry_down_is_a_noop_not_an_error(self):
        c = self._cust(name="Offline", address="")
        with patch("billing.gstin.requests.post", side_effect=OSError("down")):
            self.assertFalse(enrich_customer(c) and False or enrich_customer(c) is True)
        c.refresh_from_db()
        self.assertEqual(c.address or "", "")


class CreationPathEnrichmentTest(BaseAPITestCase):
    """Every path that creates a party gets registry completion for free."""

    def setUp(self):
        super().setUp()
        cache.clear()

    def test_api_customer_create_is_enriched(self):
        with patch("billing.gstin.requests.post") as mock_post:
            mock_post.return_value.json.return_value = TALLY_PAYLOAD
            # Enrichment is deferred to after commit (audit D7); TestCase runs in a
            # transaction, so the callbacks must be run explicitly.
            with self.captureOnCommitCallbacks(execute=True):
                r = self.client.post(reverse("customer-list"), {
                    "name": "Fresh Party", "gst_number": "08AAGPL3375F1ZO",
                    "businesses": [self.business.id],
                }, format="json")
        self.assertEqual(r.status_code, 201, r.data)
        c = Customer.objects.get(id=r.data["id"])
        self.assertIn("Bapu Bazar", c.address or "")
        self.assertEqual(c.pan_number, "AAGPL3375F")

    def test_inward_capture_new_supplier_is_enriched(self):
        import json as _json

        with patch("billing.gstin.requests.post") as mock_post:
            mock_post.return_value.json.return_value = TALLY_PAYLOAD
            # Enrichment is deferred to after commit (audit D7); TestCase runs in a
            # transaction, so the callbacks must be run explicitly.
            with self.captureOnCommitCallbacks(execute=True):
                r = self.client.post(reverse("inward-bill-list"), {
                    "business_id": self.business.id,
                    "supplier_name": "ENRICHED SUPPLIER",
                    "supplier_gstin": "08AAGPL3375F1ZO",
                    "invoice_number": "ENR-1", "invoice_date": "2026-08-01",
                    "lines": _json.dumps([{"product_name": "Silver", "hsn_code": "711311",
                                           "quantity": "10", "rate": "100",
                                           "gst_tax_rate": "0.03", "unit": "gms"}]),
                })
        self.assertEqual(r.status_code, 201, r.data)
        sup = Customer.objects.get(name="ENRICHED SUPPLIER")
        self.assertIn("Bapu Bazar", sup.address or "")
