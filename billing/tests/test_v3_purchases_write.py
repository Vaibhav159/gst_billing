"""Purchase saves use the typed number, one money rule and the credit month's lock."""
from datetime import date

import pytest
from django.utils import timezone

from billing.models import AuditLog, Customer, FiledPeriod, Invoice, InwardCapture, LineItem
from billing.tests.v3_helpers import ROLE_GROUPS, buyer, client_for, firm, person, sale

pytestmark = pytest.mark.django_db


@pytest.fixture
def setup(monkeypatch):
    monkeypatch.setattr(timezone, "localdate", lambda *a, **k: date(2026, 10, 8))
    user = person("purchase-owner", *ROLE_GROUPS["owner"])
    business = firm()
    supplier = buyer("Udaipur Supplier", gst_number="08AACFU5521R1ZN")
    payload = {"business": business.pk, "supplier": supplier.pk, "invoice_number": "UBS/0850",
               "invoice_date": "2026-09-04", "lines": [{"product_name": "Gold bullion", "hsn_code": "7108",
               "quantity": "2.001", "unit": "gms", "rate": "123.456", "gst_percent": "3"}]}
    return user, client_for(user), business, supplier, payload


def post(setup, **changes):
    return setup[1].post("/api/purchases/", {**setup[4], **changes}, format="json")


def test_create_rounds_marks_supplier_and_audits(setup):
    response = post(setup)
    assert response.status_code == 201, response.data
    data = response.data
    assert data["taxable"] == "247.04"
    assert (data["cgst"], data["sgst"], data["total_amount"]) == ("3.71", "3.70", "254.45")
    assert data["credit"]["month"] == "2026-09"
    assert data["credit"]["chosen"] is None
    assert data["source"] == "typed"
    assert data["history"]["created_by"]["id"] == setup[0].pk
    assert Customer.objects.get(pk=setup[3].pk).is_supplier
    assert AuditLog.objects.get(action="created", entity_id=data["id"]).details == "Udaipur Supplier · ₹254.45"


def test_filed_bill_month_chooses_open_credit_but_explicit_filed_refuses(setup):
    FiledPeriod.objects.create(business=setup[2], year=2026, month=9)
    assert post(setup, itc_month="2026-09").status_code == 409
    response = post(setup)
    assert response.status_code == 201, response.data
    assert response.data["credit"]["chosen"] == "2026-10"
    assert response.data["credit"]["late"] is True


def test_duplicate_key_and_explicit_override_and_exclusion(setup):
    first = post(setup)
    response = post(setup, invoice_number="UBS-0850")
    assert response.status_code == 409
    assert response.data["code"] == "duplicate"
    assert "same number written differently" in response.data["detail"]
    assert post(setup, invoice_number="UBS-0850", duplicate_ok=True).status_code == 201
    client, payload = setup[1], setup[4]
    check = client.get("/api/purchases/check-duplicate/", {"business_id": setup[2].pk,
        "supplier_id": setup[3].pk, "invoice_number": "UBS/0850", "invoice_date": "2026-09-04",
        "exclude_id": first.data["id"]})
    assert check.data["duplicate"]["id"] != first.data["id"]
    assert client.put(f"/api/purchases/{first.data['id']}/", payload, format="json").status_code == 200


def test_duplicate_uses_registration_across_supplier_records(setup):
    post(setup)
    another = buyer("Same registration", gst_number="08AACFU5521R1ZN")
    assert post(setup, supplier=another.pk).status_code == 409


def test_buyer_confirmation_and_interstate(setup):
    other = firm("MEERA ORNAMENTS", gstin="27ABCDE1234A1Z5", state="MAHARASHTRA")
    response = post(setup, buyer_gstin=other.gst_number)
    assert response.status_code == 400
    assert response.data["buyer_gstin"] == ["This bill is addressed to MEERA ORNAMENTS, not KIRAN GOLD HOUSE."]
    response = post(setup, buyer_gstin=other.gst_number, buyer_ack=True)
    assert response.status_code == 201
    assert "billed_to_other" in response.data["checks"]
    supplier = setup[3]
    supplier.gst_number = "27AACFU5521R1ZN"
    supplier.save()
    response = post(setup, invoice_number="UBS/0851")
    assert response.data["igst"] == "7.41"
    assert response.data["cgst"] == "0.00"


