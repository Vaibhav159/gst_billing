import csv
from collections import Counter
from io import StringIO

from django.test import TestCase

from billing.tests.test_audit_mapping import CASES
from billing.tests.test_audit_mapping_reads import AuditMappingFixture
from billing.tests.v3_helpers import ROLE_GROUPS, client_for, person


# Explicit 4A integration gate: these routes/permissions do not exist at d5c4a0c7.
class MappingAPITest(AuditMappingFixture, TestCase):
    def setUp(self):
        super().setUp()
        self.client = client_for(person("mapping-owner", *ROLE_GROUPS["owner"]))

    def test_http_kind_counts_and_groups_use_the_shared_inventory(self):
        counts = Counter(case[2] for case in CASES)
        for kind, count in counts.items():
            response = self.client.get("/api/audit/", {"kind": kind, "counts": 1, "page_size": 100})
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(response.data["count"], count)
            self.assertEqual(response.data["counts"], {"all": len(CASES), **counts})
            self.assertEqual({row["kind"] for row in response.data["results"]}, {kind})
        for group, count in Counter(case[3] for case in CASES).items():
            response = self.client.get("/api/audit/", {"group": group, "page_size": 100})
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(response.data["count"], count)
            self.assertEqual({row["group"] for row in response.data["results"]}, {group})

    def test_csv_uses_every_producer_words_and_details_from_the_same_mapper(self):
        response = self.client.get("/api/audit/export/")
        self.assertEqual(response.status_code, 200)
        decoded = b"".join(response.streaming_content).decode("utf-8-sig")
        rows = list(csv.DictReader(StringIO(decoded)))
        expected = Counter((" ".join(filter(None, [c[4], c[6], c[5]])), c[8]) for c in CASES)
        self.assertEqual(Counter((row["What"], row["Details"]) for row in rows), expected)
        filtered = self.client.get("/api/audit/export/", {"kind": "filing", "group": "send"})
        self.assertEqual(filtered.status_code, 200)
        selected = list(csv.DictReader(StringIO(b"".join(filtered.streaming_content).decode("utf-8-sig"))))
        expected_selected = Counter(" ".join(filter(None, [c[4], c[6], c[5]])) for c in CASES if c[2:4] == ("filing", "send"))
        self.assertEqual(Counter(row["What"] for row in selected), expected_selected)
