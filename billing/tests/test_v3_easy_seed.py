"""Opt-in Easy fixtures leave the original seed and its tests intact."""

import tempfile
from datetime import date
from io import StringIO
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
from django.contrib.auth.models import User
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.urls import Resolver404, resolve, reverse
from django.utils import timezone

from billing.fy import fy_of
from billing.management.commands.seed_sandbox import Command, month_add
from billing.models import AuditLog, Business, Customer, Invoice, SaleDraft, UserPreference
from billing.numbering import counter_of
from billing.tests.v3_helpers import client_for


class EasySeedTest(TestCase):
    @classmethod
    def seed(cls, today, *args):
        with tempfile.TemporaryDirectory(prefix="easy-seed-") as media, override_settings(MEDIA_ROOT=media), \
                patch.object(Command, "_assert_sandbox"), \
                patch("billing.management.commands.seed_sandbox.timezone.localdate", return_value=today):
            call_command("seed_sandbox", "--scale", "0.1", *args, stdout=StringIO(), stderr=StringIO())

    @classmethod
    def setUpTestData(cls):
        cls.today = date(2026, 10, 8)
        cls.seed(cls.today, "--easy")
        cls.kiran = Business.objects.get(name="KIRAN GOLD HOUSE (SANDBOX)")
        cls.aarav = Business.objects.get(name="AARAV JEWELLERS (SANDBOX)")
        cls.staff = User.objects.get(username="sandbox_staff")

    def test_today_has_three_active_bills_and_one_sent_at_1044_ist(self):
        rows = list(Invoice.objects.sales().filter(business=self.kiran, invoice_date=self.today))
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(row.status == "active" for row in rows))
        walkin = next(row for row in rows if row.customer.kind == "walkin")
        self.assertEqual((walkin.sent_at, walkin.sent_count, walkin.sent_to), (None, 0, ""))
        sent = [row for row in rows if row.sent_at]
        self.assertEqual(len(sent), 1)
        self.assertEqual(timezone.localtime(sent[0].sent_at, ZoneInfo("Asia/Kolkata")).strftime("%Y-%m-%d %H:%M"), "2026-10-08 10:44")
        response = client_for(self.staff).get(reverse("sale-list"), {
            "business_id": self.kiran.pk, "start_date": str(self.today), "end_date": str(self.today),
        })
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["summary"]["bills"], 3)
        for bill in rows:
            self.assertEqual(bill.total_amount, sum(item.amount for item in bill.lineitem_set.all()))
            self.assertFalse(bill.lineitem_set.filter(product_name__icontains="making").exists())

    def test_lalit_draft_keeps_the_real_form_shape_and_staff_timestamp(self):
        draft = SaleDraft.objects.get(business=self.kiran)
        self.assertEqual(draft.started_by_id, self.staff.pk)
        self.assertEqual(timezone.localtime(draft.created_at, ZoneInfo("Asia/Kolkata")).strftime("%Y-%m-%d %H:%M"), "2026-10-08 15:20")
        self.assertEqual(draft.updated_at, draft.created_at)
        data = draft.data
        self.assertEqual((data["v"], data["firmId"], data["date"], data["customer"]["name"]), (1, self.kiran.pk, str(self.today), "Lalit Jain"))
        self.assertEqual((data["payment"], data["paper"], data["posOverride"], data["replaces"]), (None, False, None, None))
        item = data["lines"][0]
        self.assertEqual((item["name"], item["qty"], item["rate"], item["gst"], item["unit"]), ("Gold bangles 22K", None, "", "3", "gms"))
        response = client_for(self.staff).get(reverse("draft-list"), {"business_id": self.kiran.pk})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["results"][0]["id"], str(draft.pk))
        next_number = client_for(self.staff).get(reverse("sale-next-number"), {
            "business_id": self.kiran.pk, "invoice_date": str(self.today),
        })
        self.assertEqual(next_number.status_code, 200, next_number.data)
        self.assertEqual(data["number"], next_number.data["invoice_number"])
        viewer = User.objects.get(username="sandbox_viewer")
        self.assertEqual(UserPreference.objects.get(user=viewer).data["defaultBusinessId"], str(self.aarav.pk))

    def test_imported_missing_hsn_empty_and_cancelled_cases_are_readable(self):
        imported = AuditLog.objects.get(action="imported", details__startswith="Imported from Excel")
        bill = Invoice.objects.get(pk=imported.entity_id)
        self.assertEqual((bill.business_id, bill.payment_mode, bill.customer.kind), (self.aarav.pk, "", "business"))
        self.assertEqual(bill.lineitem_set.get().hsn_code, "")
        client = client_for(self.staff)
        detail = client.get(reverse("sale-detail", args=[bill.pk]))
        self.assertEqual(detail.status_code, 200, detail.data)
        self.assertIn("no_hsn", detail.data["checks"])
        empty = Invoice.objects.sales().filter(business=self.aarav, lineitem__isnull=True).get()
        self.assertEqual(empty.total_amount, 0)
        detail = client.get(reverse("sale-detail", args=[empty.pk]))
        self.assertIn("no_lines", detail.data["checks"])
        cancelled = Invoice.objects.get(business__name="MEERA ORNAMENTS (SANDBOX)", cancel_reason="Wrong weight or rate")
        self.assertEqual(cancelled.status, "cancelled")
        self.assertTrue(AuditLog.objects.filter(entity_id=cancelled.pk, action="cancelled", details="Wrong weight or rate").exists())

    def test_last_month_duplicate_uses_existing_normalization_and_not_a_schema_change(self):
        month = month_add(self.today.replace(day=1), -1)
        response = client_for(self.staff).get(reverse("sale-list"), {
            "business_id": self.kiran.pk, "month": month.strftime("%Y-%m"), "dups": "1",
        })
        self.assertEqual(response.status_code, 200, response.data)
        rows = response.data["results"]
        self.assertEqual(len(rows), 2)
        self.assertEqual(len({row["invoice_number"].lower() for row in rows}), 1)
        self.assertEqual(len({row["invoice_number"] for row in rows}), 2)
        self.assertTrue(all("duplicate" in row["checks"] for row in rows))

    def test_reset_handles_month_year_and_leap_boundaries_then_restores_the_base_seed(self):
        for today in (date(2026, 10, 1), date(2027, 1, 1), date(2027, 3, 1), date(2027, 4, 1), date(2028, 3, 1)):
            with self.subTest(today=today):
                self.seed(today, "--reset", "--easy")
                kiran = Business.objects.get(name="KIRAN GOLD HOUSE (SANDBOX)")
                current = list(Invoice.objects.sales().filter(business=kiran, invoice_date=today))
                self.assertEqual(len(current), 3)
                self.assertEqual(SaleDraft.objects.count(), 1)
                for bill in current:
                    self.assertTrue(bill.invoice_number.startswith(f"KGH/{fy_of(today)}-{str(fy_of(today) + 1)[-2:]}/"))
                if today.month == 4:
                    self.assertEqual(min(counter_of(bill.invoice_number) for bill in current), 1)
                month = month_add(today.replace(day=1), -1)
                client = client_for(User.objects.get(username="sandbox_staff"))
                response = client.get(reverse("sale-list"), {"business_id": kiran.pk, "month": month.strftime("%Y-%m"), "dups": "1"})
                self.assertEqual(response.status_code, 200, response.data)
                self.assertEqual(response.data["count"], 2)
        self.seed(self.today, "--reset")
        self.assertFalse(SaleDraft.objects.exists())
        self.assertFalse(Customer.objects.filter(name="Lalit Jain").exists())
        self.assertFalse(Invoice.objects.filter(cancel_reason="Wrong weight or rate").exists())
        self.assertFalse(UserPreference.objects.filter(user__username="sandbox_viewer").exists())


