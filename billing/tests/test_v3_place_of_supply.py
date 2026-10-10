"""A bill's own place of supply, the frozen firm, and notes (plan 1A, Task 5).

NULL keeps today's rule (the customer's state, else the firm's), so every older bill reads as
before; a chosen place decides IGST against the firm's state everywhere the direction is read.
"""

from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse

from billing.constants import BILL_CANCELLED
from billing.models import AuditLog, BinnedInvoice, Customer, Invoice, LineItem
from billing.period_lock import assert_period_unlocked
from billing.services.line_items import build_line_items
from billing.services.sales import firm_snapshot
from billing.tax_rules import classify_b2c, place_of_supply, supply_interstate
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, line, person, sale

B2B_GSTIN = "08AAKFS4821M1Z9"


def heads(bill):
    li = bill.lineitem_set.get()
    return li.cgst, li.sgst, li.igst


class DirectionTest(TestCase):
    def setUp(self):
        self.biz = firm()  # Rajasthan, 08
        self.gujarati = buyer("Desai Gems Walk-in", state="GUJARAT")

    def test_null_keeps_todays_rule(self):
        inv = Invoice(business=self.biz, customer=self.gujarati)
        self.assertEqual((supply_interstate(inv), place_of_supply(inv)), (True, "24"))

    def test_a_counter_sale_to_a_buyer_from_another_state_is_local(self):
        inv = Invoice(business=self.biz, customer=self.gujarati, place_of_supply="08")
        self.assertEqual((supply_interstate(inv), place_of_supply(inv)), (False, "08"))

    def test_the_builder_files_the_heads_by_it(self):
        local = sale(self.biz, self.gujarati, "1", "2026-09-10", place_of_supply="08").lineitem_set.get()
        self.assertEqual((local.cgst, local.sgst, local.igst), (150, 150, 0))
        sent = sale(self.biz, buyer(), "2", "2026-09-10", place_of_supply="24").lineitem_set.get()
        self.assertEqual((sent.cgst, sent.sgst, sent.igst), (0, 0, 300))

    def test_is_igst_applicable_follows_it(self):
        bill = sale(self.biz, buyer(), "1", "2026-09-10", place_of_supply="24")
        r = client_for(person("kailash", *ROLE_GROUPS["owner"])).get(reverse("invoice-detail", args=[bill.pk]))
        self.assertTrue(r.data["is_igst_applicable"])

    def test_a_new_customer_keeps_the_chosen_place(self):
        bill = sale(self.biz, self.gujarati, "1", "2026-09-10", place_of_supply="08")
        bill.customer = buyer("Patel Walk-in", state="GUJARAT")
        bill.save()  # v2's header edit: the lines follow the parties (Invoice._follow_parties)
        li = bill.lineitem_set.get()
        self.assertEqual((li.cgst, li.sgst, li.igst), (150, 150, 0))

    # Beyond the plan's tests: the rule's other branches.

    def test_without_the_buyers_state_the_firms_is_the_place(self):
        walk_in = Invoice(business=self.biz, customer=buyer("Counter Walk-in", state=""))
        self.assertEqual((supply_interstate(walk_in), place_of_supply(walk_in)), (False, "08"))

    def test_a_chosen_place_against_a_firm_with_no_state_is_local(self):
        # As is_interstate does when a side is unknown: intra, the safe default for a local shop.
        nowhere = firm("NO STATE FIRM", gstin="", state="")
        self.assertFalse(supply_interstate(Invoice(business=nowhere, customer=self.gujarati, place_of_supply="24")))

    def test_a_move_follows_the_chosen_place_where_the_parties_cant_tell(self):
        # The place says where the goods went, so a bill moved to a firm in that state turns local even for a walk-in
        # with no state (Task 6's move saves through Invoice.save, as v2's PATCH does).
        bill = sale(self.biz, buyer("Counter Walk-in", state=""), "1", "2026-09-10", place_of_supply="24")
        self.assertEqual(heads(bill), (0, 0, 300))
        bill.business = firm("DESAI GEMS", gstin="24ABCDE1234A1Z5", state="GUJARAT")
        bill.save()
        self.assertEqual(heads(bill), (150, 150, 0))


