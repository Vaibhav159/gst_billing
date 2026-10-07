"""H6: a line item's customer follows its invoice, and deleting a party can't
take other parties' lines with it.

LineItem.customer was CASCADE while Invoice.customer is PROTECT. A header
PATCH, the Django admin and undo changed invoice.customer without re-pointing
the lines; deleting the old customer (who now had no invoices) then returned
204 and wiped those lines, filed months included: the invoice dropped to zero
lines and Rs 0. No lock check ran and no snapshot held the lines.
"""

from decimal import Decimal as D
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.test import override_settings
from django.urls import reverse

from billing.models import AuditLog, Customer, Invoice, LineItem
from billing.tests.test_base import BaseAPITestCase


class LineCustomerTest(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.other = Customer.objects.create(name="Second Buyer", gst_number="22CCCCC0000C1Z5", state_name="CHHATTISGARH")
        self.other.businesses.add(self.business)

    def test_moving_the_invoice_moves_its_lines(self):
        r = self.client.patch(reverse("invoice-detail", args=[self.invoice.id]), {"customer": self.other.id}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.line_item.refresh_from_db()
        self.assertEqual(self.line_item.customer_id, self.other.id)

    def test_the_old_customer_can_then_go_without_taking_the_lines(self):
        self.client.patch(reverse("invoice-detail", args=[self.invoice.id]), {"customer": self.other.id}, format="json")
        r = self.client.delete(reverse("customer-detail", args=[self.customer.id]))
        self.assertEqual(r.status_code, 204)
        self.assertTrue(LineItem.objects.filter(pk=self.line_item.pk).exists())
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.total_amount, D("1180"))

    def test_a_save_outside_the_api_moves_the_lines_too(self):
        inv = Invoice.objects.get(pk=self.invoice.pk)
        inv.customer = self.other
        inv.save()
        self.line_item.refresh_from_db()
        self.assertEqual(self.line_item.customer_id, self.other.id)

    def test_undo_of_a_customer_change_brings_the_lines_back(self):
        self.client.patch(reverse("invoice-detail", args=[self.invoice.id]), {"customer": self.other.id}, format="json")
        entry = AuditLog.objects.filter(action="updated", entity="invoice", entity_id=self.invoice.id).latest("timestamp")
        r = self.client.post(reverse("auditlog-undo", args=[entry.pk]))
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.line_item.refresh_from_db()
        self.assertEqual(self.line_item.customer_id, self.customer.id)

    def test_a_party_still_named_on_another_invoices_lines_is_protected(self):
        # Legacy drift: the invoice moved, its line didn't.
        Invoice.objects.filter(pk=self.invoice.pk).update(customer=self.other)
        r = self.client.delete(reverse("customer-detail", args=[self.customer.id]))
        self.assertEqual(r.status_code, 409, getattr(r, "data", None))
        self.assertIn("1 invoice", r.data["error"])
        # The invoice is someone else's now: say it is its lines (review of H6).
        self.assertIn("lines", r.data["error"])
        self.assertTrue(LineItem.objects.filter(pk=self.line_item.pk).exists())

    def test_a_line_that_follows_a_move_is_marked_updated(self):
        # Review of H6: saved with update_fields of the moved columns only,
        # the line kept its old updated_at.
        from datetime import datetime
        from datetime import timezone as tz

        from freezegun import freeze_time

        with freeze_time("2030-01-02 03:04:05"):
            self.client.patch(reverse("invoice-detail", args=[self.invoice.id]), {"customer": self.other.id},
                              format="json")
        self.line_item.refresh_from_db()
        self.assertEqual(self.line_item.updated_at, datetime(2030, 1, 2, 3, 4, 5, tzinfo=tz.utc))

    def test_merging_customers_moves_lines_with_their_invoices(self):
        third = Customer.objects.create(name="Third Buyer", state_name="CHHATTISGARH")
        # The invoice belongs to `other`, but its line still names `customer`.
        Invoice.objects.filter(pk=self.invoice.pk).update(customer=self.other)
        r = self.client.post(reverse("customer-merge"), {"source_id": self.other.id, "target_id": third.id}, format="json")
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.line_item.refresh_from_db()
        self.assertEqual(self.line_item.customer_id, third.id)


    def test_merging_into_an_out_of_state_record_refiles_the_heads(self):
        # Review of M14: the merge moved invoices by a queryset update, which
        # skips Invoice.save, so a local sale merged into an out-of-state
        # record kept CGST + SGST.
        mumbai = Customer.objects.create(name="MUMBAI BUYER", gst_number="27ABCDE1234A1Z5", state_name="MAHARASHTRA")
        r = self.client.post(reverse("customer-merge"), {"source_id": self.customer.id, "target_id": mumbai.id},
                             format="json")
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.line_item.refresh_from_db()
        self.assertEqual(self.line_item.customer_id, mumbai.id)
        self.assertEqual((self.line_item.cgst, self.line_item.sgst, self.line_item.igst), (D("0"), D("0"), D("180")))
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.total_amount, D("1180"))


    @override_settings(CACHEOPS_ENABLED=True, CACHEOPS_FAKE=False)
    def test_the_merge_drops_the_cached_lines(self):
        # Its line update is a queryset update, which cacheops never hears of:
        # the merged party's lines could show the old customer for 30 minutes.
        third = Customer.objects.create(name="Third Buyer", state_name="CHHATTISGARH")
        with mock.patch("cacheops.invalidate_model") as dropped:
            r = self.client.post(reverse("customer-merge"), {"source_id": self.customer.id, "target_id": third.id},
                                 format="json")
        self.assertEqual(r.status_code, 200, getattr(r, "data", None))
        self.assertIn(LineItem, [c.args[0] for c in dropped.call_args_list])


