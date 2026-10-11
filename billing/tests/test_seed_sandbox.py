import os
import tempfile
from datetime import date
from decimal import Decimal
from io import StringIO
from unittest import mock

from django.contrib.auth.models import User
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connections
from django.test import TestCase, override_settings

from billing.constants import B2CL_THRESHOLD
from billing.fy import fy_of
from billing.management.commands.seed_sandbox import Command, month_add
from billing.models import (
    BinnedInvoice,
    Business,
    Customer,
    FiledPeriod,
    Invoice,
    InwardCapture,
    LineItem,
    UserPreference,
)
from billing.numbering import counter_of, holder, paper_book
from billing.roles import ROLES as V3_ROLES
from billing.roles import role_of
from billing.services.bill_reads import itax_flags
from billing.services.bin import restore_from_bin
from billing.tax_rules import is_interstate


@override_settings(MEDIA_ROOT=tempfile.mkdtemp(prefix="seed-sandbox-"))
class SeedSandboxTest(TestCase):
    def _seed(self, *args):
        # The guard admits SQLite or the sandbox's own Postgres. CircleCI and
        # the release gate run pytest on Postgres, whose test database
        # (test_circle_test) is neither, so these tests step past it; the
        # guard has tests of its own below.
        out = StringIO()
        with mock.patch.object(Command, "_assert_sandbox"):
            call_command("seed_sandbox", "--scale", "0.1", *args, stdout=out, stderr=StringIO())
        return out.getvalue()

    def test_refuses_outside_the_sandbox(self):
        with mock.patch.dict(os.environ, {"GST_SANDBOX": ""}), self.assertRaises(CommandError):
            call_command("seed_sandbox", stdout=StringIO(), stderr=StringIO())
        self.assertFalse(Business.objects.exists())

    def test_refuses_any_postgres_but_the_sandbox_database(self):
        db = connections["default"]
        with mock.patch.dict(os.environ, {"GST_SANDBOX": "1"}), mock.patch.object(db, "vendor", "postgresql"):
            for name, host in (("neondb", "ep-cool-dew.neon.tech"), ("gst_billing", "db"), ("gst_sandbox", "10.0.0.5")):
                with self.subTest(name=name, host=host), \
                        mock.patch.dict(db.settings_dict, {"NAME": name, "HOST": host}), \
                        self.assertRaises(CommandError):
                    Command()._assert_sandbox()
            with mock.patch.dict(db.settings_dict, {"NAME": "gst_sandbox", "HOST": "db"}):
                Command()._assert_sandbox()  # the sandbox's own database is admitted

    def test_books_are_internally_consistent(self):
        logins = self._seed("--print-credentials").strip().splitlines()
        self.assertEqual(len(logins), 7)
        roles = [line.split("\t")[0] for line in logins]
        self.assertIn("accountant", roles)
        self.assertIn("staff", roles)
        self.assertEqual(role_of(User.objects.get(username="sandbox_accountant")), "accountant")
        staff = User.objects.get(username="sandbox_staff")
        self.assertEqual(role_of(staff), "staff")
        kiran = Business.objects.get(name="KIRAN GOLD HOUSE (SANDBOX)")
        self.assertEqual(UserPreference.objects.get(user=staff).data["defaultBusinessId"], str(kiran.id))
        for username, role in (
            ("sandbox_owner", "owner"), ("sandbox_accountant", "accountant"), ("sandbox_staff", "staff"),
        ):
            # The groups v3 assigns each role (roles.ROLES), v2's included, so v2 and a rollback agree.
            groups = User.objects.get(username=username).groups.values_list("name", flat=True)
            self.assertCountEqual(groups, V3_ROLES[role]["groups"], username)

        for inv in Invoice.objects.prefetch_related("lineitem_set"):
            lines = list(inv.lineitem_set.all())
            self.assertTrue(lines, inv.invoice_number)
            self.assertEqual(inv.total_amount, sum(li.amount for li in lines), inv.invoice_number)

        for li in LineItem.objects.select_related("invoice__business", "invoice__customer"):
            if is_interstate(li.invoice.business, li.invoice.customer):
                self.assertEqual(li.cgst + li.sgst, 0)
            else:
                self.assertEqual(li.igst, 0)

        b2cl = Invoice.objects.get(customer__name="Arjun Nair")
        self.assertGreater(b2cl.total_amount, B2CL_THRESHOLD)
        self.assertTrue(FiledPeriod.objects.exists())
        self.assertEqual(InwardCapture.objects.count(), 3)

    def test_second_run_needs_reset(self):
        self._seed()
        with self.assertRaises(CommandError):
            self._seed()
        self._seed("--reset")
        self.assertEqual(Business.objects.count(), 3)

    @mock.patch("billing.management.commands.seed_sandbox.timezone.localdate", return_value=date(2026, 10, 8))
    def test_part_1_cases_are_planted(self, _today):
        self._seed()
        kiran = Business.objects.get(name="KIRAN GOLD HOUSE (SANDBOX)")
        start = kiran.paper_full_number_from
        self.assertEqual((kiran.invoice_prefix, Business.objects.exclude(paper_full_number_from=None).count()), ("KGH", 1))
        self.assertEqual(start, date(2026, 9, 1))
        for number, day in Invoice.objects.filter(business=kiran, type_of_invoice="outward").values_list(
                "invoice_number", "invoice_date"):
            self.assertEqual(number.startswith("KGH/"), day >= start, number)

        book = paper_book(kiran, start.year, start.month)
        self.assertEqual(len(book["missing"]), 2)
        self.assertEqual(book["missing_count"], 2)
        self.assertEqual(sorted(e["kind"] for e in book["explained"]), ["cancelled", "deleted"])
        self.assertTrue(any(b["paper"] for b in book["bills"]))
        binned = BinnedInvoice.objects.get(reason="Entered twice by mistake")
        self.assertIsNotNone(holder(kiran.pk, fy_of(binned.invoice_date), binned.invoice_number))

        paper = [b for b in book["bills"] if b["paper"]]
        run = sorted([(b["counter"], b["invoice_date"], b["id"]) for b in paper] + [
            (counter_of(binned.invoice_number), binned.invoice_date.isoformat(), binned.original_id),
        ])
        self.assertEqual(len(run), 6)
        self.assertEqual(run[-1][0] - run[0][0] + 1, 8)
        self.assertEqual([day for _, day, _ in run], sorted(day for _, day, _ in run))
        self.assertTrue(all("2026-09-15" <= day <= "2026-09-30" for _, day, _ in run))
        self.assertTrue(all(b["paper"] or b["invoice_date"] < "2026-09-15" for b in book["bills"]))
        this_month = list(Invoice.objects.sales().filter(business=kiran, invoice_date__gte=date(2026, 10, 1)))
        self.assertTrue(this_month)
        self.assertLess(run[-1][0], min(counter_of(b.invoice_number) for b in this_month))
        self.assertGreater(min(pk for _, _, pk in run), max(b.pk for b in this_month))

        walkin = Customer.objects.get(name="Walk-in Customer")
        self.assertEqual(walkin.customer_type, "walkin")
        self.assertEqual(Customer.objects.filter(customer_type="walkin").count(), 1)
        self.assertFalse(walkin.mobile_number)
        self.assertEqual(Customer.objects.get(name="Patel Diamonds").city, "Surat")
        self.assertTrue(Invoice.objects.filter(customer=walkin, sent_to="9829041122", sent_count=2).exists())
        recent = Invoice.objects.sales().filter(invoice_date__gte=date(2026, 10, 1), paper=False).exclude(
            customer=walkin).order_by("id")
        self.assertGreaterEqual(len(recent), 3)
        sent = [bill.sent_at is not None for bill in recent]
        # Two sends, then one still to send; a partial final group starts with the sends.
        for group_start in range(0, len(sent), 3):
            group = sent[group_start:group_start + 3]
            self.assertEqual(group, [True, True, False][:len(group)])
        for bill in recent:
            if bill.sent_at:
                self.assertEqual((bill.sent_via, bill.sent_count, bill.last_sent_at), ("whatsapp", 1, bill.sent_at))
        cash = Invoice.objects.select_related("customer").get(
            business__name="MEERA ORNAMENTS (SANDBOX)", customer__name="Pooja Bhati",
            invoice_date=date(2026, 10, 8), total_amount=Decimal("200000.00"), payment_mode="cash")
        self.assertEqual([f["kind"] for f in itax_flags(cash)], ["cash_limit"])
        big = Invoice.objects.select_related("customer").get(
            business__name="AARAV JEWELLERS (SANDBOX)", customer__name="Deepak Choudhary",
            invoice_date=date(2026, 10, 8), total_amount=Decimal("257500.00"), payment_mode="bank")
        self.assertEqual([f["kind"] for f in itax_flags(big)], ["pan"])
        kinds = {f["kind"] for inv in Invoice.objects.sales().select_related("customer") for f in itax_flags(inv)}
        self.assertLessEqual({"pan", "cash_limit"}, kinds)
        restored = restore_from_bin(binned, None)
        self.assertIs(restored.paper, True)
        self.assertEqual(restored.pk, binned.original_id)
        self.assertEqual(restored.invoice_date, date(2026, 9, 21))
        self.assertTrue(restored.invoice_number.startswith("KGH/2026-27/"))

    def test_paper_run_stays_in_its_month_and_financial_year(self):
        for today in (date(2026, 10, 1), date(2027, 3, 1), date(2027, 4, 1),
                      date(2026, 10, 15), date(2027, 3, 15), date(2027, 4, 15)):
            with self.subTest(today=today), mock.patch(
                    "billing.management.commands.seed_sandbox.timezone.localdate", return_value=today):
                self._seed("--reset")
                kiran = Business.objects.get(name="KIRAN GOLD HOUSE (SANDBOX)")
                this_month = today.replace(day=1)
                start = month_add(this_month, -1)
                self.assertEqual(kiran.paper_full_number_from, start)
                book = paper_book(kiran, start.year, start.month)
                self.assertEqual(book["missing_count"], 2)
                self.assertEqual(sorted(e["kind"] for e in book["explained"]), ["cancelled", "deleted"])
                paper = list(Invoice.objects.sales().filter(business=kiran, paper=True).order_by("invoice_number"))
                binned = BinnedInvoice.objects.get(reason="Entered twice by mistake")
                run = [*paper, binned]
                self.assertEqual(len(run), 6)
                self.assertTrue(all(start.replace(day=15) <= b.invoice_date < this_month for b in run))
                self.assertFalse(Invoice.objects.sales().filter(
                    business=kiran, paper=False, invoice_date__gte=start.replace(day=15),
                    invoice_date__lt=this_month).exists())
                current = list(Invoice.objects.sales().filter(business=kiran, invoice_date__gte=this_month))
                self.assertTrue(current)
                self.assertGreater(min(b.pk for b in paper), max(b.pk for b in current))
                lowest = min(counter_of(b.invoice_number) for b in current)
                counters = [counter_of(b.invoice_number) for b in run]
                self.assertEqual(max(counters) - min(counters) + 1, 8)
                if fy_of(start) == fy_of(today):
                    self.assertLess(max(counters), lowest)
                else:
                    self.assertEqual(lowest, 1)  # April starts a new series; March keeps its own reservation.