class GstrOneTest(TestCase):
    def setUp(self):
        self.biz = firm()
        self.client = client_for(person("kailash", *ROLE_GROUPS["owner"]))

    def test_classify_b2c_reads_it(self):
        local = buyer()
        self.assertEqual(classify_b2c(self.biz, Invoice(customer=local, place_of_supply="24", total_amount=50000)),
                         ("b2cs", True, "24", False))
        self.assertEqual(classify_b2c(self.biz, Invoice(customer=local, place_of_supply="24", total_amount=150000)),
                         ("b2cl", True, "24", False))
        registered = Customer.objects.create(name="Rathore Gems", gst_number=B2B_GSTIN, state_name="RAJASTHAN")
        self.assertEqual(classify_b2c(self.biz, Invoice(customer=registered, place_of_supply="24")),
                         ("b2b", None, "24", False))

    def test_the_export_and_the_portal_file_file_it(self):
        registered = Customer.objects.create(name="Rathore Gems", gst_number=B2B_GSTIN, state_name="RAJASTHAN")
        sale(self.biz, registered, "1", "2026-09-10", place_of_supply="24")
        sale(self.biz, buyer(), "2", "2026-09-11", place_of_supply="24")
        export = self.client.get(reverse("invoice-gstr-export"), {"business_id": self.biz.pk}).data["gstr1"]
        self.assertEqual(export["b2b"][0]["inv"][0]["pos"], "24")
        self.assertEqual([(r["sply_ty"], r["pos"]) for r in export["b2cs"]], [("INTER", "24")])
        portal = self.client.get(reverse("invoice-gstr1-portal-json"),
                                 {"business_id": self.biz.pk, "month": 9, "year": 2026}).data["file"]
        self.assertEqual(portal["b2b"][0]["inv"][0]["pos"], "24")
        self.assertEqual([(r["sply_ty"], r["pos"]) for r in portal["b2cs"]], [("INTER", "24")])

    # Beyond the plan's tests: the rulings, and the rule's other branches.

    def test_a_counter_sale_files_local_whatever_its_size(self):
        # A chosen place that is the firm's own state is intra-state B2CS, above the B2CL threshold too.
        gujarati = buyer("Desai Gems Walk-in", state="GUJARAT")
        self.assertEqual(classify_b2c(self.biz, Invoice(customer=gujarati, place_of_supply="08", total_amount=150000)),
                         ("b2cs", False, "08", False))

    def test_a_bill_without_a_place_files_as_before(self):
        # Ruling 5 of the dispatch: with no place of supply (every older bill) the builder and GSTR-1 read as they
        # always have. B2B under the buyer's GSTIN state; B2C under the buyer's state when it is another one, else
        # the firm's; B2CL above the threshold. The figures are today's (this test passes at 5e13295 too).
        mumbai = Customer.objects.create(name="Shah Bullion", gst_number="27AAKFS4821M1Z5", state_name="MAHARASHTRA")
        gujarati = buyer("Desai Gems Walk-in", state="GUJARAT")
        bills = [sale(self.biz, mumbai, "1", "2026-09-10"), sale(self.biz, gujarati, "2", "2026-09-10"),
                 sale(self.biz, buyer(), "3", "2026-09-10"), sale(self.biz, buyer("Counter Walk-in", state=""), "4",
                                                                 "2026-09-10"),
                 sale(self.biz, gujarati, "5", "2026-09-10", line(rate="200000"))]
        self.assertEqual([heads(b) for b in bills], [(0, 0, 300), (0, 0, 300), (150, 150, 0), (150, 150, 0),
                                                     (0, 0, 6000)])

        export = self.client.get(reverse("invoice-gstr-export"), {"business_id": self.biz.pk}).data["gstr1"]
        portal = self.client.get(reverse("invoice-gstr1-portal-json"),
                                 {"business_id": self.biz.pk, "month": 9, "year": 2026}).data["file"]
        for name, gstr1 in (("export", export), ("portal", portal)):
            with self.subTest(name):
                self.assertEqual([(g["ctin"], [(i["inum"], i["pos"]) for i in g["inv"]]) for g in gstr1["b2b"]],
                                 [("27AAKFS4821M1Z5", [("1", "27")])])
                self.assertEqual([(r["pos"], [i["inum"] for i in r["inv"]]) for r in gstr1["b2cl"]], [("24", ["5"])])
                self.assertEqual(sorted((r["sply_ty"], r["pos"], r["txval"]) for r in gstr1["b2cs"]),
                                 [("INTER", "24", 10000.0), ("INTRA", "08", 20000.0)])


