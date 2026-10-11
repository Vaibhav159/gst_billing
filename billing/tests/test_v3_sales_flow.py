"""Part 1's selling flows end to end against the real endpoints (plan 1A, Task 11), in the order
the prototype's checks walk them (ui-prototype/tests/sales-flows.cjs): a counter bill and a
clash, a run from the paper book, cancel and make it again, delete and bring back, renumber,
a walk-in's send, the e-way bill, the income-tax checks, and what a viewer may do."""

from datetime import date
from unittest.mock import patch

from django.test import TestCase
from django.urls import reverse

from billing.models import AuditLog, Customer
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person

GOLD = {"product_name": "Gold Ring 22K", "hsn_code": "711319", "gst_percent": "3", "quantity": "12.345",
        "unit": "gms", "rate": "6512.50"}


class SalesFlowTest(TestCase):
    def setUp(self):
        self.owner = client_for(person("kailash", *ROLE_GROUPS["owner"], first_name="Kailash", last_name="Mehta"))
        self.staff = client_for(person("rakesh", *ROLE_GROUPS["staff"], first_name="Rakesh", last_name="Soni"))
        self.viewer = client_for(person("manoj", *ROLE_GROUPS["viewer"]))
        self.kgh = firm(invoice_prefix="KGH", paper_full_number_from=date(2026, 4, 1))
        self.anil = buyer(mobile_number="9829041122")
        self.walkin = buyer("Walk-in Customer", customer_type="walkin")

    def bill(self, client, number, day="2026-10-08", customer=None, lines=(GOLD,), **more):
        body = {"business": self.kgh.pk, "customer": (customer or self.anil).pk, "invoice_number": number,
                "invoice_date": day, "payment_mode": "cash", "lines": list(lines), **more}
        return client.post(reverse("sale-list"), body, format="json")

    @patch("django.utils.timezone.localdate", return_value=date(2026, 10, 9))
    def test_the_selling_flows(self, _today):
        # A counter bill: the number the paper bill carries, typed as digits, in the firm's format.
        nxt = self.staff.get(reverse("sale-next-number"), {"business_id": self.kgh.pk, "invoice_date": "2026-10-08"})
        self.assertEqual(nxt.data["invoice_number"], "KGH/2026-27/1")
        first = self.bill(self.staff, "1").data
        self.assertEqual((first["invoice_number"], first["total_amount"]), ("KGH/2026-27/1", "82808.71"))
        self.assertEqual([f["kind"] for f in first["itax"]], ["b2c_address"])  # warns, never blocks the save
        clash = self.bill(self.staff, "1")
        self.assertEqual((clash.status_code, clash.data["code"], clash.data["next"]["invoice_number"]),
                         (409, "number_taken", "KGH/2026-27/2"))
        skip = self.staff.get(reverse("sale-check-number"), {"business_id": self.kgh.pk, "invoice_date": "2026-10-08",
                                                             "invoice_number": "5"}).data
        self.assertEqual(skip["note"], "Numbers 2 to 4 would be skipped. GSTR-1 lists skipped numbers, so only do this on purpose.")

        # A run from September's paper book, typed in after October's bill: each next number in turn.
        for _ in range(3):
            book = self.staff.get(reverse("sale-paper-book"), {"business_id": self.kgh.pk, "month": "2026-09"}).data
            made = self.bill(self.staff, str(book["next"]["counter"]), day="2026-09-30", paper=True)
            self.assertEqual(made.status_code, 201, made.data)
        book = self.staff.get(reverse("sale-paper-book"), {"business_id": self.kgh.pk, "month": "2026-09"}).data
        self.assertEqual((book["entered"], book["runs"], book["next"]["counter"]), (3, [[2, 4]], 5))

        # Cancel (the owner), then make it again (counter staff): the two bills point at each other.
        cancel = self.owner.post(reverse("sale-cancel", args=[first["id"]]), {"reason": "Customer returned it"},
                                 format="json")
        self.assertEqual(cancel.data["status"], "cancelled")
        again = self.bill(self.staff, "5", replaces=first["id"]).data
        self.assertEqual(again["replaces"]["invoice_number"], "KGH/2026-27/1")
        self.assertEqual(self.staff.get(reverse("sale-detail", args=[first["id"]])).data["replaced_by"]["id"], again["id"])
        listed = self.viewer.get(reverse("sale-list"), {"fy": "2026-27"}).data
        self.assertEqual((listed["summary"]["bills"], listed["summary"]["cancelled"]), (4, 1))

        # Delete to the bin, the Audit log's Undo brings it back under its own id.
        gone = self.owner.delete(reverse("sale-detail", args=[again["id"]]), {"reason": "Entered twice"}, format="json")
        self.assertEqual(gone.data["invoice_number"], "KGH/2026-27/5")
        self.assertEqual(self.viewer.get(reverse("sale-detail", args=[again["id"]])).data["code"], "deleted")
        entry = AuditLog.objects.get(action="deleted", entity_id=again["id"])
        self.assertEqual(self.owner.post(reverse("auditlog-undo", args=[entry.pk])).data["new_id"], again["id"])

        # Renumber: the owner gives the bill the next free number.
        moved = self.owner.post(reverse("sale-renumber", args=[again["id"]]), {"invoice_number": "6"}, format="json")
        self.assertEqual(moved.data["invoice_number"], "KGH/2026-27/6")

        # A walk-in's bill goes to a number typed for it, which the customer record never keeps.
        walkin_bill = self.bill(self.staff, "7", customer=self.walkin).data
        sent = self.staff.post(reverse("sale-sent", args=[walkin_bill["id"]]), {"via": "whatsapp", "to": "98290 41122"},
                               format="json").data["sent"]
        self.assertEqual((sent["to"], sent["count"]), ("9829041122", 1))
        self.assertEqual(Customer.objects.get(pk=self.walkin.pk).mobile_number, None)

        # The e-way bill, by the owner, shows on the bill.
        eway = self.owner.put(reverse("sale-eway", args=[walkin_bill["id"]]),
                              {"eway_bill_number": "1234 5678 9012", "vehicle_number": "RJ27GA4410", "distance_km": 820},
                              format="json").data["eway"]
        self.assertEqual((eway["eway_bill_number"], eway["distance_km"]), ("123456789012", 820))

        # The income-tax checks: cash at the limit, and a big bill to a buyer with no PAN.
        cash = self.bill(self.staff, "8", lines=[{**GOLD, "quantity": "1", "rate": "194174.76"}]).data
        self.assertEqual([f["kind"] for f in cash["itax"]], ["cash_limit", "b2c_address"])
        big = self.bill(self.staff, "9", payment_mode="bank", lines=[{**GOLD, "quantity": "1", "rate": "250000"}]).data
        self.assertEqual([f["kind"] for f in big["itax"]], ["pan", "b2c_address"])
        views = self.viewer.get(reverse("sale-list"), {"fy": "2026-27", "itax": "1"}).data["results"]
        self.assertEqual({row["invoice_number"] for row in views}, {f"KGH/2026-27/{n}" for n in (2, 3, 4, 6, 7, 8, 9)})

        # A viewer reads everything and changes nothing, and is told who may.
        refused = self.bill(self.viewer, "10")
        self.assertEqual(refused.data["detail"], "Only the owner and counter staff can make bills. Ask the owner if you need it.")
        statement = self.viewer.get(reverse("customer-statement", args=[self.anil.pk])).data
        self.assertEqual([b["paid"] for b in statement["bills"]][:2], ["billing", "billing"])
        self.assertIn("cancelled", [b["paid"] for b in statement["bills"]])
