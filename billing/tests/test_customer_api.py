from django.urls import reverse
from rest_framework import status

from billing.models import Business, Customer
from billing.tests.test_base import BaseAPITestCase


class CustomerAPITestCase(BaseAPITestCase):
    """Test case for Customer API endpoints."""

    def test_list_customers(self):
        """Test retrieving a list of customers."""
        url = reverse("customer-list")
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["name"], "Test Customer")
        self.assertEqual(response.data["results"][0]["gst_number"], "22BBBBB0000B1Z5")

    def test_retrieve_customer(self):
        """Test retrieving a single customer."""
        url = reverse("customer-detail", args=[self.customer.id])
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["name"], "Test Customer")
        self.assertEqual(response.data["gst_number"], "22BBBBB0000B1Z5")
        self.assertEqual(response.data["state_name"], "MAHARASHTRA")
        self.assertEqual(response.data["mobile_number"], "9876543211")
        self.assertIn(self.business.id, response.data["businesses"])

    def test_create_customer(self):
        """Test creating a new customer."""
        url = reverse("customer-list")
        data = {
            "name": "New Customer",
            "address": "789 New Avenue",
            "gst_number": "22EEEEE0000E1Z5",
            "state_name": "GUJARAT",
            "mobile_number": "9876543213",
            "businesses": [self.business.id],
        }
        response = self.client.post(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Customer.objects.count(), 2)
        self.assertEqual(response.data["name"], "New Customer")
        self.assertEqual(response.data["gst_number"], "22EEEEE0000E1Z5")
        self.assertIn(self.business.id, response.data["businesses"])

    def test_update_customer(self):
        """Test updating an existing customer."""
        url = reverse("customer-detail", args=[self.customer.id])
        data = {
            "name": "Updated Customer",
            "address": "456 Test Avenue",
            "gst_number": "22BBBBB0000B1Z5",
            "state_name": "DELHI",
            "mobile_number": "9876543211",
            "businesses": [self.business.id],
        }
        response = self.client.put(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.name, "Updated Customer")
        self.assertEqual(self.customer.state_name, "DELHI")

    def test_partial_update_customer(self):
        """Test partially updating an existing customer."""
        url = reverse("customer-detail", args=[self.customer.id])
        data = {"name": "Partially Updated Customer"}
        response = self.client.patch(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.name, "Partially Updated Customer")
        self.assertEqual(self.customer.gst_number, "22BBBBB0000B1Z5")  # Unchanged

    def test_delete_customer(self):
        """Test deleting a customer."""
        url = reverse("customer-detail", args=[self.customer.id])
        response = self.client.delete(url)

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(Customer.objects.count(), 0)

    def test_search_customer(self):
        """Test searching for customers."""
        # Create another customer for testing search
        new_customer = Customer.objects.create(
            name="Another Customer",
            address="456 Another Avenue",
            gst_number="22FFFFF0000F1Z5",
            state_name="TELANGANA",
        )
        new_customer.businesses.add(self.business)

        url = reverse("customer-list") + "?search=Test"
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["name"], "Test Customer")

        url = reverse("customer-list") + "?search=Another"
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["name"], "Another Customer")

    def test_filter_customer_by_business(self):
        """Test filtering customers by business."""
        # Create another business and customer
        another_business = Business.objects.create(
            name="Another Business",
            address="456 Another Street",
            gst_number="22DDDDD0000D1Z5",
            state_name="KARNATAKA",
        )

        another_customer = Customer.objects.create(
            name="Business-specific Customer",
            address="789 Specific Avenue",
            gst_number="22GGGGG0000G1Z5",
            state_name="KARNATAKA",
        )
        another_customer.businesses.add(another_business)

        # Test filtering by the original business
        url = reverse("customer-list") + f"?business_id={self.business.id}"
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["name"], "Test Customer")

        # Test filtering by the new business
        url = reverse("customer-list") + f"?business_id={another_business.id}"
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(
            response.data["results"][0]["name"], "Business-specific Customer"
        )