class AdminLineCustomerTest(BaseAPITestCase):
    """Review of H6: the Django admin still offered a line's customer (and an
    existing line's invoice) as editable fields, so it could make the drift
    H6 removed."""

    def setUp(self):
        super().setUp()
        from django.contrib.auth.models import User

        self.admin_client = self.client_class()
        self.admin_client.force_login(User.objects.create_superuser("root_h6", "root@example.com", "pw"))
        self.other = Customer.objects.create(name="Second Buyer", state_name="CHHATTISGARH")

    def test_a_line_saved_with_another_customer_takes_its_invoices(self):
        li = LineItem.objects.create(invoice=self.invoice, customer=self.other, product_name="Silver",
                                     hsn_code="711311", gst_tax_rate=D("0.03"), quantity=D("1"), rate=D("100"),
                                     cgst=D("1.50"), sgst=D("1.50"), igst=0, amount=D("103"))
        li.refresh_from_db()
        self.assertEqual(li.customer_id, self.customer.id)

    def test_the_admin_shows_the_customer_without_letting_it_change(self):
        page = self.admin_client.get(reverse("admin:billing_lineitem_change", args=[self.line_item.id]))
        self.assertEqual(page.status_code, 200)
        self.assertNotContains(page, 'name="customer"')
        self.assertNotContains(page, 'name="invoice"')
        inline = self.admin_client.get(reverse("admin:billing_invoice_change", args=[self.invoice.id]))
        self.assertEqual(inline.status_code, 200)
        self.assertNotContains(inline, 'name="lineitem_set-0-customer"')


class FixLineCustomersTest(BaseAPITestCase):
    def _run(self, *args):
        out = StringIO()
        call_command("fix_line_customers", *args, stdout=out)
        return out.getvalue()

    def test_reports_then_repoints_drifted_lines(self):
        other = Customer.objects.create(name="Second Buyer", state_name="CHHATTISGARH")
        Invoice.objects.filter(pk=self.invoice.pk).update(customer=other)
        output = self._run()
        self.assertIn("INV-001", output)
        self.assertIn("Test Customer", output)
        self.assertIn("Second Buyer", output)
        self.assertIn("Dry run", output)
        self.line_item.refresh_from_db()
        self.assertEqual(self.line_item.customer_id, self.customer.id)

        self._run("--apply")
        self.line_item.refresh_from_db()
        self.assertEqual(self.line_item.customer_id, other.id)
        self.assertIn("No line items", self._run())

    def test_lists_invoices_the_cascade_already_emptied(self):
        # What H6 left behind: the lines deleted with a customer, and the
        # total re-summed to 0 by the line signals, so no total looks wrong.
        LineItem.objects.filter(invoice=self.invoice).delete()
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.total_amount, D("0"))
        output = self._run()
        self.assertIn("1 invoice(s) have no lines", output)
        self.assertIn("INV-001", output)
        self._run("--apply")
        self.assertTrue(Invoice.objects.filter(pk=self.invoice.pk).exists())

    def test_says_nothing_of_empty_invoices_when_there_are_none(self):
        self.assertNotIn("no lines", self._run())
