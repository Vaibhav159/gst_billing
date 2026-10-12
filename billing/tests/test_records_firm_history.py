"""X-8 shared filing stages and X-29 retained firm history across every deletion door."""
from datetime import date
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from billing.api.mixins import snapshot_of
from billing.models import (
    AuditLog,
    Business,
    FiledPeriod,
    FilingMonth,
    FilingRecord,
    Invoice,
    ITCReclaimLedger,
    OpeningCredit,
    ReturnDownload,
)
from billing.services import filing, gst_checks
from billing.tests.v3_helpers import buyer, client_for, firm, person


def part3_history_rows(business, owner):
    """Real fixtures from part-3 design §4.1, one retained 3A model at a time."""
    names = ("FilingRecord", "FilingMonth", "OpeningCredit", "ReturnDownload")
    models = {model.__name__: model for model in (FilingRecord, FilingMonth, OpeningCredit, ReturnDownload)}
    now = timezone.now()
    fields = {
        "FilingRecord": {"year": 2025, "month": 4, "kind": "gstr1", "filed_on": date(2025, 5, 10), "arn": "",
                         "figures": {}, "bills": [], "file": {}, "marked_by": owner, "marked_at": now,
                         "updated_by": owner, "updated_at": now},
        "FilingMonth": {"year": 2025, "month": 4, "unlocked_at": now, "unlocked_by": owner,
                        "unlock_reason": "Correct a bill", "relocked_at": None, "relocked_by": None, "legacy_frozen_at": None},
        "OpeningCredit": {"as_of": date(2025, 4, 1), "igst": 0, "cgst": 0, "sgst": 0,
                          "updated_by": owner, "updated_at": now},
        "ReturnDownload": {"year": 2025, "month": 4, "kind": "gstr1", "by": owner, "at": now,
                           "via": "download", "fingerprint": "0" * 64},
    }
    keys = {"FilingRecord": "filing_records", "FilingMonth": "filing_months", "OpeningCredit": "opening_credits",
            "ReturnDownload": "filing_records"}
    for name in names:
        row = models[name].objects.create(business=business, **fields[name])
        try:
            yield keys[name], row
        finally:
            row.delete()