def test_no_gstin_refuses_tax_but_zero_and_amount_only_work(setup):
    setup[3].gst_number = "URP"
    setup[3].save()
    assert post(setup).status_code == 400
    response = post(setup, lines=[{"product_name": "Old gold", "gst_percent": "0",
                                 "taxable": "1234.56", "amount_only": True}])
    assert response.status_code == 201, response.data
    assert response.data["supplier"]["gst_number"] == ""
    assert response.data["lines"][0]["note"] == "Amount only"
    assert response.data["taxable"] == "1234.56"
    assert response.data["first_line"]["amount_only"] is True


def test_unchanged_put_writes_nothing_and_check_only_logs_checked(setup):
    made = post(setup, needs_review=True)
    pk, client, payload = made.data["id"], setup[1], setup[4]
    count = AuditLog.objects.count()
    before_lines = list(LineItem.objects.filter(invoice_id=pk).values_list("id", flat=True))
    response = client.put(f"/api/purchases/{pk}/", payload, format="json")
    assert response.status_code == 200, response.data
    assert AuditLog.objects.count() == count + 1
    assert AuditLog.objects.order_by("-id").first().action == "checked"
    updated = Invoice.objects.get(pk=pk).updated_at
    response = client.put(f"/api/purchases/{pk}/", payload, format="json")
    assert response.status_code == 200
    assert Invoice.objects.get(pk=pk).updated_at == updated
    assert list(LineItem.objects.filter(invoice_id=pk).values_list("id", flat=True)) == before_lines
    assert AuditLog.objects.count() == count + 1


def test_put_changes_clear_check_and_keeps_credit_when_unsent(setup):
    made = post(setup, needs_review=True, itc_month="2026-10")
    pk = made.data["id"]
    response = setup[1].put(f"/api/purchases/{pk}/", {**setup[4], "invoice_number": "UBS/0852",
                "needs_review": {"bad": True}, "capture": [], "source": []}, format="json")
    assert response.status_code == 200, response.data
    assert response.data["credit"]["month"] == "2026-10"
    assert not response.data["needs_review"]
    audit = AuditLog.objects.order_by("-id").first()
    assert audit.action == "updated"
    assert audit.details == "Changed the number, checked"


def test_checked_and_move_credit_are_idempotent_and_locked_by_old_month(setup):
    made = post(setup, needs_review=True)
    pk, client = made.data["id"], setup[1]
    assert client.post(f"/api/purchases/{pk}/checked/").data == {"id": pk, "needs_review": False}
    before = AuditLog.objects.count()
    assert client.post(f"/api/purchases/{pk}/checked/").status_code == 200
    assert AuditLog.objects.count() == before
    moved = client.put(f"/api/purchases/{pk}/credit-month/", {"itc_month": "2026-10"}, format="json")
    assert moved.status_code == 200, moved.data
    assert moved.data["previous"] == "2026-09"
    assert AuditLog.objects.order_by("-id").first().details == "Credit claimed in October 2026 (was September 2026)"
    assert AuditLog.objects.order_by("-id").first().action == "credit_set"
    before = AuditLog.objects.count()
    assert client.put(f"/api/purchases/{pk}/credit-month/", {"itc_month": "2026-10"}, format="json").status_code == 200
    assert AuditLog.objects.count() == before
    FiledPeriod.objects.create(business=setup[2], year=2026, month=10)
    for method, suffix, payload in [("post", "checked/", {}), ("put", "", setup[4]),
                                     ("put", "credit-month/", {"itc_month": None}), ("delete", "", {})]:
        response = getattr(client, method)(f"/api/purchases/{pk}/{suffix}", payload, format="json")
        assert response.status_code == 409, response.data
        assert response.data["code"] == "month_closed"
        assert response.data["detail"].endswith("Have the owner unlock October 2026 in GST returns first.")


