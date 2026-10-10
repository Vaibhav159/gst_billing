"""v3's permission base (plan 1A, Task 1): the role matrix on the server, read once per request."""

from datetime import date
from unittest.mock import patch

from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework.response import Response
from rest_framework.test import APIRequestFactory, force_authenticate
from rest_framework.views import APIView

from billing.api.permissions import V3Permission, get_user_role
from billing.fy import fy_label, fy_of, fy_range, parse_fy
from billing.models import Business, Customer, FiledPeriod, Invoice
from billing.period_lock import assert_sales_open
from billing.refusals import Refusal
from billing.roles import (
    GROUP_ACCOUNTANT,
    GROUP_STAFF,
    PERMS,
    group_names,
    is_placed,
    needs_role_choice,
    permissions_of,
    role_of,
    why_not,
)
from billing.tests.test_ist_dates import EARLY_MORNING_IST
from billing.tests.v3_helpers import client_for, person

LINE = {"product_name": "Silver", "hsn_code": "711311", "gst_tax_rate": "0.03", "quantity": "1",
        "rate": "10000", "cgst": "150", "sgst": "150", "igst": "0", "amount": "10300"}
MAKE_BILLS = {"detail": "Only the owner and counter staff can make bills. Ask the owner if you need it.",
              "needs": "bill.create"}
CHANGE_BILLS = {"detail": "Only the owner can change bills. Ask the owner if you need it.", "needs": "bill.edit"}


class FrozenPermsTest(TestCase):
    def test_nobody_can_widen_a_role(self):
        with self.assertRaises(TypeError):
            PERMS["staff"].append("bill.edit")
        with self.assertRaises(TypeError):
            PERMS["viewer"] += ["bill.delete"]
        with self.assertRaises(TypeError):
            PERMS["intern"] = ["view"]
        self.assertNotIn("bill.edit", PERMS["staff"])
        self.assertEqual(PERMS["viewer"], ["view", "reports.export"])


class GroupNamesTest(TestCase):
    def test_one_query_answers_every_role_question(self):
        u = person("rakesh", GROUP_STAFF, "editor")
        with self.assertNumQueries(1):
            self.assertEqual(role_of(u), "staff")
            self.assertIn("bill.create", permissions_of(u))
            self.assertFalse(needs_role_choice(u))
            self.assertEqual(get_user_role(u), "editor")
            self.assertTrue(is_placed(u))

    def test_a_group_change_is_read_again(self):
        u = person("neha", "editor")
        self.assertEqual(role_of(u), "staff")
        u.groups.add(Group.objects.get_or_create(name=GROUP_ACCOUNTANT)[0])
        self.assertEqual(role_of(u), "accountant")
        self.assertEqual(group_names(u), {"editor", GROUP_ACCOUNTANT})

    def test_me_reads_the_groups_once(self):
        u = person("kailash", "admin")
        with CaptureQueriesContext(connection) as ctx:
            r = client_for(u).get(reverse("me"))
        self.assertEqual(r.status_code, 200)
        self.assertEqual(sum("auth_group" in q["sql"] for q in ctx.captured_queries), 1)


class WhyNotTest(TestCase):
    def test_the_prototype_words(self):
        staff = person("rakesh", GROUP_STAFF, "editor")
        viewer = person("manoj", "viewer")
        self.assertEqual(why_not(staff, "bill.cancel"), "Only the owner can cancel bills. Ask the owner if you need it.")
        self.assertEqual(why_not(viewer, "bill.create"),
                         "Only the owner and counter staff can make bills. Ask the owner if you need it.")
        self.assertEqual(why_not(viewer, "customer.edit"),
                         "Only the owner, the accountant and counter staff can add or change customers. "
                         "Ask the owner if you need it.")
        self.assertEqual(why_not(person("kailash", "admin"), "bill.cancel"), "")


class Door(APIView):
    """A stand-in v3 endpoint: reading is open, cancelling is the owner's, PUT was never named."""

    permission_classes = [V3Permission]
    v3_actions = {"POST": "bill.cancel"}

    def get(self, request):
        return Response({"ok": True})

    def post(self, request):
        return Response({"ok": True})

    def put(self, request):
        return Response({"ok": True})


class V3PermissionTest(TestCase):
    def call(self, method, user=None):
        request = getattr(APIRequestFactory(), method)("/door/", {}, format="json")
        if user is not None:
            force_authenticate(request, user=user)
        return Door.as_view()(request)

    def test_reading_needs_view(self):
        self.assertEqual(self.call("get", person("manoj", "viewer")).status_code, 200)

    def test_a_write_needs_its_key_and_says_who_may(self):
        r = self.call("post", person("rakesh", GROUP_STAFF, "editor"))
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data, {"detail": "Only the owner can cancel bills. Ask the owner if you need it.",
                                  "needs": "bill.cancel"})
        self.assertEqual(self.call("post", person("kailash", "admin")).status_code, 200)

    def test_a_write_nobody_named_is_closed_even_to_the_owner(self):
        r = self.call("put", person("kailash", "admin"))
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data["needs"], "")

    def test_signed_out_is_401(self):
        self.assertEqual(self.call("get").status_code, 401)


