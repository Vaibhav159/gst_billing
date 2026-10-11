"""Part 4 catalog: scoped history, exact words and reversible master writes."""

from decimal import Decimal

from django.db import connection
from django.test import TestCase, TransactionTestCase, skipUnlessDBFeature
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIRequestFactory, force_authenticate

from billing.constants import BILL_CANCELLED
from billing.models import AuditLog, FiledPeriod, Invoice, LineItem, Product
from billing.services.bin import bin_bill
from billing.tests.v3_helpers import buyer, firm, line, person, sale


class CatalogCase(TestCase):
    def setUp(self):
        self.owner = person("catalog-owner", "admin")
        self.firm = firm()
        self.customer = buyer()
        self.product = Product.objects.create(name="Silver", hsn_code="7113", gst_tax_rate="0.03")
        self.bill = sale(self.firm, self.customer, "1", "2026-10-01", line(qty="2", rate="100"),
                         line(qty="1", rate="150", unit="g"), line(qty="3", rate="50", unit="pcs"))
        self.cancelled = sale(self.firm, self.customer, "2", "2026-10-02", status=BILL_CANCELLED)
        sale(self.firm, self.customer, "3", "2025-03-31", line(rate="99999"))
        self.purchase = sale(self.firm, self.customer, "P1", "2026-10-03", line(qty="4", rate="90"), kind="inward")

    def ask(self, path="", params=None, method="get", data=None, user=None):
        from billing.api.catalog import CatalogDetail, CatalogList
        request = getattr(APIRequestFactory(), method)("/api/catalog/" + path, data if data is not None else params or {},
                                                      format="json")
        force_authenticate(request, user or self.owner)
        view = CatalogDetail if path else CatalogList
        return view.as_view()(request, **({"pk": int(path.rstrip("/"))} if path else {}))



