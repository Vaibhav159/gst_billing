"""Part 4 firms: narrow reads, legal identity and live print settings."""
from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from billing.models import FiledPeriod
from billing.services.bin import bin_bill
from billing.tests.v3_helpers import buyer, client_for, firm, line, person, sale


class FirmReadTests(TestCase):
    def setUp(self):
        self.owner = person("firm-owner", "admin")
        self.client = client_for(self.owner)
        self.firm = firm(invoice_prefix="KGH")
        self.buyer = buyer()

    def test_slim_list_has_only_contract_keys_and_no_writes(self):
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get("/api/firms/")
        self.assertEqual(response.status_code, 200)
        row = response.data["results"][0]
        self.assertEqual(set(row), {"id", "name", "short", "short_name", "gst_number", "state_code", "state_name",
                                    "invoice_prefix", "city", "paper_full_number_from"})
        self.assertEqual(row["short"], "Kiran")
        sql = " ".join(q["sql"] for q in queries)
        self.assertNotIn('"bank_account_number"', sql)
        self.assertFalse(any(q["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE")) for q in queries))

    @patch("billing.services.firms.timezone.localdate", return_value=date(2026, 10, 8))
    def test_figures_group_tax_without_multiplying_bill_total(self, today):
        first = sale(self.firm, self.buyer, "1", "2026-04-01", line(), line(rate="20000"))
        sale(self.firm, self.buyer, "2", "2026-09-10", status="cancelled")
        sale(self.firm, self.buyer, "3", "2026-09-12", line(rate="5000"), kind="inward")
        sale(self.firm, self.buyer, "4", "2026-03-31")
        FiledPeriod.objects.create(business=self.firm, year=2026, month=9)
        response = self.client.get("/api/firms/", {"figures": "1", "fy": "2026-27"})
        self.assertEqual(response.status_code, 200, getattr(response, "data", None))
        figures = response.data["results"][0]["figures"]
        self.assertEqual(figures["sales"], {"bills": 1, "total": "30900.00", "tax": "900.00", "cancelled": 1})
        self.assertEqual(figures["purchases"], {"bills": 1, "total": "5150.00", "tax": "150.00"})
        self.assertEqual(figures["customers"], 1)
        self.assertEqual(figures["first_bill"]["id"], first.pk)
        self.assertEqual(figures["last_bill"]["id"], first.pk)
        self.assertEqual(figures["previous_month"], {"month": "2026-09", "state": "filed", "blocker": ""})
        self.assertEqual(figures["last_filed"], {"month": "2026-09", "gstr1_filed_on": None, "gstr3b_filed_on": None})
        self.assertEqual((figures["from"], figures["to"]), ("2026-04-01", "2026-10-08"))

    @patch("billing.services.firms.timezone.localdate", return_value=date(2026, 10, 8))
    def test_figures_round_each_legacy_tax_head_to_paise_before_adding(self, today):
        from billing.models import LineItem

        outgoing = sale(self.firm, self.buyer, "1", "2026-09-01", line(), line())
        incoming = sale(self.firm, self.buyer, "2", "2026-09-01", line(), line(), kind="inward")
        cancelled = sale(self.firm, self.buyer, "3", "2026-09-01", status="cancelled")
        LineItem.objects.filter(invoice=outgoing).update(cgst=Decimal("0.025"), sgst=Decimal("0.025"), igst=0)
        LineItem.objects.filter(invoice=incoming).update(cgst=0, sgst=0, igst=Decimal("0.025"))
        LineItem.objects.filter(invoice=cancelled).update(cgst=Decimal("0.999"), sgst=Decimal("0.999"), igst=0)
        response = self.client.get("/api/firms/", {"figures": "1", "fy": "2026-27"})
        self.assertEqual(response.status_code, 200, response.data)
        figures = response.data["results"][0]["figures"]
        self.assertEqual(figures["sales"]["tax"], "0.12")
        self.assertEqual(figures["purchases"]["tax"], "0.06")
        self.assertEqual(list(LineItem.objects.filter(invoice=outgoing).values_list("cgst", flat=True)),
                         [Decimal("0.025"), Decimal("0.025")])

    @patch("billing.services.firms.timezone.localdate", return_value=date(2026, 10, 8))
    def test_number_series_counts_deleted_and_ignores_nonseries(self, today):
        sale(self.firm, self.buyer, "17", "2026-09-01", status="cancelled")
        highest = sale(self.firm, self.buyer, "18", "2026-09-02")
        bin_bill(highest, self.owner, "Entered twice")
        sale(self.firm, self.buyer, "P1778291284", "2026-09-03")
        numbers = self.client.get("/api/firms/", {"numbers": "1"}).data["results"][0]["numbers"]
        self.assertEqual(numbers["next"], {"counter": 19, "invoice_number": "19"})
        self.assertEqual(numbers["last"]["invoice_number"], "18")
        self.assertEqual(numbers["last"]["status"], "deleted")
        self.assertFalse(numbers["full_number"])

    @patch("billing.services.firms.timezone.localdate", return_value=date(2026, 10, 8))
    def test_detail_recent_months_defaults_uses_and_plain_numbers(self, today):
        self.firm.paper_full_number_from = date(2026, 4, 1)
        self.firm.city = "Jaipur"
        self.firm.save()
        for n in range(1, 9):
            sale(self.firm, self.buyer, str(n), f"2026-09-{n:02d}")
        response = self.client.get(f"/api/firms/{self.firm.pk}/", {"fy": "2026-27"})
        self.assertEqual(response.status_code, 200)
        data = response.data
        self.assertEqual(data["uses"], {"sales": 8, "cancelled": 0, "purchases": 0, "bin": 0, "drafts": 0, "captures": 0,
                                             "filing_records": 0, "filing_months": 0, "filed_periods": 0, "opening_credits": 0})
        self.assertEqual([b["invoice_number"] for b in data["recent"]], ["8", "7", "6", "5", "4", "3"])
        self.assertEqual(len(data["months"]), 7)
        self.assertEqual(data["plain_after_full_date"], 8)
        self.assertEqual(data["jurisdiction_printed"], "Jaipur")
        self.assertTrue(data["declaration_printed"].startswith("We declare that this invoice"))
        self.assertIsNone(data["signature_url"])

    def test_bad_fy_missing_firm_and_viewer_rights(self):
        self.assertEqual(self.client.get("/api/firms/", {"figures": "1", "fy": "bad"}).status_code, 400)
        response = self.client.get("/api/firms/999999/")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data, {"detail": "This firm isn't on file."})
        self.client = client_for(person("firm-viewer", "viewer"))
        self.assertEqual(self.client.get("/api/firms/").status_code, 200)
        self.assertEqual(self.client.post("/api/firms/", {}, format="json").status_code, 403)

    @patch("billing.services.firms.timezone.localdate", return_value=date(2026, 10, 8))
    def test_figures_are_grouped_and_bill_blobs_never_fetched(self, today):
        for n in range(5):
            sale(self.firm, self.buyer, str(n), "2026-09-01", line(rate=str(Decimal("100") + n)))
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get("/api/firms/", {"figures": "1", "fy": "2026-27"})
        self.assertEqual(response.status_code, 200)
        sql = " ".join(q["sql"] for q in queries)
        self.assertIn("GROUP BY", sql)
        for column in ('"firm_snapshot"', '"source_file"', '"notes"', '"product_name"'):
            self.assertNotIn(column, sql)
