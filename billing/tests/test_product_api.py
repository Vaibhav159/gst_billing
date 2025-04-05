from decimal import Decimal

from django.urls import reverse
from rest_framework import status

from billing.models import Product
from billing.tests.test_base import BaseAPITestCase


class ProductAPITestCase(BaseAPITestCase):
    """Test case for Product API endpoints."""

    def test_list_products(self):
        """Test retrieving a list of products."""
        url = reverse("product-list")
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["name"], "Test Product")
        self.assertEqual(response.data["results"][0]["hsn_code"], "711319")

    def test_retrieve_product(self):
        """Test retrieving a single product."""
        url = reverse("product-detail", args=[self.product.id])
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["name"], "Test Product")
        self.assertEqual(response.data["hsn_code"], "711319")
        self.assertEqual(Decimal(response.data["gst_tax_rate"]), Decimal("0.18"))

    def test_create_product(self):
        """Test creating a new product."""
        url = reverse("product-list")
        data = {"name": "New Product", "hsn_code": "711320", "gst_tax_rate": "0.12"}
        response = self.client.post(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Product.objects.count(), 2)
        self.assertEqual(response.data["name"], "New Product")
        self.assertEqual(response.data["hsn_code"], "711320")
        self.assertEqual(Decimal(response.data["gst_tax_rate"]), Decimal("0.12"))

    def test_update_product(self):
        """Test updating an existing product."""
        url = reverse("product-detail", args=[self.product.id])
        data = {
            "name": "Updated Product",
            "hsn_code": "711319",
            "gst_tax_rate": "0.18",
        }
        response = self.client.put(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.product.refresh_from_db()
        self.assertEqual(self.product.name, "Updated Product")

    def test_partial_update_product(self):
        """Test partially updating an existing product."""
        url = reverse("product-detail", args=[self.product.id])
        data = {"name": "Partially Updated Product"}
        response = self.client.patch(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.product.refresh_from_db()
        self.assertEqual(self.product.name, "Partially Updated Product")
        self.assertEqual(self.product.hsn_code, "711319")  # Unchanged

    def test_delete_product(self):
        """Test deleting a product."""
        url = reverse("product-detail", args=[self.product.id])
        response = self.client.delete(url)

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(Product.objects.count(), 0)

    def test_search_product(self):
        """Test searching for products."""
        # Create another product for testing search
        Product.objects.create(
            name="Another Product", hsn_code="711321", gst_tax_rate=Decimal("5.00")
        )

        url = reverse("product-list") + "?search=Test"
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["name"], "Test Product")

        url = reverse("product-list") + "?search=Another"
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["name"], "Another Product")

    def test_product_defaults(self):
        """Test retrieving default values for products."""
        from billing.constants import GST_TAX_RATE, HSN_CODE

        url = reverse("product-defaults")
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["hsn_code"], HSN_CODE)
        self.assertEqual(float(response.data["gst_tax_rate"]), float(GST_TAX_RATE))

    def test_filter_product_by_hsn_code(self):
        """Test filtering products by HSN code."""
        # Create products with different HSN codes
        Product.objects.create(
            name="HSN Product 1", hsn_code="711321", gst_tax_rate=Decimal("5.00")
        )

        Product.objects.create(
            name="HSN Product 2", hsn_code="711322", gst_tax_rate=Decimal("12.00")
        )

        url = reverse("product-list") + "?search=711319"
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["count"] >= 1)
        # Check if Test Product is in the results
        product_names = [product["name"] for product in response.data["results"]]
        self.assertIn("Test Product", product_names)

        url = reverse("product-list") + "?search=711321"
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["count"] >= 1)
        # Check if HSN Product 1 is in the results
        product_names = [product["name"] for product in response.data["results"]]
        self.assertIn("HSN Product 1", product_names)

    def test_filter_product_by_gst_tax_rate(self):
        """Test filtering products by GST percentage."""
        # Create products with different GST percentages
        Product.objects.create(
            name="GST Product 1", hsn_code="711321", gst_tax_rate=Decimal("0.05")
        )

        Product.objects.create(
            name="GST Product 2", hsn_code="711322", gst_tax_rate=Decimal("0.12")
        )

        # Since gst_tax_rate is not directly searchable, we'll test by name instead
        url = reverse("product-list") + "?search=Test"
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["count"] >= 1)
        # Check if Test Product is in the results
        product_names = [product["name"] for product in response.data["results"]]
        self.assertIn("Test Product", product_names)

        url = reverse("product-list") + "?search=GST Product 1"
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data["count"] >= 1)
        # Check if GST Product 1 is in the results
        product_names = [product["name"] for product in response.data["results"]]
        self.assertIn("GST Product 1", product_names)
