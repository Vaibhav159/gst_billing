from datetime import date, timedelta
from tempfile import TemporaryDirectory

from django.test import TestCase, override_settings
from django.utils import timezone

from billing.models import AuditLog, FiledPeriod, Invoice
from billing.tests.test_v3_capture_files import upload
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person, sale


class PurchaseFilesTest(TestCase):
    def setUp(self):
        self.media = TemporaryDirectory(dir=".")
        self.addCleanup(self.media.cleanup)
        self.override = override_settings(MEDIA_ROOT=self.media.name)
        self.override.enable()
        self.addCleanup(self.override.disable)
        self.user = person("scan-counter", *ROLE_GROUPS["staff"])
        self.client = client_for(self.user)
        self.owner = client_for(person("scan-owner", *ROLE_GROUPS["owner"]))
        self.bill = sale(firm(), buyer(), "SUP/1", date(2026, 10, 7), kind="inward")
        AuditLog.objects.create(entity="invoice", entity_id=self.bill.pk, user=self.user, action="created")
        self.url = f"/api/purchases/{self.bill.pk}/files/"

    def test_maker_can_attach_for_24_hours_and_second_file_is_refused(self):
        response = self.client.post(self.url, {"file": upload()}, format="multipart")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["files"][0]["id"], "src")
        self.assertEqual(self.client.post(self.url, {"file": upload()}, format="multipart").data,
                         {"file": ["This bill has its file already. Remove it first to put another."]})
        self.assertTrue(AuditLog.objects.filter(details="File attached: bill.pdf").exists())

    def test_other_staff_and_old_maker_need_purchase_edit(self):
        other = client_for(person("other-scan-counter", *ROLE_GROUPS["staff"]))
        self.assertEqual(other.post(self.url, {"file": upload()}, format="multipart").status_code, 403)
        Invoice.objects.filter(pk=self.bill.pk).update(created_at=timezone.now() - timedelta(hours=25))
        self.assertEqual(self.client.post(self.url, {"file": upload()}, format="multipart").status_code, 403)
        self.assertEqual(self.owner.post(self.url, {"file": upload()}, format="multipart").status_code, 200)

    def test_only_src_is_removable_by_editors_and_deletion_waits_for_commit(self):
        self.client.post(self.url, {"file": upload()}, format="multipart")
        self.bill.refresh_from_db()
        stored = self.bill.source_file
        self.assertEqual(self.client.delete(self.url + "src/").status_code, 403)
        self.assertEqual(self.owner.delete(self.url + "p1/").status_code, 404)
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(self.owner.delete(self.url + "src/").status_code, 204)
        self.assertFalse(stored.storage.exists(stored.name))
        self.assertTrue(AuditLog.objects.filter(details="File removed: bill.pdf").exists())

    def test_filed_credit_month_blocks_both_file_mutations(self):
        FiledPeriod.objects.create(business=self.bill.business, year=2026, month=10)
        for response in (self.owner.post(self.url, {"file": upload()}, format="multipart"), self.owner.delete(self.url + "src/")):
            self.assertEqual((response.status_code, response.data["code"]), (409, "month_closed"))

    def test_sales_id_is_not_a_purchase(self):
        Invoice.objects.filter(pk=self.bill.pk).update(type_of_invoice="outward")
        self.assertEqual(self.owner.post(self.url, {"file": upload()}, format="multipart").status_code, 404)

    def test_verified_mime_controls_the_stored_extension_and_file_kind(self):
        response = self.owner.post(self.url, {"file": upload("bill.jpg")}, format="multipart")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual((response.data["files"][0]["kind"], response.data["files"][0]["name"]), ("pdf", "bill.pdf"))