class FirmFilingReadTests(TestCase):
    def setUp(self):
        self.client = client_for(person("filing-reader", "viewer"))
        self.business = firm()

    def blocked(self, business, label):
        # A bill with no lines is a real GSTR-1 blocker in 3A's grouped checks.
        Invoice.objects.create(business=business, customer=buyer(f"Buyer {business.pk} {label}"), invoice_number=f"EMPTY-{business.pk}-{label}",
                               invoice_date=date.fromisoformat(label + "-01"), type_of_invoice="outward")

    def first_blocker(self, business, label):
        return gst_checks.gstr1_blockers([business.pk], [label])[business.pk, label]["first_two"][0]

    def spies(self):
        return (patch("billing.services.filing.month_stages", wraps=filing.month_stages),
                patch("billing.services.gst_checks.gstr1_blockers", wraps=gst_checks.gstr1_blockers))

    @patch("billing.services.firms.timezone.localdate", return_value=date(2026, 10, 8))
    def test_list_uses_one_grouped_stage_call_and_exact_first_blocker(self, today):
        other = firm("SECOND FIRM")
        ids = [self.business.pk, other.pk]
        for business in (self.business, other):
            self.blocked(business, "2026-09")
            FilingRecord.objects.create(business=business, year=2026, month=8, kind="gstr1", filed_on=date(2026, 9, 10))
            FilingRecord.objects.create(business=business, year=2026, month=8, kind="gstr3b", filed_on=date(2026, 9, 18))
        stages_spy, checks_spy = self.spies()
        with stages_spy as stages, checks_spy as checks:
            response = self.client.get("/api/firms/", {"figures": "1", "fy": "2026-27"})
        self.assertEqual(response.status_code, 200, response.data)
        stages.assert_called_once_with(ids, ["2026-09"], today=date(2026, 10, 8), include_checks=False)
        self.assertEqual(checks.call_count, 2)
        self.assertEqual(checks.call_args_list[0].kwargs, {"include_text": False})
        self.assertEqual(checks.call_args.args, (ids, ["2026-09"]))
        rows = {row["id"]: row for row in response.data["results"]}
        for business in (self.business, other):
            figures = rows[business.pk]["figures"]
            self.assertEqual(figures["previous_month"], {"month": "2026-09", "state": "blocked",
                                                         "blocker": self.first_blocker(business, "2026-09")})
            self.assertTrue(figures["previous_month"]["blocker"])
            self.assertEqual(figures["last_filed"], {"month": "2026-08", "gstr1_filed_on": "2026-09-10", "gstr3b_filed_on": "2026-09-18"})

    @patch("billing.services.firms.timezone.localdate", return_value=date(2026, 10, 8))
    def test_bulk_month_grid_keeps_blocker_words_only_for_blocked_stages(self, today):
        from billing.services.firms import firm_figures, read_filings

        other = firm("SECOND FIRM")
        ids, labels = [self.business.pk, other.pk], ["2026-08", "2026-09"]
        FilingRecord.objects.create(business=self.business, year=2026, month=8, kind="gstr1", filed_on=date(2026, 9, 10))
        self.blocked(self.business, "2026-09")
        self.blocked(other, "2026-08")
        FilingRecord.objects.create(business=other, year=2026, month=9, kind="gstr1", filed_on=date(2026, 10, 5))
        stages_spy, checks_spy = self.spies()
        with stages_spy, checks_spy as checks:
            filings = read_filings(ids, labels)
            figures = firm_figures(ids, 2026, filings)
        self.assertEqual(checks.call_count, 2)
        self.assertEqual(checks.call_args_list[0].kwargs, {"include_text": False})
        self.assertEqual(checks.call_args.args, (ids, labels))
        self.assertEqual({key: month["state"] for key, month in filings["months"].items()},
                         {(self.business.pk, "2026-08"): "gstr1", (self.business.pk, "2026-09"): "blocked",
                          (other.pk, "2026-08"): "blocked", (other.pk, "2026-09"): "gstr1"})
        self.assertEqual(figures[self.business.pk]["previous_month"]["blocker"], self.first_blocker(self.business, "2026-09"))
        self.assertEqual(figures[other.pk]["previous_month"], {"month": "2026-09", "state": "gstr1", "blocker": ""})

    @patch("billing.services.firms.timezone.localdate", return_value=date(2026, 10, 8))
    def test_detail_keeps_every_shared_stage_with_one_call_for_all_months(self, today):
        labels = [f"2026-{month:02d}" for month in range(4, 11)]
        FilingMonth.objects.create(business=self.business, year=2026, month=4, unlocked_at=timezone.now())
        FilingRecord.objects.create(business=self.business, year=2026, month=5, kind="gstr1", filed_on=date(2026, 6, 10))
        self.blocked(self.business, "2026-06")
        FiledPeriod.objects.create(business=self.business, year=2026, month=9)
        stages_spy, checks_spy = self.spies()
        with stages_spy as stages, checks_spy as checks:
            response = self.client.get(f"/api/firms/{self.business.pk}/", {"fy": "2026-27"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([row["state"] for row in response.data["months"]],
                         ["unlocked", "gstr1", "blocked", "ready", "ready", "filed", "open"])
        stages.assert_called_once_with([self.business.pk], labels, today=date(2026, 10, 8), include_checks=False)
        self.assertEqual(checks.call_count, 2)
        self.assertEqual(checks.call_args_list[0].args, ([self.business.pk], ["2026-06", "2026-07", "2026-08"]))
        self.assertEqual(checks.call_args_list[0].kwargs, {"include_text": False})
        self.assertEqual(checks.call_args.args, ([self.business.pk], ["2026-06"]))
        self.assertEqual(response.data["figures"]["previous_month"], {"month": "2026-09", "state": "filed", "blocker": ""})

    def test_retained_filing_models_and_zero_opening_rows_all_count(self):
        from billing.services.firms import firm_uses
        now = timezone.now()
        FiledPeriod.objects.create(business=self.business, year=2025, month=4)
        ITCReclaimLedger.objects.create(business=self.business)
        OpeningCredit.objects.create(business=self.business, as_of=date(2025, 4, 1), igst=0, cgst=0, sgst=0, updated_at=now)
        for kind in ("gstr1", "gstr3b"):
            FilingRecord.objects.create(business=self.business, year=2025, month=4, kind=kind, filed_on=date(2025, 5, 10))
            ReturnDownload.objects.create(business=self.business, year=2025, month=4, kind=kind, at=now,
                                          via="download", fingerprint="0" * 64)
        for month in (5, 6, 7):
            FilingMonth.objects.create(business=self.business, year=2025, month=month, unlocked_at=now)
        uses = firm_uses(self.business)
        self.assertEqual({key: uses[key] for key in ("filing_records", "filing_months", "filed_periods", "opening_credits")},
                         {"filing_records": 4, "filing_months": 3, "filed_periods": 1, "opening_credits": 2})

    def test_real_part3_grouped_helpers_keep_legacy_filed_month(self):
        today = timezone.localdate()
        previous = date(today.year - (today.month == 1), 12 if today.month == 1 else today.month - 1, 1)
        label = previous.strftime("%Y-%m")
        FiledPeriod.objects.create(business=self.business, year=previous.year, month=previous.month)
        result = filing.month_stages([self.business.pk], [label], today=today)
        self.assertEqual(result["stages"][self.business.pk, label], "filed")
        self.assertEqual(result["latest_gstr1"][self.business.pk], label)
        blockers = gst_checks.gstr1_blockers([self.business.pk], [label])
        self.assertFalse(blockers.get((self.business.pk, label), {}).get("first_two"))
        response = self.client.get("/api/firms/", {"figures": "1"})
        self.assertEqual(response.status_code, 200, response.data)
        figures = response.data["results"][0]["figures"]
        self.assertEqual(figures["previous_month"], {"month": label, "state": "filed", "blocker": ""})
        self.assertEqual(figures["last_filed"], {"month": label, "gstr1_filed_on": None, "gstr3b_filed_on": None})
        detail = self.client.get(f"/api/firms/{self.business.pk}/")
        self.assertEqual(detail.status_code, 200, detail.data)
        self.assertEqual(detail.data["figures"]["previous_month"], figures["previous_month"])


class FirmHistoryProtectionTests(TestCase):
    def setUp(self):
        self.owner = person("history-owner", "admin")
        self.client = client_for(self.owner)
        self.business = firm()
        self.entry = AuditLog.objects.create(user=self.owner, action="created", entity="business", entity_id=self.business.pk,
                                             entity_name=self.business.name, snapshot=snapshot_of(self.business))

    def test_v3_v2_and_legacy_audit_keep_filing_or_zero_opening_credit(self):
        cases = [("filed_periods", lambda: FiledPeriod.objects.create(business=self.business, year=2025, month=4)),
                 ("opening_credits", lambda: ITCReclaimLedger.objects.create(business=self.business))]
        for key, create in cases:
            row = create()
            for method, url in (("delete", f"/api/firms/{self.business.pk}/"), ("delete", f"/api/businesses/{self.business.pk}/"),
                                ("post", f"/api/audit-logs/{self.entry.pk}/undo/")):
                with self.subTest(kind=key, url=url):
                    response = getattr(self.client, method)(url)
                    self.assertEqual(response.status_code, 409, response.data)
                    self.assertEqual(response.data["code"], "in_use")
                    self.assertEqual(response.data["detail"], "KIRAN GOLD HOUSE has filing records or opening credit, so it can't be deleted. Its GST history keeps its firm.")
                    self.assertEqual(response.data["uses"][key], 1)
                    self.assertTrue(Business.objects.filter(pk=self.business.pk).exists())
                    self.assertTrue(type(row).objects.filter(pk=row.pk).exists())
                    self.entry.refresh_from_db()
                    self.assertNotIn("_undo", self.entry.snapshot)
            row.delete()

    def test_guard_refuses_retained_future_records_and_months(self):
        from billing.refusals import Refusal
        from billing.services.firms import assert_firm_unused, firm_uses
        uses = firm_uses(self.business)
        for key in ("filing_records", "filing_months", "opening_credits"):
            with self.subTest(key=key), self.assertRaises(Refusal) as refused:
                assert_firm_unused(self.business, {**uses, key: 1})
            self.assertEqual(refused.exception.detail["code"], "in_use")
            self.assertIn("Its GST history keeps its firm.", refused.exception.detail["detail"])

    def test_real_part3_history_blocks_v3_v2_and_legacy_undo(self):
        for key, row in part3_history_rows(self.business, self.owner):
            for method, url in (("delete", f"/api/firms/{self.business.pk}/"), ("delete", f"/api/businesses/{self.business.pk}/"),
                                ("post", f"/api/audit-logs/{self.entry.pk}/undo/")):
                with self.subTest(model=type(row).__name__, url=url):
                    response = getattr(self.client, method)(url)
                    self.assertEqual(response.status_code, 409, response.data)
                    self.assertEqual(response.data["code"], "in_use")
                    self.assertEqual(response.data["detail"], "KIRAN GOLD HOUSE has filing records or opening credit, so it can't be deleted. Its GST history keeps its firm.")
                    self.assertEqual(response.data["uses"][key], 1)
                    self.assertTrue(type(row).objects.filter(pk=row.pk).exists())
                    self.assertTrue(Business.objects.filter(pk=self.business.pk).exists())
                    self.entry.refresh_from_db()
                    self.assertNotIn("_undo", self.entry.snapshot)

class FirmHistoryAuditTests(TestCase):
    def setUp(self):
        self.owner = person("history-audit-owner", "admin")
        self.client = client_for(self.owner)
        self.business = firm()
        self.entry = AuditLog.objects.create(user=self.owner, action="created", entity="business", entity_id=self.business.pk,
                                             entity_name=self.business.name, snapshot=snapshot_of(self.business))

    def test_v3_audit_undo_uses_the_same_retained_history_guard(self):
        cases = [("filed_periods", lambda: FiledPeriod.objects.create(business=self.business, year=2025, month=4)),
                 ("opening_credits", lambda: ITCReclaimLedger.objects.create(business=self.business))]
        for key, create in cases:
            with self.subTest(key=key):
                row = create()
                response = self.client.post(f"/api/audit/{self.entry.pk}/undo/")
                self.assertEqual(response.status_code, 409, response.data)
                self.assertEqual(response.data["code"], "in_use")
                self.assertEqual(response.data["detail"], "KIRAN GOLD HOUSE has filing records or opening credit, so it can't be deleted. Its GST history keeps its firm.")
                self.assertEqual(response.data["uses"][key], 1)
                self.assertTrue(type(row).objects.filter(pk=row.pk).exists())
                self.assertTrue(Business.objects.filter(pk=self.business.pk).exists())
                self.entry.refresh_from_db()
                self.assertNotIn("_undo", self.entry.snapshot)
                row.delete()

    def test_real_part3_history_blocks_v3_audit_undo(self):
        for key, row in part3_history_rows(self.business, self.owner):
            with self.subTest(model=type(row).__name__):
                response = self.client.post(f"/api/audit/{self.entry.pk}/undo/")
                self.assertEqual(response.status_code, 409, response.data)
                self.assertEqual(response.data["code"], "in_use")
                self.assertEqual(response.data["detail"], "KIRAN GOLD HOUSE has filing records or opening credit, so it can't be deleted. Its GST history keeps its firm.")
                self.assertEqual(response.data["uses"][key], 1)
                self.assertTrue(type(row).objects.filter(pk=row.pk).exists())
                self.assertTrue(Business.objects.filter(pk=self.business.pk).exists())
                self.entry.refresh_from_db()
                self.assertNotIn("_undo", self.entry.snapshot)
