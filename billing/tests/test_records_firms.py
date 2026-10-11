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

class FirmWriteTests(TestCase):
    def setUp(self):
        self.owner = person("firm-writer", "admin")
        self.client = client_for(self.owner)
        self.payload = {"name": "KIRAN GOLD HOUSE", "gst_number": "08AAGPL3375F1ZO", "address": "12 Bapu Bazar",
                        "mobile_number": "91 94141 22018", "invoice_prefix": "KGH"}

    def create(self, **more):
        return self.client.post("/api/firms/", {**self.payload, **more}, format="json")

    def test_first_firm_creates_walkin_and_derives_pan_and_state(self):
        from billing.models import AuditLog, Customer
        response = self.create()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["mobile_number"], "9414122018")
        self.assertEqual(response.data["pan_number"], "AAGPL3375F")
        self.assertEqual(response.data["state_name"], "RAJASTHAN")
        self.assertEqual(Customer.objects.get(customer_type="walkin").name, "Walk-in Customer")
        self.assertIn("GSTIN 08AAGPL3375F1ZO", AuditLog.objects.get(entity="business").details)

    def test_first_firm_keeps_existing_legacy_walkin(self):
        from billing.models import Customer
        existing = Customer.objects.create(name="Walk-in Customer")
        response = self.create()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(list(Customer.objects.values_list("pk", flat=True)), [existing.pk])

    def test_exact_validation_words_and_odd_json(self):
        values = {"name": ("", "Enter the firm's legal name, as on its GST certificate."),
                  "gst_number": ("", "Enter the firm's GSTIN. It prints at the top of every bill."),
                  "address": ("", "Enter the address printed on bills."),
                  "short_name": ("a" * 21, "Keep the short name to 20 characters."),
                  "pin_code": ("123", "A PIN code has 6 digits; this has 3."),
                  "mobile_number": ("123", "A mobile number has 10 digits; this has 3."),
                  "email": ("bad", "That email looks incomplete. It should look like accounts@example.in."),
                  "bank_account_number": ("123", "Account numbers have 9 to 18 digits; this has 3."),
                  "bank_ifsc_code": ("bad", "An IFSC has 11 characters: 4 letters, a zero, then 6 letters or digits (like SBIN0UDR014)."),
                  "invoice_prefix": ("KGH2", "Use 1 to 4 capital letters, like KGH. A GST bill number can have at most 16 characters."),
                  "paper_full_number_from": ([], "Type the date like 2027-04-01."),
                  "jurisdiction": ("x" * 101, "Keep the jurisdiction to 100 characters."),
                  "declaration": ("x" * 501, "Keep the declaration to 500 characters.")}
        for key, (value, words) in values.items():
            with self.subTest(key=key):
                response = self.create(**{key: value})
                self.assertEqual(response.status_code, 400, response.data)
                self.assertEqual(response.data[key], [words])
        for data in ([], {"name": {}}, {"name": "\x00"}, {"signature_on_bills": "false"}):
            self.assertEqual(self.client.post("/api/firms/", data, format="json").status_code, 400)

    def test_legacy_unchanged_values_are_kept_and_noop_writes_nothing(self):
        old = firm(gstin="broken", invoice_prefix="LONGPREFIX")
        old.mobile_number = "short"
        old.save()
        with CaptureQueriesContext(connection) as queries:
            response = self.client.put(f"/api/firms/{old.pk}/", {"name": old.name, "gst_number": "broken", "mobile_number": "short",
                "invoice_prefix": "LONGPREFIX", "address": old.address}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["changes"], [])
        self.assertEqual(response.data["frozen_bills"], 0)
        self.assertFalse(any(q["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE")) for q in queries))

    def test_identity_freezes_once_but_bank_city_signature_print_live(self):
        from billing.models import Invoice
        from billing.services.bill_reads import firm_block
        from billing.services.sales import firm_snapshot
        old = firm(bank_account_number="123456789", city="Udaipur")
        customer = buyer()
        a = sale(old, customer, "1", "2026-09-01")
        b = sale(old, customer, "2", "2026-09-02", status="cancelled", firm_snapshot=firm_snapshot(old))
        purchase = sale(old, customer, "3", "2026-09-03", kind="inward")
        response = self.client.put(f"/api/firms/{old.pk}/", {"name": "KIRAN NEW", "bank_account_number": "987654321", "city": "Jaipur"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["frozen_bills"], 1)
        for bill in (a, b):
            bill = Invoice.objects.select_related("business").get(pk=bill.pk)
            shown = firm_block(bill)
            self.assertEqual(shown["name"], old.name)
            self.assertEqual(shown["bank_account_number"], "987654321")
            self.assertEqual(shown["city"], "Jaipur")
        purchase.refresh_from_db()
        self.assertIsNone(purchase.firm_snapshot)
        response = self.client.put(f"/api/firms/{old.pk}/", {"name": "KIRAN THIRD"}, format="json")
        self.assertEqual(response.data["frozen_bills"], 0)

    def test_v2_business_update_freezes_older_sales(self):
        old = firm()
        bill = sale(old, buyer(), "1", "2026-09-01")
        response = self.client.patch(f"/api/businesses/{old.pk}/", {"address": "A new address"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        bill.refresh_from_db()
        self.assertEqual(bill.firm_snapshot["address"], old.address)

    def test_bank_only_save_keeps_older_bills_unfrozen(self):
        old = firm()
        bill = sale(old, buyer(), "1", "2026-09-01")
        response = self.client.put(f"/api/firms/{old.pk}/", {"bank_account_number": "123456789", "city": "Jaipur"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["frozen_bills"], 0)
        bill.refresh_from_db()
        self.assertIsNone(bill.firm_snapshot)

    def test_casefold_name_short_gstin_prefix_clashes(self):
        old = firm(short_name="Sunny", invoice_prefix="KGH", gstin=self.payload["gst_number"])
        for key, value in (("name", old.name.lower()), ("short_name", "sunny"), ("gst_number", old.gst_number), ("invoice_prefix", "KGH")):
            data = {"name": "MEERA", "gst_number": "27AAPFU0939F1ZV", "invoice_prefix": "MO", key: value}
            response = self.create(**data)
            self.assertEqual(response.status_code, 400, response.data)
            self.assertIn(key, response.data)
        response = self.create(name="Sunny GOLD", gst_number="27AAPFU0939F1ZV", invoice_prefix="MO")
        self.assertEqual(response.status_code, 400)
        self.assertIn("short_name", response.data)

    def test_delete_refuses_drafts_captures_and_bills_keeps_snapshot(self):
        import uuid

        from billing.models import AuditLog, Business, InwardCapture, SaleDraft, ShopSetting
        old = firm()
        ShopSetting.objects.create(pk=1, default_business=old)
        draft = SaleDraft.objects.create(id=uuid.uuid4(), business=old, data={})
        response = self.client.delete(f"/api/firms/{old.pk}/")
        self.assertEqual((response.status_code, response.data["code"], response.data["uses"]["drafts"]), (409, "in_use", 1))
        draft.delete()
        capture = InwardCapture.objects.create(business=old, image="inward/test.png")
        self.assertEqual(self.client.delete(f"/api/firms/{old.pk}/").status_code, 409)
        capture.status = "converted"
        capture.save()
        self.assertEqual(self.client.delete(f"/api/firms/{old.pk}/").status_code, 409)
        capture.delete()
        response = self.client.delete(f"/api/firms/{old.pk}/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(Business.objects.filter(pk=old.pk).exists())
        self.assertIsNone(ShopSetting.objects.get(pk=1).default_business_id)
        self.assertEqual(AuditLog.objects.get(pk=response.data["audit_id"]).snapshot["name"], old.name)