@pytest.mark.parametrize("role,create,edit,delete", [("owner", 201, 200, 200), ("accountant", 201, 200, 403),
                                                   ("staff", 201, 403, 403), ("viewer", 403, 403, 403)])
def test_purchase_permissions(setup, role, create, edit, delete):
    pk = post(setup).data["id"]
    client = client_for(person(role, *ROLE_GROUPS[role]))
    assert client.post("/api/purchases/", {**setup[4], "invoice_number": "ROLE-1"}, format="json").status_code == create
    assert client.put(f"/api/purchases/{pk}/", setup[4], format="json").status_code == edit
    assert client.delete(f"/api/purchases/{pk}/", {}, format="json").status_code == delete


@pytest.mark.parametrize("field,value,words", [
    ("business", [], "Choose which firm bought this."), ("supplier", True, "Choose the supplier, or add a new one."),
    ("invoice_number", "", "Type the bill number printed on the supplier's bill."),
    ("invoice_number", "x"*51, "Keep the bill number to 50 characters."),
    ("invoice_date", "bad", "Type the date like 2026-09-30."),
    ("invoice_date", "1999-12-31", "Pick a date from 2000 to 2099."),
    ("invoice_date", "2026-10-09", "That's after today (08 Oct 2026). Check the date on the bill."),
    ("itc_month", {}, "Give the month like 2026-09."),
    ("itc_month", "2026-08", "The credit can't go in a month before the bill's date (September 2026)."),
    ("itc_month", "2026-11", "November 2026 hasn't started yet. Pick a month up to this one."),
    ("lines", [], "Add at least one item from the bill."), ("lines", [{}]*201, "A bill can have at most 200 items.")])
def test_header_validation_words(setup, field, value, words):
    response = post(setup, **{field: value})
    assert response.status_code == 400, response.data
    assert response.data[field] == [words]


@pytest.mark.parametrize("field,value,words", [
    ("product_name", "", "Choose the item from the bill."),
    ("hsn_code", "71A8", "Type the HSN code from the bill: 4 to 8 digits."),
    ("gst_percent", "", "Choose the slab printed on the bill (0% if it charges no GST)."),
    ("gst_percent", "25", "Choose the slab printed on the bill (0% if it charges no GST)."),
    ("quantity", "NaN", "Type the quantity in grams (gms)."), ("quantity", "1.0001", "Type the quantity in grams (gms)."),
    ("rate", "Infinity", "Type the rate printed on the bill."), ("unit", "stone", "Pick a unit from the list."),
    ("note", "x"*61, "Keep the note to 60 characters.")])
def test_line_validation_words(setup, field, value, words):
    line = {**setup[4]["lines"][0], field: value}
    response = post(setup, lines=[line])
    assert response.status_code == 400, response.data
    assert response.data["lines"][0][field] == [words]


@pytest.mark.parametrize("body", [[], "bad", True, None])
def test_odd_bodies_are_field_errors(setup, body):
    response = setup[1].post("/api/purchases/", body, format="json")
    assert response.status_code == 400
    assert response.data["business"] == ["Choose which firm bought this."]


def test_capture_consumed_atomically_and_only_once(setup):
    capture = InwardCapture.objects.create(image="synthetic.jpg", captured_by=setup[0])
    first = post(setup, capture=capture.pk, source="capture")
    assert first.status_code == 201, first.data
    capture.refresh_from_db()
    assert capture.status == "converted"
    assert capture.invoice_id == first.data["id"]
    second = post(setup, capture=capture.pk, invoice_number="UBS/0851", source="capture")
    assert second.status_code == 409
    assert second.data["code"] == "capture_used"
    assert Invoice.objects.purchases().count() == 1


