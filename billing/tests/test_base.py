import importlib.util
import os
from contextlib import contextmanager
from decimal import Decimal
from pathlib import Path
from unittest import mock

from django.contrib.auth.models import Group, User
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils.module_loading import import_string
from rest_framework.test import APIClient
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from billing.constants import INVOICE_TYPE_OUTWARD
from billing.models import Business, Customer, Invoice, LineItem, Product

PRODUCTION_SETTINGS = Path(__file__).resolve().parents[2] / "gst_billing" / "production_settings.py"


def load_production_settings(**env):
    """A fresh copy of gst_billing.production_settings, evaluated under `env`.

    The suite runs under test_settings, which imports the dev settings and
    switches throttling off, so nothing exercised what the image actually
    runs. Pass env vars as the container would see them; None unsets one.
    """
    env = {"DJANGO_SECRET_KEY": "test-only-not-secret", **env}
    with mock.patch.dict(os.environ):
        for key, value in env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        spec = importlib.util.spec_from_file_location("production_settings_under_test", PRODUCTION_SETTINGS)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module


@contextmanager
def production_throttling(**env):
    """Serve requests under production's REST_FRAMEWORK throttling.

    override_settings alone can't do it: DRF binds APIView.throttle_classes
    and SimpleRateThrottle.THROTTLE_RATES when it is first imported (under
    test settings, where throttling is off), so both are patched as well.
    Throttle history lives in the cache, which is cleared on the way in and out.
    """
    prod = load_production_settings(**env)
    rf = prod.REST_FRAMEWORK
    classes = [import_string(path) for path in rf["DEFAULT_THROTTLE_CLASSES"]]
    cache.clear()
    try:
        with override_settings(REST_FRAMEWORK=rf), \
                mock.patch.object(APIView, "throttle_classes", classes), \
                mock.patch.object(SimpleRateThrottle, "THROTTLE_RATES", rf["DEFAULT_THROTTLE_RATES"]):
            yield prod
    finally:
        cache.clear()


class BaseAPITestCase(TestCase):
    """Base test case for API tests with common setup methods."""

    def setUp(self):
        """Set up test data and authenticate the client."""
        self.client = APIClient()

        # Create a test user
        self.user = User.objects.create_user(
            username="testuser", email="test@example.com", password="testpassword"
        )

        # Assign admin role so all operations are permitted
        admin_group, _ = Group.objects.get_or_create(name="admin")
        self.user.groups.add(admin_group)

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
            state_name="MAHARASHTRA",
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
            state_name="MAHARASHTRA",
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

        # Update the invoice total amount
        self.invoice.save()
