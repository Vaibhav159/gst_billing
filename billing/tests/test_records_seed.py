from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase

from billing.management.commands.seed_sandbox import Command
from billing.models import AuditLog, Business, Customer, Product
from billing.tests.v3_helpers import buyer, firm


class RecordsSeedTest(TestCase):
    def test_records_fixture_is_repeatable_and_keeps_existing_bills(self):
        firm()
        buyer()
        Product.objects.create(name="Gold Ornaments 22K", hsn_code="711319")
        cmd = Command()
        cmd.today = date(2026, 10, 8)
        owner = get_user_model().objects.create_user("sandbox_owner")
        cmd._records()
        counts = (Business.objects.count(), Customer.objects.count(), Product.objects.count(), AuditLog.objects.count())
        cmd._records()
        self.assertEqual(counts, (Business.objects.count(), Customer.objects.count(), Product.objects.count(), AuditLog.objects.count()))
        self.assertTrue(Product.objects.filter(name="Gold jewellery 22K", kind="gold", purity="22K", usual_rate="6470.000").exists())
        self.assertTrue(Product.objects.filter(name="Unused packing box", purchase_only=True).exists())
        self.assertTrue(Product.objects.filter(name="GOLD JEWELLERY 22K").exists())
        self.assertEqual(AuditLog.objects.get(entity="product", changes__name__old="Gold Ornaments 22K").user, owner)
        self.assertEqual(Customer.objects.filter(mobile_number="9000000042").count(), 2)
        self.assertTrue(Business.objects.filter(bank_account_number="").exists())
