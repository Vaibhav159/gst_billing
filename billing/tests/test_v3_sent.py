"""Sent records and the customer's type (plan 1A, Task 4): POST /api/sales/{id}/sent/,
walk-ins, and the customer fields the send rules read."""

from unittest.mock import patch

from django.test import SimpleTestCase, TestCase
from django.urls import reverse

from billing.api.sales import SalesViewSet
from billing.constants import BILL_CANCELLED
from billing.models import AuditLog, BinnedInvoice, Customer, FiledPeriod, Invoice
from billing.period_lock import assert_period_unlocked
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person, sale

SAY_HOW = {"via": ["Say how it was sent: whatsapp or share."]}
TYPE_A_MOBILE = {"to": ["Type a 10-digit mobile number, like 98290 41122."]}
WHAT_A_PAN_IS = {"pan_number": ["A PAN has 10 characters: 5 letters, 4 digits, then a letter (like ABCDE1234F)."]}
CHOOSE_A_TYPE = {"customer_type": ["Choose walk-in, person or business."]}


class SentTest(TestCase):
    def setUp(self):
        self.staff = person("rakesh", *ROLE_GROUPS["staff"])
        self.biz = firm()
        self.anil = buyer(mobile_number="9829041122")
        self.bill = sale(self.biz, self.anil, "KGH/2026-27/31", "2026-10-08")

    def send(self, bill=None, user=None, **body):
        body.setdefault("via", "whatsapp")
        return client_for(user or self.staff).post(reverse("sale-sent", args=[(bill or self.bill).pk]), body, format="json")

    def test_the_first_send_and_the_next(self):
        r = self.send()
        self.assertEqual(r.status_code, 200, r.data)
        first = r.data["sent"]
        self.assertEqual((first["count"], first["via"], first["to"]), (1, "whatsapp", ""))
        self.assertEqual(first["at"], first["last_at"])
        again = self.send(via="share").data["sent"]
        self.assertEqual((again["count"], again["at"], again["via"]), (2, first["at"], "share"))
        self.assertGreater(again["last_at"], first["last_at"])
        details = list(AuditLog.objects.filter(action="sent").order_by("id").values_list("details", flat=True))
        self.assertEqual(details, ["WhatsApp to Anil Gupta", "Again on the share sheet to Anil Gupta"])

    def test_a_walk_in_needs_a_number_kept_on_the_bill_only(self):
        walkin = Customer.objects.create(name="Walk-in Customer", customer_type="walkin", state_name="RAJASTHAN")
        bill = sale(self.biz, walkin, "KGH/2026-27/33", "2026-10-08")
        r = self.send(bill)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data, {"to": ["A walk-in has no number on record. Type theirs to send the bill to their WhatsApp."]})
        r = self.send(bill, to="+91 98290-41122")
        self.assertEqual(r.data["sent"]["to"], "9829041122")
        self.assertEqual(AuditLog.objects.get(action="sent").details, "WhatsApp to +91 98290 41122")
        walkin.refresh_from_db()
        self.assertFalse(walkin.mobile_number)
        self.assertEqual(self.send(bill).data["sent"]["count"], 2)  # sending again reuses that number

    def test_a_customer_without_a_phone_needs_a_number(self):
        bill = sale(self.biz, buyer("Lalit Mehta"), "KGH/2026-27/34", "2026-10-08")
        r = self.send(bill)
        self.assertEqual(r.data, {"to": ["Lalit Mehta has no mobile number on record. Type the WhatsApp number to send it to."]})

    def test_words_for_a_bad_number_and_a_bad_way(self):
        self.assertEqual(self.send(to="12345").data, {"to": ["Type a 10-digit mobile number, like 98290 41122."]})
        self.assertEqual(self.send(via="sms").data, {"via": ["Say how it was sent: whatsapp or share."]})

    def test_a_cancelled_bill_isnt_sent(self):
        Invoice.objects.filter(pk=self.bill.pk).update(status=BILL_CANCELLED)
        r = self.send()
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.data, {"detail": "KGH/2026-27/31 is cancelled, so it can't be sent.", "code": "cancelled"})

    def test_a_filed_month_still_sends(self):
        FiledPeriod.objects.create(business=self.biz, year=2026, month=10)
        self.assertEqual(self.send().status_code, 200)

    def test_owner_and_staff_send(self):
        self.assertEqual(self.send(user=person("kailash", *ROLE_GROUPS["owner"])).status_code, 200)
        for role in ("accountant", "viewer"):
            r = self.send(user=person(role, *ROLE_GROUPS[role]))
            self.assertEqual((r.status_code, r.data["needs"]), (403, "bill.send"), role)

    def test_v2_cant_write_the_sends_and_its_undo_keeps_them(self):
        owner = client_for(person("kailash", *ROLE_GROUPS["owner"]))
        owner.patch(reverse("invoice-detail", args=[self.bill.pk]), {"payment_mode": "cash", "sent_count": 9}, format="json")
        self.send()
        edit = AuditLog.objects.get(action="updated", entity_id=self.bill.pk)
        self.assertEqual(owner.post(reverse("auditlog-undo", args=[edit.pk])).status_code, 200)
        self.bill.refresh_from_db()
        self.assertEqual((self.bill.payment_mode, self.bill.sent_count), ("", 1))

    # Beyond the plan's tests: the rulings' edges.

    def test_a_way_or_a_number_that_cant_be_used_gets_the_contracts_words(self):
        # Ruling 1A-5 and Task 3's review M2: never DRF's own words. A way that is missing, null or not one of
        # the two; a number that is null, not text or has a null character; a body that isn't an object (each
        # field refuses it). Nothing is recorded.
        url = reverse("sale-sent", args=[self.bill.pk])
        for body, words in (
            ({}, SAY_HOW), ({"via": None}, SAY_HOW), ({"via": ""}, SAY_HOW), ({"via": ["whatsapp"]}, SAY_HOW),
            ({"via": {"by": "whatsapp"}}, SAY_HOW), ({"via": True}, SAY_HOW),
            ({"via": "whatsapp", "to": None}, TYPE_A_MOBILE), ({"via": "whatsapp", "to": ["9829041122"]}, TYPE_A_MOBILE),
            ({"via": "whatsapp", "to": {"n": "9829041122"}}, TYPE_A_MOBILE), ({"via": "whatsapp", "to": True}, TYPE_A_MOBILE),
            ({"via": "whatsapp", "to": "98290\x0041122"}, TYPE_A_MOBILE),
            (["whatsapp", "9829041122"], {**SAY_HOW, **TYPE_A_MOBILE}), ("whatsapp", {**SAY_HOW, **TYPE_A_MOBILE}),
        ):
            with self.subTest(body=body):
                r = client_for(self.staff).post(url, body, format="json")
                self.assertEqual((r.status_code, r.data), (400, words))
        self.bill.refresh_from_db()
        self.assertEqual((self.bill.sent_count, self.bill.sent_at), (0, None))
        self.assertFalse(AuditLog.objects.filter(action="sent").exists())

    def test_a_bill_never_sent_has_no_sends(self):
        from billing.services.sales import sent_block

        self.assertIsNone(sent_block(self.bill))  # contract 0.2: null when never sent
        self.send()
        self.bill.refresh_from_db()
        self.assertEqual(sent_block(self.bill)["count"], 1)

    def test_a_deleted_bill_comes_back_with_its_sends(self):
        # Contract 3.2: every field as it was. The bin keeps the sends with the rest of the bill.
        from billing.services.sales import sent_block

        sent = self.send(to="98290 41123").data["sent"]
        owner = client_for(person("kailash", *ROLE_GROUPS["owner"]))
        owner.delete(reverse("sale-detail", args=[self.bill.pk]), {"reason": "Entered twice"}, format="json")
        r = owner.post(reverse("bin-restore", args=[BinnedInvoice.objects.get().pk]))
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(sent_block(Invoice.objects.get(pk=self.bill.pk)), sent)

    def test_a_bill_deleted_after_it_was_found_is_a_404(self):
        # Ruling 1A-17, through locked_bill: another request deletes the bill between get_object() and the lock.
        found = SalesViewSet.get_object

        def found_then_deleted(view):
            bill = found(view)
            Invoice.objects.filter(pk=bill.pk).delete()
            return bill

        with patch.object(SalesViewSet, "get_object", found_then_deleted):
            r = self.send()
        self.assertEqual((r.status_code, r.data), (404, {"detail": "No Invoice matches the given query."}))
        self.assertFalse(AuditLog.objects.filter(action="sent").exists())

    def test_a_purchase_is_not_a_sale(self):
        purchase = sale(self.biz, self.anil, "SJ-1", "2026-10-08", kind="inward")
        r = self.send(purchase)
        self.assertEqual((r.status_code, r.data), (404, {"detail": "No Invoice matches the given query."}))
        purchase.refresh_from_db()
        self.assertEqual(purchase.sent_count, 0)

    def test_a_v2_save_that_read_the_bill_before_a_send_keeps_the_send(self):
        # Ruling 1A-16: v2's saves never write the v3 columns, so a send that lands while v2's PATCH holds the
        # bill stays. v2 reads the sends, read-only (contract §7).
        from billing.services.sales import record_send

        owner = client_for(person("kailash", *ROLE_GROUPS["owner"]))

        def sent_meanwhile(*args, **kwargs):
            if not Invoice.objects.filter(pk=self.bill.pk, sent_count__gt=0).exists():  # once: v2 checks twice
                record_send(self.bill, self.staff, "whatsapp")
            return assert_period_unlocked(*args, **kwargs)

        with patch("billing.api.views.assert_period_unlocked", sent_meanwhile):
            r = owner.patch(reverse("invoice-detail", args=[self.bill.pk]), {"payment_mode": "cash"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.bill.refresh_from_db()
        self.assertEqual((self.bill.payment_mode, self.bill.sent_count, self.bill.sent_via), ("cash", 1, "whatsapp"))
        v2 = owner.get(reverse("invoice-detail", args=[self.bill.pk])).data
        self.assertEqual((v2["sent_count"], v2["sent_via"], v2["sent_to"]), (1, "whatsapp", ""))
        self.assertTrue(v2["sent_at"] and v2["sent_at"] == v2["last_sent_at"])


class MobileOfTest(SimpleTestCase):
    def test_a_10_digit_indian_mobile_from_what_was_typed(self):
        # Contract 2.10: a leading 91 or 0, spaces and marks are dropped. Only 0-9 count as digits (other
        # scripts' are dropped like marks): a wa.me link reads only those.
        from billing.services.sales import mobile_of

        for typed, read in (("9829041122", "9829041122"), ("+91 98290-41122", "9829041122"),
                            ("098290 41122", "9829041122"), ("91 9829041122", "9829041122"),
                            ("12345", ""), ("5829041122", ""), ("98290 41122 3", ""), ("", ""), (None, ""),
                            ("98290४११२२", ""), ("98290٤١١٢٢", ""), ("+९१ 98290 41122", "9829041122")):
            with self.subTest(typed=typed):
                self.assertEqual(mobile_of(typed), read)


class CustomerTypeTest(TestCase):
    def setUp(self):
        self.client = client_for(person("rakesh", *ROLE_GROUPS["staff"]))

    def add(self, **body):
        return self.client.post(reverse("customer-list"), {"name": "Meena Jain", "state_name": "RAJASTHAN", **body},
                                format="json")

    def test_type_city_and_the_pan_on_record(self):
        r = self.add(customer_type="person", city="Udaipur", pan_number=" abcde1234f ")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual((r.data["customer_type"], r.data["city"], r.data["pan_number"]), ("person", "Udaipur", "ABCDE1234F"))
        self.assertEqual((r.data["type"], r.data["pan"]), ("person", "ABCDE1234F"))

    def test_the_type_is_inferred_when_blank(self):
        gst = Customer.objects.create(name="Rathore Gems", gst_number="08AAKFS4821M1Z9")
        self.assertEqual((gst.kind, Customer.objects.create(name="Priya").kind), ("business", "person"))

    def test_a_pan_comes_from_a_gstin_only_when_its_check_digit_passes(self):
        from billing.gstin import check_digit

        good = "08AAKFS4821M1Z" + check_digit("08AAKFS4821M1Z")
        bad = good[:14] + ("A" if good[14] != "A" else "B")
        self.assertEqual(Customer(name="A", gst_number=good).pan, "AAKFS4821M")
        self.assertEqual(Customer(name="B", gst_number=bad).pan, "")

    def test_words_for_a_bad_pan_and_type(self):
        r = self.add(pan_number="ABCD1234F")
        self.assertEqual(r.data, {"pan_number": ["A PAN has 10 characters: 5 letters, 4 digits, then a letter (like ABCDE1234F)."]})
        self.assertEqual(self.add(customer_type="shop").data, {"customer_type": ["Choose walk-in, person or business."]})

    # Beyond the plan's tests: the rulings' edges.

    def test_a_typed_pan_comes_before_the_gstins(self):
        # Upper-cased: v2 stored a PAN as it was typed.
        from billing.gstin import check_digit

        gstin = "08ABCDE1234A1Z" + check_digit("08ABCDE1234A1Z")
        self.assertEqual(Customer(name="C", pan_number=" aakfs4821m ", gst_number=gstin).pan, "AAKFS4821M")
        self.assertEqual(Customer(name="D", gst_number=gstin).pan, "ABCDE1234A")

    def test_a_pan_or_type_that_cant_be_used_gets_the_contracts_words(self):
        # Ruling 1A-5: too long (a GSTIN typed in the PAN box) or not text says what a PAN is; a null or
        # listed type says the three. Never DRF's own words.
        for body, words in (({"pan_number": "ABCDE1234FG"}, WHAT_A_PAN_IS), ({"pan_number": "08AAKFS4821M1Z9"}, WHAT_A_PAN_IS),
                            ({"pan_number": ["ABCDE1234F"]}, WHAT_A_PAN_IS), ({"customer_type": None}, CHOOSE_A_TYPE),
                            ({"customer_type": ["person"]}, CHOOSE_A_TYPE)):
            with self.subTest(body=body):
                r = self.add(**body)
                self.assertEqual((r.status_code, r.data), (400, words))
        self.assertFalse(Customer.objects.exists())
        r = self.add(pan_number="", customer_type="")  # no PAN, and the type left to infer, as in v2
        self.assertEqual((r.status_code, r.data["pan_number"], r.data["type"], r.data["pan"]), (201, "", "person", ""))
