from datetime import date

from django.test import TestCase

from billing.models import FiledPeriod, FilingRecord
from billing.tests.v3_helpers import client_for, firm, person


class FiledPeriodBridgeTest(TestCase):
    def setUp(self):
        self.business = firm()
        self.data = {"business": self.business.pk, "year": 2026, "month": 9, "note": ""}

    def test_placed_staff_cannot_lock_but_accountant_can(self):
        staff = client_for(person("staff", "counter_staff", "editor"))
        response = staff.post("/api/filed-periods/", self.data, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["needs"], "gst.lock")
        accountant = client_for(person("accountant", "accountant", "editor"))
        response = accountant.post("/api/filed-periods/", self.data, format="json")
        self.assertEqual(response.status_code, 201, response.content)

    def test_old_lock_takes_the_firm_lock_and_refuses_a_month_locked_meanwhile(self):
        from unittest.mock import patch

        accountant = client_for(person("accountant", "accountant", "editor"))
        taken = []

        def lock_firms(*ids):
            taken.append(ids)
            FiledPeriod.objects.create(business=self.business, year=2026, month=9, note="v3 got there first")

        with patch("billing.numbering.lock_firms", side_effect=lock_firms):
            response = accountant.post("/api/filed-periods/", self.data, format="json")
        self.assertEqual(taken, [(self.business.pk,)])
        self.assertEqual((response.status_code, response.json()), (400, {"month": ["That month is already locked."]}))

    def test_old_unlock_preserves_records_and_marks_v3_month_unlocked(self):
        from billing.models import FilingMonth
        record = FilingRecord.objects.create(business=self.business, year=2026, month=9, kind="gstr1",
                                             filed_on=date(2026, 10, 5), figures={}, bills={}, file={})
        locked = FiledPeriod.objects.create(business=self.business, year=2026, month=9)
        owner = client_for(person("owner", "admin"))
        response = owner.delete(f"/api/filed-periods/{locked.pk}/")
        self.assertEqual(response.status_code, 204, response.content)
        self.assertTrue(FilingRecord.objects.filter(pk=record.pk).exists())
        self.assertEqual(FilingMonth.objects.get().unlock_reason, "Unlocked in the old screen")
        self.assertFalse(FiledPeriod.objects.exists())


class V2PortalFileTest(TestCase):
    def test_v2_gstr1_download_is_the_month_without_correction_tables(self):
        # R3A-8: v2 never had correction tables; v3's own download carries them.
        from unittest.mock import patch

        business = firm()
        seen = {}

        def build(*args, **kwargs):
            seen.update(kwargs)
            return {"file": {}, "meta": {}}

        owner = client_for(person("owner", "admin"))
        with patch("billing.services.gstr1_file.build_gstr1", side_effect=build):
            response = owner.get(f"/api/invoices/gstr1-portal-json/?business_id={business.pk}&year=2026&month=9")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIs(seen.get("amendments"), False)
