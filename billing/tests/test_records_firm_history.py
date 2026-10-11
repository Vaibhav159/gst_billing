"""X-8 shared filing stages and X-29 retained firm history across every deletion door."""
from datetime import date
from importlib import import_module
from types import ModuleType
from unittest import SkipTest
from unittest.mock import Mock, patch

from django.apps import apps
from django.test import TestCase
from django.utils import timezone

from billing.api.mixins import snapshot_of
from billing.cache import uncached
from billing.models import AuditLog, Business, FiledPeriod, ITCReclaimLedger
from billing.tests.v3_helpers import client_for, firm, person


def part3_history_rows(business, owner):
    """Real fixtures from part-3 design §4.1; run once 3A Task 1's retained models land."""
    names = ("FilingRecord", "FilingMonth", "OpeningCredit", "ReturnDownload")
    try:
        models = {name: apps.get_model("billing", name) for name in names}
    except LookupError:
        raise SkipTest("Requires 3A Task 1 retained filing models; confirm fields against its published plan (X-40).") from None
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

    @patch("billing.services.firms.timezone.localdate", return_value=date(2026, 10, 8))
    def test_list_uses_one_grouped_stage_call_and_exact_first_blocker(self, today):
        other = firm("SECOND FIRM")
        ids = [self.business.pk, other.pk]
        filing, checks = ModuleType("billing.services.filing"), ModuleType("billing.services.gst_checks")
        filing.month_stages = Mock(return_value=({(pk, "2026-09"): "blocked" for pk in ids}, {pk: "2026-08" for pk in ids}))
        words = "Bill number KGH/2026-27/17 is used twice"
        checks.gstr1_blockers = Mock(return_value={(pk, "2026-09"): {"count": 1, "first_two": [words, "Another blocker"]} for pk in ids})
        dates = {(pk, "2026-08", kind): day for pk in ids for kind, day in (("gstr1", "2026-09-10"), ("gstr3b", "2026-09-18"))}
        with patch.dict("sys.modules", {filing.__name__: filing, checks.__name__: checks}), patch("billing.services.firms.filing_dates", return_value=dates) as dates_read:
            response = self.client.get("/api/firms/", {"figures": "1", "fy": "2026-27"})
        self.assertEqual(response.status_code, 200, response.data)
        filing.month_stages.assert_called_once_with(ids, ["2026-09"], today=date(2026, 10, 8))
        checks.gstr1_blockers.assert_called_once_with(ids, ["2026-09"])
        dates_read.assert_called_once_with(ids, {"2026-08", "2026-09"})
        for row in response.data["results"]:
            self.assertEqual(row["figures"]["previous_month"], {"month": "2026-09", "state": "blocked", "blocker": words})
            self.assertEqual(row["figures"]["last_filed"], {"month": "2026-08", "gstr1_filed_on": "2026-09-10", "gstr3b_filed_on": "2026-09-18"})

    @patch("billing.services.firms.timezone.localdate", return_value=date(2026, 10, 8))
    def test_bulk_month_grid_keeps_blocker_words_only_for_blocked_stages(self, today):
        from billing.services.firms import firm_figures, read_filings

        other = firm("SECOND FIRM")
        ids, labels = [self.business.pk, other.pk], ["2026-08", "2026-09"]
        filing, checks = ModuleType("billing.services.filing"), ModuleType("billing.services.gst_checks")
        stages = {(self.business.pk, "2026-08"): "gstr1", (self.business.pk, "2026-09"): "blocked",
                  (other.pk, "2026-08"): "blocked", (other.pk, "2026-09"): "gstr1"}
        filing.month_stages = Mock(return_value=(stages, {pk: None for pk in ids}))
        words = "Bill number KGH/2026-27/17 is used twice"
        checks.gstr1_blockers = Mock(return_value={key: {"count": 1, "first_two": [words]} for key in stages})
        with patch.dict("sys.modules", {filing.__name__: filing, checks.__name__: checks}):
            figures = firm_figures(ids, 2026, read_filings(ids, labels))
        checks.gstr1_blockers.assert_called_once_with(ids, labels)
        self.assertEqual(figures[self.business.pk]["previous_month"]["blocker"], words)
        self.assertEqual(figures[other.pk]["previous_month"], {"month": "2026-09", "state": "gstr1", "blocker": ""})

    @patch("billing.services.firms.timezone.localdate", return_value=date(2026, 10, 8))
    def test_detail_keeps_every_shared_stage_with_one_call_for_all_months(self, today):
        filing, checks = ModuleType("billing.services.filing"), ModuleType("billing.services.gst_checks")
        stages = ["future", "open", "blocked", "ready", "gstr1", "filed", "unlocked"]
        labels = [f"2026-{month:02d}" for month in range(4, 11)]
        filing.month_stages = Mock(return_value=({(self.business.pk, label): stage for label, stage in zip(labels, stages, strict=True)}, {self.business.pk: "2026-09"}))
        checks.gstr1_blockers = Mock(return_value={(self.business.pk, "2026-06"): {"count": 1, "first_two": ["A line needs its HSN"]}})
        with patch.dict("sys.modules", {filing.__name__: filing, checks.__name__: checks}), patch("billing.services.firms.filing_dates", return_value={}):
            response = self.client.get(f"/api/firms/{self.business.pk}/", {"fy": "2026-27"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([row["state"] for row in response.data["months"]], stages)
        filing.month_stages.assert_called_once_with([self.business.pk], labels, today=date(2026, 10, 8))
        self.assertEqual(response.data["figures"]["previous_month"], {"month": "2026-09", "state": "filed", "blocker": ""})

    def test_future_filing_models_and_zero_opening_rows_all_count(self):
        from billing.services.firms import firm_uses
        FiledPeriod.objects.create(business=self.business, year=2025, month=4)
        ITCReclaimLedger.objects.create(business=self.business)
        future = {name: object() for name in ("FilingRecord", "FilingMonth", "OpeningCredit", "ReturnDownload")}
        def rows(model):
            if model in future.values():
                result = Mock()
                result.filter.return_value.count.return_value = {future["FilingRecord"]: 2, future["FilingMonth"]: 3, future["OpeningCredit"]: 1, future["ReturnDownload"]: 2}[model]
                return result
            return uncached(model)
        with patch("billing.services.firms.optional_filing_model", side_effect=future.get), patch("billing.services.firms.uncached", side_effect=rows):
            uses = firm_uses(self.business)
        self.assertEqual({key: uses[key] for key in ("filing_records", "filing_months", "filed_periods", "opening_credits")},
                         {"filing_records": 4, "filing_months": 3, "filed_periods": 1, "opening_credits": 2})

    def test_real_part3_grouped_helpers_keep_legacy_filed_month(self):
        modules = {}
        for name, helper in (("billing.services.filing", "month_stages"), ("billing.services.gst_checks", "gstr1_blockers")):
            try:
                modules[name] = import_module(name)
            except ModuleNotFoundError as missing:
                if missing.name != name:
                    raise
                self.skipTest(f"Requires 3A Tasks 4 and 9: {name}.{helper} (X-40).")
            if not hasattr(modules[name], helper):
                self.skipTest(f"Requires 3A Task 9's complete grouped interface: {name}.{helper} (X-40).")
        today = timezone.localdate()
        previous = date(today.year - (today.month == 1), 12 if today.month == 1 else today.month - 1, 1)
        label = previous.strftime("%Y-%m")
        FiledPeriod.objects.create(business=self.business, year=previous.year, month=previous.month)
        # Contract §11 leaves the carrier unspecified. Confirm this two-tuple against 3A's plan before combined landing.
        stages, _latest = modules["billing.services.filing"].month_stages([self.business.pk], [label], today=today)
        self.assertEqual(stages[self.business.pk, label], "filed")
        blockers = modules["billing.services.gst_checks"].gstr1_blockers([self.business.pk], [label])
        self.assertFalse(blockers.get((self.business.pk, label), {}).get("first_two"))
        response = self.client.get("/api/firms/", {"figures": "1"})
        self.assertEqual(response.status_code, 200, response.data)
        figures = response.data["results"][0]["figures"]
        self.assertEqual(figures["previous_month"], {"month": label, "state": "filed", "blocker": ""})
        self.assertEqual(figures["last_filed"], {"month": label, "gstr1_filed_on": None, "gstr3b_filed_on": None})


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
