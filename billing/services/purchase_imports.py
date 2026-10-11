"""Atomic purchase/sales imports: a dry run executes the same rules and rolls back."""

from decimal import Decimal

from django.db import transaction
from django.db.models.functions import Trim, Upper
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError

from billing.api.body import UNSTORABLE, valid
from billing.cache import uncached
from billing.models import AuditLog, Customer, ShopSetting
from billing.numbering import lock_firms
from billing.roles import can, why_not
from billing.services.sales import save_bill
from billing.services.suppliers import save_supplier
from billing.tax_rules import clean_gstin
from billing.text import inr, money


def problems(detail, prefix=""):
    """DRF's nested dictionaries and lists become the client's zero-based field paths."""
    if isinstance(detail, dict):
        return [problem for key, value in detail.items() for problem in
                problems(value, f"{prefix}.{key}" if prefix else str(key))]
    if isinstance(detail, list):
        return [problem for index, value in enumerate(detail) for problem in
                problems(value, f"{prefix}.{index}" if isinstance(value, dict | list) else prefix)]
    return [{"field": prefix, "detail": str(detail)}]


def party_for_pair(business):
    gstin = clean_gstin(business.gst_number)
    if not gstin:
        raise ValidationError({"pair": ["Add the buyer firm's GSTIN before importing a bill between firms."]})
    customer = uncached(Customer).annotate(normal_gstin=Upper(Trim("gst_number"))).filter(normal_gstin=gstin)\
        .only("id", "name", "gst_number", "state_name", "address", "pan_number", "mobile_number", "email", "customer_type", "city").first()
    if customer:
        return customer
    name = business.name
    if uncached(Customer).filter(name__iexact=name).exists():
        suffix = f" ({gstin})"
        name = name[:255 - len(suffix)] + suffix
    if uncached(Customer).filter(name__iexact=name).exists():
        raise ValidationError({"pair": [f"{name} is already on file. Give the buyer firm a different name before importing this pair."]})
    return Customer.objects.create(name=name, gst_number=gstin, state_name=business.state_name,
                                   address=business.address, customer_type="business")


