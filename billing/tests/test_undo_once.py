"""H7: an undo can be used once.

A repeat was caught only by the outward-number unique constraint, so a
deleted inward bill (supplier numbers may repeat) or a blank-number draft
came back once per click, each copy with its lines, doubling the ITC. And
can_undo never cleared.
"""

from decimal import Decimal
from io import StringIO

from django.contrib.auth.models import Group, User
from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from billing.models import AuditLog, Business, Customer, Invoice


class UndoTestBase(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username="admin_undo_once", password="pw")
        self.user.groups.add(Group.objects.get_or_create(name="admin")[0])
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.biz = Business.objects.create(name="LODHA JEWELLERS", gst_number="08ABCDE1234A1Z5", state_name="RAJASTHAN")
        self.supplier = Customer.objects.create(name="SUPPLIER", gst_number="08AAECD1234K1Z2", state_name="RAJASTHAN")

    def _invoice(self, number, kind):
        r = self.client.post(reverse("invoice-list"), {
            "business": self.biz.id, "customer": self.supplier.id, "invoice_number": number,
            "invoice_date": "2026-05-10", "type_of_invoice": kind,
            "line_items": [{"product_name": "Silver", "hsn_code": "711311", "gst_tax_rate": "0.03", "quantity": "1",
                            "rate": "10000", "cgst": "150", "sgst": "150", "igst": "0", "amount": "10300"}],
        }, format="json")
        self.assertEqual(r.status_code, 201, getattr(r, "data", None))
        return Invoice.objects.get(id=r.data["id"])

    def _entry(self, action, invoice_id):
        return AuditLog.objects.filter(entity="invoice", action=action, entity_id=invoice_id).latest("timestamp")

    def _undo(self, entry):
        return self.client.post(reverse("auditlog-undo", args=[entry.pk]))

    def _deleted_entry(self, number, kind):
        inv = self._invoice(number, kind)
        self.client.delete(reverse("invoice-detail", args=[inv.id]))
        return self._entry("deleted", inv.id)


class UndoOnceTests(UndoTestBase):
    def test_a_deleted_purchase_comes_back_once(self):
        entry = self._deleted_entry("SJ-101", "inward")
        self.assertEqual(self._undo(entry).status_code, 200)
        second = self._undo(entry)
        self.assertEqual(second.status_code, 409, getattr(second, "data", None))
        self.assertEqual(Invoice.objects.filter(invoice_number="SJ-101").count(), 1)

    def test_a_deleted_draft_without_a_number_comes_back_once(self):
        # Imports can land drafts without a number; the form can't.
        from decimal import Decimal as D

        from billing.models import LineItem

        draft = Invoice.objects.create(business=self.biz, customer=self.supplier, invoice_number="",
                                       invoice_date="2026-05-10", type_of_invoice="outward", total_amount=D("10300"))
        LineItem.objects.create(invoice=draft, customer=self.supplier, product_name="Silver", hsn_code="711311",
                                gst_tax_rate=D("0.03"), quantity=1, rate=D("10000"), cgst=D("150"), sgst=D("150"),
                                igst=0, amount=D("10300"))
        self.client.delete(reverse("invoice-detail", args=[draft.id]))
        entry = self._entry("deleted", draft.id)
        self.assertEqual(self._undo(entry).status_code, 200)
        self.assertEqual(self._undo(entry).status_code, 409)
        self.assertEqual(Invoice.objects.filter(invoice_number="", business=self.biz).count(), 1)

    def test_an_update_is_reverted_once(self):
        inv = self._invoice("7", "outward")
        self.client.patch(reverse("invoice-detail", args=[inv.id]), {"invoice_number": "77"}, format="json")
        entry = self._entry("updated", inv.id)
        self.assertEqual(self._undo(entry).status_code, 200)
        self.client.patch(reverse("invoice-detail", args=[inv.id]), {"invoice_number": "78"}, format="json")
        self.assertEqual(self._undo(entry).status_code, 409)
        inv.refresh_from_db()
        self.assertEqual(inv.invoice_number, "78")  # the second click changed nothing

    def test_a_create_is_undone_once(self):
        inv = self._invoice("8", "outward")
        entry = self._entry("created", inv.id)
        self.assertEqual(self._undo(entry).status_code, 200)
        self.assertEqual(self._undo(entry).status_code, 409)

    def test_the_log_stops_offering_an_undo_it_has_used(self):
        entry = self._deleted_entry("SJ-102", "inward")
        listed = lambda: next(e for e in self.client.get(reverse("auditlog-list")).data["results"] if e["id"] == entry.pk)  # noqa: E731
        self.assertTrue(listed()["can_undo"])
        self._undo(entry)
        self.assertFalse(listed()["can_undo"])