class CatalogReadTests(CatalogCase):
    def test_list_totals_distinct_bills_units_and_scope(self):
        data = self.ask(params={"figures": "1", "fy": "2026-27", "business_id": self.firm.pk}).data
        self.assertEqual(data["results"][0]["sold"], {
            "bills": 1, "quantity": "3.000", "other_units": [{"unit": "pcs", "quantity": "3.000"}],
            "taxable": "500.00", "tax": "15.00", "cancelled": 1})
        self.assertEqual(data["summary"], {"taxable": "500.00", "bills": 1, "cancelled": 1,
                                           "no_items": [], "no_items_count": 0})
        self.assertNotIn("sold", self.ask().data["results"][0])
        row = self.ask().data["results"][0]
        self.assertEqual((row["kind"], row["kind_effective"], row["kind_set"]), (None, "silver", False))

    def test_rename_history_excludes_an_earlier_name_now_owned_by_another_product(self):
        AuditLog.objects.create(action="updated", entity="product", entity_id=self.product.pk, entity_name="Silver",
                                changes={"name": {"old": "Old Silver", "new": "Silver"}})
        sale(self.firm, self.customer, "4", "2026-10-04", line(name="OLD SILVER", rate="300"))
        data = self.ask(f"{self.product.pk}/", {"fy": "2026-27"}).data
        self.assertEqual(data["earlier_names"], ["Old Silver"])
        self.assertEqual(data["sold"]["taxable"], "800.00")
        Product.objects.create(name="old silver", hsn_code="7113")
        data = self.ask(f"{self.product.pk}/", {"fy": "2026-27"}).data
        self.assertEqual(data["earlier_names"], [])
        self.assertEqual(data["sold"]["taxable"], "500.00")

    def test_summary_uses_every_match_once_even_for_case_twins_and_pages(self):
        Product.objects.create(name="SILVER", hsn_code="7113")
        Product.objects.create(name="Box", hsn_code="4819", purchase_only=True)
        empty = Invoice.objects.create(business=self.firm, customer=self.customer, invoice_number="EMPTY",
                                       invoice_date="2026-10-08")
        data = self.ask(params={"figures": "1", "fy": "2026-27", "page_size": 1}).data
        self.assertEqual((data["count"], data["total_products"], len(data["twins"])), (3, 3, 1))
        self.assertEqual(data["summary"]["taxable"], "500.00")
        self.assertEqual(data["summary"]["no_items"][0]["id"], empty.pk)
        data = self.ask(params={"figures": "1", "fy": "2026-27", "show": "sold"}).data
        self.assertEqual((data["count"], data["summary"]["no_items_count"]), (2, 0))

    def test_detail_bought_firms_history_hsn_and_open_month_blockers(self):
        LineItem.objects.filter(invoice=self.bill).update(hsn_code="")
        data = self.ask(f"{self.product.pk}/", {"fy": "2026-27"}).data
        self.assertEqual(data["bought"]["taxable"], "360.00")
        self.assertEqual(data["average_rate"], "116.667")
        self.assertEqual(data["sold"]["taxable"], "500.00")
        self.assertEqual(data["sold"]["other_units"], [{"unit": "pcs", "quantity": "3.000"}])
        self.assertEqual(data["line_count"], 3)
        self.assertEqual(data["by_firm"][0]["sold"]["bills"], 1)
        self.assertEqual(data["uses"], {"sales": 2, "cancelled": 1, "purchases": 1, "bin": 0})
        self.assertEqual(data["hsn_on_bills"]["lines"], 6)
        self.assertEqual(data["hsn_on_bills"]["blocking"][0]["bill"]["id"], self.bill.pk)
        FiledPeriod.objects.create(business=self.firm, year=2026, month=10)
        self.assertEqual(self.ask(f"{self.product.pk}/", {"fy": "2026-27"}).data["hsn_on_bills"]["blocking"], [])

    def test_bin_use_counts_only_live_rows_and_matches_earlier_names(self):
        binned, entry = bin_bill(self.bill, self.owner)
        self.assertEqual(self.ask(f"{self.product.pk}/", {"fy": "2026-27"}).data["uses"]["bin"], 1)
        entry.snapshot["_undo"] = {"at": "2026-10-08"}
        entry.save(update_fields=["snapshot"])
        self.assertEqual(self.ask(f"{self.product.pk}/", {"fy": "2026-27"}).data["uses"]["bin"], 0)
        self.assertIsNotNone(binned.pk)

    def test_filters_orders_and_odd_params_have_words(self):
        for params, field, words in [
            ({"show": "bad"}, "show", "Choose all, sold or bought."),
            ({"gst_rate": "NaN"}, "gst_rate", "Choose one of the GST rates."),
            ({"ordering": "bad"}, "ordering", "Sort by name, -sold or hsn."),
            ({"fy": "all"}, "fy", "Give the financial year like 2026-27."),
            ({"business_id": "9" * 99}, "business_id", "Pick a firm from the list."),
            ({"kind": "stone"}, "kind", "Pick a kind from the list."),
        ]:
            with self.subTest(params=params):
                response = self.ask(params=params)
                self.assertEqual((response.status_code, str(response.data[field][0])), (400, words))
        self.assertEqual(self.ask(params={"page": 99}).data["detail"], "This list has no page 99.")
        self.assertEqual(self.ask("9999/").data["detail"], "This product isn't on file.")
        self.assertEqual(self.ask(params={"kind": "silver", "q": "Sil", "gst_rate": "3"}).data["count"], 1)

    def test_reads_are_narrow_and_aggregate_lines_in_sql(self):
        with CaptureQueriesContext(connection) as queries:
            self.ask(params={"figures": "1", "fy": "2026-27"})
        selects = [q["sql"] for q in queries if q["sql"].startswith("SELECT")]
        self.assertTrue(any("SUM(" in query and "GROUP BY" in query for query in selects))
        self.assertFalse(any('"firm_snapshot"' in query or '"signature_image"' in query for query in selects))
        self.assertFalse(any('"snapshot"' in query.split(" FROM ")[0] for query in selects))


    def test_only_the_page_fetches_product_description_and_rate(self):
        shown = Product.objects.create(name="A shown", hsn_code="7113", description="needle on page", usual_rate="123.456")
        Product.objects.bulk_create([Product(name=f"Off page {n:03d}", hsn_code="7113", description="x" * 1000)
                                     for n in range(35)])
        with CaptureQueriesContext(connection) as queries:
            response = self.ask(params={"page_size": 1, "ordering": "name", "figures": "1", "fy": "2026-27"})
        self.assertEqual(response.data["results"][0]["id"], shown.pk)
        self.assertEqual(response.data["results"][0]["description"], "needle on page")
        product_reads = [q["sql"] for q in queries if 'FROM "billing_product"' in q["sql"]]
        wide = [q for q in product_reads if '"description"' in q.split(" FROM ")[0]
                or '"usual_rate"' in q.split(" FROM ")[0]]
        self.assertEqual(len(wide), 1)
        self.assertIn(f'"billing_product"."id" IN ({shown.pk})', wide[0])
        with CaptureQueriesContext(connection) as queries:
            response = self.ask(params={"q": "needle", "page_size": 1})
        self.assertEqual(response.data["count"], 1)
        search = [q["sql"] for q in queries if "LIKE" in q["sql"] and '"description"' in q["sql"]]
        self.assertTrue(search)
        self.assertFalse(any('"description"' in q.split(" FROM ")[0] for q in search))

    def test_every_kind_inference_and_known_hsn_description(self):
        expected = [("Gem", "7102", "diamond"), ("Gold bar", "7108", "bullion"),
                    ("Silver bar", "7106", "bullion"), ("CHANDI cup", "7114", "silver"),
                    ("Ring", "7113", "gold"), ("Silver imitation", "7117", "silver"),
                    ("Work", "9988", "service"), ("Hallmark", "9983", "service"),
                    ("Box", "4823", "packing"), ("Carton", "4819", "packing"), ("Other", "9999", "other")]
        for name, hsn, _kind in expected:
            Product.objects.create(name=name, hsn_code=hsn)
        rows = {row["name"]: row for row in self.ask().data["results"]}
        for name, hsn, kind in expected:
            with self.subTest(hsn=hsn):
                self.assertEqual((rows[name]["kind"], rows[name]["kind_effective"], rows[name]["kind_set"]),
                                 (None, kind, False))
        self.assertEqual(rows["Work"]["hsn_text"], "Job work on jewellery")

    def test_explicit_kind_wins_and_kind_filter_uses_inference(self):
        override = Product.objects.create(name="Diamond setting", hsn_code="7102", kind="gold")
        inferred = Product.objects.create(name="Loose diamond", hsn_code="7102")
        row = self.ask(f"{override.pk}/", {"fy": "2026-27"}).data
        self.assertEqual((row["kind"], row["kind_effective"], row["kind_set"]), ("gold", "gold", True))
        gold = self.ask(params={"kind": "gold"}).data["results"]
        diamond = self.ask(params={"kind": "diamond"}).data["results"]
        self.assertEqual([row["id"] for row in gold], [override.pk])
        self.assertEqual([row["id"] for row in diamond], [inferred.pk])
        self.assertEqual((diamond[0]["kind"], diamond[0]["kind_effective"]), (None, "diamond"))

    def test_legacy_blank_kind_is_returned_as_null(self):
        Product.objects.filter(pk=self.product.pk).update(kind="")
        for row in (self.ask().data["results"][0], self.ask(f"{self.product.pk}/", {"fy": "2026-27"}).data):
            self.assertEqual((row["kind"], row["kind_effective"], row["kind_set"]), (None, "silver", False))

    def test_average_counts_only_own_unit_and_combines_grams(self):
        for unit, expected, quantity in [("gms", "116.667", "3.000"), ("g", "116.667", "3.000"),
                                          ("pcs", "50.000", "3.000"), ("kg", None, "0.000")]:
            with self.subTest(unit=unit):
                Product.objects.filter(pk=self.product.pk).update(default_unit=unit)
                data = self.ask(f"{self.product.pk}/", {"fy": "2026-27"}).data
                self.assertEqual((data["average_rate"], data["sold"]["quantity"], data["sold"]["taxable"]),
                                 (expected, quantity, "500.00"))
                if unit == "pcs":
                    self.assertEqual(data["sold"]["other_units"], [{"unit": "gms", "quantity": "3.000"}])

    def test_paise_per_line_for_average_taxable_and_each_tax_head(self):
        tiny = Product.objects.create(name="Tiny", hsn_code="7113")
        rows = [line(name=tiny.name, qty="0.025", rate="1") for _ in range(2)]
        sold = sale(self.firm, self.customer, "T1", "2026-10-01", *rows)
        bought = sale(self.firm, self.customer, "TP1", "2026-10-01", *rows, kind="inward")
        LineItem.objects.filter(invoice=sold).update(cgst="0.025", sgst="0.025", igst="0")
        LineItem.objects.filter(invoice=bought).update(cgst="0", sgst="0", igst="0.025")
        detail = self.ask(f"{tiny.pk}/", {"fy": "2026-27"}).data
        self.assertEqual((detail["sold"]["taxable"], detail["sold"]["tax"], detail["average_rate"]),
                         ("0.06", "0.12", "1.200"))
        self.assertEqual((detail["bought"]["taxable"], detail["bought"]["tax"]), ("0.06", "0.06"))
        listed = self.ask(params={"q": tiny.name, "fy": "2026-27", "figures": "1"}).data
        self.assertEqual((listed["summary"]["taxable"], listed["results"][0]["sold"]["tax"]), ("0.06", "0.12"))

    def test_history_limits_scope_and_round_each_line_before_adding(self):
        for n in range(9):
            sale(self.firm, self.customer, f"R{n}", "2026-10-01", line(qty="0.005", rate="1"))
        detail = self.ask(f"{self.product.pk}/", {"fy": "2026-27"}).data
        self.assertEqual((detail["line_count"], len(detail["lines"])), (12, 8))
        self.assertEqual(detail["sold"]["taxable"], "500.09")
        detail = self.ask(f"{self.product.pk}/", {"fy": "2026-27", "lines": "all"}).data
        self.assertEqual(len(detail["lines"]), 12)
        other = firm("Other firm", gstin="08AAAAA0000A1Z5")
        self.assertEqual(self.ask(f"{self.product.pk}/", {"fy": "2026-27", "business_id": other.pk}).data["sold"]["bills"], 0)
        self.assertEqual(self.ask(params={"fy": "2026-27", "ordering": "-sold"}).data["results"][0]["id"], self.product.pk)


