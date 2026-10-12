"""The counter's existing walk-in record is an explicit choice (part 7, X-83)."""
import re
from datetime import date
from io import StringIO
from unittest.mock import patch

import pytest
from django.core.management import CommandError, call_command
from django.db import connection

from billing.constants import BILL_CANCELLED
from billing.models import Customer
from billing.tests.v3_helpers import buyer, firm, sale

pytestmark = pytest.mark.django_db
CHOOSE = "Choose a customer with --id, or add a new one with --add."


def walkin(*args):
    out = StringIO()
    call_command("mark_walkin", *args, stdout=out)
    return out.getvalue()


def test_mark_walkin_only_adds_when_explicitly_requested_and_only_once():
    said = walkin()
    assert "No customers without a GSTIN." in said
    assert CHOOSE in said
    assert "Dry run: nothing changed. Run again with --apply." in said
    assert 'Would add a new customer "Walk-in Customer"' not in said
    with pytest.raises(CommandError, match=re.escape(CHOOSE)):
        walkin("--apply")
    assert not Customer.objects.exists()

    assert 'Would add a new customer "Walk-in Customer" as the walk-in record.' in walkin("--add")
    assert not Customer.objects.exists()
    said = walkin("--add", "--apply")
    record = Customer.objects.get(customer_type="walkin")
    assert record.name == "Walk-in Customer"
    assert f"Marked: Walk-in Customer (id {record.pk}) is the walk-in record." in said
    assert walkin("--add", "--apply") == f"Already marked: Walk-in Customer (id {record.pk}). Nothing to do.\n"
    assert Customer.objects.count() == 1


def test_an_existing_walkin_name_is_never_chosen_implicitly():
    named = buyer("walk-in customer")
    assert CHOOSE in walkin()
    with pytest.raises(CommandError, match=re.escape(CHOOSE)):
        walkin("--apply")
    named.refresh_from_db()
    assert named.customer_type != "walkin"
    assert Customer.objects.count() == 1


def test_candidates_rank_cash_sales_and_show_counts_and_last_active_sale():
    business = firm()
    popular = buyer("Zoya", gst_number="URP")
    bank = buyer("AAA CASH SALES")
    empty = buyer("COUNTER")
    for number, customer, mode, day in [
        ("1", popular, "cash", 1), ("2", popular, "cash", 2), ("3", popular, "bank", 10),
        ("4", bank, "cash", 1), ("5", bank, "bank", 2), ("6", bank, "credit", 3),
        ("7", bank, "mixed", 4), ("8", bank, "", 5),
    ]:
        sale(business, customer, number, date(2026, 9, day), payment_mode=mode)
    sale(business, bank, "9", date(2026, 9, 29), payment_mode="cash", status=BILL_CANCELLED)
    sale(business, bank, "10", date(2026, 9, 30), payment_mode="cash", kind="inward")

    said = walkin()
    assert "Customers without a GSTIN, with the most cash sales first:" in said
    first = f"  Zoya (id {popular.pk}): 3 sales bill(s), 2 cash sale(s), last bill 2026-09-10"
    second = f"  AAA CASH SALES (id {bank.pk}): 5 sales bill(s), 1 cash sale(s), last bill 2026-09-05"
    third = f"  COUNTER (id {empty.pk}): 0 sales bill(s), 0 cash sale(s), last bill none"
    assert first in said and second in said and third in said
    assert said.index(first) < said.index(second) < said.index(third)
    assert not Customer.objects.filter(customer_type="walkin").exists()


@pytest.mark.parametrize("gstin", [None, "", "  ", "NA", "URP"])
def test_candidates_include_gstin_placeholders(gstin):
    candidate = buyer("Anil Gupta", gst_number=gstin)
    assert f"  Anil Gupta (id {candidate.pk}):" in walkin()


@pytest.mark.parametrize("gstin", ["08AAKFS4821M1ZM", " 08AAKFS4821M1ZM "])
def test_registered_customers_are_neither_candidates_nor_valid_targets(gstin):
    registered = buyer("Cash Trader", gst_number=gstin)
    assert "Cash Trader" not in walkin()
    with pytest.raises(CommandError, match=re.escape("Cash Trader has a GSTIN; the walk-in record has none. Choose another.")):
        walkin("--id", str(registered.pk), "--apply")


def test_candidate_limit_is_applied_after_cash_ordering():
    for n in range(11):
        buyer(f"Customer {n:02}")
    top = buyer("Zoya")
    sale(firm(), top, "1", date(2026, 9, 1), payment_mode="cash")
    rows = [row for row in walkin().splitlines() if row.startswith("  ")]
    assert len(rows) == 10
    assert rows[0].startswith(f"  Zoya (id {top.pk}):")


