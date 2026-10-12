"""X-88: editing a supplier never changes a purchase's recorded credit eligibility."""

from datetime import date
from decimal import Decimal

import pytest

from billing.models import FilingRecord
from billing.services.filing import mark_filed
from billing.services.ledger import credit_at_risk_summary, gstr3b_tables, month_position
from billing.services.purchase_reads import purchase_queryset, purchase_rows, purchase_summary
from billing.services.report_context import credit_payload, report_payload
from billing.services.suppliers import save_supplier
from billing.tests.v3_helpers import buyer, firm, person, sale

pytestmark = pytest.mark.django_db
TODAY = date(2026, 10, 8)
START, END = date(2026, 9, 1), date(2026, 9, 30)


@pytest.fixture(autouse=True)
def today(monkeypatch):
    monkeypatch.setattr("django.utils.timezone.localdate", lambda *args, **kwargs: TODAY)


def report(kind, business, start=START, end=END):
    return report_payload(kind, business, start, end, split=False, side="sales")


@pytest.mark.parametrize("filed", [False, True])
def test_clearing_supplier_gstin_preserves_credit_across_every_reader(filed):
    business = firm(gstin="08VRHFA2322D1ZI")
    supplier = buyer("Supplier", gst_number="08ABCDE1234A1Z5", is_supplier=True)
    owner = person("owner", "admin")
    bill = sale(business, supplier, "P1", date(2026, 9, 10), kind="inward")
    if filed:
        mark_filed(business, START, owner, {
            "kind": "both", "gstr1_filed_on": "2026-10-04", "filed_on": "2026-10-05",
            "cash_total": "0.00", "confirm_checks": True,
        })
    frozen = list(FilingRecord.objects.filter(business=business).values("pk", "figures"))

    def snapshot():
        tables = gstr3b_tables(business, 2026, 9, today=TODAY)
        credit = credit_payload(business, 2026)["buckets"]
        register = report("purchases", business)
        months = report("months", business)
        tax = report("tax", business)
        workbook = report("ca-workbook", business)["firms"][0]
        purchases = purchase_queryset().filter(pk=bill.pk)
        card = purchase_rows(purchases)[0]["credit"]
        workbook_tables = workbook["gstr3b"][0]["tables"]
        amounts = {
            "ledger": month_position(business, 2026, 9, today=TODAY)["credit"]["total"],
            "gstr3b_gross": tables["t4a5"]["heads"]["total"],
            "gstr3b_net": tables["t4c"]["total"],
            "credit": credit["claimed" if filed else "open"]["tax"],
            "register": register["credit_by_return"]["tax"],
            "months": months["rows"][0]["credit"]["total"],
            "months_total": months["totals"]["credit"]["total"],
            "tax": tax["firms"][0]["rows"][0]["credit"]["total"],
            "workbook_gross": workbook_tables["t4a5"]["heads"]["total"],
            "workbook_net": workbook_tables["t4c"]["total"],
            "purchase_summary": purchase_summary(purchases)["credit"],
            "purchase_card": card["claimed"],
        }
        state = "claimed" if filed else "to_claim"
        assert register["bills"][0]["credit_state"] == state
        assert workbook["months"][0]["purchases"]["rows"][0][19] == state
        assert card["state"] == ("filed" if filed else "open")
        assert credit["none"] == []
        return {key: Decimal(str(value)) for key, value in amounts.items()}

    before = snapshot()
    assert set(before.values()) == {Decimal("300.00")}
    save_supplier({"name": supplier.name, "gst_number": ""}, owner, instance=supplier)
    assert snapshot() == before
    assert list(FilingRecord.objects.filter(business=business).values("pk", "figures")) == frozen


def test_clearing_supplier_gstin_keeps_prior_year_credit_and_other_firm_risk():
    business = firm(gstin="08VRHFA2322D1ZI")
    other = firm("MEERA ORNAMENTS")
    supplier = buyer("Supplier", gst_number="08ABCDE1234A1Z5", is_supplier=True)
    owner = person("owner", "admin")
    for shop in (business, other):
        sale(shop, supplier, "OLD", date(2026, 2, 18), kind="inward", itc_month=START)

    def snapshot():
        current = credit_payload(business, 2026)
        risk = current["at_risk"]
        assert (risk["count"], risk["tax"]) == (1, "300.00")
        assert current["others_at_risk"] == [{"business": other.pk, "short": "Meera", "count": 1}]
        assert credit_payload(business, 2025)["buckets"]["open"] == {"bills": 1, "tax": "300.00"}
        choices = risk["bills"][0]["claim_months"]
        assert "2026-09" in {choice["month"] for choice in choices}
        summary = credit_at_risk_summary([business.pk, other.pk])
        assert (summary["count"], summary["tax"]) == (2, Decimal("600.00"))
        return choices

    before = snapshot()
    save_supplier({"name": supplier.name, "gst_number": ""}, owner, instance=supplier)
    assert snapshot() == before


def test_clearing_supplier_gstin_keeps_preledger_credit_figures():
    business = firm(gstin="08VRHFA2322D1ZI")
    supplier = buyer("Supplier", gst_number="08ABCDE1234A1Z5", is_supplier=True)
    owner = person("owner", "admin")
    sale(business, supplier, "BEFORE", date(2025, 3, 18), kind="inward")

    def snapshot():
        tax = report("tax", business, date(2025, 3, 1), date(2025, 3, 31))
        return (tax["firms"][0]["rows"][0]["credit"]["total"],
                credit_payload(business, 2024)["buckets"]["before_ledger"])

    before = snapshot()
    assert before == ("300.00", {"count": 1, "tax": "300.00"})
    save_supplier({"name": supplier.name, "gst_number": ""}, owner, instance=supplier)
    assert snapshot() == before
