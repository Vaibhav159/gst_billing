"""P4-9 adapters at published 2A seams; real predecessor gates live beside these."""

from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from rest_framework import serializers

from billing.models import AuditLog, BinnedInvoice, Business, Customer, Invoice
from billing.refusals import Refusal
from billing.services import backup_restore
from billing.tax_rules import normalize_rate
from billing.tests.test_v3_backup_restore import purchase_payload, upload
from billing.tests.v3_helpers import buyer, firm, person, sale

pytestmark = pytest.mark.django_db


class SeamPurchaseSerializer(serializers.Serializer):
    """Only the shape consumed at this adapter boundary; 2A owns real validation."""
    business = serializers.IntegerField()
    supplier = serializers.IntegerField()
    invoice_number = serializers.CharField(max_length=50)
    invoice_date = serializers.DateField()
    payment_mode = serializers.ChoiceField(choices=("", "cash", "bank", "credit", "mixed"), default="")
    itc_month = serializers.CharField(allow_null=True, required=False)
    itc_eligible = serializers.BooleanField(default=True)
    buyer_gstin = serializers.CharField(allow_blank=True, default="")
    buyer_ack = serializers.BooleanField(default=False)
    needs_review = serializers.BooleanField(default=False)
    duplicate_ok = serializers.BooleanField(default=False)
    capture = serializers.IntegerField(allow_null=True, default=None)
    source = serializers.ChoiceField(choices=("typed", "capture"), default="typed")
    lines = serializers.ListField(child=serializers.DictField(), min_length=1, max_length=200)


@pytest.fixture
def purchases():
    closed = set()

    def credit(invoice):
        return None if invoice.invoice_date < date(2025, 4, 1) else invoice.itc_month or invoice.invoice_date.replace(day=1)

    def guard(business, month, action="edit"):
        if month in closed:
            raise Refusal(f"{month:%B %Y}'s GSTR-3B is filed. Have the owner unlock {month:%B %Y} in GST returns first.", "month_closed")

    def choose(business, day, value=None, *, invoice=None, today=None):
        if day < date(2025, 4, 1):
            if value is not None:
                raise serializers.ValidationError({"itc_month": ["This bill is before April 2025. Its credit is in the opening balance or lapsed; leave the credit month blank."]})
            return None
        month = date.fromisoformat(value + "-01") if value else day.replace(day=1)
        guard(business, month, "create")
        return None if month == day.replace(day=1) else month

    def save(data, user, invoice=None):
        assert invoice is None
        rows = [{**row, "gst_tax_rate": normalize_rate(row["gst_percent"], assume="percent")} for row in data["lines"]]
        return sale(data["business"], data["supplier"], data["invoice_number"], data["invoice_date"], *rows, kind="inward")

    def restore(binned, user, check_month=True, via="bin"):
        assert check_month is True
        invoice = Invoice.objects.create(pk=binned.original_id, business_id=binned.business_id,
            customer_id=binned.customer_id, invoice_number=binned.invoice_number, invoice_date=binned.invoice_date,
            type_of_invoice="inward", total_amount=binned.total_amount)
        return invoice

    services = SimpleNamespace(save_purchase=Mock(side_effect=save), restore_purchase=Mock(side_effect=restore),
        choose_credit_month=Mock(side_effect=choose), credit_month_of=Mock(side_effect=credit),
        assert_purchase_open=Mock(side_effect=guard), PurchaseSerializer=SeamPurchaseSerializer, closed=closed)
    with patch.object(backup_restore, "_purchase_services", return_value=services, create=True):
        yield services


def registered(number="SUP-001"):
    data = purchase_payload(number)
    data["businesses"][0]["gst_number"] = "08VRHFA2322D1ZI"
    data["customers"][0]["gst_number"] = "08WWUFP9975S1ZN"
    return data


def apply(data):
    owner = person("purchase-restore-owner", "admin")
    answer = backup_restore.preview(upload(data))
    result = backup_restore.apply_restore(upload(data), answer["fingerprint"], owner)
    return result, owner


def test_purchase_preview_is_read_only_and_apply_uses_the_published_save_service(purchases):
    data = registered()
    data["invoices"][0].update(itc_month="2026-04-01", itc_eligible=False, buyer_gstin="08VRHFA2322D1ZI",
        buyer_ack=True, needs_review=True, payment_mode="bank", source="excel", capture=99, linked_sale=88)
    answer = backup_restore.preview(upload(data))
    assert answer["plan"]["purchases"]["add_count"] == 1
    assert not Business.objects.exists() and not Invoice.objects.exists() and not AuditLog.objects.exists()
    purchases.save_purchase.assert_not_called()
    result, owner = apply(data)
    assert result["plan"]["purchases"]["add_count"] == 1
    sent, user = purchases.save_purchase.call_args.args
    assert user == owner
    assert sent["business"].pk == Business.objects.get().pk
    assert sent["supplier"].pk == Customer.objects.get().pk
    assert sent["invoice_date"] == date(2026, 3, 31)
    assert sent["invoice_number"] == "SUP-001"
    assert sent["lines"][0]["gst_percent"] == "0.25"
    assert sent["itc_month"] == "2026-04"
    assert sent["itc_eligible"] is False and sent["needs_review"] is True and sent["buyer_ack"] is True
    assert sent["source"] == "excel" and sent["payment_mode"] == "bank"
    # The plan already refused duplicates under the restore's locks, so 2A's scan is not repeated.
    assert sent["duplicate_ok"] is True and sent.get("capture") is None and "linked_sale" not in sent
    assert AuditLog.objects.filter(entity="invoice", action="imported", entity_id=result["added"]["purchases"][0]).exists()