class UndoneBeforeTheMarkerTests(UndoTestBase):
    """Review of H7: an undo run before this change left no marker on its
    entry, only the restore's own log ("Restored via undo (was #N)"). So a
    deleted purchase restored then could be restored once more, doubling its
    ITC, which is H7 again."""

    def _undone_the_old_way(self, number):
        entry = self._deleted_entry(number, "inward")
        self.assertEqual(self._undo(entry).status_code, 200)
        entry.refresh_from_db()
        entry.snapshot.pop("_undo")
        entry.save(update_fields=["snapshot"])
        return entry

    def test_it_is_not_undone_again(self):
        entry = self._undone_the_old_way("SJ-201")
        second = self._undo(entry)
        self.assertEqual(second.status_code, 409, getattr(second, "data", None))
        self.assertEqual(Invoice.objects.filter(invoice_number="SJ-201").count(), 1)

    def test_the_log_does_not_offer_it(self):
        entry = self._undone_the_old_way("SJ-202")
        listed = next(e for e in self.client.get(reverse("auditlog-list")).data["results"] if e["id"] == entry.pk)
        self.assertFalse(listed["can_undo"])

    def test_another_deletes_undo_is_still_offered(self):
        self._undone_the_old_way("SJ-203")
        other = self._deleted_entry("SJ-204", "inward")
        listed = next(e for e in self.client.get(reverse("auditlog-list")).data["results"] if e["id"] == other.pk)
        self.assertTrue(listed["can_undo"])


class UndoResumsTheTotalTests(UndoTestBase):
    """M9: undo of an "updated" invoice copied every field back, total
    included, over lines that had changed since: the header said 1,030 while
    its lines summed to 2,060. Dashboards read the header, GSTR tables the
    lines."""

    def test_undoing_a_header_edit_keeps_the_total_of_the_lines(self):
        inv = self._invoice("9", "outward")  # one line, 10,300
        self.client.patch(reverse("invoice-detail", args=[inv.id]), {"invoice_number": "99"}, format="json")
        header_edit = self._entry("updated", inv.id)
        r = self.client.post(reverse("invoice-update-line-items", args=[inv.id]), {"line_items": [
            {"product_name": "Silver", "hsn_code": "711311", "gst_tax_rate": "0.03", "quantity": "2", "rate": "10000",
             "cgst": "300", "sgst": "300", "igst": "0", "amount": "20600"}]}, format="json")
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.assertEqual(self._undo(header_edit).status_code, 200)
        inv.refresh_from_db()
        self.assertEqual(inv.invoice_number, "9")
        self.assertEqual(inv.total_amount, Decimal("20600"))


class FixInvoiceTotalsTests(UndoTestBase):
    def _run(self, *args):
        out = StringIO()
        call_command("fix_invoice_totals", *args, stdout=out)
        return out.getvalue()

    def test_reports_then_resums_a_stale_header(self):
        inv = self._invoice("10", "outward")
        Invoice.objects.filter(pk=inv.pk).update(total_amount=Decimal("1030"))
        output = self._run()
        self.assertIn("#10", output)
        self.assertIn("1030", output)
        self.assertIn("10300", output)
        self.assertIn("Dry run", output)
        inv.refresh_from_db()
        self.assertEqual(inv.total_amount, Decimal("1030"))

        self._run("--apply")
        inv.refresh_from_db()
        self.assertEqual(inv.total_amount, Decimal("10300"))
        self.assertIn("No invoice totals", self._run())

    def test_an_invoice_without_lines_is_listed_not_zeroed(self):
        empty = Invoice.objects.create(business=self.biz, customer=self.supplier, invoice_number="11",
                                       invoice_date="2026-05-10", type_of_invoice="outward", total_amount=Decimal("500"))
        output = self._run("--apply")
        self.assertIn("#11", output)
        empty.refresh_from_db()
        self.assertEqual(empty.total_amount, Decimal("500"))
