"""P4-12: merging records cannot rewrite a purchase's supplier GSTIN."""
import uuid

from django.test import TestCase

from billing.models import AuditLog, BinnedInvoice, Customer, FiledPeriod, Invoice, LineItem, SaleDraft
from billing.services.bin import bin_bill
from billing.services.purchase_bin import bin_purchase, purchase_bin_row
from billing.tests.v3_helpers import buyer, client_for, firm, person, sale


class MergeSupplierIdentityTests(TestCase):
    def setUp(self):
        self.owner = person("supplier-merge-owner", "admin")
        self.client = client_for(self.owner)
        self.business = firm()
        self.source = buyer("Old Supplier", gst_number="08AAGPL3375F1ZO")
        self.target = buyer("Kept Supplier", gst_number="08AAMFR5567K1ZG")

    def preview(self):
        return self.client.get(f"/api/customers/{self.source.pk}/merge-preview/", {"into": self.target.pk})

    def merge(self):
        return self.client.post(f"/api/customers/{self.source.pk}/merge-into/", {"into": self.target.pk}, format="json")

    def stored_rows(self):
        return [list(model.objects.order_by("pk").values()) for model in
                (Customer, Invoice, LineItem, SaleDraft, BinnedInvoice, Customer.businesses.through, AuditLog)]

    def test_different_supplier_gstins_list_purchases_and_refuse_without_any_mutation(self):
        later = sale(self.business, self.source, "PUR-2", "2026-09-20", kind="inward")
        earlier = sale(self.business, self.source, "PUR-1", "2026-09-12", kind="inward")
        sale(self.business, self.source, "1", "2026-09-01")
        bin_bill(sale(self.business, self.source, "2", "2026-09-02"), self.owner)
        SaleDraft.objects.create(id=uuid.uuid4(), business=self.business,
                                 data={"customer": {"id": self.source.pk, "name": self.source.name}})
        self.source.businesses.add(self.business)
        before = self.stored_rows()
        response = self.preview()
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["can_merge"])
        self.assertEqual(response.data["purchases"], 2)
        refusal = response.data["refusal"]
        self.assertEqual(refusal["code"], "sent_changes")
        self.assertEqual(refusal["months"], [])
        self.assertEqual(refusal["detail"],
                         "Can't merge: under Kept Supplier (08AAMFR5567K1ZG), purchase bills PUR-1 and PUR-2 "
                         "from Old Supplier (08AAGPL3375F1ZO) would have a different supplier GSTIN. "
                         "The supplier's bills wouldn't match your purchase records. Keep both customers.")
        self.assertEqual([change["bill"]["id"] for change in refusal["bills"]], [earlier.pk, later.pk])
        for change in refusal["bills"]:
            self.assertEqual(set(change), {"bill", "sent", "paper", "sent_at", "sent_via", "heads", "segment", "gstin_changes", "words"})
            self.assertTrue(change["gstin_changes"])
            self.assertIsNone(change["heads"])
            self.assertIsNone(change["segment"])
            self.assertEqual(change["words"], "Supplier GSTIN changes")
            self.assertFalse(change["sent"])
            self.assertFalse(change["paper"])
        commit = self.merge()
        self.assertEqual(commit.status_code, 409)
        self.assertEqual(commit.data["code"], refusal["code"])
        self.assertEqual(commit.data["detail"], refusal["detail"])
        self.assertEqual(commit.data["bills"], refusal["bills"])
        self.assertEqual(self.stored_rows(), before)

    def test_commit_rechecks_supplier_gstin_after_an_allowed_preview(self):
        Customer.objects.filter(pk=self.target.pk).update(gst_number=self.source.gst_number)
        sale(self.business, self.source, "PUR-1", "2026-09-12", kind="inward")
        self.assertTrue(self.preview().data["can_merge"])
        Customer.objects.filter(pk=self.target.pk).update(gst_number="08AAMFR5567K1ZG")
        before = self.stored_rows()
        response = self.merge()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "sent_changes")
        self.assertEqual(self.stored_rows(), before)

    def test_gstin_added_or_removed_also_refuses_with_purchase_numbers(self):
        sale(self.business, self.source, "PUR-1", "2026-09-12", kind="inward")
        for source_gstin, target_gstin in (("", "08AAMFR5567K1ZG"), ("08AAGPL3375F1ZO", "")):
            with self.subTest(source=source_gstin, target=target_gstin):
                Customer.objects.filter(pk=self.source.pk).update(gst_number=source_gstin)
                Customer.objects.filter(pk=self.target.pk).update(gst_number=target_gstin)
                before = self.stored_rows()
                preview = self.preview().data
                self.assertFalse(preview["can_merge"])
                self.assertIn("purchase bill PUR-1", preview["refusal"]["detail"])
                self.assertIn("no GSTIN", preview["refusal"]["detail"])
                self.assertEqual(self.merge().status_code, 409)
                self.assertEqual(self.stored_rows(), before)

    def test_same_normalized_gstin_can_merge_without_changing_purchase_money(self):
        Customer.objects.filter(pk=self.target.pk).update(gst_number=" 08aagpl3375f1zo ")
        purchase = sale(self.business, self.source, "PUR-1", "2026-09-12", kind="inward")
        before = list(LineItem.objects.filter(invoice=purchase).values_list("quantity", "rate", "cgst", "sgst", "igst", "amount"))
        total = purchase.total_amount
        self.assertTrue(self.preview().data["can_merge"])
        self.assertEqual(self.merge().status_code, 200)
        purchase.refresh_from_db()
        self.assertEqual((purchase.customer_id, purchase.total_amount), (self.target.pk, total))
        self.assertEqual(list(LineItem.objects.filter(invoice=purchase).values_list("quantity", "rate", "cgst", "sgst", "igst", "amount")), before)

    def test_target_purchases_do_not_block_a_source_without_purchases(self):
        purchase = sale(self.business, self.target, "PUR-1", "2026-09-12", kind="inward")
        outgoing = sale(self.business, self.source, "1", "2026-09-12")
        self.assertTrue(self.preview().data["can_merge"])
        self.assertEqual(self.merge().status_code, 200)
        for bill in (purchase, outgoing):
            bill.refresh_from_db()
            self.assertEqual(bill.customer_id, self.target.pk)

    def test_preledger_purchase_keeps_its_supplier_identity_too(self):
        sale(self.business, self.source, "OLD-PUR", "2025-03-31", kind="inward")
        before = self.stored_rows()
        self.assertFalse(self.preview().data["can_merge"])
        response = self.merge()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "sent_changes")
        self.assertIn("OLD-PUR", response.data["detail"])
        self.assertEqual(self.stored_rows(), before)

    def test_supplier_identity_refusal_does_not_suggest_unlocking_a_filed_month(self):
        sale(self.business, self.source, "FILED-PUR", "2026-09-12", kind="inward")
        FiledPeriod.objects.create(business=self.business, year=2026, month=9)
        before = self.stored_rows()
        refusal = self.preview().data["refusal"]
        self.assertEqual(refusal["code"], "sent_changes")
        self.assertIn("FILED-PUR", refusal["detail"])
        self.assertNotIn("unlock", refusal["detail"])
        response = self.merge()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["detail"], refusal["detail"])
        self.assertEqual(response.data["bills"], refusal["bills"])
        self.assertEqual(self.stored_rows(), before)


