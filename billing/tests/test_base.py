from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from billing.constants import INVOICE_TYPE_OUTWARD
from billing.models import Business, Customer, Invoice, LineItem, Product


class BaseAPITestCase(TestCase):
    """Base test case for API tests with common setup methods."""

    def setUp(self):
        """Set up test data and authenticate the client."""
        self.client = APIClient()

        # Create a test user
        self.user = User.objects.create_user(
            username="testuser", email="test@example.com", password="testpassword"
        )

        # Authenticate the client
        self.client.force_authenticate(user=self.user)

        # Create test data
        self.create_test_data()

    def create_test_data(self):
        """Create test data for use in tests."""
        # Create a test business
        self.business = Business.objects.create(
            name="Test Business",
            address="123 Test Street",
            gst_number="22AAAAA0000A1Z5",
            state_name="Test State",
            mobile_number="9876543210",
            pan_number="ABCDE1234F",
            bank_name="Test Bank",
            bank_account_number="1234567890",
            bank_ifsc_code="TEST0001234",
            bank_branch_name="Test Branch",
        )

        # Create a test customer
        self.customer = Customer.objects.create(
            name="Test Customer",
            address="456 Test Avenue",
            gst_number="22BBBBB0000B1Z5",
            state_name="Test State",
            mobile_number="9876543211",
        )
        self.customer.businesses.add(self.business)

        # Create a test product
        self.product = Product.objects.create(
            name="Test Product", hsn_code="711319", gst_tax_rate=Decimal("0.18")
        )

        # Create a test invoice
        self.invoice = Invoice.objects.create(
            invoice_number="INV-001",
            invoice_date="2023-01-01",
            business=self.business,
            customer=self.customer,
            type_of_invoice=INVOICE_TYPE_OUTWARD,
            total_amount=Decimal("1180.00"),
        )

        # Create a test line item
        self.line_item = LineItem.objects.create(
            invoice=self.invoice,
            customer=self.customer,
            product_name="Test Product",
            hsn_code="711319",
            quantity=Decimal("1.00"),
            rate=Decimal("1000.00"),
            amount=Decimal("1180.00"),
            gst_tax_rate=Decimal("0.18"),
            cgst=Decimal("90.00"),
            sgst=Decimal("90.00"),
            igst=Decimal("0.00"),
        )
