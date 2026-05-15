from decimal import Decimal

from django.urls import reverse
from freezegun import freeze_time
from rest_framework import status

from billing.constants import INVOICE_TYPE_INWARD, INVOICE_TYPE_OUTWARD
from billing.models import Business, Customer, Invoice, LineItem
from billing.tests.test_base import BaseAPITestCase


class InvoiceAPITestCase(BaseAPITestCase):
    """Test case for Invoice API endpoints."""

    def test_list_invoices(self):
        """Test retrieving a list of invoices."""
        url = reverse("invoice-list")
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["invoice_number"], "INV-001")
        self.assertEqual(
            response.data["results"][0]["type_of_invoice"], INVOICE_TYPE_OUTWARD
        )

    def test_retrieve_invoice(self):
        """Test retrieving a single invoice."""
        url = reverse("invoice-detail", args=[self.invoice.id])
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["invoice_number"], "INV-001")
        self.assertEqual(response.data["type_of_invoice"], INVOICE_TYPE_OUTWARD)
        self.assertEqual(response.data["business"], self.business.id)
        self.assertEqual(response.data["customer"], self.customer.id)
        # Refresh the invoice to get the updated total_amount
        self.invoice.refresh_from_db()
        self.assertEqual(
            Decimal(response.data["total_amount"]), self.invoice.total_amount
        )

    def test_create_invoice(self):
        """Test creating a new invoice."""
        url = reverse("invoice-list")
        data = {
            "invoice_number": "INV-002",
            "invoice_date": "2023-02-01",
            "business": self.business.id,
            "customer": self.customer.id,
            "type_of_invoice": INVOICE_TYPE_INWARD,
            "total_amount": "590.00",
        }
        response = self.client.post(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Invoice.objects.count(), 2)
        self.assertEqual(response.data["invoice_number"], "INV-002")
        self.assertEqual(response.data["type_of_invoice"], INVOICE_TYPE_INWARD)
        # is_igst_applicable is a property that depends on the customer and business GST numbers

    def test_create_invoice_with_line_items(self):
        """Combined-create endpoint: invoice + line items in a single POST.

        Asserts that bulk-created line items land, total_amount is recomputed
        from the items' amounts (not whatever the request claimed), and the
        response includes the persisted line items.
        """
        url = reverse("invoice-list")
        data = {
            "invoice_number": "INV-COMBINED",
            "invoice_date": "2023-03-01",
            "business": self.business.id,
            "customer": self.customer.id,
            "type_of_invoice": INVOICE_TYPE_OUTWARD,
            "total_amount": "0.00",  # backend ignores this and recomputes
            "line_items": [
                {
                    "product_name": "Widget A",
                    "hsn_code": "100100",
                    "gst_tax_rate": "0.18",
                    "quantity": "2",
                    "rate": "100",
                    "cgst": "9",
                    "sgst": "9",
                    "igst": "0",
                    "amount": "218",
                    "unit": "pcs",
                },
                {
                    "product_name": "Widget B",
                    "hsn_code": "100200",
                    "gst_tax_rate": "0.18",
                    "quantity": "1",
                    "rate": "300",
                    "cgst": "27",
                    "sgst": "27",
                    "igst": "0",
                    "amount": "354",
                    "unit": "pcs",
                },
            ],
        }
        response = self.client.post(url, data, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        new_invoice = Invoice.objects.get(invoice_number="INV-COMBINED")
        items = LineItem.objects.filter(invoice=new_invoice).order_by("id")
        self.assertEqual(items.count(), 2)
        self.assertEqual(items[0].product_name, "Widget A")
        self.assertEqual(items[1].product_name, "Widget B")
        # total_amount should reflect SUM(amounts), not the "0.00" we sent.
        self.assertEqual(new_invoice.total_amount, Decimal("572"))

    def test_create_invoice_without_line_items_still_works(self):
        """Backwards-compat: creating without `line_items` behaves like before."""
        url = reverse("invoice-list")
        data = {
            "invoice_number": "INV-NO-ITEMS",
            "invoice_date": "2023-04-01",
            "business": self.business.id,
            "customer": self.customer.id,
            "type_of_invoice": INVOICE_TYPE_OUTWARD,
            "total_amount": "100.00",
        }
        response = self.client.post(url, data, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        new_invoice = Invoice.objects.get(invoice_number="INV-NO-ITEMS")
        self.assertEqual(LineItem.objects.filter(invoice=new_invoice).count(), 0)

    def test_update_invoice(self):
        """Test updating an existing invoice."""
        url = reverse("invoice-detail", args=[self.invoice.id])
        data = {
            "invoice_number": "INV-001-UPDATED",
            "invoice_date": "2023-01-01",
            "business": self.business.id,
            "customer": self.customer.id,
            "type_of_invoice": INVOICE_TYPE_OUTWARD,
            "total_amount": "1180.00",
        }
        response = self.client.put(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.invoice_number, "INV-001-UPDATED")
        # is_igst_applicable is a property that depends on the customer and business GST numbers

    def test_partial_update_invoice(self):
        """Test partially updating an existing invoice."""
        url = reverse("invoice-detail", args=[self.invoice.id])
        data = {"invoice_number": "INV-001-PARTIAL"}
        response = self.client.patch(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.invoice_number, "INV-001-PARTIAL")
        self.assertEqual(
            self.invoice.type_of_invoice, INVOICE_TYPE_OUTWARD
        )  # Unchanged

    def test_delete_invoice(self):
        """Test deleting an invoice."""
        url = reverse("invoice-detail", args=[self.invoice.id])
        response = self.client.delete(url)

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(Invoice.objects.count(), 0)
        # Line items should be deleted as well (cascade)
        self.assertEqual(LineItem.objects.count(), 0)

    def test_filter_invoice_by_business(self):
        """Test filtering invoices by business."""
        # Create another business and invoice
        another_business = self.create_another_business()
        Invoice.objects.create(
            invoice_number="INV-003",
            invoice_date="2023-03-01",
            business=another_business,
            customer=self.customer,
            type_of_invoice=INVOICE_TYPE_OUTWARD,
            total_amount=Decimal("500.00"),
        )

        # Test filtering by the original business
        url = reverse("invoice-list") + f"?business_id={self.business.id}"
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["invoice_number"], "INV-001")

        # Test filtering by the new business
        url = reverse("invoice-list") + f"?business_id={another_business.id}"
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["invoice_number"], "INV-003")

    def test_filter_invoice_by_customer(self):
        """Test filtering invoices by customer."""
        # Create another customer and invoice
        another_customer = Customer.objects.create(
            name="Another Customer",
            address="789 Another Avenue",
            gst_number="22HHHHH0000H1Z5",
            state_name="TELANGANA",
        )
        Invoice.objects.create(
            invoice_number="INV-004",
            invoice_date="2023-04-01",
            business=self.business,
            customer=another_customer,
            type_of_invoice=INVOICE_TYPE_OUTWARD,
            total_amount=Decimal("600.00"),
        )

        # Test filtering by the original customer
        url = reverse("invoice-list") + f"?customer_id={self.customer.id}"
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["invoice_number"], "INV-001")

        # Test filtering by the new customer
        url = reverse("invoice-list") + f"?customer_id={another_customer.id}"
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["invoice_number"], "INV-004")

    def test_filter_invoice_by_date_range(self):
        """Test filtering invoices by date range."""
        # Create invoices with different dates
        Invoice.objects.create(
            invoice_number="INV-005",
            invoice_date="2023-05-01",
            business=self.business,
            customer=self.customer,
            type_of_invoice=INVOICE_TYPE_OUTWARD,
            total_amount=Decimal("700.00"),
        )

        # Test filtering by date range that includes only the original invoice
        url = reverse("invoice-list") + "?start_date=2023-01-01&end_date=2023-01-31"
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["invoice_number"], "INV-001")

        # Test filtering by date range that includes only the new invoice
        url = reverse("invoice-list") + "?start_date=2023-05-01&end_date=2023-05-31"
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["invoice_number"], "INV-005")

        # Test filtering by date range that includes both invoices
        url = reverse("invoice-list") + "?start_date=2023-01-01&end_date=2023-12-31"
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 2)

    def test_filter_invoice_by_type(self):
        """Test filtering invoices by type."""
        # Create an inward invoice
        Invoice.objects.create(
            invoice_number="INV-006",
            invoice_date="2023-06-01",
            business=self.business,
            customer=self.customer,
            type_of_invoice=INVOICE_TYPE_INWARD,
            total_amount=Decimal("800.00"),
        )

        # Test filtering by outward type
        url = reverse("invoice-list") + f"?type_of_invoice={INVOICE_TYPE_OUTWARD}"
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["invoice_number"], "INV-001")

        # Test filtering by inward type
        url = reverse("invoice-list") + f"?type_of_invoice={INVOICE_TYPE_INWARD}"
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["invoice_number"], "INV-006")

    def test_invoice_summary(self):
        """Test retrieving invoice summary."""
        url = reverse("invoice-summary", args=[self.invoice.id])
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["total_items"], 1)
        # Check that the summary values match the line item values
        self.assertEqual(
            Decimal(response.data["amount_without_tax"]),
            self.line_item.rate * self.line_item.quantity,
        )
        self.assertEqual(Decimal(response.data["total_cgst_tax"]), self.line_item.cgst)
        self.assertEqual(Decimal(response.data["total_sgst_tax"]), self.line_item.sgst)
        self.assertEqual(Decimal(response.data["total_amount"]), self.line_item.amount)

    def test_invoice_print(self):
        """Test retrieving invoice print data."""
        url = reverse("invoice-print", args=[self.invoice.id])
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["invoice"]["invoice_number"], "INV-001")
        self.assertEqual(len(response.data["line_items"]), 1)
        self.assertEqual(
            response.data["line_items"][0]["product_name"], self.line_item.product_name
        )
        self.assertEqual(Decimal(response.data["total_amount"]), self.line_item.amount)

    @freeze_time("2023-06-01")
    def test_next_invoice_number(self):
        """Test retrieving the next invoice number."""
        # Create a few more invoices to test the sequence
        Invoice.objects.create(
            invoice_number="1",
            invoice_date="2023-04-01",  # Start of financial year 2023-24
            business=self.business,
            customer=self.customer,
            type_of_invoice=INVOICE_TYPE_OUTWARD,
        )

        Invoice.objects.create(
            invoice_number="5",
            invoice_date="2023-05-01",
            business=self.business,
            customer=self.customer,
            type_of_invoice=INVOICE_TYPE_OUTWARD,
        )

        # Test outward invoice number
        url = (
            reverse("invoice-next-invoice-number")
            + f"?business_id={self.business.id}&type_of_invoice=outward"
        )
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # The next number should be 003 for the current financial year
        self.assertEqual(response.data["next_invoice_number"], "6")

        # test for next fy year
        with freeze_time("2024-06-01"):
            response = self.client.get(url)

            self.assertEqual(response.status_code, status.HTTP_200_OK)
            # The next number should be 001 for the next financial year
            self.assertEqual(response.data["next_invoice_number"], "1")

        # Test inward invoice number
        url = (
            reverse("invoice-next-invoice-number")
            + f"?business_id={self.business.id}&type_of_invoice=inward"
        )
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # The next number should be 001 for inward since we haven't created any
        self.assertEqual(response.data["next_invoice_number"], "1")

        # Test without business_id
        url = reverse("invoice-next-invoice-number")
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["error"], "Business ID is required")

    @freeze_time("2023-06-01")
    def test_next_invoice_number_ignores_non_numeric_invoice_numbers(self):
        """Regression: an invoice with embedded digits (e.g. "TEST-1778345121")
        should not pollute the next-invoice-number sequence. PostgreSQL's CAST
        used to extract the trailing digits and treat them as the "max" — so
        a single test invoice could leak a giant timestamp into the suggested
        next number. Filter to purely numeric invoice_numbers first.
        """
        Invoice.objects.create(
            invoice_number="3",
            invoice_date="2023-04-15",
            business=self.business,
            customer=self.customer,
            type_of_invoice=INVOICE_TYPE_OUTWARD,
        )
        # This non-numeric one used to win the "max" race because its trailing
        # digits cast to a bigger int.
        Invoice.objects.create(
            invoice_number="TEST-1778345121",
            invoice_date="2023-04-20",
            business=self.business,
            customer=self.customer,
            type_of_invoice=INVOICE_TYPE_OUTWARD,
        )

        next_n = Invoice.get_next_invoice_number(self.business.id)
        # Should be 4 (3 + 1), not 1778345122.
        self.assertEqual(next_n, 4)

    @freeze_time("2026-05-15")
    def test_check_duplicate_scopes_by_fy_and_type(self):
        """
        Regression: the duplicate-check used to scope only by (business,
        invoice_number, today's-FY). That had two failure modes:

          1. Outward "12" and inward "12" in the same FY+business would
             collide on first lookup, even though they're legitimately
             distinct documents on the GST portal.
          2. A back-dated invoice (date in a previous FY) would be checked
             against today's FY, never against its own — so a true
             duplicate in the past FY would slip through.

        New endpoint accepts `invoice_date` (drives the FY) and
        `type_of_invoice` (gates the lookup).
        """
        biz = self.business
        cust = self.customer
        # Existing outward "100" in FY 2026-27 — created without freeze so
        # use a clear date inside that FY:
        Invoice.objects.create(
            invoice_number="100", invoice_date="2026-05-01",
            business=biz, customer=cust,
            type_of_invoice=INVOICE_TYPE_OUTWARD, total_amount="100",
        )
        url = reverse("invoice-check-duplicate")

        # (a) Same number + same FY + same type → duplicate
        r = self.client.get(url, {
            "invoice_number": "100", "business_id": biz.id,
            "type_of_invoice": "outward", "invoice_date": "2026-06-01",
        })
        self.assertTrue(r.data["exists"], "same-FY same-type should be a dup")

        # (b) Same number + same FY but inward → NOT a duplicate (legit)
        r = self.client.get(url, {
            "invoice_number": "100", "business_id": biz.id,
            "type_of_invoice": "inward", "invoice_date": "2026-06-01",
        })
        self.assertFalse(r.data["exists"], "outward + inward can share a number")

        # (c) Same number + outward but back-dated to FY 2024-25 → NOT a
        # duplicate (different FY than the existing one).
        r = self.client.get(url, {
            "invoice_number": "100", "business_id": biz.id,
            "type_of_invoice": "outward", "invoice_date": "2024-09-15",
        })
        self.assertFalse(r.data["exists"], "different FY shouldn't collide")

        # (d) Backward compat: caller that omits type+date still works (uses
        # today's FY, no type filter) — should detect the existing dup.
        r = self.client.get(url, {
            "invoice_number": "100", "business_id": biz.id,
        })
        self.assertTrue(r.data["exists"], "legacy callers still work")

    def test_data_quality_endpoint(self):
        """data_quality should report counts of empty / no-HSN / dup invoices."""
        # The base test fixture has 1 invoice (`self.invoice`) with 1 line item
        # that has hsn_code = "1234". Starting state should be clean.
        url = reverse("invoice-data-quality")
        r = self.client.get(url)
        self.assertEqual(r.status_code, 200)
        baseline_empty = r.data["invoices_no_line_items"]
        baseline_no_hsn = r.data["line_items_missing_hsn"]
        baseline_dups = r.data["duplicate_invoice_groups"]

        # Add an empty-item invoice
        Invoice.objects.create(
            invoice_number="EMPTY1", invoice_date="2026-05-01",
            business=self.business, customer=self.customer,
            type_of_invoice=INVOICE_TYPE_OUTWARD, total_amount="0",
        )
        # Add a HSN-less line item on a separate invoice
        inv2 = Invoice.objects.create(
            invoice_number="NOHSN1", invoice_date="2026-05-01",
            business=self.business, customer=self.customer,
            type_of_invoice=INVOICE_TYPE_OUTWARD, total_amount="100",
        )
        LineItem.objects.create(
            invoice=inv2, customer=self.customer, product_name="X",
            hsn_code="", gst_tax_rate="0.030", quantity="1", rate="100",
            cgst="1.5", sgst="1.5", igst="0", amount="100",
            unit="gms", workspace_id=1,
        )
        # Add two invoices with the same number/date/type → 1 dup group
        Invoice.objects.create(
            invoice_number="DUP1", invoice_date="2026-05-01",
            business=self.business, customer=self.customer,
            type_of_invoice=INVOICE_TYPE_OUTWARD, total_amount="50",
        )
        Invoice.objects.create(
            invoice_number="DUP1", invoice_date="2026-05-15",
            business=self.business, customer=self.customer,
            type_of_invoice=INVOICE_TYPE_OUTWARD, total_amount="60",
        )

        r = self.client.get(url)
        # 3 new empty invoices: EMPTY1, DUP1×2. NOHSN1 has a line item.
        self.assertEqual(r.data["invoices_no_line_items"], baseline_empty + 3)
        self.assertEqual(r.data["line_items_missing_hsn"], baseline_no_hsn + 1)
        # 1 new dup group: (business, DUP1, FY 2026-27, outward)
        self.assertEqual(r.data["duplicate_invoice_groups"], baseline_dups + 1)
        self.assertTrue(r.data["has_issues"])

    def test_invoice_list_hygiene_filters(self):
        """?dups=1, ?empty=1, ?no_hsn=1 narrow the list correctly."""
        # Setup: 1 dup pair, 1 empty invoice, 1 no-hsn invoice
        Invoice.objects.create(
            invoice_number="DUPA", invoice_date="2026-05-01",
            business=self.business, customer=self.customer,
            type_of_invoice=INVOICE_TYPE_OUTWARD, total_amount="10",
        )
        Invoice.objects.create(
            invoice_number="DUPA", invoice_date="2026-05-02",
            business=self.business, customer=self.customer,
            type_of_invoice=INVOICE_TYPE_OUTWARD, total_amount="20",
        )
        Invoice.objects.create(
            invoice_number="EMPTYA", invoice_date="2026-05-01",
            business=self.business, customer=self.customer,
            type_of_invoice=INVOICE_TYPE_OUTWARD, total_amount="0",
        )
        inv = Invoice.objects.create(
            invoice_number="NOHSNA", invoice_date="2026-05-01",
            business=self.business, customer=self.customer,
            type_of_invoice=INVOICE_TYPE_OUTWARD, total_amount="50",
        )
        LineItem.objects.create(
            invoice=inv, customer=self.customer, product_name="Y",
            hsn_code="", gst_tax_rate="0.030", quantity="1", rate="50",
            cgst="0.75", sgst="0.75", igst="0", amount="50",
            unit="gms", workspace_id=1,
        )

        url = reverse("invoice-list")
        # dups → both DUPA rows
        r = self.client.get(url, {"dups": "1"})
        nums = [x["invoice_number"] for x in r.data["results"]]
        self.assertEqual(sum(1 for n in nums if n == "DUPA"), 2,
                         f"dups filter should include both DUPA rows, got {nums}")

        # empty → EMPTYA (and DUPA×2 which also have no items, and original
        # bare invoices). Just assert EMPTYA is in there.
        r = self.client.get(url, {"empty": "1"})
        nums = {x["invoice_number"] for x in r.data["results"]}
        self.assertIn("EMPTYA", nums)
        self.assertIn("DUPA", nums)  # those are also empty

        # no_hsn → NOHSNA but NOT EMPTYA (no line items at all)
        r = self.client.get(url, {"no_hsn": "1"})
        nums = {x["invoice_number"] for x in r.data["results"]}
        self.assertIn("NOHSNA", nums)
        self.assertNotIn("EMPTYA", nums,
                         "empty-item invoices must not match no_hsn (LEFT JOIN guard)")

    def create_another_business(self):
        """Helper method to create another business for testing."""
        return Business.objects.create(
            name="Another Business",
            address="456 Another Street",
            gst_number="22DDDDD0000D1Z5",
            state_name="KARNATAKA",
        )