def _gst_month_available():
    try:
        resolve("/api/gst/month/")
    except Resolver404:
        return False
    return True


@pytest.mark.django_db
@pytest.mark.skipif(not _gst_month_available(), reason="X-40: runs after part 3A's gst/month endpoint lands")
def test_easy_seed_exposes_last_month_duplicate_through_gst_month():
    today = date(2026, 10, 8)
    EasySeedTest.seed(today, "--easy")
    kiran = Business.objects.get(name="KIRAN GOLD HOUSE (SANDBOX)")
    staff = User.objects.get(username="sandbox_staff")
    response = client_for(staff).get("/api/gst/month/", {"business_id": kiran.pk, "month": "2026-09"})
    assert response.status_code == 200, response.data
    assert response.data["stage"] == "blocked"
    rows = client_for(staff).get(reverse("sale-list"), {
        "business_id": kiran.pk, "month": "2026-09", "dups": "1",
    }).data["results"]
    ids = {row["id"] for row in rows}
    assert len(ids) == 2
    blockers = response.data["checks"]["blockers"]
    duplicate = next(check for check in blockers if check["kind"] == "duplicate" and ids <= {bill["id"] for bill in check["bills"]})
    assert duplicate["blocks"] is True
    canonical = next(row["invoice_number"] for row in rows if row["invoice_number"].startswith("KGH/"))
    assert duplicate["text"] == f"Bill number {canonical} is used twice"