@pytest.mark.parametrize("day,expected", [("2025-03-31", None), ("2025-04-01", "2025-04")])
def test_null_credit_does_not_shift_an_own_month_or_enter_the_preledger(purchases, day, expected):
    data = registered()
    data["invoices"][0].update(invoice_date=day, itc_month=None)
    result, _owner = apply(data)
    assert result["plan"]["purchases"]["add_count"] == 1
    assert purchases.save_purchase.call_args.args[0]["itc_month"] == expected


def test_purchase_preview_refuses_closed_credit_without_using_sales_lock(purchases):
    business = firm(gstin="08VRHFA2322D1ZI")
    customer = buyer("Supplier", gst_number="08WWUFP9975S1ZN")
    data = registered()
    data["businesses"][0]["name"] = business.name
    data["customers"][0]["name"] = customer.name
    purchases.closed.add(date(2026, 3, 1))
    with patch.object(backup_restore, "assert_sales_open", side_effect=AssertionError("purchase used sales lock")):
        plan = backup_restore.preview(upload(data))["plan"]
    assert plan["purchases"]["fail_count"] == 1
    assert "March 2026" in plan["purchases"]["fail"][0]["why"]
    assert plan["purchases"]["add_count"] == 0
    purchases.save_purchase.assert_not_called()


def test_purchase_bin_uses_latest_saved_credit_and_its_own_restore_service(purchases):
    business = firm(gstin="08VRHFA2322D1ZI")
    supplier = buyer("Supplier", gst_number="08WWUFP9975S1ZN")
    binned = BinnedInvoice.objects.create(original_id=811, business=business, customer=supplier,
        invoice_date=date(2026, 3, 31), invoice_number="SUP-001", type_of_invoice="inward",
        total_amount="321.00", data={"invoice": {"itc_month": "2026-04-01"}, "lines": []})
    data = registered("sup/001")
    data["invoices"][0].update(invoice_date="2026-02-01", itc_month=None)
    data["businesses"][0]["name"] = business.name
    data["customers"][0]["name"] = supplier.name
    purchases.closed.add(date(2026, 4, 1))
    answer = backup_restore.preview(upload(data))
    assert "April 2026" in answer["plan"]["purchases"]["fail"][0]["why"]
    purchases.closed.clear()
    with patch.object(backup_restore, "restore_many_from_bin", side_effect=AssertionError("purchase used sales restore")):
        result, _owner = apply(data)
    assert result["added"]["purchases"] == [811]
    assert Invoice.objects.get().invoice_date == binned.invoice_date
    assert Invoice.objects.get().total_amount == Decimal("321.00")
    assert purchases.restore_purchase.call_args.args[0].pk == binned.pk
    purchases.save_purchase.assert_not_called()


def test_purchase_service_failure_rolls_back_bulk_sales_and_new_masters(purchases):
    data = registered("001")
    row = data["invoices"][0]
    data["invoices"].append({**row, "type_of_invoice": "outward"})
    purchases.save_purchase.side_effect = serializers.ValidationError({"supplier": ["Supplier changed"]})
    with pytest.raises(serializers.ValidationError, match="Supplier changed"):
        apply(data)
    assert not Invoice.objects.exists() and not Business.objects.exists() and not AuditLog.objects.exists()


def test_missing_named_supplier_is_added_once_for_two_purchases(purchases):
    data = registered()
    data["customers"] = []
    row = data["invoices"][0]
    row.update(customer=None, customer_name="New supplier", customerGST="08WWUFP9975S1ZN")
    data["invoices"].append({**row, "invoice_number": "SUP-002"})
    result, _owner = apply(data)
    assert result["plan"]["purchases"]["add_count"] == 2
    assert Customer.objects.count() == 1
    assert {call.args[0]["supplier"].pk for call in purchases.save_purchase.call_args_list} == {Customer.objects.get().pk}


def test_preledger_credit_is_cleared_and_bad_header_is_a_preview_failure(purchases):
    data = registered()
    data["invoices"][0].update(invoice_date="2025-03-31", itc_month="2026-04-01")
    assert backup_restore.preview(upload(data))["plan"]["purchases"]["add_count"] == 1
    assert purchases.choose_credit_month.call_args.kwargs["value"] is None
    data["invoices"][0].update(invoice_date="2026-03-31", itc_month=None, invoice_number="x" * 51)
    assert backup_restore.preview(upload(data))["plan"]["purchases"]["fail_count"] == 1
    purchases.save_purchase.assert_not_called()


@pytest.mark.parametrize("day", ["1999-12-31", "2099-12-31"])
def test_purchase_preview_checks_the_service_date_limits(purchases, day):
    data = registered()
    data["invoices"][0]["invoice_date"] = day
    plan = backup_restore.preview(upload(data))["plan"]
    assert plan["purchases"]["add_count"] == 0
    assert plan["purchases"]["fail_count"] == 1
    purchases.save_purchase.assert_not_called()
