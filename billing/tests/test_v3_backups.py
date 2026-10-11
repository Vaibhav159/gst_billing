import json
from unittest.mock import patch

from django.contrib.auth.models import User
from django.db import connection
from django.test import TransactionTestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIRequestFactory, force_authenticate

from billing.models import AuditLog, Business, Product
from billing.tests.v3_helpers import buyer, firm, line, person, sale


class BackupTests(TransactionTestCase):
    """Response.close sends request_finished, so these stream tests need autocommit."""

    def setUp(self):
        self.owner = person("owner", "admin", first_name="Kailash", last_name="Mehta")
        self.biz, self.customer = firm(), buyer()
        self.customer.businesses.add(self.biz)
        Product.objects.create(name="Silver", hsn_code="711311")
        self.bill = sale(self.biz, self.customer, "KGH/2026-27/1", "2026-10-08", line())
        sale(self.biz, self.customer, "KGH/2026-27/2", "2026-10-08", status="cancelled")
        sale(self.biz, self.customer, "P1", "2026-03-31", kind="inward")

    def call(self, full=False, user=None):
        from billing.api.backups import BackupFullView, BackupSummaryView
        request = APIRequestFactory().get("/api/backup/full/" if full else "/api/backup/summary/")
        force_authenticate(request, user=user or self.owner)
        return (BackupFullView if full else BackupSummaryView).as_view()(request)

    def test_summary_counts_and_financial_year_boundaries(self):
        data = self.call().data
        self.assertEqual(data["counts"], dict(firms=1, customers=1, suppliers=0, products=1,
                         sales=1, cancelled=1, purchases=1, people=1, audit=0, bin=0))
        self.assertEqual(data["years"], [dict(fy="2025-26", sales=0, cancelled=0, purchases=1),
                                       dict(fy="2026-27", sales=1, cancelled=1, purchases=0)])
        self.assertEqual(data["recent"], [])
        self.assertIsNone(data["last_backup_at"])
        self.assertTrue(data["estimated_size"])

    def test_full_wire_shape_and_audit_only_after_exhaustion(self):
        from billing.api.serializers import InvoiceSerializer
        response = self.call(full=True)
        self.assertTrue(response.streaming)
        self.assertEqual(response["Content-Type"], "application/json")
        self.assertIn('attachment; filename="gst-backup-', response["Content-Disposition"])
        self.assertEqual(AuditLog.objects.count(), 0)
        data = json.loads(b"".join(response.streaming_content))
        self.assertEqual(data["app"], "gst-billing")
        self.assertEqual(data["version"], "5.0")
        self.assertEqual(data["made"], data["exportedAt"])
        self.assertTrue(data["made"].endswith("+05:30"))
        self.assertEqual(data["by"], "Kailash Mehta")
        self.assertEqual(data["invoices"][0], dict(InvoiceSerializer(self.bill).data))
        self.assertEqual(data["customers"][0]["businesses"], [self.biz.pk])
        self.assertNotIn("signature_image_base64", data["businesses"][0])
        self.assertEqual(data["v3"]["people"], [dict(username="owner", first_name="Kailash",
                         last_name="Mehta", email="", role="owner", active=True)])
        self.assertEqual(data["v3"]["audit_log"], [])
        audit = AuditLog.objects.get(entity="backup")
        self.assertEqual(audit.entity_name, "Full backup")
        self.assertIn("1 sales bills (and 1 cancelled) and 1 purchase bills", audit.details)
        self.assertEqual(self.call().data["recent"][0]["audit_id"], audit.pk)

    def test_abandoned_stream_writes_no_success_audit(self):
        response = self.call(full=True)
        stream = iter(response.streaming_content)
        next(stream)
        response.close()
        self.assertFalse(AuditLog.objects.filter(entity="backup").exists())

    def test_permissions_and_recent_privacy(self):
        for role in ["counter_staff", "viewer"]:
            user = person(role, role)
            self.assertEqual(self.call(full=True, user=user).status_code, 403)
            self.assertEqual(self.call(user=user).data["recent"], [])
        accountant = person("accounts", "accountant", "editor")
        response = self.call(full=True, user=accountant)
        self.assertEqual(response.status_code, 200)
        b"".join(response.streaming_content)
        viewer = User.objects.get(username="viewer")
        data = self.call(user=viewer).data
        self.assertEqual(data["recent"], [])
        self.assertIsNotNone(data["last_backup_at"])

    def test_no_secrets_or_media_even_in_bin_and_audit(self):
        from billing.models import BinnedInvoice
        Business.objects.filter(pk=self.biz.pk).update(signature_image="private-signature.png")
        self.bill.source_file = "private-photo.jpg"
        self.bill.save(update_fields=["source_file"])
        BinnedInvoice.objects.create(original_id=99, business=self.biz, customer=self.customer,
            invoice_date="2026-10-01", data={"invoice": {"source_file": "private-photo.jpg"},
            "line_items": []})
        AuditLog.objects.create(action="updated", entity="customer", entity_id=self.customer.pk,
            entity_name="Anil", snapshot={"secret": "private-snapshot"}, user=self.owner)
        with CaptureQueriesContext(connection) as queries:
            content = b"".join(self.call(full=True).streaming_content).decode()
        for forbidden in ["private-photo", "private-signature", "private-snapshot", self.owner.password,
                          "code_hash", "tokens_after"]:
            self.assertNotIn(forbidden, content)
        for query in queries:
            if query["sql"].lstrip().upper().startswith("SELECT"):
                self.assertNotIn("airead", query["sql"].lower())
                self.assertNotIn('"password"', query["sql"])
                self.assertNotIn('"signature_image"', query["sql"])
                self.assertNotIn('"source_file"', query["sql"])
                self.assertNotIn('"snapshot"', query["sql"].split(" FROM ", 1)[0])

    def test_full_values_are_batched_and_around_cacheops(self):
        from django.db.models.query import QuerySet
        sizes = []
        original = QuerySet.iterator
        def watched(queryset, *args, **kwargs):
            sizes.append(kwargs.get("chunk_size"))
            self.assertIn(queryset._iterable_class.__name__, ["ValuesIterable", "ValuesListIterable"])
            return original(queryset, *args, **kwargs)
        with patch.object(QuerySet, "iterator", watched):
            b"".join(self.call(full=True).streaming_content)
        self.assertTrue(sizes)
        self.assertEqual(set(sizes), {500})

    def test_part3_filing_hook(self):
        from billing.services import backups
        filing = {"filing_records": [{"business": self.biz.pk, "month": "2026-09", "stage": "filed"}],
                  "filing_months": [{"business": self.biz.pk, "month": "2026-09"}],
                  "opening_credits": [{"business": self.biz.pk, "cgst": "100.00"}]}
        with patch.object(backups, "filing_rows", return_value=filing):
            data = json.loads(b"".join(self.call(full=True).streaming_content))
        self.assertEqual(data["v3"]["filing"], filing)
