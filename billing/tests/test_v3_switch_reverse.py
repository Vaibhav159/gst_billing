"""Going forward after a rollback (part 7, Ruling 7-D14; Ruling 1A-45): a bill v2 moved to another firm keeps the old
firm's frozen details, because v2 doesn't know firm_snapshot. --reverse lists and clears them; the freeze sets the new."""
from datetime import date
from io import StringIO

import pytest
from django.core.management import call_command

from billing.models import Invoice
from billing.services.sales import firm_snapshot
from billing.tests.v3_helpers import buyer, firm, sale

pytestmark = pytest.mark.django_db


def reverse(*flags):
    out = StringIO()
    call_command("prepare_v2_rollback", "--reverse", *flags, stdout=out)
    return out.getvalue()


def test_reverse_clears_the_frozen_firm_of_a_bill_v2_moved_and_freeze_sets_its_own():
    old, new, customer = firm(), firm("NEW FIRM"), buyer()
    moved = sale(old, customer, "1", date(2026, 9, 1), firm_snapshot=firm_snapshot(old))
    kept = sale(old, customer, "2", date(2026, 9, 1), firm_snapshot=firm_snapshot(old))
    Invoice.objects.filter(pk=moved.pk).update(business=new)  # what v2.0.9's PATCH does while rolled back

    said = reverse()
    assert "  NEW FIRM 1 of 2026-09-01: frozen with KIRAN GOLD HOUSE's details" in said
    assert "1 bill(s) moved to another firm while v2 ran: frozen details to clear." in said
    moved.refresh_from_db()
    assert moved.firm_snapshot == firm_snapshot(old)  # a dry run changes nothing

    said = reverse("--apply")
    assert "1 bill(s) moved to another firm while v2 ran: frozen details cleared." in said
    moved.refresh_from_db()
    kept.refresh_from_db()
    assert moved.firm_snapshot is None
    assert kept.firm_snapshot == firm_snapshot(old)

    call_command("freeze_firm_snapshots", "--apply", stdout=StringIO())
    moved.refresh_from_db()
    assert moved.firm_snapshot == firm_snapshot(new)
    assert "0 bill(s) moved to another firm while v2 ran" in reverse()


def test_reverse_leaves_unfrozen_bills_and_old_snapshots_without_a_firm_id_alone():
    business, customer = firm(), buyer()
    bare = sale(business, customer, "1", date(2026, 9, 1))
    legacy = sale(business, customer, "2", date(2026, 9, 1), firm_snapshot={"name": "Earlier"})
    assert "0 bill(s) moved to another firm while v2 ran" in reverse("--apply")
    bare.refresh_from_db()
    legacy.refresh_from_db()
    assert bare.firm_snapshot is None
    assert legacy.firm_snapshot == {"name": "Earlier"}


@pytest.mark.parametrize("text_id", [False, True])
def test_reverse_without_a_rollback_keeps_every_current_firm_snapshot(text_id):
    business, customer = firm(), buyer()
    bill = sale(business, customer, "1", date(2026, 9, 1))
    call_command("freeze_firm_snapshots", "--apply", stdout=StringIO())
    bill.refresh_from_db()
    frozen = bill.firm_snapshot
    if text_id:
        frozen["business_id"] = str(business.pk)
        Invoice.objects.filter(pk=bill.pk).update(firm_snapshot=frozen)
    assert "0 bill(s) moved to another firm while v2 ran" in reverse("--apply")
    bill.refresh_from_db()
    assert bill.firm_snapshot == frozen


@pytest.mark.parametrize("frozen_id", ["text_id", "unknown", None, []])
def test_reverse_names_text_firm_ids_and_reports_unrecognised_ids(frozen_id):
    old, new, customer = firm(), firm("NEW FIRM"), buyer()
    value = str(old.pk) if frozen_id == "text_id" else frozen_id
    frozen = {**firm_snapshot(old), "business_id": value}
    bill = sale(new, customer, "1", date(2026, 9, 1), firm_snapshot=frozen)
    old_name = old.name if frozen_id == "text_id" else f"firm {value}"
    assert f"  NEW FIRM 1 of 2026-09-01: frozen with {old_name}'s details" in reverse()
    bill.refresh_from_db()
    assert bill.firm_snapshot == frozen
    reverse("--apply")
    bill.refresh_from_db()
    assert bill.firm_snapshot is None
