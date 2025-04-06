from django.urls import reverse
from rest_framework import status

from billing.tests.test_base import BaseAPITestCase


class ReportAPITestCase(BaseAPITestCase):
    """Test case for Report API endpoints."""

    def test_get_csrf_token(self):
        """Test getting a CSRF token for report generation."""
        url = reverse("generate-report")
        response = self.client.get(url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["message"], "Report API ready")

    def test_generate_report_without_dates(self):
        """Test generating a report without providing dates."""
        url = reverse("generate-report")
        response = self.client.post(url, {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["error"], "Start date and end date are required")

    def test_generate_report_with_dates(self):
        """Test generating a report with valid dates."""
        url = reverse("generate-report")
        data = {
            "start_date": "2023-01-01",
            "end_date": "2023-01-31",
            "invoice_type": "both",
        }
        response = self.client.post(url, data, format="json")

        # The response should be a file download
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response["Content-Type"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        self.assertTrue("attachment; filename=" in response["Content-Disposition"])

    def test_generate_report_with_outward_type(self):
        """Test generating a report with outward invoice type."""
        url = reverse("generate-report")
        data = {
            "start_date": "2023-01-01",
            "end_date": "2023-01-31",
            "invoice_type": "outward",
        }
        response = self.client.post(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response["Content-Type"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

    def test_generate_report_with_inward_type(self):
        """Test generating a report with inward invoice type."""
        url = reverse("generate-report")
        data = {
            "start_date": "2023-01-01",
            "end_date": "2023-01-31",
            "invoice_type": "inward",
        }
        response = self.client.post(url, data, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response["Content-Type"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
