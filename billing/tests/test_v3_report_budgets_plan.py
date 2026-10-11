"""Report reads: real database query counts, cache bypass and narrow projections."""

from datetime import date

from django.db import connection
from django.test import TransactionTestCase
from django.test.utils import CaptureQueriesContext

from billing.constants import BILL_CANCELLED
from billing.models import Invoice
from billing.tests.test_v3_cacheops import cacheops_on
from billing.tests.v3_helpers import buyer, firm, line, sale

START = date(2026, 9, 1)
END = date(2026, 9, 30)


class SalesRegisterBudgetTest(TransactionTestCase):
    def setUp(self):
        self.business = firm()
        self.customer = buyer()
        self.bill = sale(self.business, self.customer, "1", "2026-09-10")

    def read(self):
        from billing.services.v3_reports import load_sales

        return load_sales(START, END, self.business.pk)

    def test_reads_bypass_cacheops_and_control_really_records_reads(self):
        with cacheops_on() as touched:
            self.assertEqual(len(self.read()), 1)
        self.assertEqual(touched, [])
        with cacheops_on() as control:
            list(Invoice.objects.filter(pk=self.bill.pk).values_list("pk", flat=True))
        self.assertIn("billing_invoice", {table for _op, tables in control for table in tables})

    def test_query_count_is_fixed_for_one_and_twenty_bills(self):
        self.read()
        with CaptureQueriesContext(connection) as one:
            self.assertEqual(len(self.read()), 1)
        for index in range(2, 21):
            sale(self.business, buyer(f"Buyer {index}"), str(index), "2026-09-10",
                 *[line(rate=str(1000 + item)) for item in range(5)])
        with CaptureQueriesContext(connection) as twenty:
            self.assertEqual(len(self.read()), 20)
        self.assertEqual(len(twenty), len(one))
        self.assertLessEqual(len(twenty), 3)

    def test_selects_omit_bill_payload_and_unused_party_and_line_fields(self):
        Invoice.objects.filter(pk=self.bill.pk).update(notes="n" * 20000, firm_snapshot={"unused": "x" * 20000})
        with CaptureQueriesContext(connection) as seen:
            self.assertEqual(len(self.read()), 1)
        projections = [query["sql"].split(" FROM ", 1)[0] for query in seen
                       if query["sql"].lstrip().upper().startswith("SELECT")]
        self.assertTrue(projections)
        for table, columns in {
            "billing_invoice": ("notes", "firm_snapshot", "source_file", "source_preview", "vehicle_number",
                                "transporter_name", "eway_bill_number", "sent_to"),
            "billing_customer": ("address", "mobile_number"),
            "billing_business": ("address", "mobile_number", "signature", "logo"),
            "billing_lineitem": ("note", "created_at", "updated_at", "workspace_id"),
        }.items():
            for column in columns:
                with self.subTest(table=table, column=column):
                    self.assertFalse(any(f'"{table}"."{column}"' in sql for sql in projections))

    def test_reads_filter_firm_bill_date_and_side_before_fetching(self):
        elsewhere = firm("Other firm")
        sale(elsewhere, self.customer, "2", "2026-09-10")
        sale(self.business, self.customer, "3", "2026-08-31")
        sale(self.business, self.customer, "4", "2026-10-01")
        sale(self.business, self.customer, "5", "2026-09-10", kind="inward")
        cancelled = sale(self.business, self.customer, "6", "2026-09-15", status=BILL_CANCELLED)
        from billing.services.v3_reports import load_sales

        scoped = load_sales(START, END, self.business.pk)
        self.assertEqual({row["id"] for row in scoped}, {self.bill.pk, cancelled.pk})
        self.assertEqual(len(load_sales(START, END)), 3)


    def test_line_paise_agrees_in_portal_reports_and_workbook_on_real_rows(self):
        from decimal import Decimal

        from billing.models import LineItem
        from billing.services.gstr1_file import build_gstr1
        from billing.services.v3_reports import build_report, ca_workbook

        self.bill.delete()
        bill = sale(self.business, self.customer, "1", "2026-09-10",
                    line(rate="1", qty="1"), line(rate="1", qty="1"))
        LineItem.objects.filter(invoice_id=bill.pk).update(cgst=Decimal("0.025"), sgst=Decimal("0.025"), igst=0)
        Invoice.objects.filter(pk=bill.pk).update(total_amount=Decimal("2.10"))
        rows = self.read()
        firm_ref = {"id": self.business.pk, "name": self.business.name, "gst_number": self.business.gst_number}
        context = {"firms": [firm_ref], "start": START, "end": END, "today": date(2026, 10, 8)}
        report = build_report("sales", rows, [], **context)
        workbook = ca_workbook(rows, [], **context)
        portal = build_gstr1(self.business, 2026, 9, amendments=False)
        self.assertEqual(portal["figures"]["cgst"], "0.06")
        self.assertEqual(Decimal(str(portal["file"]["b2cs"][0]["camt"])), Decimal("0.06"))
        self.assertEqual(report["totals"]["cgst"], "0.06")
        self.assertEqual(workbook["summary"][0]["sales"]["cgst"], "0.06")
        self.assertEqual([row[12] for row in workbook["firms"][0]["months"][0]["sales"]["rows"]], ["0.03", "0.03"])

    def test_purchase_helpers_keep_query_count_fixed_and_preledger_month_null(self):
        from billing.services.v3_reports import load_register

        scope = date(2025, 3, 1), date(2026, 11, 30), self.business.pk
        sale(self.business, self.customer, "OLD", "2025-03-31", kind="inward")
        sale(self.business, self.customer, "L1", "2025-05-01", kind="inward", itc_month=date(2026, 11, 1))
        with CaptureQueriesContext(connection) as first:
            data = load_register(*scope)
        for index in range(2, 21):
            sale(self.business, self.customer, f"L{index}", "2025-05-01", kind="inward", itc_month=date(2026, 11, 1))
        with CaptureQueriesContext(connection) as many:
            data = load_register(*scope)
        self.assertEqual(len(first), len(many))
        self.assertLessEqual(len(many), 6)
        old = next(bill for bill in data["purchases"] if bill["number"] == "OLD")
        self.assertIsNone(old["credit_month"])
        self.assertTrue(all(bill["credit_lapsed"] for bill in data["purchases"] if bill["number"].startswith("L")))

    def test_product_units_are_narrow_and_loaded_only_when_requested(self):
        from billing.models import Product
        from billing.services.v3_reports import load_register

        Product.objects.create(name="Silver", hsn_code="711311", default_unit="gms", description="unused " * 1000)
        with CaptureQueriesContext(connection) as without:
            data = load_register(START, END, self.business.pk)
        self.assertNotIn("product_units", data)
        self.assertFalse(any('"billing_product"' in query["sql"] for query in without))
        with CaptureQueriesContext(connection) as included:
            data = load_register(START, END, self.business.pk, include_products=True)
        self.assertEqual(data["product_units"], {("Silver", "711311"): "gms"})
        product_reads = [query["sql"].split(" FROM ", 1)[0] for query in included if '"billing_product"' in query["sql"]]
        self.assertEqual(len(product_reads), 1)
        self.assertNotIn('"description"', product_reads[0])


    def test_register_reads_only_the_requested_side(self):
        from billing.services.v3_reports import load_register

        sale(self.business, self.customer, "PURCHASE", "2026-09-10", kind="inward")
        with CaptureQueriesContext(connection) as sales_only:
            sales = load_register(START, END, self.business.pk, sides=("sales",))
        with CaptureQueriesContext(connection) as purchases_only:
            purchases = load_register(START, END, self.business.pk, sides=("purchases",))
        self.assertEqual(len(sales["sales"]), 1)
        self.assertEqual(sales["purchases"], [])
        self.assertEqual(len(purchases["purchases"]), 1)
        self.assertEqual(purchases["sales"], [])
        self.assertLessEqual(len(sales_only), 4)
        self.assertLessEqual(len(purchases_only), 3)
        self.assertFalse(any("'inward'" in query["sql"] for query in sales_only))
        self.assertFalse(any("'outward'" in query["sql"] for query in purchases_only))