@pytest.mark.parametrize("recorded_cash", [False, True])
def test_cash_ties_rank_total_sales_before_names_and_the_candidate_limit(recorded_cash):
    for n in range(11):
        buyer(f"Customer {n:02}")
    business, recent, historical = firm(), buyer("AAA"), buyer("ZZZ old counter")
    mode = "cash" if recorded_cash else ""
    sale(business, recent, "1", date(2026, 9, 1), payment_mode=mode)
    sale(business, historical, "2", date(2026, 9, 1), payment_mode=mode)
    sale(business, historical, "3", date(2026, 8, 1))
    sale(business, historical, "4", date(2026, 8, 2))
    rows = [row for row in walkin().splitlines() if row.startswith("  ")]
    assert len(rows) == 10
    assert rows[0].startswith(f"  ZZZ old counter (id {historical.pk}): 3 sales bill(s)")
    assert rows[1].startswith(f"  AAA (id {recent.pk}): 1 sales bill(s)")


def test_candidates_keep_database_parameters_and_loaded_customers_bounded():
    Customer.objects.bulk_create([Customer(name=f"Counter {n:03}") for n in range(100)])

    def bounded(execute, sql, params, many, context):
        assert len(params or ()) <= 20
        return execute(sql, params, many, context)

    with connection.execute_wrapper(bounded), patch.object(Customer, "from_db", wraps=Customer.from_db) as loaded:
        rows = [row for row in walkin().splitlines() if row.startswith("  ")]
    assert len(rows) == 10
    assert loaded.call_count <= 10


def test_suppliers_are_not_walkin_candidates_even_if_they_have_cash_sales():
    supplier = buyer("Cash Supplier", is_supplier=True)
    sale(firm(), supplier, "1", date(2026, 9, 1), payment_mode="cash")
    said = walkin()
    assert "Cash Supplier" not in said
    assert "No customers without a GSTIN." in said


@pytest.mark.parametrize("flags", [(), ("--apply",)])
def test_suppliers_cannot_be_marked_by_id(flags):
    supplier = buyer("Cash Supplier", is_supplier=True)
    before = Customer.objects.filter(pk=supplier.pk).values().get()
    with pytest.raises(CommandError, match=re.escape("Cash Supplier is a supplier; the walk-in record must be a customer. Choose another.")):
        walkin("--id", str(supplier.pk), *flags)
    assert Customer.objects.filter(pk=supplier.pk).values().get() == before


def test_mark_by_id_preserves_the_customer_and_bills_and_never_marks_a_second():
    cash = buyer("CASH", address="Existing address", mobile_number="9000000001")
    other = buyer("Counter sales")
    bill = sale(firm(), cash, "1", date(2026, 9, 1), payment_mode="cash")
    before = Customer.objects.filter(pk=cash.pk).values().get()
    assert f"Would mark CASH (id {cash.pk}) as the walk-in record." in walkin("--id", str(cash.pk))
    assert Customer.objects.filter(pk=cash.pk).values().get() == before
    walkin("--id", str(cash.pk), "--apply")
    after = Customer.objects.filter(pk=cash.pk).values().get()
    assert after == {**before, "customer_type": "walkin"}
    bill.refresh_from_db()
    assert bill.customer_id == cash.pk
    already = f"Already marked: CASH (id {cash.pk}). Nothing to do.\n"
    assert walkin() == already
    assert walkin("--id", str(cash.pk), "--apply") == already
    for flags in [(), ("--apply",)]:
        assert walkin("--id", str(other.pk), *flags) == already + f"--id {other.pk} was not applied.\n"
    assert Customer.objects.filter(customer_type="walkin").count() == 1


def test_invalid_id_and_ambiguous_options_are_refused():
    with pytest.raises(CommandError, match=re.escape("No customer has id 999999.")):
        walkin("--id", "999999")
    with pytest.raises(CommandError, match="not allowed with argument"):
        walkin("--id", "999999", "--add", "--apply")
    assert not Customer.objects.exists()


def test_add_refuses_an_existing_canonical_name_and_lists_ids_for_selection():
    named = buyer("walk-in customer")
    with pytest.raises(CommandError, match=re.escape('A customer is already named "Walk-in Customer". Choose it with --id.')):
        walkin("--add", "--apply")
    assert f"  walk-in customer (id {named.pk}):" in walkin()
    buyer("WALK-IN CUSTOMER")
    with pytest.raises(CommandError, match=re.escape('More than one customer is named "Walk-in Customer". Choose one with --id.')):
        walkin("--add", "--apply")
    assert not Customer.objects.filter(customer_type="walkin").exists()
