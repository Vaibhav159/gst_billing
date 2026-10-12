from datetime import date
from decimal import Decimal
from unittest.mock import patch

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from billing.gstin import check_digit
from billing.models import AuditLog, Customer, LineItem
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, line, person, sale


def gstin(first="08ABCDE1234A1Z"):
    return first + check_digit(first)


class SuppliersTests(TestCase):
    def setUp(self):
        self.owner = person("supplier-owner", *ROLE_GROUPS["owner"])
        self.client = client_for(self.owner)
        self.firm = firm(gstin=gstin())
        self.supplier = buyer("Bullion", gst_number=gstin("08ABCDE1234B1Z"))
        self.empty = buyer("Marked", is_supplier=True)
        self.customer = buyer("Customer")
        self.bill = sale(self.firm, self.supplier, "UB/009", "2026-09-01", kind="inward")

    def get_list(self, **params):
        response = self.client.get("/api/suppliers/", {"fy": "2026-27", **params})
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_list_scope_summary_and_page(self):
        sale(self.firm, self.supplier, "UB/010", "2026-09-02", line(rate="5000"), kind="inward",
             itc_eligible=False)
        sale(self.firm, self.supplier, "SALE/1", "2026-09-02")
        data = self.get_list(page_size=1)
        self.assertEqual(data["count"], 2)
        self.assertEqual(data["summary"], {"suppliers": 2, "bills": 2, "total": "15450.00", "tax": "450.00"})
        self.assertEqual(data["results"][0]["figures"], {
            "bills": 2, "total": "15450.00", "tax": "450.00", "credit": "300.00",
            "last": {"id": self.bill.pk + 1, "invoice_date": "2026-09-02"},
        })
        self.assertEqual(self.get_list(business_id=9999)["summary"]["bills"], 0)
        self.assertEqual([row["name"] for row in self.get_list(q="Mark")["results"]], ["Marked"])

    def test_credit_uses_stored_month_and_deadline(self):
        self.bill.itc_month = date(2027, 11, 1)
        self.bill.save(update_fields=["itc_month"])
        self.assertEqual(self.get_list()["results"][0]["figures"]["credit"], "0.00")
        self.bill.itc_month = date(2027, 10, 1)
        self.bill.save(update_fields=["itc_month"])
        self.assertEqual(self.get_list()["results"][0]["figures"]["credit"], "300.00")

    def test_detail_rates_exclude_amount_only_and_single_pieces(self):
        sale(self.firm, self.supplier, "UB/010", "2026-09-02", line(qty="2", rate="20000"),
             line(name="Ring", unit="pcs"), kind="inward")
        LineItem.objects.filter(invoice=self.bill).update(note="Amount only")
        response = self.client.get(f"/api/suppliers/{self.supplier.pk}/", {"fy": "2026-27"})
        self.assertEqual(response.status_code, 200, response.data)
        data = response.data
        self.assertEqual(data["supplier"]["prefix"], "UB/")
        self.assertEqual(data["supplier"]["gstin_valid"], True)
        self.assertEqual(data["rates"], [{"product_name": "Silver", "unit": "gms", "quantity": "2.000",
            "value": "40000.00", "bills": 1, "average": "20000.000", "low": "20000.000", "high": "20000.000"}])
        self.assertEqual(len(data["bills"]), 2)
        self.assertEqual(data["bills"][0]["supplier"]["id"], self.supplier.pk)

    def test_memory_uses_newest_series_and_highest_number(self):
        sale(self.firm, self.supplier, "UB/098", "2026-08-01", kind="inward")
        sale(self.firm, self.supplier, "OTHER/999", "2026-07-01", kind="inward")
        response = self.client.get(f"/api/suppliers/{self.supplier.pk}/memory/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data, {"bills": 3, "last": {"id": self.bill.pk,
            "invoice_number": "UB/009", "invoice_date": "2026-09-01"},
            "line": {"product_name": "Silver", "hsn_code": "711311", "unit": "gms", "gst_percent": "3"},
            "next_number": "UB/099"})
        empty = self.client.get(f"/api/suppliers/{self.empty.pk}/memory/")
        self.assertEqual(empty.data, {"bills": 0, "last": None, "line": None, "next_number": None})

    def test_customers_role_and_read_only_mark(self):
        def names(role):
            return {row["name"] for row in self.client.get("/api/customers/", {"role": role}).data["results"]}
        self.assertEqual(names("customers"), {"Customer"})
        self.assertEqual(names("suppliers"), {"Bullion", "Marked"})
        sale(self.firm, self.supplier, "SALE/1", "2026-09-01")
        self.assertEqual(names("customers"), {"Customer", "Bullion"})
        self.assertEqual(names(""), {"Customer", "Bullion", "Marked"})
        response = self.client.patch(f"/api/customers/{self.customer.pk}/", {"is_supplier": True}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["is_supplier"])

    def test_supplier_write_words_registry_and_old_heads(self):
        with patch("billing.gstin.enrich_customer") as enrich, self.captureOnCommitCallbacks(execute=True):
            response = self.client.post("/api/suppliers/", {"name": "New Supplier", "gst_number": "URP"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["gst_number"], "")
        enrich.assert_called_once()
        self.assertTrue(Customer.objects.get(pk=response.data["id"]).is_supplier)
        before = list(LineItem.objects.filter(invoice=self.bill).values_list("cgst", "sgst", "igst"))
        response = self.client.put(f"/api/suppliers/{self.supplier.pk}/", {
            "name": "Bullion", "gst_number": gstin("24ABCDE1234B1Z"), "state_name": "RAJASTHAN"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["state_name"], "GUJARAT")
        self.assertEqual(before, list(LineItem.objects.filter(invoice=self.bill).values_list("cgst", "sgst", "igst")))
        self.assertEqual(AuditLog.objects.filter(entity="customer", action="updated").first().details,
                         "Supplier details updated")

    def test_supplier_duplicates_names_and_gstin(self):
        response = self.client.post("/api/suppliers/", {"name": "Other", "gst_number": self.supplier.gst_number}, format="json")
        self.assertEqual((response.status_code, response.data["code"]), (409, "gstin_taken"))
        self.assertEqual(response.data["supplier"]["id"], self.supplier.pk)
        for name, words in [("Bullion", f"Bullion is already a supplier (GSTIN {self.supplier.gst_number}). If this is another branch, give it its own name, like the city."),
                            ("Customer", "Customer is already on file as a customer. If this is another firm, give it its own name, like the city.")]:
            response = self.client.post("/api/suppliers/", {"name": name}, format="json")
            self.assertEqual((response.status_code, response.data), (400, {"name": [words]}))

    def test_bad_supplier_fields_and_permissions(self):
        for payload, field, words in [({}, "name", "Type the supplier's name as it's printed on their bill."),
            ({"name": "New", "email": "bad"}, "email", "This doesn't look like an email address."),
            ({"name": "New", "pan_number": "bad"}, "pan_number", "A PAN has 10 characters: 5 letters, 4 digits, then a letter (like ABCDE1234F).")]:
            response = self.client.post("/api/suppliers/", payload, format="json")
            self.assertEqual((response.status_code, response.data), (400, {field: [words]}))
        wrong = self.supplier.gst_number[:-1] + ("0" if self.supplier.gst_number[-1] != "0" else "1")
        response = self.client.post("/api/suppliers/", {"name": "New", "gst_number": wrong}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("doesn't check out:", str(response.data["gst_number"]))
        self.client = client_for(person("view-supplier", *ROLE_GROUPS["viewer"]))
        self.assertEqual(self.client.get("/api/suppliers/").status_code, 200)
        response = self.client.post("/api/suppliers/", {"name": "No"}, format="json")
        self.assertEqual((response.status_code, response.data["needs"]), (403, "supplier.edit"))

    def test_invalid_ids_filters_and_absent_supplier(self):
        for path in ["/api/suppliers/9999/", f"/api/suppliers/{self.customer.pk}/"]:
            response = self.client.get(path)
            self.assertEqual((response.status_code, response.data), (404, {"detail": "No supplier matches the given query."}))
        for params in [{"business_id": "x"}, {"fy": "x"}, {"ordering": "oops"}]:
            self.assertEqual(self.client.get("/api/suppliers/", params).status_code, 400)

    def test_figures_are_one_narrow_aggregate(self):
        from billing.services.suppliers import supplier_figures

        with CaptureQueriesContext(connection) as queries:
            figures = supplier_figures([self.supplier.pk, self.empty.pk], None, 2026)
        self.assertEqual(len(queries), 1)
        self.assertEqual(figures[self.supplier.pk]["total"], "10300.00")
        self.assertNotIn("firm_snapshot", queries[0]["sql"])
        self.assertNotIn("address", queries[0]["sql"])
        self.assertEqual(Decimal(figures[self.empty.pk]["credit"]), 0)

    def test_credit_excludes_bills_before_the_april_2025_ledger_floor(self):
        from billing.services.suppliers import supplier_figures

        sale(self.firm, self.supplier, "OLD-2025", "2025-03-31", kind="inward",
             itc_month=date(2025, 4, 1))
        sale(self.firm, self.supplier, "IN-2025", "2025-04-01", kind="inward")
        figures = supplier_figures([self.supplier.pk])[self.supplier.pk]
        self.assertEqual((figures["bills"], figures["tax"], figures["credit"]), (3, "900.00", "600.00"))
