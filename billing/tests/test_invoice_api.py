from decimal import Decimal

from django.urls import reverse
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

    def create_another_business(self):
        """Helper method to create another business for testing."""
        return Business.objects.create(
            name="Another Business",
            address="456 Another Street",
            gst_number="22DDDDD0000D1Z5",
            state_name="KARNATAKA",
        )
