"""A share-sheet destination belongs to the device's chooser, not WhatsApp's URL."""

from django.test import TestCase
from django.urls import reverse

from billing.models import AuditLog, Invoice
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person, sale


class EasyShareTest(TestCase):
    def setUp(self):
        self.user = person("staff", *ROLE_GROUPS["staff"])
        self.client = client_for(self.user)
        self.customer = buyer("Walk-in Customer", customer_type="walkin", mobile_number="")
        self.bill = sale(firm(), self.customer, "31", "2026-10-08")
        self.url = reverse("sale-sent", args=[self.bill.pk])

    def send(self, **body):
        return self.client.post(self.url, {"via": "share", **body}, format="json")

    def test_walkin_shares_twice_without_a_number_and_whatsapp_still_refuses(self):
        first = self.send()
        self.assertEqual(first.status_code, 200, first.data)
        sent = first.data["sent"]
        self.assertEqual((first.data["id"], sent["count"], sent["via"], sent["to"]), (self.bill.pk, 1, "share", ""))
        self.assertEqual(sent["at"], sent["last_at"])
        again = self.send().data["sent"]
        self.assertEqual((again["count"], again["at"], again["to"]), (2, sent["at"], ""))
        self.assertGreaterEqual(again["last_at"], sent["last_at"])
        refused = self.send(via="whatsapp")
        self.assertEqual((refused.status_code, refused.data), (400, {
            "to": ["A walk-in has no number on record. Type theirs to send the bill to their WhatsApp."],
        }))
        self.assertEqual(list(AuditLog.objects.filter(action="sent").order_by("id").values_list("details", flat=True)), [
            "On the share sheet to Walk-in Customer", "Again on the share sheet to Walk-in Customer",
        ])
        self.bill.refresh_from_db()
        self.assertEqual(self.bill.sent_count, 2)

    def test_named_customer_without_phone_can_share_but_needs_phone_for_whatsapp(self):
        self.customer.name = "Lalit Jain"
        self.customer.customer_type = "person"
        self.customer.save()
        shared = self.send()
        self.assertEqual(shared.status_code, 200, shared.data)
        self.assertEqual(shared.data["sent"]["to"], "")
        refused = self.send(via="whatsapp")
        self.assertEqual((refused.status_code, refused.data), (400, {
            "to": ["Lalit Jain has no mobile number on record. Type the WhatsApp number to send it to."],
        }))

    def test_numberless_share_keeps_the_one_off_destination_without_changing_customer(self):
        self.assertEqual(self.send(via="whatsapp", to="+91 98290-41122").data["sent"]["to"], "9829041122")
        self.assertEqual(self.send().data["sent"]["to"], "9829041122")
        self.assertEqual(self.send(to="98290 41123").data["sent"]["to"], "9829041123")
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.mobile_number, "")

    def test_explicit_invalid_share_destination_is_still_rejected_without_writes(self):
        for bad in ("12345", None, True, ["9829041122"], {"number": "9829041122"}, "98290\x0041122"):
            with self.subTest(to=bad):
                response = self.send(to=bad)
                self.assertEqual((response.status_code, response.data), (400, {
                    "to": ["Type a 10-digit mobile number, like 98290 41122."],
                }))
        self.bill.refresh_from_db()
        self.assertEqual((self.bill.sent_count, self.bill.sent_at), (0, None))
        self.assertFalse(AuditLog.objects.filter(action="sent").exists())

    def test_numberless_share_keeps_permissions_and_cancel_refusal(self):
        for role in ("viewer", "accountant"):
            response = client_for(person(role, *ROLE_GROUPS[role])).post(self.url, {"via": "share"}, format="json")
            self.assertEqual((response.status_code, response.data["needs"]), (403, "bill.send"))
        Invoice.objects.filter(pk=self.bill.pk).update(status="cancelled")
        response = self.send()
        self.assertEqual((response.status_code, response.data), (409, {
            "detail": "31 is cancelled, so it can't be sent.", "code": "cancelled",
        }))
        self.assertFalse(AuditLog.objects.filter(action="sent").exists())
