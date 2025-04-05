from django.urls import reverse
from rest_framework import status

from billing.models import Business
from billing.tests.test_base import BaseAPITestCase


class BusinessAPITestCase(BaseAPITestCase):
    """Test case for Business API endpoints."""

    def test_list_businesses(self):
        """Test retrieving a list of businesses."""
        url = reverse("business-list")
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["name"], "Test Business")
        self.assertEqual(response.data["results"][0]["gst_number"], "22AAAAA0000A1Z5")

    def test_retrieve_business(self):
        """Test retrieving a single business."""
        url = reverse("business-detail", args=[self.business.id])
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["name"], "Test Business")
        self.assertEqual(response.data["gst_number"], "22AAAAA0000A1Z5")
        self.assertEqual(response.data["state_name"], "MAHARASHTRA")
        self.assertEqual(response.data["mobile_number"], "9876543210")

    def test_create_business(self):
        """Test creating a new business."""
        url = reverse("business-list")
        data = {
            "name": "New Business",
            "address": "789 New Street",
            "gst_number": "22CCCCC0000C1Z5",
            "state_name": "GUJARAT",
            "mobile_number": "9876543212",
            "pan_number": "FGHIJ5678K",
            "bank_name": "New Bank",
            "bank_account_number": "0987654321",
            "bank_ifsc_code": "NEW0001234",
            "bank_branch_name": "New Branch",
        }
        response = self.client.post(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, msg=response.json())
        self.assertEqual(Business.objects.count(), 2)
        self.assertEqual(response.data["name"], "New Business")
        self.assertEqual(response.data["gst_number"], "22CCCCC0000C1Z5")

    def test_update_business(self):
        """Test updating an existing business."""
        url = reverse("business-detail", args=[self.business.id])
        data = {
            "name": "Updated Business",
            "address": "123 Test Street",
            "gst_number": "22AAAAA0000A1Z5",
            "state_name": "DELHI",
            "mobile_number": "9876543210",
        }
        response = self.client.put(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK, msg=response.json())
        self.business.refresh_from_db()
        self.assertEqual(self.business.name, "Updated Business")
        self.assertEqual(self.business.state_name, "DELHI")

    def test_partial_update_business(self):
        """Test partially updating an existing business."""
        url = reverse("business-detail", args=[self.business.id])
        data = {"name": "Partially Updated Business"}
        response = self.client.patch(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.business.refresh_from_db()
        self.assertEqual(self.business.name, "Partially Updated Business")
        self.assertEqual(self.business.gst_number, "22AAAAA0000A1Z5")  # Unchanged

    def test_delete_business(self):
        """Test deleting a business."""
        url = reverse("business-detail", args=[self.business.id])
        response = self.client.delete(url)

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(Business.objects.count(), 0)

    def test_search_business(self):
        """Test searching for businesses."""
        # Create another business for testing search
        Business.objects.create(
            name="Another Business",
            address="456 Another Street",
            gst_number="22DDDDD0000D1Z5",
        )

        url = reverse("business-list") + "?search=Test"
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["name"], "Test Business")

        url = reverse("business-list") + "?search=Another"
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["name"], "Another Business")