class PlacedPeopleOnV2EndpointsTest(TestCase):
    """invoices/ and customers/ keep v2's rules; the v3 key applies only to people placed in a v3 group."""

    def setUp(self):
        self.biz = Business.objects.create(name="LODHA JEWELLERS", gst_number="08ABCDE1234A1Z5", state_name="RAJASTHAN")
        self.cust = Customer.objects.create(name="LOCAL BUYER", state_name="RAJASTHAN")
        self.supplier = Customer.objects.create(name="SUPPLIER", gst_number="08AAECD1234K1Z2", state_name="RAJASTHAN")
        self.sale = Invoice.objects.create(business=self.biz, customer=self.cust, invoice_number="1",
                                           invoice_date="2026-05-10", type_of_invoice="outward")

    def bill(self, client, number, kind="outward"):
        party = self.supplier if kind == "inward" else self.cust
        return client.post(reverse("invoice-list"), {
            "business": self.biz.id, "customer": party.id, "invoice_number": number,
            "invoice_date": "2026-05-11", "type_of_invoice": kind, "line_items": [LINE]}, format="json")

    def test_a_placed_accountant_books_purchases_but_not_sales(self):
        acct = client_for(person("neha", GROUP_ACCOUNTANT, "editor"))
        r = self.bill(acct, "2")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data["needs"], "bill.create")
        self.assertEqual(self.bill(acct, "SJ-9", kind="inward").status_code, 201)
        r = acct.patch(reverse("invoice-detail", args=[self.sale.id]), {"payment_mode": "cash"}, format="json")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.data["needs"], "bill.edit")

    def test_placed_staff_make_bills_but_dont_change_them(self):
        staff = client_for(person("rakesh", GROUP_STAFF, "editor"))
        self.assertEqual(self.bill(staff, "2").status_code, 201)
        r = staff.patch(reverse("invoice-detail", args=[self.sale.id]), {"payment_mode": "cash"}, format="json")
        self.assertEqual(r.status_code, 403)

    def test_an_unplaced_editor_keeps_v2_rights(self):
        editor = client_for(person("old_editor", "editor"))
        r = editor.patch(reverse("invoice-detail", args=[self.sale.id]), {"payment_mode": "cash"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)

    def test_placed_people_may_add_customers(self):
        acct = client_for(person("neha", GROUP_ACCOUNTANT, "editor"))
        r = acct.post(reverse("customer-list"), {"name": "NEW BUYER", "state_name": "RAJASTHAN"}, format="json")
        self.assertEqual(r.status_code, 201, r.data)


class PlacedPeopleChangingBillsTest(TestCase):
    """A placed accountant changes purchases on invoices/, but no write there turns a purchase into
    a sale (Task 1 review, Important 1); a bad id is still v2's 404 (Rulings 1A-13 and 1A-15)."""

    def setUp(self):
        self.biz = Business.objects.create(name="LODHA JEWELLERS", gst_number="08ABCDE1234A1Z5", state_name="RAJASTHAN")
        self.cust = Customer.objects.create(name="LOCAL BUYER", state_name="RAJASTHAN")
        self.supplier = Customer.objects.create(name="SUPPLIER", gst_number="08AAECD1234K1Z2", state_name="RAJASTHAN")
        self.sale = Invoice.objects.create(business=self.biz, customer=self.cust, invoice_number="1",
                                           invoice_date="2026-05-10", type_of_invoice="outward")
        self.purchase = Invoice.objects.create(business=self.biz, customer=self.supplier, invoice_number="SJ-1",
                                               invoice_date="2026-05-10", type_of_invoice="inward")
        self.acct = client_for(person("neha", GROUP_ACCOUNTANT, "editor"))

    def test_the_accountant_changes_a_purchase_that_stays_one(self):
        for body in ({"payment_mode": "cash"}, {"type_of_invoice": "inward", "payment_mode": "bank"}):
            with self.subTest(body=body):
                r = self.acct.patch(reverse("invoice-detail", args=[self.purchase.id]), body, format="json")
                self.assertEqual(r.status_code, 200, r.data)

    def test_a_patch_or_put_that_makes_a_purchase_a_sale_needs_bill_edit(self):
        for method in ("patch", "put"):
            with self.subTest(method=method):
                bill = Invoice.objects.create(business=self.biz, customer=self.supplier, invoice_number=f"SJ-{method}",
                                              invoice_date="2026-05-10", type_of_invoice="inward")
                body = {"type_of_invoice": "outward"}
                if method == "put":
                    body.update(business=self.biz.id, customer=self.supplier.id, invoice_number=bill.invoice_number,
                                invoice_date="2026-05-10")
                r = getattr(self.acct, method)(reverse("invoice-detail", args=[bill.id]), body, format="json")
                self.assertEqual((r.status_code, r.data), (403, CHANGE_BILLS))
                bill.refresh_from_db()
                self.assertEqual(bill.type_of_invoice, "inward")

    def test_update_line_items_that_makes_a_purchase_a_sale_needs_bill_edit(self):
        r = self.acct.post(reverse("invoice-update-line-items", args=[self.purchase.id]),
                           {"invoice": {"type_of_invoice": "outward"}, "line_items": [LINE]}, format="json")
        self.assertEqual((r.status_code, r.data), (403, CHANGE_BILLS))
        self.purchase.refresh_from_db()
        self.assertEqual(self.purchase.type_of_invoice, "inward")
        self.assertFalse(self.purchase.lineitem_set.exists())

    def test_update_line_items_follows_the_bill(self):
        r = self.acct.post(reverse("invoice-update-line-items", args=[self.purchase.id]),
                           {"line_items": [LINE]}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        r = self.acct.post(reverse("invoice-update-line-items", args=[self.sale.id]),
                           {"line_items": [LINE]}, format="json")
        self.assertEqual((r.status_code, r.data), (403, CHANGE_BILLS))

    def test_the_eway_post_follows_the_bill(self):
        r = self.acct.post(reverse("invoice-eway-bill", args=[self.purchase.id]), {"vehicle_number": "RJ14AB1234"},
                           format="json")
        self.assertEqual(r.status_code, 200, r.data)
        r = self.acct.post(reverse("invoice-eway-bill", args=[self.sale.id]), {"vehicle_number": "RJ14AB1234"},
                           format="json")
        self.assertEqual((r.status_code, r.data), (403, CHANGE_BILLS))
        self.sale.refresh_from_db()
        self.assertEqual(self.sale.vehicle_number, "")

    def test_a_bad_or_missing_id_is_a_404(self):
        for pk in ("abc", 999999):
            with self.subTest(pk=pk):
                r = self.acct.patch(reverse("invoice-detail", args=[pk]), {"payment_mode": "cash"}, format="json")
                self.assertEqual(r.status_code, 404)

    def test_an_unrouted_method_is_a_405(self):
        self.assertEqual(self.acct.put(reverse("invoice-list"), {}, format="json").status_code, 405)


class PlacedPeopleImportingTest(TestCase):
    """The three import doors take the hybrid too (Ruling 1A-14): a placed accountant imports
    purchases and customers, never a sale."""

    def setUp(self):
        self.biz = Business.objects.create(name="LODHA JEWELLERS", gst_number="08ABCDE1234A1Z5", state_name="RAJASTHAN")
        Customer.objects.create(name="LOCAL BUYER", state_name="RAJASTHAN").businesses.add(self.biz)
        self.acct = client_for(person("neha", GROUP_ACCOUNTANT, "editor"))

    def upload(self, rows, **fields):
        return self.acct.post(reverse("csv-import"), {**fields, "file": SimpleUploadedFile("rows.csv", rows)},
                              format="multipart")

    def test_a_bulk_import_with_any_sale_needs_bill_create(self):
        item = {"productName": "Silver", "hsn": "711311", "gstRate": 3, "qty": 1, "rate": 10000, "taxable": 10000,
                "cgst": 150, "sgst": 150, "igst": 0, "amount": 10300}
        purchase = {"invoiceNumber": "SJ-1", "invoice_date": "2026-05-10", "customerName": "SUPPLIER",
                    "customerGST": "08AAECD1234K1Z2", "type": "INWARD", "total": 10300, "items": [item]}
        sale = {**purchase, "invoiceNumber": "B-1", "customerName": "LOCAL BUYER", "customerGST": "", "type": "OUTWARD"}
        r = self.acct.post(reverse("bulk-invoice-import"), {"business_id": self.biz.id, "invoices": [purchase, sale]},
                           format="json")
        self.assertEqual((r.status_code, r.data), (403, MAKE_BILLS))
        self.assertFalse(Invoice.objects.exists())
        r = self.acct.post(reverse("bulk-invoice-import"), {"business_id": self.biz.id, "invoices": [purchase]},
                           format="json")
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(list(Invoice.objects.values_list("type_of_invoice", flat=True)), ["inward"])

    def test_a_csv_import_of_bills_needs_bill_create(self):
        rows = (b"invoice_number,invoice_date,customer_name,product_name,quantity,rate,hsn_code,gst_tax_rate\n"
                b"C-1,2026-05-10,LOCAL BUYER,Silver,1,10000,711311,0.03\n")
        r = self.upload(rows, business_id=self.biz.id)
        self.assertEqual((r.status_code, r.data), (403, MAKE_BILLS))
        self.assertFalse(Invoice.objects.exists())

    def test_a_csv_import_of_customers_needs_customer_edit_and_of_products_product_edit(self):
        r = self.upload(b"name,address,gst_number,mobile_number,pan_number,state_name\nNEW BUYER,,,,,RAJASTHAN\n",
                        type="customer", business_id=self.biz.id)
        self.assertEqual(r.status_code, 201, r.data)
        self.assertTrue(Customer.objects.filter(name="NEW BUYER").exists())
        r = self.upload(b"name,hsn_code,gst_tax_rate,description\nCSV PRODUCT,711319,0.03,ok\n", type="product")
        self.assertEqual((r.status_code, r.data), (403, {
            "detail": "Only the owner can add or change products. Ask the owner if you need it.",
            "needs": "product.edit"}))

    def test_an_ai_create_of_a_sale_needs_bill_create(self):
        data = {"business_id": self.biz.id, "invoice_data": {
            "customer_name": "MUMBAI BUYER", "customer_gst_number": "27ABCDE1234A1Z5", "invoice_number": "AI-1",
            "invoice_date": "2026-05-10",
            "line_items": [{"product_name": "Silver", "hsn_code": "711311", "quantity": 1, "rate": 10000,
                            "gst_tax_rate": 0.03}]}}
        r = self.acct.post(reverse("ai-invoice-create"), data, format="json")
        self.assertEqual((r.status_code, r.data), (403, MAKE_BILLS))
        self.assertFalse(Invoice.objects.exists())
        r = self.acct.post(reverse("ai-invoice-create"), {**data, "type_of_invoice": "inward"}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(Invoice.objects.get().type_of_invoice, "inward")


class SalesOpenTest(TestCase):
    def setUp(self):
        self.biz = Business.objects.create(name="KIRAN GOLD HOUSE", gst_number="08ABCDE1234A1Z5", state_name="RAJASTHAN")

    def test_an_open_month_passes(self):
        # Locked around it: this firm's August, its September a year back, another firm's September.
        other = Business.objects.create(name="OTHER FIRM", gst_number="08AAECD1234K1Z2", state_name="RAJASTHAN")
        for biz, year, month in ((self.biz, 2026, 8), (self.biz, 2025, 9), (other, 2026, 9)):
            FiledPeriod.objects.create(business=biz, year=year, month=month)
        self.assertIsNone(assert_sales_open(self.biz, date(2026, 9, 30), "create"))

    def test_a_closed_month_is_a_409_with_the_period(self):
        period = FiledPeriod.objects.create(business=self.biz, year=2026, month=9)
        with self.assertRaises(Refusal) as ctx:
            assert_sales_open(self.biz, date(2026, 9, 30), "create")
        self.assertEqual(ctx.exception.status_code, 409)
        self.assertEqual(ctx.exception.detail, {
            "detail": "September 2026 is filed and locked for KIRAN GOLD HOUSE, so no bill can go into it. "
                      "Have the owner unlock September 2026 in GST returns first.",
            "code": "month_closed",
            "locked_period": {"id": period.id, "business": self.biz.id, "year": 2026, "month": 9},
        })


class FinancialYearTest(TestCase):
    def test_april_to_march(self):
        self.assertEqual(fy_of(date(2026, 3, 31)), 2025)
        self.assertEqual(fy_of(date(2026, 4, 1)), 2026)
        self.assertEqual(fy_of("2027-02-08"), 2026)
        with patch("django.utils.timezone.now", return_value=EARLY_MORNING_IST):
            self.assertEqual(fy_of(), 2026)  # 1 Apr 2026, 01:30 in IST; still 31 Mar in UTC
        self.assertEqual(fy_label(2026), "2026-27")
        self.assertEqual(fy_label(2099), "2099-00")
        self.assertEqual(fy_range(2026), (date(2026, 4, 1), date(2027, 3, 31)))
        self.assertEqual(parse_fy("2026-27"), 2026)
        self.assertIsNone(parse_fy("2026-28"))
        self.assertIsNone(parse_fy("26-27"))


class SalesQuerySetTest(TestCase):
    def test_sales_are_the_outward_bills(self):
        biz = Business.objects.create(name="F", gst_number="08ABCDE1234A1Z5", state_name="RAJASTHAN")
        cust = Customer.objects.create(name="C", state_name="RAJASTHAN")
        sale = Invoice.objects.create(business=biz, customer=cust, invoice_number="1", invoice_date="2026-05-10")
        Invoice.objects.create(business=biz, customer=cust, invoice_number="P1", invoice_date="2026-05-10",
                               type_of_invoice="inward")
        self.assertEqual(list(Invoice.objects.sales()), [sale])