def test_sales_ids_never_accept_purchase_actions(setup):
    outward = sale(setup[2], setup[3], "KGH/2026-27/1", date(2026, 9, 4))
    for method, suffix, data in [("get", "", {}), ("put", "", setup[4]), ("delete", "", {}), ("post", "checked/", {})]:
        assert getattr(setup[1], method)(f"/api/purchases/{outward.pk}/{suffix}", data, format="json").status_code == 404


def test_noop_keeps_stored_heads_after_supplier_moves_state(setup):
    made = post(setup)
    pk = made.data["id"]
    setup[3].gst_number = "27AACFU5521R1ZN"
    setup[3].state_name = "MAHARASHTRA"
    setup[3].save()
    before = AuditLog.objects.count()
    response = setup[1].put(f"/api/purchases/{pk}/", setup[4], format="json")
    assert response.status_code == 200
    assert response.data["cgst"] == "3.71"
    assert response.data["igst"] == "0.00"
    assert response.data["interstate"] is False
    assert AuditLog.objects.count() == before


def test_update_snapshot_holds_old_header_and_lines(setup):
    made = post(setup)
    pk = made.data["id"]
    response = setup[1].put(f"/api/purchases/{pk}/", {**setup[4], "invoice_number": "NEW-1",
                "lines": [{**setup[4]["lines"][0], "rate": "1000"}]}, format="json")
    assert response.status_code == 200
    entry = AuditLog.objects.filter(action="updated", entity_id=pk).get()
    assert entry.snapshot["invoice_number"] == "UBS/0850"
    assert entry.snapshot["line_items"][0]["rate"] == "123.456"


@pytest.mark.parametrize("field", ["quantity", "rate", "gst_percent", "hsn_code"])
@pytest.mark.parametrize("value", [[], {}, True, "9" * 1000, "1e999999999", "\x00"])
def test_nested_and_extreme_line_values_are_400(setup, field, value):
    response = post(setup, lines=[{**setup[4]["lines"][0], field: value}])
    assert response.status_code == 400, response.data


def test_preledger_purchase_has_no_claim_or_movable_credit(setup):
    made = post(setup, invoice_date="2024-03-10")
    assert made.status_code == 201, made.data
    assert made.data["credit"]["month"] is None
    assert made.data["credit"]["chosen"] is None
    assert made.data["credit"]["state"] == "outside"
    assert made.data["credit"]["claimed"] == "0.00"
    pk = made.data["id"]
    words = "This bill is before April 2025. Its credit is in the opening balance or lapsed; leave the credit month blank."
    moved = setup[1].put(f"/api/purchases/{pk}/credit-month/", {"itc_month": "2026-10"}, format="json")
    assert moved.status_code == 400, moved.data
    assert moved.data == {"itc_month": [words]}
    count = AuditLog.objects.filter(entity_id=pk).count()
    FiledPeriod.objects.create(business=setup[2], year=2024, month=3)
    unchanged = setup[1].put(f"/api/purchases/{pk}/credit-month/", {"itc_month": None}, format="json")
    assert unchanged.status_code == 200, unchanged.data
    assert unchanged.data["previous"] is None
    assert unchanged.data["credit"] == made.data["credit"]
    assert AuditLog.objects.filter(entity_id=pk).count() == count
    assert setup[1].post(f"/api/purchases/{pk}/checked/").status_code == 200
    changed = setup[1].put(f"/api/purchases/{pk}/", {**setup[4], "invoice_date": "2024-03-10", "payment_mode": "cash"}, format="json")
    assert changed.status_code == 200, changed.data
    assert changed.data["credit"]["month"] is None
    refused = post(setup, invoice_number="PRE-LEDGER", invoice_date="2024-03-10", itc_month="2026-10")
    assert refused.status_code == 400 and refused.data == {"itc_month": [words]}
    assert not setup[1].get("/api/purchases/", {"credit_month": "2026-10"}).data["results"]
