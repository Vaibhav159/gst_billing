"""The final server review's frozen-firm, restore and missing-write-path regressions."""

from datetime import date
from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse

from billing.api.sales import SalesViewSet
from billing.models import AuditLog, BinnedInvoice, Invoice
from billing.numbering import counter_of, next_counter, refuse_taken
from billing.services.sales import cancel_bill
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person, sale

RING = {"product_name": "Gold Ring 22K", "hsn_code": "711319", "gst_percent": "3", "quantity": "12.345",
        "unit": "gms", "rate": "6512.5", "note": "Hallmarked"}


@patch("django.utils.timezone.localdate", lambda *args, **kwargs: date(2026, 10, 11))
class FinalWritesTest(TestCase):
    def setUp(self):
        self.owner = person("kailash", *ROLE_GROUPS["owner"])
        self.client = client_for(self.owner)
        self.biz, self.cust = firm(invoice_prefix="KGH"), buyer(mobile_number="9829041122")

    def body(self, **more):
        return {"business": self.biz.pk, "customer": self.cust.pk, "invoice_number": "KGH/2026-27/31",
                "invoice_date": "2026-09-30", "payment_mode": "cash", "lines": [RING], **more}

    def make(self, **more):
        result = self.client.post(reverse("sale-list"), self.body(**more), format="json")
        self.assertEqual(result.status_code, 201, result.data)
        return Invoice.objects.get(pk=result.data["id"])

    def test_a_new_frozen_firm_remembers_its_business_id(self):
        bill = self.make()
        self.assertEqual(bill.firm_snapshot.get("business_id"), self.biz.pk)

    def test_an_old_frozen_firm_without_business_id_still_prints(self):
        bill = self.make()
        old_snapshot = {k: v for k, v in bill.firm_snapshot.items() if k != "business_id"}
        old_snapshot["name"] = "The firm as printed"
        Invoice.objects.filter(pk=bill.pk).update(firm_snapshot=old_snapshot)
        answer = self.client.get(reverse("sale-detail", args=[bill.pk]))
        self.assertEqual(answer.status_code, 200, answer.data)
        self.assertEqual((answer.data["firm"]["name"], answer.data["firm"]["frozen"]),
                         ("The firm as printed", True))

    def test_a_restore_insert_clash_answers_409_after_its_savepoint(self):
        bill = self.make()
        deleted = self.client.delete(reverse("sale-detail", args=[bill.pk]), {}, format="json")
        taken = sale(self.biz, self.cust, bill.invoice_number, "2026-09-29")
        # A v2 writer can bypass the firm's lock. Let the first check pass, then let the real
        # INSERT hit the unique guard: the second check must run in a usable transaction.
        with patch("billing.services.bin.refuse_taken") as checked:
            checked.side_effect = lambda *args, **kwargs: None if checked.call_count == 1 else refuse_taken(*args, **kwargs)
            answer = self.client.post(reverse("bin-restore", args=[deleted.data["id"]]))
        self.assertEqual((answer.status_code, answer.data["code"], answer.data["bill"]["id"]),
                         (409, "number_taken", taken.pk))
        self.assertFalse(Invoice.objects.filter(pk=bill.pk).exists())
        self.assertIsNone(BinnedInvoice.objects.get(pk=deleted.data["id"]).restored_at)
        self.assertFalse(AuditLog.objects.filter(action="restored").exists())

    def test_cancel_without_a_user_records_the_cancellation(self):
        bill = self.make()
        cancel_bill(bill, None, "Returned")
        bill.refresh_from_db()
        self.assertEqual((bill.status, bill.cancel_reason, bill.cancelled_by_id), ("cancelled", "Returned", None))
        self.assertIsNotNone(bill.cancelled_at)
        self.assertIsNone(AuditLog.objects.get(action="cancelled", entity_id=bill.pk).user_id)

    def test_number_parts_read_only_ascii_digits(self):
        for number in ("KGH/2026-27/٣١", "३१", "１２"):
            with self.subTest(number=number):
                self.assertIsNone(counter_of(number))
                sale(self.biz, self.cust, number, "2026-09-30")
        self.assertEqual(next_counter(self.biz.pk, 2026), 1)

    def test_found_then_deleted_put_eway_and_fix_heads_answer_404(self):
        found = SalesViewSet.get_object

        def found_then_deleted(view):
            bill = found(view)
            Invoice.objects.filter(pk=bill.pk).delete()
            return bill

        for method, route, body in (("put", "sale-detail", self.body()),
                                    ("put", "sale-eway", {"eway_bill_number": "123456789012",
                                                          "vehicle_number": "RJ14AB1234"}),
                                    ("post", "sale-fix-heads", {})):
            with self.subTest(route=route):
                bill = sale(self.biz, self.cust, "KGH/2026-27/31", "2026-09-30")
                with patch.object(SalesViewSet, "get_object", found_then_deleted):
                    answer = getattr(self.client, method)(reverse(route, args=[bill.pk]), body, format="json")
                self.assertEqual((answer.status_code, answer.data),
                                 (404, {"detail": "No Invoice matches the given query."}))
        self.assertFalse(AuditLog.objects.exists())

    def test_the_bin_round_trips_every_v3_field(self):
        bill = self.make(notes="Order 77", place_of_supply="24", paper=True)
        sent = self.client.post(reverse("sale-sent", args=[bill.pk]),
                                {"via": "whatsapp", "to": "98290 41123"}, format="json")
        self.assertEqual(sent.status_code, 200, sent.data)
        before = self.client.get(reverse("sale-detail", args=[bill.pk])).data
        deleted = self.client.delete(reverse("sale-detail", args=[bill.pk]), {"reason": "Entered twice"}, format="json")
        self.assertEqual(deleted.status_code, 200, deleted.data)
        restored = self.client.post(reverse("bin-restore", args=[deleted.data["id"]]))
        self.assertEqual(restored.status_code, 200, restored.data)
        after = self.client.get(reverse("sale-detail", args=[bill.pk])).data
        for key in ("firm", "notes", "place_of_supply_chosen", "paper", "sent", "total_amount",
                    "invoice_number", "status", "created_at"):
            with self.subTest(key=key):
                self.assertEqual(after[key], before[key])
        self.assertEqual([{k: v for k, v in row.items() if k != "id"} for row in after["lines"]],
                         [{k: v for k, v in row.items() if k != "id"} for row in before["lines"]])
        bill.refresh_from_db()
        self.assertEqual(bill.firm_snapshot, BinnedInvoice.objects.get(pk=deleted.data["id"]).data["invoice"]["firm_snapshot"])