def import_bills(data, user, *, sales=False):
    from billing.api.bill_imports import PairSerializer
    from billing.api.purchases import PurchaseSerializer
    from billing.api.sales import SaleSerializer
    from billing.api.suppliers import SupplierSerializer
    from billing.services.purchase_reads import credit_block
    from billing.services.purchases import save_purchase

    has_pairs = any(isinstance(row, dict) and row.get("pair") is not None for row in data["bills"])
    if (sales or has_pairs) and not can(user, "bill.create"):
        raise PermissionDenied({"detail": why_not(user, "bill.create"), "needs": "bill.create"})

    party_key = "customers" if sales else "suppliers"
    dry_run, file_name = data["dry_run"], data["file_name"]
    result = {"dry_run": dry_run, "ok": True, "bills": [], party_key: [],
              "totals": {"bills": 0, "total_amount": "0.00", "credit": "0.00"}}
    created_ids = set()
    total, credit = Decimal("0"), Decimal("0")
    with transaction.atomic():
        # One order for every batch: party mutex, then every participating firm in ascending order.
        ShopSetting.objects.select_for_update().get_or_create(pk=1)
        firm_ids = set()
        for row in data["bills"]:
            if isinstance(row, dict):
                pair = row.get("pair")
                for value in (row.get("business"), pair.get("seller") if isinstance(pair, dict) else None):
                    if isinstance(value, int) and not isinstance(value, bool) and 0 < value < 10**18:
                        firm_ids.add(value)
                    elif isinstance(value, str) and value.isascii() and value.isdigit() and len(value) <= 18:
                        firm_ids.add(int(value))
        if firm_ids:
            lock_firms(*firm_ids)
        parties = {}
        for index, row in enumerate(data[party_key]):
            try:
                payload = {key: value for key, value in row.items() if key != "ref"}
                party_data = valid(SupplierSerializer, payload)
                if sales:
                    # Sales imports use the same party fields but never mark their customers as suppliers.
                    from billing.services.suppliers import name_problem

                    name_problem(party_data["name"])
                    customer = Customer.objects.create(**party_data)
                    AuditLog.objects.create(action="created", entity="customer", entity_id=customer.pk,
                                            entity_name=customer.name, user=user, details="New customer")
                else:
                    customer = save_supplier(party_data, user)
            except APIException as refused:
                detail = refused.detail
                if isinstance(detail, dict) and "code" in detail:
                    field = "gst_number" if detail["code"] == "gstin_taken" else "non_field_errors"
                    detail = {field: [detail["detail"]]}
                errors = {}
                for problem in problems(detail, f"{party_key}.{index}"):
                    errors.setdefault(problem["field"], []).append(problem["detail"])
                raise ValidationError(errors) from None
            parties[row["ref"]] = customer.pk
            result[party_key].append({"ref": row["ref"], "id": customer.pk})
        for index, row in enumerate(data["bills"]):
            ref = row.get("ref", f"Bill {index + 1}") if isinstance(row, dict) else f"Bill {index + 1}"
            answer = {"ref": ref, "ok": False, "id": None, "problems": [], "duplicate": None, "credit": None}
            try:
                with transaction.atomic():
                    if not isinstance(row, dict):
                        raise ValidationError({"bill": ["Give each bill as an object with its fields."]})
                    if not isinstance(ref, str) or not ref.strip():
                        raise ValidationError({"ref": ["Give this bill its row or photo reference."]})
                    ref = UNSTORABLE.sub("", ref)
                    answer["ref"] = ref
                    payload = dict(row)
                    relation = "customer" if sales else "supplier"
                    party = payload.get(relation)
                    if isinstance(party, str):
                        # JSON ids are numbers; every string is a declared batch reference.
                        payload[relation] = parties.get(party)
                    if sales:
                        payload["paper"] = True
                        bill = save_bill(valid(SaleSerializer, payload), user)
                        claimed = Decimal("0")
                    else:
                        payload.pop("capture", None)
                        payload.update(duplicate_ok=False, needs_review=False, source="typed")
                        purchase_data = valid(PurchaseSerializer, payload)
                        purchase_data["source"] = "excel" if file_name else "photos"
                        if row.get("pair") is not None:
                            pair = valid(PairSerializer, row["pair"])
                            seller, buyer = pair["seller"], purchase_data["business"]
                            if seller.pk == buyer.pk:
                                raise ValidationError({"pair": ["Choose two different firms for this bill."]})
                            if clean_gstin(seller.gst_number) != clean_gstin(purchase_data["supplier"].gst_number):
                                raise ValidationError({"pair": ["Choose the seller firm whose GSTIN is on this bill."]})
                            customer = party_for_pair(buyer)
                            sale_data = {"business": seller.pk, "customer": customer.pk, "paper": True,
                                         "invoice_number": pair["invoice_number"], "invoice_date": payload.get("invoice_date"),
                                         "payment_mode": payload.get("payment_mode", ""), "lines": payload.get("lines")}
                            paired_sale = save_bill(valid(SaleSerializer, sale_data), user)
                            purchase_data["linked_sale"] = paired_sale.pk
                            created_ids.add(paired_sale.pk)
                        bill = save_purchase(purchase_data, user)
                        answer["credit"] = credit_block(bill)
                        claimed = Decimal(answer["credit"]["claimed"])
                    created_ids.add(bill.pk)
                    answer.update(ok=True, id=bill.pk)
                    result["totals"]["bills"] += 1
                    total += bill.total_amount
                    credit += claimed
                    ids = [bill.pk] + ([paired_sale.pk] if not sales and row.get("pair") is not None else [])
                    for entry in AuditLog.objects.filter(action="created", entity="invoice", entity_id__in=ids).only("pk", "details"):
                        entry.details += f" · from {file_name or 'bill photos'}, {ref}"
                        entry.save(update_fields=["details"])
            except APIException as refused:
                result["ok"] = False
                detail = refused.detail
                if isinstance(detail, dict) and "code" in detail:
                    answer["duplicate"] = detail.get("purchase")
                    field = "invoice_number" if detail["code"] in ("duplicate", "number_taken", "number_deleted") else "itc_month" if detail["code"] == "month_closed" else ""
                    answer["problems"] = [{"field": field, "detail": str(detail["detail"])}]
                else:
                    answer["problems"] = problems(detail)
            result["bills"].append(answer)
        result["totals"].update(total_amount=money(total), credit=money(credit))
        if dry_run or not result["ok"]:
            transaction.set_rollback(True)
            for row in result["bills"]:
                row["id"] = None
                if row["duplicate"] and row["duplicate"]["id"] in created_ids:
                    row["duplicate"] = None
            for row in result[party_key]:
                row["id"] = None
        else:
            origin = file_name or f"{len(data['bills'])} bill photos"
            AuditLog.objects.create(action="imported", entity="invoice", entity_id=result["bills"][0]["id"],
                                    entity_name=(file_name or "Bill photos")[:255], user=user,
                                    details=f"From {origin} · {inr(total)} · ITC {inr(credit)}")
    return result