class FirmAndNotesTest(TestCase):
    def setUp(self):
        self.biz = firm(pan_number="ABCDE1234F", invoice_prefix="KGH", bank_name="Sandbox Bank")
        self.client = client_for(person("kailash", *ROLE_GROUPS["owner"]))

    def test_the_firm_snapshot(self):
        snap = firm_snapshot(self.biz)
        self.assertEqual((snap["name"], snap["state_name"], snap["invoice_prefix"]), ("KIRAN GOLD HOUSE", "RAJASTHAN", "KGH"))
        self.assertEqual((snap["email"], snap["signature_image"]), ("", ""))
        self.assertEqual(set(snap), {"name", "address", "gst_number", "state_name", "pan_number", "mobile_number",
                                     "email", "bank_name", "bank_account_number", "bank_ifsc_code",
                                     "bank_branch_name", "invoice_prefix", "signature_image"})

    def test_a_line_note_is_kept_to_60_characters(self):
        inv = Invoice.objects.create(business=self.biz, customer=buyer(), invoice_number="1", invoice_date="2026-09-10")
        (li,), _ = build_line_items(inv, [{**line(), "note": "x" * 70}], source="api")
        self.assertEqual(li.note, "x" * 60)

    def test_v2_reads_but_cant_write_them(self):
        bill = sale(self.biz, buyer(), "1", "2026-09-10", notes="Order 77")
        r = self.client.patch(reverse("invoice-detail", args=[bill.pk]),
                              {"place_of_supply": "24", "notes": "changed", "firm_snapshot": {"name": "X"}}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual((r.data["place_of_supply"], r.data["notes"], r.data["firm_snapshot"]), (None, "Order 77", None))
        bill.refresh_from_db()
        self.assertEqual((bill.place_of_supply, bill.notes, bill.firm_snapshot), (None, "Order 77", None))
        li = bill.lineitem_set.get()
        LineItem.objects.filter(pk=li.pk).update(note="Hallmarked 916")  # as v3's sales/ stores one
        # Ruling 1A-8: the PATCH goes through (v2's own fields stay writable) and leaves the stored note as it was.
        r = self.client.patch(reverse("lineitem-detail", args=[li.pk]), {"note": "hacked", "product_name": "Silver Payal"},
                              format="json")
        self.assertEqual((r.status_code, r.data["product_name"], r.data["note"]), (200, "Silver Payal", "Hallmarked 916"),
                         r.data)
        li.refresh_from_db()
        self.assertEqual((li.product_name, li.note), ("Silver Payal", "Hallmarked 916"))

    def test_the_rollback_script_lists_a_chosen_place(self):
        sale(self.biz, buyer(), "9", "2026-09-10", place_of_supply="24")
        out = StringIO()
        call_command("prepare_v2_rollback", stdout=out)
        self.assertIn("KIRAN GOLD HOUSE 9 of 2026-09-10: place of supply 24, v2 reads 08", out.getvalue())

    # Beyond the plan's tests: the rulings.

    def test_the_rollback_script_lists_only_what_v2_would_file_otherwise(self):
        # A place the rule gives anyway (the buyer moved state since) files the same on v2; a cancelled bill goes to
        # the bin before v2 runs; a blank place is no place; a purchase files in no GSTR-1. None of them is listed.
        sale(self.biz, buyer(), "9", "2026-09-10", place_of_supply="24")
        sale(self.biz, buyer("Desai Gems Walk-in", state="GUJARAT"), "10", "2026-09-10", place_of_supply="24")
        sale(self.biz, buyer("Patel Walk-in"), "11", "2026-09-10", place_of_supply="24", status=BILL_CANCELLED)
        sale(self.biz, buyer("Mehta Walk-in"), "12", "2026-09-10", place_of_supply="")
        sale(self.biz, buyer("Soni Bullion Suppliers"), "SB-4", "2026-09-10", kind="inward", place_of_supply="24")
        out = StringIO()
        call_command("prepare_v2_rollback", stdout=out)
        listed = [row for row in out.getvalue().splitlines() if ": place of supply " in row]
        self.assertEqual(listed, ["  KIRAN GOLD HOUSE 9 of 2026-09-10: place of supply 24, v2 reads 08"])
        self.assertIn("1 bill(s) with a place of supply chosen by hand.", out.getvalue())

    def test_a_v2_save_that_read_the_bill_first_keeps_them(self):
        # Ruling 1A-16: v2's saves write only v2's columns, so a place, frozen firm or notes that v3 changes while
        # v2's PATCH holds the bill stay as v3 left them.
        bill = sale(self.biz, buyer(), "1", "2026-09-10", place_of_supply="24", notes="Order 77",
                    firm_snapshot=firm_snapshot(self.biz))
        later = {"place_of_supply": "27", "notes": "Order 78",
                 "firm_snapshot": {**firm_snapshot(self.biz), "name": "KIRAN GOLD HOUSE (NEW)"}}

        def changed_meanwhile(*args, **kwargs):
            Invoice.objects.filter(pk=bill.pk).update(**later)  # after v2 read the bill, before it saves
            return assert_period_unlocked(*args, **kwargs)

        with patch("billing.api.views.assert_period_unlocked", changed_meanwhile):
            r = self.client.patch(reverse("invoice-detail", args=[bill.pk]), {"payment_mode": "cash"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        bill.refresh_from_db()
        self.assertEqual((bill.payment_mode, bill.place_of_supply, bill.notes, bill.firm_snapshot),
                         ("cash", "27", "Order 78", later["firm_snapshot"]))

    def test_v2s_undo_of_an_old_edit_keeps_them(self):
        # Contract §7: the Audit log's Undo of an older edit doesn't touch the place, the notes or the frozen firm.
        bill = sale(self.biz, buyer(), "1", "2026-09-10")
        self.client.patch(reverse("invoice-detail", args=[bill.pk]), {"payment_mode": "cash"}, format="json")
        Invoice.objects.filter(pk=bill.pk).update(place_of_supply="24", notes="Order 77",
                                                  firm_snapshot=firm_snapshot(self.biz))  # later, by v3
        edit = AuditLog.objects.get(action="updated", entity_id=bill.pk)
        self.assertEqual(self.client.post(reverse("auditlog-undo", args=[edit.pk])).status_code, 200)
        bill.refresh_from_db()
        self.assertEqual((bill.payment_mode, bill.place_of_supply, bill.notes, bill.firm_snapshot),
                         ("", "24", "Order 77", firm_snapshot(self.biz)))

    def test_v2s_line_writes_leave_the_note_alone(self):
        # Contract §7: on v2's endpoints a line's note is read-only. v2's create and its line replace hand the lines
        # as sent to the builder, which keeps a note from v3's path only (source "api"). A note that isn't text is
        # no 500 there (Ruling 1A-5).
        priced = {**line(), "cgst": "150", "sgst": "150", "igst": "0", "amount": "10300"}
        cust, made = buyer(), []
        for n, note in enumerate(("hacked", 5, ["x"], {"x": 1}), start=1):
            with self.subTest(note=note):
                r = self.client.post(reverse("invoice-list"), {
                    "business": self.biz.pk, "customer": cust.pk, "invoice_number": str(n), "invoice_date": "2026-09-10",
                    "type_of_invoice": "outward", "line_items": [{**priced, "note": note}]}, format="json")
                self.assertEqual(r.status_code, 201, r.data)
                made.append(r.data["id"])
                self.assertEqual(LineItem.objects.get(invoice_id=r.data["id"]).note, "")
        r = self.client.post(reverse("invoice-update-line-items", args=[made[0]]),
                             {"line_items": [{**priced, "note": "hacked"}, {**priced, "note": 5}]}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(list(LineItem.objects.filter(invoice_id=made[0]).values_list("note", flat=True)), ["", ""])

    def test_a_deleted_bill_comes_back_with_them(self):
        # Contract 3.2: a restore brings back every field; the frozen firm stays JSON on its way through the bin.
        bill = sale(self.biz, buyer(), "1", "2026-09-10", place_of_supply="24", notes="Order 77",
                    firm_snapshot=firm_snapshot(self.biz))
        LineItem.objects.filter(invoice=bill).update(note="Hallmarked 916")
        self.client.delete(reverse("sale-detail", args=[bill.pk]), {"reason": "Entered twice"}, format="json")
        r = self.client.post(reverse("bin-restore", args=[BinnedInvoice.objects.get().pk]))
        self.assertEqual(r.status_code, 200, r.data)
        back = Invoice.objects.get(pk=bill.pk)
        self.assertEqual((back.place_of_supply, back.notes, back.firm_snapshot, back.lineitem_set.get().note),
                         ("24", "Order 77", firm_snapshot(self.biz), "Hallmarked 916"))


class RepairCommandsTest(TestCase):
    """Ruling 1A-3: v2's two repair commands decide a bill's direction by its place of supply too."""

    def setUp(self):
        self.biz = firm()  # Rajasthan, 08
        self.gujarati = buyer("Desai Gems Walk-in", state="GUJARAT")

    @staticmethod
    def run_command(name, *args):
        out = StringIO()
        call_command(name, *args, stdout=out)
        return out.getvalue()

    def test_fix_tax_heads_files_by_the_chosen_place(self):
        counter = sale(self.biz, self.gujarati, "1", "2026-09-10", place_of_supply="08")  # local by its place: right
        old = sale(self.biz, self.gujarati, "2", "2026-09-10")  # IGST by the rule
        sent = sale(self.biz, buyer(), "3", "2026-09-10", place_of_supply="24")  # IGST by its place
        LineItem.objects.filter(invoice__in=[old, sent]).update(cgst=150, sgst=150, igst=0)  # filed local by mistake
        out = self.run_command("fix_tax_heads")
        reported = [row.split()[0] for row in out.splitlines() if row.startswith("  #")]
        self.assertEqual(sorted(reported), ["#2", "#3"])

        self.run_command("fix_tax_heads", "--apply")
        self.assertEqual([heads(b) for b in (counter, old, sent)], [(150, 150, 0), (0, 0, 300), (0, 0, 300)])

    def test_fix_placeholder_gstins_counts_by_the_chosen_place(self):
        na = buyer("Walk-in NA", state="GUJARAT", gst_number="NA")
        sale(self.biz, na, "1", "2026-09-10", place_of_supply="08")  # local by its place: CGST+SGST is right
        old = sale(self.biz, na, "2", "2026-09-10")  # IGST by the rule
        LineItem.objects.filter(invoice=old).update(cgst=150, sgst=150, igst=0)  # filed local by mistake
        out = self.run_command("fix_placeholder_gstins")
        self.assertIn("2 sale(s), 0 purchase(s); 1 line(s) under the other head", out)
