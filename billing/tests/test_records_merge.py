"""Customer merge is atomic, permissioned, and preserves issued returns and stored totals."""
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal
from threading import Barrier
from unittest import skipUnless
from unittest.mock import patch

from django.db import close_old_connections, connection
from django.http import Http404
from django.test import TestCase, TransactionTestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIRequestFactory, force_authenticate

from billing.api.customer_merge import CustomerDuplicatesView, CustomerMergeView
from billing.models import AuditLog, Customer, FiledPeriod, Invoice, LineItem, SaleDraft
from billing.refusals import Refusal
from billing.services.bin import bin_bill
from billing.services.customer_merge import duplicates, merge_customers, merge_preview
from billing.tests.test_v3_cacheops import cacheops_on
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, line, person, sale


def invoke(view, user, method="get", pk=None, payload=None):
    request = getattr(APIRequestFactory(), method)("/api/customers/merge/", payload or {}, format="json")
    force_authenticate(request, user)
    return view.as_view()(request, **({"pk": pk} if pk is not None else {}))


class MergeTests(TestCase):
    def setUp(self):
        self.owner = person("merge-owner", *ROLE_GROUPS["owner"])
        self.firm = firm()
        self.source = buyer("Anil G", state="GUJARAT", mobile_number="9829041122")
        self.target = buyer("Anil Gupta", mobile_number="9829041122")

    def preview(self):
        return invoke(CustomerMergeView, self.owner, pk=self.source.pk, payload={"into": self.target.pk})

    def merge(self):
        return invoke(CustomerMergeView, self.owner, "post", self.source.pk, {"into": self.target.pk})

    def test_preview_names_heads_segment_chosen_place_and_counts(self):
        changed = sale(self.firm, self.source, "KGH/2026-27/1", "2026-09-12", line(rate="200000"))
        sale(self.firm, self.source, "KGH/2026-27/2", "2026-09-12", line(rate="200000"), place_of_supply="24")
        sale(self.firm, self.source, "KGH/2026-27/3", "2026-09-12", status="cancelled", paper=True)
        data = self.preview().data
        self.assertTrue(data["can_merge"])
        self.assertEqual(data["bills"], {"count": 2, "cancelled": 1,
            "numbers": ["KGH/2026-27/1", "KGH/2026-27/2", "KGH/2026-27/3"]})
        self.assertEqual(data["keeps"], "Anil Gupta keeps its name, phone, GSTIN and address.")
        self.assertEqual(data["source"]["type"], "person")
        self.assertEqual(data["target"]["since"], timezone.localtime(self.target.created_at).date().isoformat())
        self.assertEqual(len(data["changes"]), 1)
        change = data["changes"][0]
        self.assertEqual(change["bill"]["id"], changed.pk)
        self.assertEqual(change["heads"], {"from": "igst", "to": "cgst_sgst"})
        self.assertEqual(change["segment"], {"from": "b2cl", "to": "b2cs"})
        self.assertEqual(change["words"], "IGST → CGST + SGST, B2CL → B2CS in GSTR-1")

    def test_merge_moves_every_reference_refiles_without_changing_totals_and_audits(self):
        bill = sale(self.firm, self.source, "KGH/2026-27/1", "2026-09-12", line(rate="200000"))
        purchase = sale(self.firm, self.source, "P-1", "2026-09-12", kind="inward")
        cancelled = sale(self.firm, self.source, "KGH/2026-27/2", "2026-09-12", status="cancelled", paper=True)
        binned, _ = bin_bill(sale(self.firm, self.source, "KGH/2026-27/3", "2026-09-12"), self.owner)
        draft = SaleDraft.objects.create(id=uuid.uuid4(), business=self.firm,
            data={"customer": {"id": self.source.pk, "name": self.source.name}, "notes": "keep me"})
        self.source.businesses.add(self.firm)
        old_total = bill.total_amount
        old_line = LineItem.objects.get(invoice=bill)
        old_tax = old_line.cgst + old_line.sgst + old_line.igst
        source_id = self.source.pk
        response = self.merge()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data, {"target": self.target.pk,
            "moved": {"bills": 2, "purchases": 1, "bin": 1, "drafts": 1}, "refiled": 1, "firms_added": 1})
        self.assertFalse(Customer.objects.filter(pk=source_id).exists())
        for invoice in (bill, purchase, cancelled):
            invoice.refresh_from_db()
            self.assertEqual(invoice.customer_id, self.target.pk)
            self.assertFalse(LineItem.objects.filter(invoice=invoice).exclude(customer=self.target).exists())
        self.assertEqual(bill.total_amount, old_total)
        old_line.refresh_from_db()
        self.assertEqual(old_line.amount, old_total)
        self.assertEqual((old_line.cgst, old_line.sgst, old_line.igst), (old_tax / 2, old_tax / 2, Decimal("0")))
        binned.refresh_from_db()
        self.assertEqual(binned.customer_id, self.target.pk)
        self.assertEqual(binned.data["customer_name"], self.target.name)
        self.assertEqual(binned.data["invoice"]["customer_id"], str(self.target.pk))
        draft.refresh_from_db()
        self.assertEqual(draft.data, {"customer": {"id": self.target.pk, "name": self.target.name}, "notes": "keep me"})
        self.assertEqual(list(self.target.businesses.values_list("pk", flat=True)), [self.firm.pk])
        merged = AuditLog.objects.get(action="merged", entity="customer")
        self.assertEqual(merged.entity_id, self.target.pk)
        self.assertEqual(merged.snapshot["id"], str(source_id))
        self.assertEqual(merged.details, "Anil G merged into Anil Gupta · 2 bills moved")
        self.assertEqual(AuditLog.objects.get(action="updated", entity="invoice", entity_id=bill.pk).details,
                         "Tax heads re-filed: its customer was merged into Anil Gupta")

    def test_sent_or_paper_material_change_refuses_and_writes_nothing(self):
        for index, extra in enumerate(({"paper": True}, {"sent_at": timezone.now(), "sent_via": "whatsapp"})):
            with self.subTest(extra=extra):
                bill = sale(self.firm, self.source, f"KGH/2026-27/{index + 1}", "2026-09-12", **extra)
                preview = self.preview().data
                self.assertFalse(preview["can_merge"])
                self.assertEqual(preview["refusal"]["code"], "sent_changes")
                self.assertIn("Cancel and remake", preview["refusal"]["detail"])
                count = AuditLog.objects.count()
                response = self.merge()
                self.assertEqual(response.status_code, 409)
                self.assertEqual(response.data["code"], "sent_changes")
                self.assertEqual(AuditLog.objects.count(), count)
                bill.refresh_from_db()
                self.assertEqual(bill.customer_id, self.source.pk)
                bill.delete()

    def test_sent_unchanged_bill_can_move_but_gstin_change_alone_refuses(self):
        self.source.state_name = "RAJASTHAN"
        self.source.save()
        bill = sale(self.firm, self.source, "KGH/2026-27/1", "2026-09-12", paper=True)
        self.assertTrue(self.preview().data["can_merge"])
        self.source.gst_number = "08AAGPL3375F1ZO"
        self.target.gst_number = "08AAMFR5567K1ZG"
        self.source.save()
        self.target.save()
        change = self.preview().data["changes"][0]
        self.assertIsNone(change["heads"])
        self.assertIsNone(change["segment"])
        self.assertTrue(change["gstin_changes"])
        self.assertEqual(self.merge().status_code, 409)
        bill.refresh_from_db()
        self.assertEqual(bill.customer_id, self.source.pk)

    def test_every_closed_sales_month_is_named_and_post_checks_shared_guard(self):
        for month in (8, 9):
            sale(self.firm, self.source, f"KGH/2026-27/{month}", date(2026, month, 12))
            FiledPeriod.objects.create(business=self.firm, year=2026, month=month)
        refusal = self.preview().data["refusal"]
        self.assertEqual(refusal["months"], ["2026-08", "2026-09"])
        self.assertEqual(refusal["detail"], "Can't merge: 2 bills of Anil G are in filed months. August 2026 and September 2026 are filed and locked, and merging would change returns already filed. Keep both customers, or unlock those months in GST returns first (owner only).")
        response = self.merge()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["months"], ["2026-08", "2026-09"])
        self.assertEqual(response.data["detail"],
                         "August 2026 is filed and locked for KIRAN GOLD HOUSE, so its bills can't move to another customer. "
                         "Have the owner unlock August 2026 in GST returns first.")

    def test_closed_purchase_month_fallback_refuses(self):
        sale(self.firm, self.source, "P-1", "2026-09-12", kind="inward")
        FiledPeriod.objects.create(business=self.firm, year=2026, month=9)
        self.assertEqual(self.preview().data["refusal"]["code"], "month_closed")
        self.assertEqual(self.merge().status_code, 409)

    def test_purchase_fallback_ignores_a_gstr1_only_sales_lock(self):
        sale(self.firm, self.source, "P-1", "2026-09-12", kind="inward")
        with patch("billing.services.customer_merge.assert_sales_open", side_effect=Refusal(
                "Only GSTR-1 is filed", "month_closed")):
            self.assertTrue(self.preview().data["can_merge"])

    def test_part2_purchase_guard_is_the_integration_point(self):
        purchase = sale(self.firm, self.source, "P-1", "2026-09-12", kind="inward")

        def purchase_guard(business, month, action):
            # The published purchase guard indexes CREDIT_CLOSED_WORDS[action].
            words = {"edit": "Credit month is filed"}[action]
            raise Refusal(words, "month_closed", stage="filed",
                          locked_period={"id": 17, "business": business, "year": month.year, "month": month.month})

        with patch("billing.period_lock.assert_purchase_open", create=True, side_effect=purchase_guard) as guard:
            self.assertEqual(self.preview().data["refusal"]["months"], ["2026-09"])
            response = self.merge()
            self.assertEqual(response.status_code, 409)
            self.assertEqual(response.data["detail"],
                             "September 2026 is filed and locked for KIRAN GOLD HOUSE, so its bills can't move to another customer. "
                             "Have the owner unlock September 2026 in GST returns first.")
            self.assertEqual(response.data["stage"], "filed")
            self.assertEqual(response.data["locked_period"]["id"], 17)
            guard.assert_called_with(self.firm.pk, date(2026, 9, 1), "edit")
        purchase.refresh_from_db()
        self.assertEqual(purchase.customer_id, self.source.pk)
        self.assertEqual(AuditLog.objects.count(), 0)

    def test_preledger_purchase_fallback_ignores_legacy_lock_and_keeps_money(self):
        purchase = sale(self.firm, self.source, "P-OLD", "2025-03-31", kind="inward")
        FiledPeriod.objects.create(business=self.firm, year=2025, month=3)
        before = list(LineItem.objects.filter(invoice=purchase).values_list("quantity", "rate", "cgst", "sgst", "igst", "amount"))
        total = purchase.total_amount
        with patch("billing.services.customer_merge._has_column", return_value=False), \
                patch("billing.period_lock.assert_purchase_open", None, create=True), \
                patch("billing.period_lock.locked_period_or_none", side_effect=AssertionError("No credit month to lock")):
            self.assertTrue(self.preview().data["can_merge"])
            self.assertEqual(self.merge().status_code, 200)
        purchase.refresh_from_db()
        self.assertEqual((purchase.customer_id, purchase.total_amount), (self.target.pk, total))
        self.assertEqual(list(LineItem.objects.filter(invoice=purchase).values_list("quantity", "rate", "cgst", "sgst", "igst", "amount")), before)

    def test_purchase_fallback_starts_with_april_2025(self):
        sale(self.firm, self.source, "P-FIRST", "2025-04-01", kind="inward")
        FiledPeriod.objects.create(business=self.firm, year=2025, month=4)
        with patch("billing.services.customer_merge._has_column", return_value=False), \
                patch("billing.period_lock.assert_purchase_open", None, create=True):
            self.assertEqual(self.preview().data["refusal"]["months"], ["2025-04"])
            self.assertEqual(self.merge().status_code, 409)

    def test_purchase_guard_receives_no_month_before_ledger(self):
        sale(self.firm, self.source, "P-OLD", "2025-03-31", kind="inward")

        def purchase_guard(business, month, action):
            if month is not None:
                raise Refusal("This month is filed", "month_closed")

        with patch("billing.services.customer_merge._has_column", return_value=False), \
                patch("billing.period_lock.assert_purchase_open", create=True, side_effect=purchase_guard) as guard:
            self.assertTrue(self.preview().data["can_merge"])
            self.assertEqual(self.merge().status_code, 200)
            guard.assert_called_with(self.firm.pk, None, "edit")

    @skipUnless(hasattr(Invoice, "itc_month") and hasattr(Customer, "is_supplier"), "Requires part 2A purchase fields")
    def test_part2_credit_month_and_supplier_mark_survive_merge(self):
        self.source.is_supplier = True
        self.source.save(update_fields=["is_supplier"])
        purchase = sale(self.firm, self.source, "P-1", "2026-08-12", kind="inward", itc_month=date(2026, 9, 1))
        closed = FiledPeriod.objects.create(business=self.firm, year=2026, month=9)
        response = self.merge()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["months"], ["2026-09"])
        closed.delete()
        self.assertEqual(self.merge().status_code, 200)
        self.target.refresh_from_db()
        purchase.refresh_from_db()
        self.assertTrue(self.target.is_supplier)
        self.assertEqual(purchase.customer_id, self.target.pk)
        self.assertEqual(purchase.itc_month, date(2026, 9, 1))

    @skipUnless(hasattr(Invoice, "itc_month") and hasattr(Customer, "is_supplier"), "Requires part 2A purchase fields")
    def test_part2_null_credit_month_obeys_ledger_floor_without_changing_it(self):
        old = sale(self.firm, self.source, "P-OLD", "2025-03-31", kind="inward", itc_month=None)
        current = sale(self.firm, self.source, "P-FIRST", "2025-04-01", kind="inward", itc_month=None)
        FiledPeriod.objects.create(business=self.firm, year=2025, month=3)
        closed = FiledPeriod.objects.create(business=self.firm, year=2025, month=4)
        self.assertEqual(self.preview().data["refusal"]["months"], ["2025-04"])
        closed.delete()
        self.assertTrue(self.preview().data["can_merge"])
        self.assertEqual(self.merge().status_code, 200)
        for purchase in (old, current):
            purchase.refresh_from_db()
            self.assertEqual(purchase.customer_id, self.target.pk)
            self.assertIsNone(purchase.itc_month)

    def test_shared_sales_guard_is_used_even_when_no_filedperiod_exists(self):
        sale(self.firm, self.source, "KGH/2026-27/1", "2026-09-12")
        with patch("billing.services.customer_merge.assert_sales_open", side_effect=Refusal(
                "September's GSTR-1 is filed", "month_closed")) as guard:
            self.assertEqual(self.merge().data["code"], "month_closed")
            guard.assert_called_with(self.firm.pk, date(2026, 9, 12), "merge")

    def test_walkin_either_way_malformed_ids_missing_customers_and_roles(self):
        for source_walkin in (True, False):
            self.source.customer_type = "walkin" if source_walkin else "person"
            self.target.customer_type = "person" if source_walkin else "walkin"
            self.source.save()
            self.target.save()
            self.assertEqual(self.preview().data["refusal"]["code"], "walkin")
            self.assertEqual(self.merge().status_code, 409)
        for raw in (None, "", True, 1.2, [], {}, "²", "9" * 30, -1):
            response = invoke(CustomerMergeView, self.owner, "post", self.source.pk, {"into": raw})
            self.assertEqual(response.status_code, 400, raw)
            self.assertEqual(response.data["into"], ["Pick the customer to keep."])
        response = invoke(CustomerMergeView, self.owner, "post", self.source.pk, {"into": self.source.pk})
        self.assertEqual(response.data["into"], ["Pick a different customer to keep; this is the same one."])
        self.assertEqual(invoke(CustomerMergeView, self.owner, "post", self.source.pk, {"into": 999999}).status_code, 404)
        self.assertEqual(invoke(CustomerMergeView, self.owner, "post", 999999, {"into": self.target.pk}).status_code, 404)
        for role in ("accountant", "staff", "viewer"):
            user = person("merge-" + role, *ROLE_GROUPS[role])
            self.assertEqual(invoke(CustomerMergeView, user, pk=self.source.pk, payload={"into": self.target.pk}).status_code, 403)
            self.assertEqual(invoke(CustomerMergeView, user, "post", self.source.pk, {"into": self.target.pk}).status_code, 403)

    def test_preview_route_cannot_write_and_merge_route_cannot_preview(self):
        client = client_for(self.owner)
        base = f"/api/customers/{self.source.pk}"
        self.assertEqual(client.post(base + "/merge-preview/", {"into": self.target.pk}, format="json").status_code, 405)
        self.assertEqual(client.get(base + "/merge-into/", {"into": self.target.pk}).status_code, 405)
        self.assertTrue(Customer.objects.filter(pk=self.source.pk).exists())

    def test_preview_is_rechecked_and_failure_rolls_back_references(self):
        bill = sale(self.firm, self.source, "KGH/2026-27/1", "2026-09-12")
        self.assertTrue(self.preview().data["can_merge"])
        Invoice.objects.filter(pk=bill.pk).update(paper=True)
        self.assertEqual(self.merge().status_code, 409)
        Invoice.objects.filter(pk=bill.pk).update(paper=False)
        with patch("billing.services.customer_merge.refile_heads", side_effect=RuntimeError("mock failure")), self.assertRaises(RuntimeError):
            merge_customers(self.source.pk, self.target.pk, self.owner)
        bill.refresh_from_db()
        self.assertEqual(bill.customer_id, self.source.pk)
        self.assertTrue(Customer.objects.filter(pk=self.source.pk).exists())
        self.assertEqual(AuditLog.objects.count(), 0)

    def test_duplicates_normalize_last_ten_digits_and_gstin_excluding_walkin(self):
        self.source.gst_number = "08aagpl3375f1zo"
        self.source.mobile_number = "919829041122"
        self.source.save()
        self.target.gst_number = "08AAGPL3375F1ZO"
        self.target.save()
        buyer("Walk-in", customer_type="walkin", mobile_number="9829041122", gst_number="08AAGPL3375F1ZO")
        buyer("Blank", mobile_number="")
        viewer = person("duplicates-viewer", *ROLE_GROUPS["viewer"])
        groups = invoke(CustomerDuplicatesView, viewer).data["groups"]
        self.assertEqual([(group["what"], group["value"]) for group in groups],
                         [("gstin", "08AAGPL3375F1ZO"), ("phone", "9829041122")])
        self.assertEqual({row["id"] for row in groups[0]["customers"]}, {self.source.pk, self.target.pk})


