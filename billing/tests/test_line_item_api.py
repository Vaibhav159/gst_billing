from decimal import Decimal

from django.urls import reverse
from rest_framework import status

from billing.models import LineItem
from billing.tests.test_base import BaseAPITestCase


class LineItemAPITestCase(BaseAPITestCase):
    """Test case for LineItem API endpoints."""

    def test_list_line_items(self):
        """Test retrieving a list of line items."""
        url = reverse("lineitem-list")
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["item_name"], "Test Product")
        self.assertEqual(
            Decimal(response.data["results"][0]["amount"]), Decimal("1180.00")
        )

    def test_retrieve_line_item(self):
        """Test retrieving a single line item."""
        url = reverse("lineitem-detail", args=[self.line_item.id])
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["item_name"], "Test Product")
        self.assertEqual(response.data["hsn_code"], "711319")
        self.assertEqual(Decimal(response.data["quantity"]), Decimal("1.00"))
        self.assertEqual(Decimal(response.data["rate"]), Decimal("1000.00"))
        self.assertEqual(Decimal(response.data["amount"]), Decimal("1180.00"))

    def test_create_line_item(self):
        """Test creating a new line item."""
        url = reverse("lineitem-list")
        data = {
            "invoice": self.invoice.id,
            "item_name": "New Product",
            "hsn_code": "711319",
            "quantity": "2.00",
            "rate": "500.00",
            "amount": "1180.00",
            "amount_without_tax": "1000.00",
            "cgst_tax": "90.00",
            "sgst_tax": "90.00",
            "igst_tax": "0.00",
        }
        response = self.client.post(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(LineItem.objects.count(), 2)
        self.assertEqual(response.data["item_name"], "New Product")
        self.assertEqual(Decimal(response.data["quantity"]), Decimal("2.00"))
        self.assertEqual(Decimal(response.data["rate"]), Decimal("500.00"))

    def test_update_line_item(self):
        """Test updating an existing line item."""
        url = reverse("lineitem-detail", args=[self.line_item.id])
        data = {
            "invoice": self.invoice.id,
            "item_name": "Updated Product",
            "hsn_code": "711319",
            "quantity": "1.00",
            "rate": "1000.00",
            "amount": "1180.00",
            "amount_without_tax": "1000.00",
            "cgst_tax": "90.00",
            "sgst_tax": "90.00",
            "igst_tax": "0.00",
        }
        response = self.client.put(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.line_item.refresh_from_db()
        self.assertEqual(self.line_item.item_name, "Updated Product")

    def test_partial_update_line_item(self):
        """Test partially updating an existing line item."""
        url = reverse("lineitem-detail", args=[self.line_item.id])
        data = {"item_name": "Partially Updated Product"}
        response = self.client.patch(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.line_item.refresh_from_db()
        self.assertEqual(self.line_item.item_name, "Partially Updated Product")
        self.assertEqual(Decimal(self.line_item.rate), Decimal("1000.00"))  # Unchanged

    def test_delete_line_item(self):
        """Test deleting a line item."""
        url = reverse("lineitem-detail", args=[self.line_item.id])
        response = self.client.delete(url)

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(LineItem.objects.count(), 0)

    def test_filter_line_items_by_invoice(self):
        """Test filtering line items by invoice."""
        # Create another invoice and line item
        another_invoice = self.create_another_invoice()
        another_line_item = LineItem.objects.create(
            invoice=another_invoice,
            item_name="Another Product",
            hsn_code="711319",
            quantity=Decimal("3.00"),
            rate=Decimal("300.00"),
            amount=Decimal("1062.00"),
            amount_without_tax=Decimal("900.00"),
            cgst_tax=Decimal("81.00"),
            sgst_tax=Decimal("81.00"),
            igst_tax=Decimal("0.00"),
        )

        # Test filtering by the original invoice
        url = reverse("lineitem-list") + f"?invoice_id={self.invoice.id}"
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["item_name"], "Test Product")

        # Test filtering by the new invoice
        url = reverse("lineitem-list") + f"?invoice_id={another_invoice.id}"
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["item_name"], "Another Product")

    def test_create_line_item_for_invoice(self):
        """Test creating a line item for an invoice using the dedicated endpoint."""
        url = reverse("lineitem-create-for-invoice")
        data = {
            "invoice_id": self.invoice.id,
            "item_name": "API Created Product",
            "qty": "2.00",
            "rate": "500.00",
        }
        response = self.client.post(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(LineItem.objects.count(), 2)

        # Get the newly created line item
        new_line_item = LineItem.objects.exclude(id=self.line_item.id).first()
        self.assertEqual(new_line_item.item_name, "API Created Product")
        self.assertEqual(new_line_item.quantity, Decimal("2.00"))
        self.assertEqual(new_line_item.rate, Decimal("500.00"))

        # Check that the invoice total has been updated
        self.invoice.refresh_from_db()
        self.assertGreater(self.invoice.total_amount, Decimal("1180.00"))

    def create_another_invoice(self):
        """Helper method to create another invoice for testing."""
        return self.invoice.__class__.objects.create(
            invoice_number="INV-002",
            invoice_date="2023-02-01",
            business=self.business,
            customer=self.customer,
            type_of_invoice="outward",
            is_igst_applicable=False,
            total_amount=Decimal("0.00"),
        )
