import io
import uuid

from django.contrib.auth.models import User
from django.test import TransactionTestCase
from django.urls import reverse
from freezegun import freeze_time
from rest_framework import status
from rest_framework.test import APIClient

from billing.models import Business, Customer, Invoice, LineItem
from billing.utils import process_invoice_csv


class CSVImportTestCase(TransactionTestCase):
    """
    Test cases for CSV import functionality.
    Using TransactionTestCase to ensure database is reset between tests.
    """

    def setUp(self):
        # Create a client for making requests
        self.client = APIClient()

        # Create and authenticate a test user
        self.user = User.objects.create_user(
            username="testuser", email="test@example.com", password="testpassword"
        )
        self.client.force_authenticate(user=self.user)

        # Create a business for testing with a unique name
        unique_name = f"Test Business {uuid.uuid4().hex[:8]}"
        self.business = Business.objects.create(
            name=unique_name,
            address="123 Test St",
            state_name="Test State",
            gst_number="27AADCB2230M1Z3",
        )

        # Create a customer for the imported invoices
        self.customer = Customer.objects.create(
            name="Test Customer",
            address="456 Customer St",
            state_name="Test State",
            gst_number="27AADCB2230M1Z4",
        )

        # URL for testing
        self.csv_import_url = reverse("csv-import")

    def tearDown(self):
        # Clean up all created objects after each test
        LineItem.objects.all().delete()
        Invoice.objects.all().delete()

    def test_process_invoice_csv_with_nonexistent_customer(self):
        """Test that process_invoice_csv raises an error when customer doesn't exist."""
        # Create a sample CSV content with a non-existent customer
        csv_content = (
            "invoice_number,invoice_date,customer_name,product_name,quantity,rate,hsn_code,gst_tax_rate\n"
            "1001,2023-01-15,Non Existent Customer,Gold Ring,10.5,4500,711319,0.03\n"
        )

        # Process the CSV content
        result = process_invoice_csv(csv_content.encode("utf-8"), self.business.id)

        # Check that no invoices were created
        self.assertEqual(result["invoices_created"], 0)
        self.assertEqual(result["line_items_created"], 0)

        # Check that an error was reported
        self.assertEqual(len(result["errors"]), 1)
        self.assertIn(
            "Customer 'Non Existent Customer' does not exist in the database",
            result["errors"][0],
        )

        # Verify no invoice was created in the database
        self.assertEqual(Invoice.objects.count(), 0)

    def test_process_invoice_csv_with_missing_invoice_number(self):
        """Test that process_invoice_csv reports an error when invoice number is missing."""
        # Create a sample CSV content with missing invoice number
        csv_content = (
            "invoice_number,invoice_date,customer_name,product_name,quantity,rate,hsn_code,gst_tax_rate\n"
            ",2023-05-15,Test Customer,Gold Ring,10.5,4500,711319,0.03\n"
        )

        # Process the CSV content
        result = process_invoice_csv(csv_content.encode("utf-8"), self.business.id)

        # Check that no invoices were created
        self.assertEqual(result["invoices_created"], 0)
        self.assertEqual(result["line_items_created"], 0)

        # Check that an error was reported
        self.assertEqual(len(result["errors"]), 1)
        self.assertIn("Missing invoice number", result["errors"][0])

        # Verify no invoice was created in the database
        self.assertEqual(Invoice.objects.count(), 0)

    def test_csv_import_endpoint(self):
        """Test the new CSV import endpoint."""
        # Create a sample CSV file
        csv_content = (
            "invoice_number,invoice_date,customer_name,product_name,quantity,rate,hsn_code,gst_tax_rate\n"
            "1001,2023-01-15,Test Customer,Gold Ring,10.5,4500,711319,0.03\n"
            "1001,2023-01-15,Test Customer,Gold Chain,5.2,4800,711319,0.03\n"
        )
        csv_file = io.StringIO(csv_content)
        csv_file.name = "test_import.csv"

        # Prepare the request data
        data = {
            "file": csv_file,
            "business_id": self.business.id,
        }

        # Make the request
        response = self.client.post(
            self.csv_import_url,
            data,
            format="multipart",
        )

        # Check the response
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn("invoices_created", response.data)
        self.assertIn("line_items_created", response.data)

        # Verify that the invoice was created
        self.assertEqual(Invoice.objects.count(), 1)
        invoice = Invoice.objects.first()
        self.assertEqual(invoice.invoice_number, "1001")

        # Verify that the line items were created
        self.assertEqual(LineItem.objects.count(), 2)
        line_items = LineItem.objects.all()
        self.assertEqual(line_items[0].product_name, "Gold Ring")
        self.assertEqual(line_items[1].product_name, "Gold Chain")

    def test_csv_import_invalid_file(self):
        """Test CSV import with an invalid file."""
        # Create a non-CSV file
        file_content = "This is not a CSV file"
        test_file = io.StringIO(file_content)
        test_file.name = "test.txt"

        # Prepare the request data
        data = {
            "file": test_file,
            "business_id": self.business.id,
        }

        # Make the request
        response = self.client.post(
            self.csv_import_url,
            data,
            format="multipart",
        )

        # Check the response
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("error", response.data)
        self.assertEqual(response.data["error"], "File must be a CSV file")

    def test_csv_import_missing_business_id(self):
        """Test CSV import with missing business ID."""
        # Create a sample CSV file
        csv_content = (
            "invoice_number,invoice_date,customer_name,product_name,quantity,rate,hsn_code,gst_tax_rate\n"
            "1003,2023-01-25,Test Customer,Gold Earrings,3.5,5000,711319,0.03\n"
        )
        csv_file = io.StringIO(csv_content)
        csv_file.name = "test_import.csv"

        # Prepare the request data without business_id
        data = {
            "file": csv_file,
        }

        # Make the request
        response = self.client.post(
            self.csv_import_url,
            data,
            format="multipart",
        )

        # Check the response
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("error", response.data)
        self.assertEqual(response.data["error"], "Business ID is required")

    def test_csv_import_with_nonexistent_customer(self):
        """Test CSV import with a customer that doesn't exist in the database."""
        # Create a sample CSV file with non-existent customer
        csv_content = (
            "invoice_number,invoice_date,customer_name,product_name,quantity,rate,hsn_code,gst_tax_rate\n"
            "1003,2023-01-25,Non Existent Customer,Gold Earrings,3.5,5000,711319,0.03\n"
        )
        csv_file = io.StringIO(csv_content)
        csv_file.name = "test_import.csv"

        # Prepare the request data
        data = {
            "file": csv_file,
            "business_id": self.business.id,
        }

        # Make the request
        response = self.client.post(
            self.csv_import_url,
            data,
            format="multipart",
        )

        # Check the response - should be successful but with errors in the result
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["invoices_created"], 0)
        self.assertEqual(response.data["line_items_created"], 0)
        self.assertIn("errors", response.data)
        self.assertEqual(len(response.data["errors"]), 1)
        self.assertIn(
            "Customer 'Non Existent Customer' does not exist in the database",
            response.data["errors"][0],
        )

    def test_csv_import_with_missing_invoice_number(self):
        """Test CSV import with missing invoice number."""
        # Create a sample CSV file with missing invoice number
        csv_content = (
            "invoice_number,invoice_date,customer_name,product_name,quantity,rate,hsn_code,gst_tax_rate\n"
            ",2023-05-15,Test Customer,Gold Ring,10.5,4500,711319,0.03\n"
        )
        csv_file = io.StringIO(csv_content)
        csv_file.name = "test_import.csv"

        # Prepare the request data
        data = {
            "file": csv_file,
            "business_id": self.business.id,
        }

        # Make the request
        response = self.client.post(
            self.csv_import_url,
            data,
            format="multipart",
        )

        # Check the response - should be successful but with errors in the result
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(
            response.data["invoices_created"], 0
        )  # No invoices should be created
        self.assertEqual(response.data["line_items_created"], 0)
        self.assertIn("errors", response.data)
        self.assertEqual(len(response.data["errors"]), 1)
        self.assertIn("Missing invoice number", response.data["errors"][0])

    @freeze_time("2023-06-01")
    def test_csv_import_with_duplicate_invoice_number_same_fy(self):
        """Test CSV import with a duplicate invoice number in the same financial year."""
        # Create an existing invoice in the current financial year
        Invoice.objects.create(
            invoice_number="1001",
            invoice_date="2023-04-01",  # Start of financial year 2023-24
            business=self.business,
            customer=self.customer,
            type_of_invoice="outward",
        )

        # Create a sample CSV file with the same invoice number
        csv_content = (
            "invoice_number,invoice_date,customer_name,product_name,quantity,rate,hsn_code,gst_tax_rate\n"
            "1001,2023-05-15,Test Customer,Gold Ring,10.5,4500,711319,0.03\n"
        )
        csv_file = io.StringIO(csv_content)
        csv_file.name = "test_import.csv"

        # Prepare the request data
        data = {
            "file": csv_file,
            "business_id": self.business.id,
        }

        # Make the request
        response = self.client.post(
            self.csv_import_url,
            data,
            format="multipart",
        )

        # Check the response - should be successful but with errors in the result
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(
            response.data["invoices_created"], 0
        )  # No new invoices should be created
        self.assertEqual(response.data["line_items_created"], 0)
        self.assertIn("errors", response.data)
        self.assertEqual(len(response.data["errors"]), 1)
        self.assertIn(
            "Duplicate invoice numbers found in the same financial year",
            response.data["errors"][0],
        )

        # Verify no new invoice was created
        self.assertEqual(Invoice.objects.count(), 1)  # Only the one we created above

    @freeze_time("2023-06-01")
    def test_csv_import_with_duplicate_invoice_number_different_fy(self):
        """Test CSV import with a duplicate invoice number but in a different financial year."""
        # Create an existing invoice in the previous financial year
        Invoice.objects.create(
            invoice_number="1001",
            invoice_date="2022-04-01",  # Previous financial year 2022-23
            business=self.business,
            customer=self.customer,
            type_of_invoice="outward",
        )

        # Create a sample CSV file with the same invoice number but current FY
        csv_content = (
            "invoice_number,invoice_date,customer_name,product_name,quantity,rate,hsn_code,gst_tax_rate\n"
            "1001,2023-05-15,Test Customer,Gold Ring,10.5,4500,711319,0.03\n"
        )
        csv_file = io.StringIO(csv_content)
        csv_file.name = "test_import.csv"

        # Prepare the request data
        data = {
            "file": csv_file,
            "business_id": self.business.id,
        }

        # Make the request
        response = self.client.post(
            self.csv_import_url,
            data,
            format="multipart",
        )

        # Check the response - should be successful with no errors
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(
            response.data["invoices_created"], 1
        )  # New invoice should be created
        self.assertEqual(response.data["line_items_created"], 1)
        self.assertEqual(len(response.data["errors"]), 0)  # No errors

        # Verify a new invoice was created
        self.assertEqual(Invoice.objects.count(), 2)  # Both the old and new invoice
