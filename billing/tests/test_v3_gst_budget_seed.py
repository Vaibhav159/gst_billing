from datetime import date
from unittest.mock import patch

from django.db import connection
from django.test import TestCase, TransactionTestCase
from django.test.utils import CaptureQueriesContext

from billing.models import FilingRecord, OpeningCredit
from billing.tests.test_v3_cacheops import cacheops_on
from billing.tests.v3_helpers import buyer, firm, sale


class GstSeedTest(TestCase):
    def test_exact_opening_balances_are_saved_once(self):
        from billing.services.gst_seed import seed_openings
        firms = [firm("AARAV JEWELLERS"), firm("MEERA ORNAMENTS"), firm("KIRAN GOLD HOUSE")]
        seed_openings(firms, None)
        seed_openings(firms, None)
        rows = list(OpeningCredit.objects.order_by("business_id").values_list("igst", "cgst", "sgst"))
        self.assertEqual([[str(x) for x in row] for row in rows],
                         [["42000.00", "15000.00", "15000.00"], ["0.00", "4200.00", "4200.00"], ["0.00", "9500.00", "9500.00"]])

    def test_synthetic_seed_has_corrections_stale_download_and_duplicate(self):
        from billing.models import FilingMonth
        from billing.services.gst_checks import month_checks
        from billing.services.gst_downloads import download_state
        from billing.services.gst_seed import seed_gst
        from billing.services.gstr1_file import build_gstr1
        from billing.tests.v3_helpers import person
        firms = [firm("AARAV JEWELLERS"), firm("MEERA ORNAMENTS"), firm("KIRAN GOLD HOUSE")]
        buyer("Walk-in", customer_type="walkin")
        owner = person("owner", "admin")
        seed_gst(firms, owner, date(2026, 10, 8))  # the real ledger, on 2A's purchase fields
        self.assertTrue(FilingMonth.objects.filter(business=firms[0], unlocked_at__isnull=False).exists())
        self.assertEqual(set(FilingRecord.objects.filter(business=firms[2], year=2026, month=9).values_list("kind", flat=True)),
                         {"gstr1", "gstr3b"})
        self.assertIn("duplicate", {check["kind"] for check in month_checks(firms[1], 2026, 9)["blockers"]})
        self.assertTrue(download_state(firms[1], date(2026, 9, 1), build_gstr1(firms[1], 2026, 9)["file"])["stale"])

    def test_stage_batch_does_not_transfer_snapshots(self):
        from billing.services.filing import month_stages
        business = firm()
        FilingRecord.objects.create(business=business, year=2026, month=9, kind="gstr1",
                                    filed_on=date(2026, 10, 1), figures={}, bills={"large": "x" * 500000}, file={"large": "x" * 500000})
        with patch("billing.services.gst_checks.gstr1_blockers", return_value={}), CaptureQueriesContext(connection) as queries:
            stages = month_stages([business.pk], ["2026-09"], today=date(2026, 10, 8))
        self.assertEqual(stages["stages"][business.pk, "2026-09"], "gstr1")
        self.assertLessEqual(len(queries), 2)
        sql = "\n".join(query["sql"] for query in queries)
        self.assertNotIn('"bills"', sql)
        self.assertNotIn('"file"', sql)
        self.assertNotIn('"figures"', sql)


class GstCacheTest(TransactionTestCase):
    def test_builder_and_checks_bypass_cacheops(self):
        from billing.api.gst_input import firm_input
        from billing.services.gst_checks import month_checks
        from billing.services.gstr1_file import build_gstr1
        business = firm()
        sale(business, buyer(), "1", date(2026, 9, 2))
        with cacheops_on() as touched:
            fresh = firm_input({"business_id": str(business.pk)})
            built = build_gstr1(fresh, 2026, 9)
            checks = month_checks(fresh, 2026, 9)
        self.assertEqual(built["figures"]["taxable"], "10000.00")
        self.assertEqual(checks["blockers"], [])
        self.assertEqual(touched, [])
