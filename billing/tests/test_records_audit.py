from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from billing.models import AuditLog, Customer
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, person


class AuditReadTest(TestCase):
    def setUp(self):
        self.owner = person("audit-owner", *ROLE_GROUPS["owner"], first_name="Kailash", last_name="Mehta")
        self.client = client_for(self.owner)
        self.customer = buyer()
        self.entry = AuditLog.objects.create(user=self.owner, entity="customer", entity_id=self.customer.pk, entity_name=self.customer.name, action="updated", changes={"mobile_number": {"old": "", "new": "9000000000"}}, snapshot={"private": "SENTINEL"})
        Customer.objects.filter(pk=self.customer.pk).update(mobile_number="9000000000")

    def test_rows_counts_words_and_narrow_snapshot_read(self):
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get("/api/audit/?counts=1")
        self.assertEqual(response.status_code, 200)
        row = response.data["results"][0]
        self.assertEqual(row["words"], {"text": "Edited customer", "target": self.customer.name, "after": ""})
        self.assertEqual(row["changes"][0], {"key": "mobile_number", "field": "Phone", "from": "None", "to": "9000000000"})
        self.assertEqual(row["can"]["kind"], "revert")
        self.assertEqual(response.data["counts"]["records"], 1)
        self.assertNotIn("snapshot", row)
        self.assertNotIn("SENTINEL", str(response.data))
        for query in queries:
            self.assertNotIn('"billing_auditlog"."snapshot",', query["sql"])

    def test_filters_bad_parameters_roles_and_csv(self):
        for field, value in [("kind", "bogus"), ("group", "bogus"), ("by", "999999999999999999999999"), ("entity_id", "[]")]:
            self.assertEqual(self.client.get("/api/audit/", {field: value}).status_code, 400)
        self.assertEqual(self.client.get("/api/audit/?page=99").status_code, 404)
        viewer = client_for(person("audit-viewer", *ROLE_GROUPS["viewer"]))
        self.assertEqual(viewer.get("/api/audit/").status_code, 403)
        self.entry.entity_name = "=SUM(1,2)"
        self.entry.save()
        response = self.client.get("/api/audit/export/")
        self.assertEqual(response.status_code, 200)
        content = b"".join(response.streaming_content).decode("utf-8-sig")
        self.assertIn("'=SUM(1,2)", content)
        self.assertTrue(AuditLog.objects.filter(entity="backup", action="exported").exists())
