from decimal import Decimal

from django.urls import reverse
from rest_framework import status

from billing.models import LineItem
from billing.tests.test_base import BaseAPITestCase


class LineItemInvoiceTotalTestCase(BaseAPITestCase):
    """Test case for verifying line item operations and invoice total amount updates."""

    def test_invoice_total_updates_on_line_item_addition(self):
        """Test that invoice total amount updates when a line item is added."""
        # Get the initial invoice total
        initial_total = self.invoice.total_amount

        # Create a new line item
        url = reverse("lineitem-list")
        data = {
            "invoice": self.invoice.id,
            "customer": self.customer.id,
            "product_name": "New Product",
            "hsn_code": "711319",
            "quantity": "2.00",
            "rate": "500.00",
            "amount": "1180.00",
            "gst_tax_rate": "0.18",
            "cgst": "90.00",
            "sgst": "90.00",
            "igst": "0.00",
        }
        response = self.client.post(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        # Refresh the invoice from the database
        self.invoice.refresh_from_db()

        # Check that the total has been updated
        self.assertNotEqual(self.invoice.total_amount, initial_total)
        self.assertEqual(self.invoice.total_amount, initial_total + Decimal("1180.00"))

    def test_invoice_total_updates_on_line_item_deletion(self):
        """Test that invoice total amount updates when a line item is deleted."""
        # Get the initial invoice total
        initial_total = self.invoice.total_amount
        line_item_amount = self.line_item.amount

        # Delete the line item
        url = reverse("lineitem-detail", args=[self.line_item.id])
        response = self.client.delete(url)

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

        # Refresh the invoice from the database
        self.invoice.refresh_from_db()

        # Check that the total has been updated
        self.assertNotEqual(self.invoice.total_amount, initial_total)
        self.assertEqual(self.invoice.total_amount, initial_total - line_item_amount)

    def test_invoice_total_updates_on_line_item_update(self):
        """Test that invoice total amount updates when a line item is updated."""
        # Get the initial invoice total
        initial_total = self.invoice.total_amount

        # Update the line item
        url = reverse("lineitem-detail", args=[self.line_item.id])
        data = {
            "invoice": self.invoice.id,
            "customer": self.customer.id,
            "product_name": "Updated Product",
            "hsn_code": "711319",
            "quantity": "2.00",  # Changed from 1.00
            "rate": "1000.00",
            "amount": "2360.00",  # Changed from 1180.00
            "gst_tax_rate": "0.18",
            "cgst": "180.00",  # Changed from 90.00
            "sgst": "180.00",  # Changed from 90.00
            "igst": "0.00",
        }
        response = self.client.put(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        # Refresh the invoice from the database
        self.invoice.refresh_from_db()

        # Check that the total has been updated
        self.assertNotEqual(self.invoice.total_amount, initial_total)
        self.assertEqual(self.invoice.total_amount, Decimal("2360.00"))

    def test_multiple_line_items_total(self):
        """Test that invoice total is correct with multiple line items."""
        # Create a second line item
        line_item2 = LineItem.objects.create(
            invoice=self.invoice,
            customer=self.customer,
            product_name="Second Product",
            hsn_code="711319",
            quantity=Decimal("2.00"),
            rate=Decimal("500.00"),
            amount=Decimal("1180.00"),
            gst_tax_rate=Decimal("0.18"),
            cgst=Decimal("90.00"),
            sgst=Decimal("90.00"),
            igst=Decimal("0.00"),
        )

        # Create a third line item
        line_item3 = LineItem.objects.create(
            invoice=self.invoice,
            customer=self.customer,
            product_name="Third Product",
            hsn_code="711319",
            quantity=Decimal("3.00"),
            rate=Decimal("300.00"),
            amount=Decimal("1062.00"),
            gst_tax_rate=Decimal("0.18"),
            cgst=Decimal("81.00"),
            sgst=Decimal("81.00"),
            igst=Decimal("0.00"),
        )

        # Refresh the invoice from the database
        self.invoice.refresh_from_db()

        # Calculate the expected total
        expected_total = self.line_item.amount + line_item2.amount + line_item3.amount

        # Check that the total is correct
        self.assertEqual(self.invoice.total_amount, expected_total)

    def test_nested_line_item_endpoint(self):
        """Test the nested line item endpoint for adding line items to an invoice."""
        # Get the initial invoice total
        initial_total = self.invoice.total_amount

        # Add a line item using the nested endpoint
        url = reverse("invoice-line-items", args=[self.invoice.id])
        data = {
            "product_name": "Nested Product",
            "quantity": "2.00",
            "rate": "500.00",
            "hsn_code": "711319",
            "gst_tax_rate": "0.18",
        }
        response = self.client.post(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        # Refresh the invoice from the database
        self.invoice.refresh_from_db()

        # Check that the total has been updated
        self.assertNotEqual(self.invoice.total_amount, initial_total)

        # Get the new line item
        new_line_item = LineItem.objects.get(product_name="Nested Product")

        # Check that the line item was created correctly
        self.assertEqual(new_line_item.invoice_id, self.invoice.id)
        self.assertEqual(new_line_item.quantity, Decimal("2.00"))
        self.assertEqual(new_line_item.rate, Decimal("500.00"))

        # Check that the invoice total includes the new line item
        self.assertEqual(
            self.invoice.total_amount, initial_total + new_line_item.amount
        )
