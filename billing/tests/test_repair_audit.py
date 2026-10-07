"""Each repair's --apply leaves one row in the app's audit log (review of the
repair commands).

The repairs change rows outside the app, filed months included (the lock
stops the app, not a deliberate repair), and left no trace in its log.
"""

from decimal import Decimal as D
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.test import override_settings

from billing.models import AuditLog, Customer, Invoice, LineItem
from billing.tests.test_base import BaseAPITestCase

ENTITY = {
    "fix_tax_splits": "invoice",
    "fix_placeholder_gstins": "customer",
    "fix_line_customers": "invoice",
    "fix_invoice_totals": "invoice",
    "fix_tax_heads": "invoice",
    "fix_gst_rates": "product",
}


class RepairApplyIsAuditedTest(BaseAPITestCase):
    def _sale(self, number, customer=None, **line):
        inv = Invoice.objects.create(business=self.business, customer=customer or self.customer,
                                     invoice_number=number, invoice_date="2026-05-10", type_of_invoice="outward")
        LineItem.objects.create(invoice=inv, customer=inv.customer, product_name="Silver", hsn_code="711311",
                                quantity=D("1"), rate=D("1000"),
                                **{"gst_tax_rate": D("0.03"), "cgst": D("15"), "sgst": D("15"), "igst": D("0"),
                                   "amount": D("1030"), **line})
        return inv

    def setUp(self):
        super().setUp()
        # Something for each command to repair.
        self._sale("A-1", cgst=D("15.005"), sgst=D("14.995"))                    # fix_tax_splits
        Customer.objects.create(name="WALK-IN NA", gst_number="NA")               # fix_placeholder_gstins
        drifted = self._sale("A-3")                                               # fix_line_customers
        Invoice.objects.filter(pk=drifted.pk).update(
            customer=Customer.objects.create(name="NEW OWNER", state_name="CHHATTISGARH"))
        Invoice.objects.filter(pk=self._sale("A-4").pk).update(total_amount=D("1"))   # fix_invoice_totals
        self._sale("A-5", cgst=D("0"), sgst=D("0"), igst=D("30"))                 # fix_tax_heads (intra-state)
        self._sale("A-6", gst_tax_rate=D("0.25"), cgst=D("1.25"), sgst=D("1.25"), amount=D("1002.50"))  # fix_gst_rates

    def test_a_dry_run_leaves_no_row_and_each_apply_leaves_one(self):
        for command in ENTITY:
            call_command(command, stdout=StringIO())
        self.assertFalse(AuditLog.objects.filter(entity_name__startswith="(repair)").exists())
        for command, entity in ENTITY.items():
            with self.subTest(command=command):
                call_command(command, "--apply", stdout=StringIO())
                row = AuditLog.objects.get(entity_name=f"(repair) {command}")
                self.assertEqual(row.entity, entity)
                self.assertIn(command, row.details)
                self.assertTrue(any(ids for key, ids in row.changes.items() if key != "command"), row.changes)

    @override_settings(CACHEOPS_ENABLED=True, CACHEOPS_FAKE=False)
    def test_each_apply_drops_the_cached_rows_it_changed(self):
        # update() sends no signal: without this the app serves the old rows
        # for up to 30 minutes after a repair. fix_tax_heads and fix_gst_rates
        # never did it.
        changed = {"fix_tax_splits": LineItem, "fix_placeholder_gstins": Customer, "fix_line_customers": LineItem,
                   "fix_invoice_totals": Invoice, "fix_tax_heads": LineItem, "fix_gst_rates": LineItem}
        for command, model in changed.items():
            with self.subTest(command=command), mock.patch("cacheops.invalidate_model") as dropped:
                call_command(command, "--apply", stdout=StringIO())
                self.assertIn(model, [c.args[0] for c in dropped.call_args_list])
