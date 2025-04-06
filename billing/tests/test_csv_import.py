import io
import uuid

from django.contrib.auth.models import User
from django.test import TransactionTestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from billing.models import Business, Customer, Invoice, LineItem


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
