"""Signed media URLs — bill scans stopped being public the day this landed.

The signature is the credential (img/iframe tags can't carry JWT headers),
so the tests pin exactly what the signature must and must not allow.
"""

import json
import re
import shutil
import tempfile
from pathlib import Path

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.signing import TimestampSigner
from django.test import RequestFactory, SimpleTestCase, override_settings
from django.urls import reverse
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.test import APIClient
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from billing.api.media import sign_media_path
from billing.tests.test_base import BaseAPITestCase, production_throttling

_MEDIA = tempfile.mkdtemp(prefix="signed_media_test_")


@override_settings(MEDIA_ROOT=_MEDIA)
class SignedMediaTest(BaseAPITestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        (Path(_MEDIA) / "inward_bills").mkdir(parents=True, exist_ok=True)
        (Path(_MEDIA) / "inward_bills" / "scan.pdf").write_bytes(b"%PDF-1.4 test-bytes")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(_MEDIA, ignore_errors=True)
        super().tearDownClass()

    def _get(self, url):
        # No auth on purpose: the browser fetches these as bare <img>/<iframe>
        # requests. The signature must be sufficient — and necessary.
        from rest_framework.test import APIClient

        return APIClient().get(url)

    def test_signed_url_serves_the_file_without_login(self):
        url = sign_media_path("inward_bills/scan.pdf")
        resp = self._get(url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(b"".join(resp.streaming_content), b"%PDF-1.4 test-bytes")
        self.assertIn("application/pdf", resp["Content-Type"])
        self.assertIn("private", resp["Cache-Control"])

    def test_no_signature_is_forbidden(self):
        resp = self._get("/api/media/inward_bills/scan.pdf")
        self.assertEqual(resp.status_code, 403)

    def test_tampered_signature_is_forbidden(self):
        url = sign_media_path("inward_bills/scan.pdf")
        resp = self._get(url[:-4] + "XXXX")
        self.assertEqual(resp.status_code, 403)

    def test_signature_for_one_file_cannot_fetch_another(self):
        (Path(_MEDIA) / "inward_bills" / "other.pdf").write_bytes(b"other")
        good = sign_media_path("inward_bills/scan.pdf")
        token = good.split("?s=")[1]
        resp = self._get(f"/api/media/inward_bills/other.pdf?s={token}")
        self.assertEqual(resp.status_code, 403)

    def test_expired_signature_is_forbidden(self):
        from datetime import timedelta

        from django.core import signing

        old = TimestampSigner(salt="billing.media")
        # Forge an old timestamp by patching the signer's clock via freezegun-free
        # trick: sign, then assert unsign with tiny max_age rejects it.
        token = old.sign("inward_bills/scan.pdf")
        with self.settings():
            try:
                old.unsign(token, max_age=timedelta(seconds=-1))
                expired = False
            except signing.SignatureExpired:
                expired = True
        self.assertTrue(expired, "negative max_age must reject — expiry mechanism works")

    def test_traversal_paths_are_forbidden_even_if_signed(self):
        evil = "inward_bills/../../etc/passwd"
        signer = TimestampSigner(salt="billing.media")
        from urllib.parse import quote

        url = f"/api/media/{evil}?s={quote(signer.sign(evil))}"
        resp = self._get(url)
        self.assertEqual(resp.status_code, 403)

    @override_settings(MEDIA_ACCEL_REDIRECT=True)
    def test_production_mode_answers_with_accel_redirect(self):
        url = sign_media_path("inward_bills/scan.pdf")
        resp = self._get(url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["X-Accel-Redirect"], "/protected-media/inward_bills/scan.pdf")
        self.assertFalse(getattr(resp, "streaming", False), "nginx streams, not Django")

    def test_serializer_emits_signed_urls(self):
        from decimal import Decimal as D

        from django.core.files.uploadedfile import SimpleUploadedFile

        from billing.constants import INVOICE_TYPE_INWARD
        from billing.models import Invoice

        inv = Invoice.objects.create(
            workspace_id=1, business=self.business, customer=self.customer,
            invoice_number="SM-1", invoice_date="2026-08-01",
            type_of_invoice=INVOICE_TYPE_INWARD, total_amount=D("0"),
        )
        inv.source_file.save("bill.pdf", SimpleUploadedFile("bill.pdf", b"%PDF"), save=True)
        resp = self.client.get(reverse("inward-bill-detail", args=[inv.id]))
        self.assertEqual(resp.status_code, 200)
        url = resp.data["source_file_url"]
        self.assertTrue(url.startswith("/api/media/"), url)
        self.assertIn("?s=", url)
        self.assertNotIn("/media/", url.split("?")[0].replace("/api/media/", ""), "no public /media/ leak")
        # And the minted URL actually works, unauthenticated:
        self.assertEqual(self._get(url).status_code, 200)


class MediaHardeningTest(SignedMediaTest):
    """C2: an uploaded file must never run as a document at the app origin."""

    def test_pdf_stays_inline_but_carries_a_no_script_csp(self):
        resp = self._get(sign_media_path("inward_bills/scan.pdf"))
        self.assertEqual(resp["Content-Security-Policy"], "default-src 'none'")
        self.assertEqual(resp["X-Content-Type-Options"], "nosniff")
        self.assertTrue(resp["Content-Disposition"].startswith("inline;"))

    def test_anything_else_is_a_download(self):
        (Path(_MEDIA) / "inward_bills" / "evil.html").write_bytes(b"<script>alert(1)</script>")
        resp = self._get(sign_media_path("inward_bills/evil.html"))
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp["Content-Disposition"].startswith("attachment;"))
        self.assertEqual(resp["Content-Security-Policy"], "default-src 'none'")


class _PlainAnonymousView(APIView):
    """Any other unauthenticated endpoint: what the anonymous limit is for."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        return Response({})


@override_settings(MEDIA_ROOT=_MEDIA)
class SignedMediaThrottleTest(SimpleTestCase):
    """H2: production's AnonRateThrottle (100 a day) applied to signed media,
    so after about 100 thumbnails and previews every bill image answered 429
    for a rolling 24 hours. The signature is the credential here."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        (Path(_MEDIA) / "captures").mkdir(parents=True, exist_ok=True)
        (Path(_MEDIA) / "captures" / "bill.jpg").write_bytes(b"\xff\xd8\xff jpeg-bytes")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(_MEDIA, ignore_errors=True)
        super().tearDownClass()

    def test_bill_images_do_not_spend_the_anonymous_daily_budget(self):
        url = sign_media_path("captures/bill.jpg")
        with production_throttling():
            budget = AnonRateThrottle().num_requests  # production: 100 a day
            media = [APIClient().get(url).status_code for _ in range(budget + 5)]
            plain = _PlainAnonymousView.as_view()
            other = [plain(RequestFactory().get("/other")).status_code for _ in range(budget + 1)]
        self.assertEqual(media, [200] * (budget + 5))
        # The anonymous limit still holds for everything else, and the image
        # fetches above spent none of it.
        self.assertEqual(other, [200] * budget + [429])


@override_settings(MEDIA_ROOT=_MEDIA)
class SignedDocumentLinksTest(BaseAPITestCase):
    """M8: the invoice and business serializers emitted FileField paths under
    /media/, which production nginx answers with 404. AI-imported invoices
    showed "Preview unavailable" and a dead download link, and the business
    form showed a broken signature, so people uploaded it again."""

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(_MEDIA, ignore_errors=True)
        super().tearDownClass()

    def _assert_signed_and_served(self, url):
        self.assertTrue(url and url.startswith("/api/media/") and "?s=" in url, url)
        # Fetched the way an <img> fetches it: no JWT, no session.
        self.assertEqual(APIClient().get(url).status_code, 200, url)

    def _assert_no_public_media_links(self, data):
        self.assertEqual(re.findall(r"(?<!/api)/media/[^\"]*", json.dumps(data)), [])

    def test_ai_imported_invoice_links_are_signed(self):
        inv = self.invoice
        inv.source_file.save("bill.heic", SimpleUploadedFile("bill.heic", b"heic-bytes"), save=True)
        inv.source_preview.save("bill.jpg", SimpleUploadedFile("bill.jpg", b"\xff\xd8\xff"), save=True)
        resp = self.client.get(reverse("invoice-detail", args=[inv.id]))
        self.assertEqual(resp.status_code, 200)
        self._assert_signed_and_served(resp.data.get("source_file_url"))
        self._assert_signed_and_served(resp.data.get("source_preview_url"))
        self._assert_no_public_media_links(resp.data)

    def test_business_signature_link_is_signed(self):
        self.business.signature_image.save("sig.png", SimpleUploadedFile("sig.png", b"\x89PNG\r\n\x1a\n"), save=True)
        resp = self.client.get(reverse("business-detail", args=[self.business.id]))
        self.assertEqual(resp.status_code, 200)
        self._assert_signed_and_served(resp.data.get("signature_image_url"))
        self._assert_no_public_media_links(resp.data)

    def test_documents_without_files_have_no_links(self):
        inv = self.client.get(reverse("invoice-detail", args=[self.invoice.id])).data
        biz = self.client.get(reverse("business-detail", args=[self.business.id])).data
        self.assertEqual((inv["source_file_url"], inv["source_preview_url"], biz["signature_image_url"]), (None, None, None))
