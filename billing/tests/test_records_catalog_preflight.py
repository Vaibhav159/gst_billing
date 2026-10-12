"""P4-7: product-use checks aggregate matching rows without reading bin payloads."""
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from billing.models import AuditLog, BinnedInvoice, Product
from billing.services.catalog import product_names, product_uses
from billing.tests.v3_helpers import buyer, firm, line, sale


class ProductUsesBatchTests(TestCase):
    def setUp(self):
        self.firm = firm()
        self.customer = buyer()
        self.silver = Product.objects.create(name="Silver new", hsn_code="7113")
        self.gold = Product.objects.create(name="Gold", hsn_code="7113")
        AuditLog.objects.create(entity="product", entity_id=self.silver.pk, action="updated",
                                changes={"name": {"old": "Old silver", "new": self.silver.name}})

    def binned(self, names, **fields):
        return BinnedInvoice.objects.create(
            original_id=1000 + BinnedInvoice.objects.count(), business=self.firm, customer=self.customer,
            invoice_number="BIN", invoice_date="2026-09-01",
            data={"lines": [{"product_name": name} for name in names], "notes": "x" * 20000}, **fields)

    def batch(self, products, names=None):
        from billing.services.catalog import product_uses_many
        return product_uses_many(products, names)

    def test_batches_distinct_bills_aliases_case_twins_and_live_bins(self):
        twin = Product.objects.create(name="SILVER NEW", hsn_code="7113")
        unused = Product.objects.create(name="Unused", hsn_code="4819")
        sale(self.firm, self.customer, "1", "2024-09-01",
             line(name="silver NEW"), line(name="OLD SILVER"), line(name="Gold"))
        sale(self.firm, self.customer, "2", "2026-09-01", line(name="old SILVER"), status="cancelled")
        sale(self.firm, self.customer, "P1", "2026-09-01", line(name="Silver new"),
             line(name="Old silver"), kind="inward")
        self.binned(["SILVER NEW", "old silver", "OLD SILVER"])
        self.binned(["Gold"])
        self.binned(["Silver new"], restored_at=timezone.now())
        undone = AuditLog.objects.create(entity="invoice", entity_id=123, action="deleted", snapshot={"_undo": {}})
        self.binned(["Silver new"], audit_log_id=undone.pk)
        products = [self.silver, self.gold, twin, unused]
        with CaptureQueriesContext(connection) as queries:
            uses = self.batch(products)
        self.assertLessEqual(len(queries), 4)
        self.assertEqual(uses[self.silver.pk], {"sales": 1, "cancelled": 1, "purchases": 1, "bin": 1})
        self.assertEqual(uses[twin.pk], {"sales": 1, "cancelled": 0, "purchases": 1, "bin": 1})
        self.assertEqual(uses[self.gold.pk], {"sales": 1, "cancelled": 0, "purchases": 0, "bin": 1})
        self.assertEqual(uses[unused.pk], {"sales": 0, "cancelled": 0, "purchases": 0, "bin": 0})
        self.assertEqual(product_uses(self.silver), uses[self.silver.pk])

    def test_reused_old_name_belongs_only_to_its_current_holder(self):
        holder = Product.objects.create(name="OLD SILVER", hsn_code="7113")
        sale(self.firm, self.customer, "1", "2026-09-01", line(name="old silver"))
        self.binned(["old silver"])
        uses = self.batch([self.silver, holder])
        self.assertEqual(uses[self.silver.pk], {"sales": 0, "cancelled": 0, "purchases": 0, "bin": 0})
        self.assertEqual(uses[holder.pk], {"sales": 1, "cancelled": 0, "purchases": 0, "bin": 1})

    def test_bin_matching_and_counting_stay_in_sql_for_thirty_products(self):
        products = [Product.objects.create(name=f"Item {n}", hsn_code="7113") for n in range(30)]
        for product in products:
            self.binned([product.name, product.name.upper()])
        for n in range(10):
            self.binned([f"Unrelated {n}"])
        with CaptureQueriesContext(connection) as queries:
            uses = self.batch(products, {p.pk: [p.name] for p in products})
        self.assertEqual(len(queries), 2)
        self.assertTrue(all(row == {"sales": 0, "cancelled": 0, "purchases": 0, "bin": 1} for row in uses.values()))
        bin_queries = [row["sql"] for row in queries if '"billing_binnedinvoice"' in row["sql"]]
        self.assertEqual(len(bin_queries), 1)
        sql = bin_queries[0]
        self.assertIn("COUNT(DISTINCT", sql.upper())
        self.assertIn("GROUP BY", sql.upper())
        self.assertIn("LOWER(", sql.upper())
        self.assertIn("jsonb_array_elements" if connection.vendor == "postgresql" else "json_each", sql)

    def test_existing_single_product_check_does_not_read_bin_payloads(self):
        self.binned([self.silver.name])
        self.binned(["Unrelated"])
        with CaptureQueriesContext(connection) as queries:
            self.assertEqual(product_uses(self.silver)["bin"], 1)
        reads = [row["sql"] for row in queries if '"billing_binnedinvoice"' in row["sql"]]
        self.assertEqual(len(reads), 1)
        self.assertIn("COUNT(DISTINCT", reads[0].upper())

    def test_names_are_parameters_and_non_array_legacy_payloads_are_ignored(self):
        product = Product.objects.create(name="O'Brien %_ ring", hsn_code="7113")
        self.binned([product.name.upper()])
        self.binned(["O'Brien other ring"])
        for rows in (None, {}, "bad", [None, "bad", {}, {"product_name": None}]):
            binned = self.binned([])
            binned.data = {"lines": rows}
            binned.save(update_fields=["data"])
        uses = self.batch([product], {product.pk: [product.name]})
        self.assertEqual(uses[product.pk]["bin"], 1)

    def test_no_rename_needs_no_holder_query_and_empty_batch_needs_no_reads(self):
        with CaptureQueriesContext(connection) as queries:
            self.assertEqual(self.batch([]), {})
        self.assertEqual(len(queries), 0)
        with CaptureQueriesContext(connection) as queries:
            self.assertEqual(product_names([self.gold]), {self.gold.pk: [self.gold.name]})
        self.assertEqual(len(queries), 1)