class MergeReadTests(TransactionTestCase):
    def test_preview_and_duplicates_use_no_cached_or_deferred_reads(self):
        business = firm()
        source = buyer("Source", state="GUJARAT")
        target = buyer("Target")
        sale(business, source, "KGH/2026-27/1", "2026-09-12")
        with cacheops_on() as touched, CaptureQueriesContext(connection) as queries:
            merge_preview(source.pk, target.pk)
            duplicates()
        self.assertEqual(touched, [])
        self.assertFalse(any('"billing_customer"."address"' in q["sql"] for q in queries))
        self.assertFalse(any('"billing_invoice"."notes"' in q["sql"] for q in queries))


class MergeConcurrencyTests(TransactionTestCase):
    @skipUnless(connection.vendor == "postgresql", "Postgres row locks are required")
    def test_two_merges_lock_the_source_and_target_and_only_one_writes(self):
        owner = person("merge-concurrent", *ROLE_GROUPS["owner"])
        business, source, target = firm(), buyer("Source"), buyer("Target")
        bill = sale(business, source, "KGH/2026-27/1", "2026-09-12")
        start = Barrier(2)

        def attempt():
            close_old_connections()
            try:
                start.wait(timeout=10)
                try:
                    merge_customers(source.pk, target.pk, owner)
                    return "merged"
                except Http404:
                    return "missing"
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as executor:
            answers = list(executor.map(lambda _: attempt(), range(2)))
        self.assertCountEqual(answers, ["merged", "missing"])
        self.assertEqual(AuditLog.objects.filter(action="merged").count(), 1)
        bill.refresh_from_db()
        self.assertEqual(bill.customer_id, target.pk)
