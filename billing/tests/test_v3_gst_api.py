import json
from datetime import date
from unittest.mock import patch

from django.test import TestCase
from freezegun import freeze_time

from billing.api import urls as _api_urls  # noqa: F401 - load pandas before freezegun patches time
from billing.tests.v3_helpers import buyer, client_for, firm, person, sale


@freeze_time("2026-10-08 06:00:00+00:00")
class GstApiTest(TestCase):
    def setUp(self):
        self.business = firm(gstin="08VRHFA2322D1ZI")
        self.owner = person("owner", "admin")
        self.client = client_for(self.owner)
        self.query = {"business_id": self.business.pk, "month": "2026-09"}

    def test_reads_validate_query_before_work(self):
        for path in ("year", "month", "month/gstr1", "month/gstr3b", "opening-credit"):
            response = self.client.get("/api/gst/" + path + "/")
            self.assertEqual(response.status_code, 400, (path, response.content))
            self.assertEqual(response.json(), {"business_id": ["Pick a firm from the list."]})
        response = self.client.get("/api/gst/month/", {"business_id": self.business.pk, "month": "2025-03"})
        self.assertEqual(response.json(), {"month": ["The app's GST records start in April 2025."]})

    def test_month_and_month_end_keep_the_firms_chosen_short_name(self):
        self.business.short_name = "Kiran Shop"
        self.business.save(update_fields=["short_name"])
        month = self.client.get("/api/gst/month/", self.query)
        self.assertEqual(month.status_code, 200)
        self.assertEqual(month.json()["firm"]["short"], "Kiran Shop")
        end = self.client.get("/api/gst/month-end/", {"month": "2026-09"})
        self.assertEqual(end.status_code, 200)
        row = next(row for row in end.json()["firms"] if row["firm"]["id"] == self.business.pk)
        self.assertEqual(row["firm"]["short"], "Kiran Shop")

    def test_old_year_and_future_month_need_no_ledger(self):
        response = self.client.get("/api/gst/year/", {"business_id": self.business.pk, "fy": "2024-25"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["months"], [])
        self.assertFalse(response.json()["has_records"])
        response = self.client.get("/api/gst/month/", {**self.query, "month": "2026-11"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["stage"], "future")
        self.assertEqual(response.json()["due"]["gstr1"], "2026-12-11")
        self.assertIsNone(response.json()["gstr3b"])

    def test_running_files_refused_and_viewer_cannot_download(self):
        response = self.client.get("/api/gst/files/gstr1/", {**self.query, "month": "2026-10"})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "month_running")
        self.client = client_for(person("viewer", "viewer"))
        response = self.client.get("/api/gst/files/gstr1/", self.query)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["needs"], "gst.download")

    def test_as_filed_file_bypasses_current_checks_and_audits(self):
        from billing.models import AuditLog, FilingRecord, ReturnDownload
        frozen = {"gstin": self.business.gst_number, "fp": "092026", "b2cs": [{"txval": 123.45}]}
        FilingRecord.objects.create(business=self.business, year=2026, month=9, kind="gstr1",
                                    filed_on=date(2026, 10, 5), file=frozen, figures={}, bills={})
        with patch("billing.services.gst_checks.month_checks", side_effect=AssertionError("rebuild")):
            response = self.client.get("/api/gst/files/gstr1/", {**self.query, "as_filed": "1"})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(json.loads(response.content), frozen)
        self.assertEqual(response["Content-Disposition"], 'attachment; filename="GSTR1_08VRHFA2322D1ZI_092026.json"')
        self.assertEqual(ReturnDownload.objects.get().kind, "gstr1_filed")
        self.assertEqual(AuditLog.objects.get(entity="gst_file").action, "downloaded")

    def test_download_state_changes_with_file_and_names_bill_audit(self):
        from billing.models import AuditLog
        from billing.services.gst_downloads import download_state, record_download
        inv = sale(self.business, buyer(), "1", date(2026, 9, 2))
        body = {"fp": "092026", "b2cs": [{"txval": 100}]}
        record_download(self.business, date(2026, 9, 1), "gstr1", self.owner, "download", body)
        with freeze_time("2026-10-08 06:01:00+00:00"):
            AuditLog.objects.create(entity="invoice", entity_id=inv.pk, entity_name=inv.invoice_number,
                                    user=self.owner, action="updated", details="Changed quantity")
        self.assertFalse(download_state(self.business, date(2026, 9, 1), body)["stale"])
        result = download_state(self.business, date(2026, 9, 1), {**body, "b2cs": []})
        self.assertTrue(result["stale"])
        self.assertEqual(result["changed"][0]["invoice_number"], "1")

    def test_bundle_invalid_shape_is_400_and_valid_bundle_records_once(self):
        from billing.models import AuditLog, ReturnDownload
        response = self.client.post("/api/gst/files/bundle/", [], format="json")
        self.assertEqual(response.status_code, 400)
        data = {"business": self.business.pk, "month": "2026-09", "via": "share", "parts": ["gstr1", "gstr3b", "excel"]}
        response = self.client.post("/api/gst/files/bundle/", data, format="json")
        self.assertEqual(response.status_code, 204, response.content)
        self.assertCountEqual(ReturnDownload.objects.values_list("kind", "via"),
                              [("bundle", "share"), ("gstr1", "share"), ("gstr3b", "share")])
        self.assertEqual(AuditLog.objects.get(entity="gst_file").entity_name, "GST_Kiran_092026_for_CA.zip")
        self.assertEqual(AuditLog.objects.get(entity="gst_file").details,
                         "KIRAN GOLD HOUSE · September 2026 · BUNDLE · GSTR-1, GSTR-3B, Excel")

    def test_bundle_audit_uses_the_same_safe_short_name_as_the_download(self):
        from billing.models import AuditLog

        self.business.short_name = "Kiran / Shop"
        self.business.save(update_fields=["short_name"])
        response = self.client.post("/api/gst/files/bundle/", {
            "business": self.business.pk, "month": "2026-09", "via": "share", "parts": ["gstr3b", "excel"],
        }, format="json")
        self.assertEqual(response.status_code, 204)
        self.assertEqual(AuditLog.objects.get(entity="gst_file").entity_name, "GST_Kiran_Shop_092026_for_CA.zip")

    def test_legacy_frozen_file_is_downloaded_without_rebuilding(self):
        from django.utils import timezone

        from billing.models import FilingMonth
        frozen = {"gstin": self.business.gst_number, "fp": "092026"}
        FilingMonth.objects.create(business=self.business, year=2026, month=9,
            legacy_frozen_at=timezone.now(), legacy_snapshot={"gstr1": {"file": frozen, "figures": {"sections": {"b2b": []}}}})
        response = self.client.get("/api/gst/files/gstr1/", {**self.query, "as_filed": "1"})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(json.loads(response.content), frozen)

    def test_opening_preview_does_not_write_then_save_audits(self):
        from billing.models import AuditLog, OpeningCredit
        effect = {"reaches": "2026-10", "carried_out": {"from": "0.00", "to": "100.00"},
                  "cash": {"month": "2026-10", "from": "0.00", "to": "0.00"},
                  "filed_differ": {"count": 0, "from": None, "to": None}}
        data = {"business": self.business.pk, "igst": "100.00", "cgst": "0", "sgst": "0"}
        with patch("billing.services.ledger.opening_effect", return_value=effect), \
                patch("billing.services.ledger.month_position", return_value={"carry_on": {"igst": "100.00", "cgst": "0.00", "sgst": "0.00", "total": "100.00"}}):
            response = self.client.put("/api/gst/opening-credit/?preview=1", data, format="json")
            self.assertEqual(response.status_code, 200, response.content)
            self.assertFalse(OpeningCredit.objects.exists())
            self.assertFalse(AuditLog.objects.filter(entity="credit").exists())
            response = self.client.put("/api/gst/opening-credit/", data, format="json")
            self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(str(OpeningCredit.objects.get().igst), "100.00")
        self.assertEqual(AuditLog.objects.filter(entity="credit", action="updated").count(), 1)

    def test_only_owner_can_unlock_and_opening_is_owner_only(self):
        self.client = client_for(person("accountant", "accountant", "editor"))
        for route, body in (("months/unlock", {"business": self.business.pk, "month": "2026-09", "reason": "Correction"}),
                            ("months/filed-before", {"business": self.business.pk, "up_to": "2026-06"})):
            response = self.client.post("/api/gst/" + route + "/", body, format="json")
            self.assertEqual(response.status_code, 403, response.content)
        response = self.client.put("/api/gst/opening-credit/", {}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_gstr1a_without_corrections_is_refused(self):
        response = self.client.get("/api/gst/files/gstr1a/", self.query)
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["code"], "no_corrections")

    def test_empty_amendments_names_the_return_before_and_after_gstr3b(self):
        from billing.models import FilingRecord
        FilingRecord.objects.create(business=self.business, year=2026, month=9, kind="gstr1",
                                    filed_on=date(2026, 10, 5), bills={})
        for filed, ending in ((False, "there's no GSTR-1A to record."),
                              (True, "there are no amendments to carry.")):
            with self.subTest(gstr3b=filed):
                if filed:
                    FilingRecord.objects.create(business=self.business, year=2026, month=9,
                                                kind="gstr3b", filed_on=date(2026, 10, 6))
                response = self.client.get("/api/gst/files/amendments/", self.query)
                self.assertEqual(response.status_code, 409, response.content)
                self.assertEqual(response.json()["code"], "no_corrections")
                self.assertEqual(response.json()["detail"],
                                 "Nothing has changed since September 2026's GSTR-1, so " + ending)

    def test_bundle_post_records_parts_built_at_post_time_and_cockpit_detects_later_changes(self):
        from billing.models import AuditLog, ReturnDownload
        from billing.services.gst_downloads import download_state, fingerprint
        from billing.services.ledger import build_gstr3b_json
        prepared = {}
        for kind in ("gstr1", "gstr3b"):
            response = self.client.get(f"/api/gst/files/{kind}/", {**self.query, "record": "0"})
            self.assertEqual(response.status_code, 200, response.content)
            prepared[kind] = build_gstr3b_json(self.business, 2026, 9) if kind == "gstr3b" else response.json()
        self.assertFalse(ReturnDownload.objects.exists())
        self.assertFalse(AuditLog.objects.filter(entity="gst_file").exists())
        customer = buyer()
        sale(self.business, customer, "1", date(2026, 9, 2))
        parts = ["gstr1", "gstr3b", "excel"]
        response = self.client.post("/api/gst/files/bundle/", {
            "business": self.business.pk, "month": "2026-09", "parts": parts,
        }, format="json")
        self.assertEqual(response.status_code, 204, response.content)
        self.assertCountEqual(ReturnDownload.objects.values_list("kind", flat=True), ["bundle", "gstr1", "gstr3b"])
        row = ReturnDownload.objects.get(kind="bundle")
        self.assertEqual(row.fingerprint, fingerprint({"parts": sorted(parts)}))
        self.assertEqual(AuditLog.objects.filter(entity="gst_file", action="downloaded").count(), 1)
        for kind in ("gstr1", "gstr3b"):
            response = self.client.get(f"/api/gst/files/{kind}/", {**self.query, "record": "0"})
            self.assertEqual(response.status_code, 200, response.content)
            current = build_gstr3b_json(self.business, 2026, 9) if kind == "gstr3b" else response.json()
            row = ReturnDownload.objects.get(kind=kind)
            self.assertEqual(row.fingerprint, fingerprint(current))
            self.assertNotEqual(row.fingerprint, fingerprint(prepared[kind]))
            if kind == "gstr1":
                state = download_state(self.business, date(2026, 9, 1), current)
                self.assertIsNotNone(state)
                self.assertFalse(state["stale"])
        cockpit = self.client.get("/api/gst/month-end/", {"month": "2026-09"}).json()["firms"][0]
        self.assertFalse(cockpit["download"]["stale"])
        self.assertEqual(cockpit["next"], "mark1")
        with freeze_time("2026-10-08 06:01:00+00:00"):
            inv = sale(self.business, customer, "2", date(2026, 9, 3))
            AuditLog.objects.create(entity="invoice", entity_id=inv.pk, entity_name=inv.invoice_number,
                                    user=self.owner, action="created", details="New bill")
            cockpit = self.client.get("/api/gst/month-end/", {"month": "2026-09"}).json()["firms"][0]
        self.assertTrue(cockpit["download"]["stale"])
        self.assertEqual(cockpit["download"]["changed"][0]["invoice_number"], "2")
        self.assertEqual(cockpit["next"], "download")

    def test_bundle_records_only_included_returns_once(self):
        from billing.models import AuditLog, ReturnDownload
        from billing.services.gst_downloads import download_state
        response = self.client.post("/api/gst/files/bundle/", {
            "business": self.business.pk, "month": "2026-09", "parts": ["gstr3b", "excel", "gstr3b"],
        }, format="json")
        self.assertEqual(response.status_code, 204, response.content)
        self.assertCountEqual(ReturnDownload.objects.values_list("kind", flat=True), ["bundle", "gstr3b"])
        self.assertIsNone(download_state(self.business, date(2026, 9, 1), {}))
        self.assertEqual(AuditLog.objects.get(entity="gst_file").details,
                         "KIRAN GOLD HOUSE · September 2026 · BUNDLE · GSTR-3B, Excel")

    def test_failed_bundle_record_rolls_back_every_part(self):
        from billing.models import AuditLog, ReturnDownload
        with patch("billing.models.AuditLog.objects.create", side_effect=RuntimeError("audit failed")), \
                self.assertRaisesMessage(RuntimeError, "audit failed"):
            self.client.post("/api/gst/files/bundle/", {
                "business": self.business.pk, "month": "2026-09", "parts": ["gstr1", "gstr3b", "excel"],
            }, format="json")
        self.assertFalse(ReturnDownload.objects.exists())
        self.assertFalse(AuditLog.objects.filter(entity="gst_file").exists())

    def test_record_zero_keeps_download_permissions_and_running_month_checks(self):
        response = self.client.get("/api/gst/files/gstr3b/", {
            **self.query, "record": "0", "month": "2026-10",
        })
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "month_running")
        self.client = client_for(person("viewer", "viewer"))
        response = self.client.get("/api/gst/files/gstr3b/", {**self.query, "record": "0"})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["needs"], "gst.download")