class CatalogWriteTests(CatalogCase):
    def payload(self, **changes):
        return {"name": "Gold necklace 22K", "hsn_code": "711319", "gst_percent": "3", "unit": "gms", "kind": "gold",
                "purity": "22K", "usual_rate": "6470.00", "purchase_only": False, "description": "", **changes}

    def test_create_trims_name_keeps_decimal_slab_and_audit_snapshot(self):
        response = self.ask(method="post", data=self.payload(name="  Diamond   ring  ", hsn_code="7102", gst_percent="0.25"))
        self.assertEqual(response.status_code, 201, response.data)
        product = Product.objects.get(pk=response.data["id"])
        self.assertEqual((product.name, product.gst_tax_rate, response.data["usual_rate"]),
                         ("Diamond ring", Decimal("0.0025"), "6470.000"))
        entry = AuditLog.objects.get(entity="product", entity_id=product.pk)
        self.assertEqual(entry.snapshot["name"], "Diamond ring")
        self.assertEqual(entry.action, "created")
        self.assertIn("HSN 7102 · GST 0.25% · per g · ₹6,470.00", entry.details)

    def test_put_logs_changes_and_noop_does_not_write(self):
        payload = self.payload(name="Silver", hsn_code="7113", kind="", purity="", usual_rate=None)
        response = self.ask(f"{self.product.pk}/", method="put", data=payload)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["changes"], [])
        self.assertFalse(AuditLog.objects.filter(entity="product").exists())
        payload["usual_rate"] = "6470"
        response = self.ask(f"{self.product.pk}/", method="put", data=payload)
        self.assertEqual(response.data["changes"], [{"key": "usual_rate", "field": "Usual rate", "from": "None", "to": "₹6,470.00"}])
        self.assertEqual(AuditLog.objects.get(entity="product").changes["usual_rate"], {"old": None, "new": "6470"})
        with CaptureQueriesContext(connection) as queries:
            self.ask(f"{self.product.pk}/", method="put", data=payload)
        self.assertFalse(any(q["sql"].startswith(("UPDATE", "INSERT")) for q in queries))

    def test_null_blank_and_omitted_kind_infer_and_effective_kind_is_read_only(self):
        for number, kind in enumerate((None, "", "omitted")):
            with self.subTest(kind=kind):
                payload = self.payload(name=f"Gem {number}", hsn_code="7102", kind=kind, kind_effective="silver")
                if kind == "omitted":
                    payload.pop("kind")
                response = self.ask(method="post", data=payload)
                self.assertEqual(response.status_code, 201, response.data)
                pk = response.data["id"]
                self.assertIsNone(Product.objects.get(pk=pk).kind)
                self.assertEqual((response.data["kind"], response.data["kind_effective"], response.data["kind_set"]),
                                 (None, "diamond", False))
                response = self.ask(f"{pk}/", method="put", data={**payload, "kind": "gold"})
                self.assertEqual((response.data["kind"], response.data["kind_effective"], response.data["kind_set"]),
                                 ("gold", "gold", True))
                response = self.ask(f"{pk}/", method="put", data=payload)
                self.assertIsNone(response.data["kind"])
                self.assertIsNone(Product.objects.get(pk=pk).kind)
                self.assertEqual(response.data["kind_effective"], "diamond")

    def test_exact_validation_words_and_odd_values(self):
        cases = [
            ({"name": ""}, "name", "Enter the product's name, as it should print on bills."),
            ({"name": []}, "name", "Enter the product's name, as it should print on bills."),
            ({"hsn_code": ""}, "hsn_code", "Enter the HSN code. Every bill line needs one for GSTR-1."),
            ({"hsn_code": "12x"}, "hsn_code", "HSN codes have 4 to 8 digits; this has 3."),
            ({"gst_percent": ""}, "gst_percent", "Choose the GST rate. There's no default, so a wrong rate can't slip onto bills."),
            ({"gst_percent": "NaN"}, "gst_percent", "Choose one of the GST rates: 0, 0.1, 0.25, 1, 1.5, 3, 5, 12, 18, 28 or 40%."),
            ({"gst_percent": []}, "gst_percent", "Choose one of the GST rates: 0, 0.1, 0.25, 1, 1.5, 3, 5, 12, 18, 28 or 40%."),
            ({"unit": {}}, "unit", "Pick a unit from the list."),
            ({"kind": []}, "kind", "Pick a kind from the list."),
            ({"kind": False}, "kind", "Pick a kind from the list."),
            ({"kind": "stone"}, "kind", "Pick a kind from the list."),
            ({"usual_rate": "NaN"}, "usual_rate", "Type the rate per g, like 6470.00, or leave it empty."),
            ({"usual_rate": "100000000"}, "usual_rate", "Type the rate per g, like 6470.00, or leave it empty."),
            ({"usual_rate": "1.0001"}, "usual_rate", "Type the rate per g, like 6470.00, or leave it empty."),
            ({"purity": "x" * 21}, "purity", "Keep the purity short, like 22K or 925 (20 characters at most)."),
        ]
        for values, key, words in cases:
            with self.subTest(values=values):
                response = self.ask(method="post", data=self.payload(**values))
                self.assertEqual((response.status_code, str(response.data[key][0])), (400, words))
        self.assertEqual(Product.objects.count(), 1)

    def test_twins_can_edit_and_off_slab_must_be_unchanged(self):
        Product.objects.create(name="SILVER", hsn_code="7113")
        payload = self.payload(name="Silver", hsn_code="7113")
        response = self.ask(f"{self.product.pk}/", method="put", data=payload)
        self.assertEqual(response.status_code, 200, response.data)
        response = self.ask(method="post", data=payload)
        self.assertEqual(response.status_code, 400)
        self.assertIn("There's already a product called", str(response.data["name"][0]))
        Product.objects.filter(pk=self.product.pk).update(gst_tax_rate=Decimal("0.07"))
        payload["gst_percent"] = "7"
        self.assertEqual(self.ask(f"{self.product.pk}/", method="put", data=payload).status_code, 200)
        payload["gst_percent"] = "8"
        self.assertEqual(self.ask(f"{self.product.pk}/", method="put", data=payload).status_code, 400)

    def test_permissions_delete_use_refusal_and_unused_snapshot(self):
        staff = person("catalog-staff", "v3_staff", "editor")
        response = self.ask(method="post", data=self.payload(), user=staff)
        self.assertEqual((response.status_code, response.data["needs"]), (403, "product.edit"))
        response = self.ask(f"{self.product.pk}/", method="delete")
        self.assertEqual((response.status_code, response.data["code"]), (409, "in_use"))
        self.assertEqual(response.data["uses"]["sales"], 2)
        self.assertIn("Mark it Bought only to hide it from sales bills instead.", response.data["detail"])
        unused = Product.objects.create(name="Unused", hsn_code="7113")
        response = self.ask(f"{unused.pk}/", method="delete")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(AuditLog.objects.get(pk=response.data["audit_id"]).snapshot["name"], "Unused")
        self.assertFalse(Product.objects.filter(pk=unused.pk).exists())

    def test_name_edit_preserves_old_lines_and_audit_failure_rolls_back(self):
        from unittest.mock import patch

        payload = self.payload(name="Silver renamed", hsn_code="7113")
        response = self.ask(f"{self.product.pk}/", method="put", data=payload)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["earlier_names"], ["Silver"])
        self.assertEqual(response.data["uses"]["sales"], 2)
        self.assertTrue(LineItem.objects.filter(product_name="Silver").exists())
        with patch("billing.models.AuditLog.objects.create", side_effect=RuntimeError("audit failed")), \
                self.assertRaisesRegex(RuntimeError, "audit failed"):
            self.ask(method="post", data=self.payload(name="Should roll back"))
        self.assertFalse(Product.objects.filter(name="Should roll back").exists())


class CatalogConcurrencyTests(TransactionTestCase):
    @skipUnlessDBFeature("has_select_for_update")
    def test_case_insensitive_creates_are_serialized_on_postgres(self):
        import threading

        from django.db import close_old_connections, connections

        self.owner = person("catalog-race-owner", "admin")
        barrier = threading.Barrier(2)
        responses, errors = [], []

        def create(name):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                responses.append(CatalogCase.ask(self, method="post", data={
                    "name": name, "hsn_code": "7113", "gst_percent": "3"}).status_code)
            except Exception as exc:
                errors.append(exc)
            finally:
                connections.close_all()

        threads = [threading.Thread(target=create, args=(name,)) for name in ("Gold ring", "GOLD RING")]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=20)
        self.assertFalse(any(thread.is_alive() for thread in threads))
        self.assertEqual(errors, [])
        self.assertEqual(sorted(responses), [201, 400])
        self.assertEqual(Product.objects.count(), 1)
        self.assertEqual(AuditLog.objects.filter(entity="product").count(), 1)