class MergeReviewTests(TestCase):
    def setUp(self):
        self.owner = person("merge-review-owner", "admin")
        self.client = client_for(self.owner)
        self.business = firm()

    def preview(self, source, target):
        return self.client.get(f"/api/customers/{source.pk}/merge-preview/", {"into": target.pk})

    def merge(self, source, target):
        return self.client.post(f"/api/customers/{source.pk}/merge-into/", {"into": target.pk}, format="json")

    def test_a_legacy_walkin_by_name_is_never_merged(self):
        walkin, other = buyer("Walk-in Customer"), buyer("Ramesh")
        for source, target in ((walkin, other), (other, walkin)):
            with self.subTest(source=source.name):
                response = self.preview(source, target)
                self.assertEqual((response.data["can_merge"], response.data["refusal"]["code"]), (False, "walkin"))
                self.assertEqual(self.merge(source, target).status_code, 409)
        self.assertEqual(Customer.objects.count(), 2)

    def test_the_same_purchase_under_both_suppliers_refuses_a_duplicate(self):
        source, target = buyer("Sharma Traders"), buyer("Sharma Traders Jaipur")
        sale(self.business, source, "SJ/101", "2026-05-02", kind="inward")
        sale(self.business, target, "SJ-101", "2026-09-12", kind="inward")
        response = self.preview(source, target)
        self.assertEqual((response.data["can_merge"], response.data["refusal"]["code"]), (False, "duplicate_purchase"))
        self.assertEqual(response.data["refusal"]["detail"],
                         "Can't merge: purchase bill SJ/101 from Sharma Traders is already entered under Sharma Traders Jaipur "
                         "as SJ-101 for KIRAN GOLD HOUSE in 2026-27. Delete one copy first, or keep both customers.")
        self.assertEqual(self.merge(source, target).status_code, 409)
        self.assertEqual(Invoice.objects.filter(customer=source).count(), 1)
        Invoice.objects.filter(customer=target).update(invoice_date="2027-04-02")
        self.assertTrue(self.preview(source, target).data["can_merge"])

    def test_a_binned_purchase_names_the_kept_supplier(self):
        source, target = buyer("Old Supplier"), buyer("Kept Supplier")
        # 2A's real bin_purchase writes the supplier card the merge must rewrite.
        binned = bin_purchase(sale(self.business, source, "PUR-9", "2026-09-12", kind="inward"), self.owner)
        self.assertEqual(binned.data["supplier"]["id"], source.pk)
        self.assertEqual(self.merge(source, target).status_code, 200)
        binned.refresh_from_db()
        self.assertEqual((binned.customer_id, binned.data["supplier"]["id"], binned.data["supplier"]["name"]),
                         (target.pk, target.pk, "Kept Supplier"))
        self.assertEqual(purchase_bin_row(binned)["supplier"]["name"], "Kept Supplier")
