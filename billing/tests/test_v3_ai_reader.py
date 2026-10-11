"""On-demand extraction tests use synthetic files and mocked processor methods."""
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone

from billing.models import AiRead
from billing.tests.test_v3_capture_files import upload
from billing.tests.v3_helpers import ROLE_GROUPS, client_for, firm, person

RAW = {"supplier": {"name": "Synthetic Supplier", "gst_number": ""}, "buyer": {"name": "", "gst_number": ""},
       "invoice_number": "SYN/1", "invoice_date": "2026-10-07", "payment_mode": "", "irn": "",
       "lines": [{"product_name": "Silver", "hsn_code": "7106", "gst_percent": "3", "printed_rate": "3%",
                  "quantity": "2", "unit": "gms", "rate": "100", "taxable": "200", "amount_only": False}],
       "printed_total": "206", "confidence": {key: "high" for key in ("supplier", "gstin", "bill_no", "date", "amounts")}}


class ReaderTest(TestCase):
    def setUp(self):
        self.media = TemporaryDirectory(dir=".")
        self.addCleanup(self.media.cleanup)
        self.override = override_settings(MEDIA_ROOT=self.media.name)
        self.override.enable()
        self.addCleanup(self.override.disable)
        self.user = person("read-counter", *ROLE_GROUPS["staff"])
        self.client = client_for(self.user)
        self.business = firm()

    def read(self, **data):
        return self.client.post("/api/purchases/read/", {"files": [upload()], **data}, format="multipart")

    def test_pdf_twin_gets_all_pages_once_and_success_counts(self):
        with patch("billing.utils.AIInvoiceProcessor.process_invoice_pdf", return_value=RAW) as reader:
            response = self.read(files=[upload("one.pdf"), upload("two.pdf")])
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["source"], "pdf")
        self.assertEqual(response.data["lines_total"], "206.00")
        self.assertEqual(len(reader.call_args.kwargs["pages"]), 2)
        self.assertEqual((AiRead.objects.get().ok, AiRead.objects.get().pages), (True, 2))
        self.assertEqual(self.client.get("/api/ai-reads/").data, {"month": timezone.localdate().strftime("%Y-%m"), "used": 1})

    def test_failed_read_is_finished_not_counted_and_does_not_leak_provider_error(self):
        with patch("billing.utils.AIInvoiceProcessor.process_invoice_pdf", side_effect=TimeoutError("secret")):
            response = self.read()
        self.assertEqual((response.status_code, response.data), (502, {"detail": "This bill couldn't be read just now. Nothing was filled in; try again in a moment.", "code": "read_failed"}))
        row = AiRead.objects.get()
        self.assertFalse(row.ok)
        self.assertEqual(self.client.get("/api/ai-reads/").data["used"], 0)

    def test_confidence_checks_and_off_slab_values(self):
        raw = {**RAW, "invoice_date": "not-date", "printed_total": "199", "supplier": {"name": "Bad checksum", "gst_number": "08AACFU5521R1Z0"},
               "lines": [{**RAW["lines"][0], "gst_percent": "2.5", "printed_rate": "2.5%"}]}
        with patch("billing.utils.AIInvoiceProcessor.process_invoice_pdf", return_value=raw):
            data = self.read().data
        self.assertIsNone(data["invoice_date"])
        self.assertIsNone(data["lines"][0]["gst_percent"])
        self.assertEqual(data["lines"][0]["printed_rate"], "2.5%")
        self.assertEqual([data["confidence"][key] for key in ("date", "gstin", "amounts")], ["medium"] * 3)
        self.assertGreaterEqual(len(data["notes"]), 3)

    def test_irn_makes_e_invoice_confidence_high(self):
        with patch("billing.utils.AIInvoiceProcessor.process_invoice_pdf", return_value={**RAW, "irn": "a" * 64}):
            data = self.read().data
        self.assertEqual(data["source"], "e-invoice")
        self.assertEqual(set(data["confidence"].values()), {"high"})

    def test_amount_only_and_rounding_note(self):
        raw = {**RAW, "printed_total": "205.50", "lines": [{**RAW["lines"][0], "amount_only": True, "quantity": None, "rate": None}]}
        with patch("billing.utils.AIInvoiceProcessor.process_invoice_pdf", return_value=raw):
            data = self.read().data
        self.assertIsNone(data["lines"][0]["quantity"])
        self.assertEqual(data["confidence"]["amounts"], "high")
        self.assertIn("likely round-off", data["notes"][0])

    def test_viewer_cannot_read_and_invalid_kind_has_words(self):
        response = self.read(kind="bad")
        self.assertEqual(response.status_code, 400)
        self.client = client_for(person("read-viewer", *ROLE_GROUPS["viewer"]))
        self.assertEqual(self.read().status_code, 403)

    def test_fake_reader_is_deterministic_and_sandbox_only(self):
        with override_settings(AI_READER="fake", AI_READER_ALLOW_FAKE=True), patch("billing.services.fake_reader.time.sleep") as sleep:
            first = self.read(files=[upload("UBS bill 0890.pdf")]).data
            second = self.read(files=[upload("UBS bill 0890.pdf")]).data
            self.assertEqual(first, second)
            self.assertEqual(first["invoice_number"], "UBS/26-27/0890")
            self.assertEqual(self.read(files=[upload("blur.pdf")]).status_code, 502)
            sleep.assert_called_with(1.5)
        with override_settings(AI_READER="fake", AI_READER_ALLOW_FAKE=False), patch("billing.utils.AIInvoiceProcessor.process_invoice_pdf", return_value=RAW) as actual:
            self.assertEqual(self.read().status_code, 200)
            actual.assert_called_once()

    def test_provider_keeps_pdf_mime_one_call_timeout_and_only_firm_gstins(self):
        from billing.utils import GEMINI_TIMEOUT_MS, AIInvoiceProcessor
        with override_settings(GEMINI_API_KEYS="synthetic-key-for-test", GEMINI_API_KEY=""), patch("google.genai.Client") as client:
            client.return_value.models.generate_content.return_value.text = __import__("json").dumps(RAW)
            response = self.read(files=[upload("one.pdf"), upload("two.pdf")])
        self.assertEqual(response.status_code, 200, response.data)
        client.assert_called_once()
        self.assertEqual(client.call_args.kwargs["http_options"].timeout, GEMINI_TIMEOUT_MS)
        call = client.return_value.models.generate_content.call_args.kwargs
        self.assertEqual([part["inline_data"]["mime_type"] for part in call["contents"][0]["parts"][1:]], ["application/pdf"] * 2)
        self.assertIn(self.business.gst_number, call["contents"][0]["parts"][0]["text"])
        self.assertNotIn("Synthetic Supplier", call["contents"][0]["parts"][0]["text"])
        self.assertIsNotNone(call["config"].response_schema)
        self.assertEqual(AIInvoiceProcessor.MAX_IMAGE_DIM, 1568)

    def test_fraction_shaped_printed_percents_are_off_slab(self):
        for percent in ("0.03", "0.28"):
            with self.subTest(percent=percent):
                raw = {**RAW, "lines": [{**RAW["lines"][0], "gst_percent": percent, "printed_rate": percent + "%"}]}
                with patch("billing.utils.AIInvoiceProcessor.process_invoice_pdf", return_value=raw):
                    data = self.read().data
                self.assertIsNone(data["lines"][0]["gst_percent"])
                self.assertEqual(data["confidence"]["amounts"], "medium")

    def test_read_totals_use_the_returned_three_place_operands(self):
        raw = {**RAW, "printed_total": None, "lines": [{**RAW["lines"][0], "quantity": "1.2345", "rate": "10000"}]}
        with patch("billing.utils.AIInvoiceProcessor.process_invoice_pdf", return_value=raw):
            data = self.read().data
        self.assertEqual((data["lines"][0]["quantity"], data["lines"][0]["taxable"], data["lines_total"]), ("1.235", "12350.00", "12720.50"))
        self.assertEqual(data["confidence"]["amounts"], "medium")
        raw["lines"][0]["quantity"] = "0"
        with patch("billing.utils.AIInvoiceProcessor.process_invoice_pdf", return_value=raw):
            self.assertEqual(self.read().data["confidence"]["amounts"], "medium")

    def test_provider_rotates_quota_exhausted_keys_within_one_deadline(self):
        import json
        from types import SimpleNamespace

        from billing.utils import GEMINI_TIMEOUT_MS, AIInvoiceProcessor
        with override_settings(GEMINI_API_KEYS="synthetic-first,synthetic-second", GEMINI_API_KEY=""), patch.dict(AIInvoiceProcessor._key_cooldowns, {}, clear=True), patch("google.genai.Client") as client:
            client.return_value.models.generate_content.side_effect = [Exception("429 RESOURCE_EXHAUSTED retry in 2s"), SimpleNamespace(text=json.dumps(RAW))]
            response = self.read()
            self.assertEqual(response.status_code, 200, response.data)
            self.assertTrue(AIInvoiceProcessor._is_cooled_down("synthetic-first"))
            self.assertEqual([call.kwargs["api_key"] for call in client.call_args_list], ["synthetic-first", "synthetic-second"])
            self.assertLessEqual(client.call_args_list[1].kwargs["http_options"].timeout, GEMINI_TIMEOUT_MS)
