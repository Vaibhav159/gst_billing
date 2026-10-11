"""Supplier records, their scoped purchase figures, rates and last-bill memory."""

import re
from decimal import ROUND_HALF_UP, Decimal

from django.db import IntegrityError, transaction
from django.db.models import (
    Case,
    Count,
    DecimalField,
    Exists,
    F,
    IntegerField,
    Max,
    Min,
    OuterRef,
    Q,
    Subquery,
    Sum,
    Value,
    When,
)
from django.db.models.functions import Coalesce, ExtractMonth, ExtractYear, Lower, Trim, Upper
from django.http import Http404
from rest_framework.exceptions import ValidationError

from billing.cache import uncached
from billing.credit import LEDGER_START
from billing.fy import fy_range
from billing.gstin import validate
from billing.models import AuditLog, Customer, Invoice, LineItem, ShopSetting
from billing.refusals import Refusal
from billing.tax_rules import clean_gstin, rate_as_percent
from billing.text import money

FIELDS = ("id", "name", "gst_number", "state_name", "city", "address", "pan_number", "mobile_number", "email", "is_supplier")
NEWEST = ("-invoice_date", "-id")
ZERO = Decimal("0")
DECIMAL = DecimalField(max_digits=24, decimal_places=3)


def suppliers():
    return uncached(Customer).alias(has_purchase=Exists(Invoice.objects.purchases().filter(customer=OuterRef("pk"))))\
        .filter(Q(is_supplier=True) | Q(has_purchase=True)).only(*FIELDS)


def get_supplier(pk):
    raw = str(pk)
    found = suppliers().filter(pk=raw).first() if raw.isascii() and raw.isdigit() and len(raw) <= 18 else None
    if found is None:
        raise Http404("No supplier matches the given query.")
    return found


def scoped_purchases(firm=None, fy=None):
    bills = Invoice.objects.purchases()
    if firm is not None:
        bills = bills.filter(business_id=firm)
    if fy is not None:
        bills = bills.filter(invoice_date__range=fy_range(fy))
    return bills


def tax_total():
    """Each line's heads rounded to paise before adding, as bill_reads.sums and the credit ledger do."""
    from billing.services.purchase_reads import Paise

    tax = uncached(LineItem).filter(invoice_id=OuterRef("pk")).order_by().values("invoice_id")\
        .annotate(tax=Sum(Paise(F("cgst")) + Paise(F("sgst")) + Paise(F("igst")), output_field=DECIMAL)).values("tax")
    return Coalesce(Subquery(tax), Value(ZERO), output_field=DECIMAL)


def ordered_suppliers(rows, ordering, firm=None, fy=None):
    if ordering == "-total":
        totals = scoped_purchases(firm, fy).filter(customer_id=OuterRef("pk")).order_by().values("customer_id")\
            .annotate(total=Sum("total_amount")).values("total")
        rows = rows.alias(purchase_total=Coalesce(Subquery(totals), Value(ZERO), output_field=DECIMAL))
    return rows.order_by(*(["-purchase_total"] if ordering == "-total" else []), Lower("name"), "pk")


def supplier_summary(rows, firm=None, fy=None, *, count):
    bills = scoped_purchases(firm, fy).filter(customer_id__in=rows.order_by().values("pk"))
    figures = bills.annotate(_tax=tax_total()).aggregate(bills=Count("pk"), total=Sum("total_amount"), tax=Sum("_tax"))
    return {"suppliers": count, "bills": figures["bills"],
            **{key: money(figures[key] or ZERO) for key in ("total", "tax")}}


def supplier_figures(ids, firm=None, fy=None):
    """One aggregate query; invoice totals are never multiplied by joining their lines."""
    if not ids:
        return {}
    bills = scoped_purchases(firm, fy).filter(customer_id__in=ids)
    newest = scoped_purchases(firm, fy).filter(customer_id=OuterRef("customer_id")).order_by(*NEWEST)
    bills = bills.annotate(
        _tax=tax_total(),
        _limit_year=ExtractYear("invoice_date") + Case(When(invoice_date__month__lt=4, then=Value(0)),
                                                     default=Value(1), output_field=IntegerField()),
        _credit_year=ExtractYear(Coalesce("itc_month", "invoice_date")),
        _credit_month=ExtractMonth(Coalesce("itc_month", "invoice_date")),
    )
    in_time = Q(_credit_year__lt=F("_limit_year")) | Q(_credit_year=F("_limit_year"), _credit_month__lte=10)
    eligible = Q(itc_eligible=True, invoice_date__gte=LEDGER_START) & in_time
    added = bills.order_by().values("customer_id").annotate(
        bills=Count("pk"), total=Sum("total_amount"), tax=Sum("_tax"),
        credit=Sum(Case(When(eligible, then=F("_tax")), default=Value(ZERO), output_field=DECIMAL)),
        last_id=Subquery(newest.values("pk")[:1]), last_date=Subquery(newest.values("invoice_date")[:1]),
    )
    found = {row["customer_id"]: row for row in added}
    result = {}
    for pk in ids:
        row = found.get(pk, {})
        result[pk] = {"bills": row.get("bills", 0), **{key: money(row.get(key) or ZERO) for key in ("total", "tax", "credit")},
                      "last": {"id": row["last_id"], "invoice_date": row["last_date"].isoformat()} if row.get("last_id") else None}
    return result


def supplier_object(customer):
    from billing.services.purchase_reads import supplier_ref

    latest = Invoice.objects.purchases().filter(customer=customer).order_by(*NEWEST).values_list("invoice_number", flat=True).first()
    gstin = clean_gstin(customer.gst_number)
    return {**supplier_ref(customer, detail=True), "gstin_valid": validate(gstin)[0] if gstin else True,
            "prefix": re.sub(r"[0-9]+$", "", latest or "") if latest and re.search(r"[0-9]+$", latest) else ""}


def rates(bills):
    lines = uncached(LineItem).filter(invoice_id__in=bills.values("pk")).exclude(note="Amount only")\
        .exclude(unit__in=("nos", "pcs", "unit"), quantity=1)
    values = lines.values("product_name", "unit").annotate(
        quantity=Sum("quantity"), value=Sum(F("amount") - F("cgst") - F("sgst") - F("igst")),
        bills=Count("invoice_id", distinct=True), low=Min("rate"), high=Max("rate"),
    ).order_by("-value", "product_name", "unit")
    return [{**row, "quantity": f"{row['quantity']:.3f}", "value": money(row["value"]),
             "average": f"{(row['value'] / row['quantity'] if row['quantity'] else ZERO).quantize(Decimal('.001'), rounding=ROUND_HALF_UP):.3f}",
             "low": f"{row['low']:.3f}", "high": f"{row['high']:.3f}"} for row in values]


def supplier_detail(customer, firm=None, fy=None):
    from billing.services.purchase_reads import purchase_queryset, purchase_rows

    bills = scoped_purchases(firm, fy).filter(customer=customer)
    shown = purchase_queryset().filter(pk__in=bills.values("pk")).order_by(*NEWEST)[:200]
    return {"supplier": supplier_object(customer), "figures": supplier_figures([customer.pk], firm, fy)[customer.pk],
            "rates": rates(bills), "bills": purchase_rows(list(shown))}


def memory(customer, firm=None):
    bills = scoped_purchases(firm).filter(customer=customer)
    latest = bills.order_by(*NEWEST).values("id", "invoice_number", "invoice_date").first()
    result = {"bills": bills.count(), "last": None, "line": None, "next_number": None}
    if latest is None:
        return result
    result["last"] = {**latest, "invoice_date": latest["invoice_date"].isoformat()}
    first = uncached(LineItem).filter(invoice_id=latest["id"]).order_by("pk")\
        .values("product_name", "hsn_code", "unit", "gst_tax_rate").first()
    if first:
        percent = rate_as_percent(first.pop("gst_tax_rate"))
        result["line"] = {**first, "gst_percent": format(percent, "f").rstrip("0").rstrip(".") if "." in str(percent) else str(percent)}
    match = re.fullmatch(r"(.*?)([0-9]+)", latest["invoice_number"])
    if match:
        prefix, digits = match.groups()
        numbers = (re.fullmatch(re.escape(prefix) + r"([0-9]+)", value) for value in
                   bills.filter(invoice_number__startswith=prefix).values_list("invoice_number", flat=True))
        highest = max(int(found[1]) for found in numbers if found)
        result["next_number"] = prefix + str(highest + 1).zfill(len(digits))
    return result


def name_problem(name, instance=None):
    existing = uncached(Customer).filter(name__iexact=name).exclude(pk=instance.pk if instance else None)\
        .only("pk", "name", "gst_number", "is_supplier").first()
    if existing is None:
        return
    if existing.is_supplier or Invoice.objects.purchases().filter(customer=existing).exists():
        words = (f"{name} is already a supplier (GSTIN {clean_gstin(existing.gst_number)}). "
                 "If this is another branch, give it its own name, like the city.")
    else:
        words = f"{name} is already on file as a customer. If this is another firm, give it its own name, like the city."
    raise ValidationError({"name": [words]})


def save_supplier(data, user, instance=None, enrich=True):
    from billing.services.purchase_reads import supplier_ref

    with transaction.atomic():
        # A singleton serialises supplier creates, including two new records with the same GSTIN.
        ShopSetting.objects.select_for_update().get_or_create(pk=1)
        if instance:
            instance = uncached(Customer).select_for_update().filter(pk=instance.pk).only(*FIELDS).first()
            if instance is None:
                raise Http404("No supplier matches the given query.")
        name_problem(data["name"], instance)
        gstin = data.get("gst_number", instance.gst_number if instance else "")
        if gstin:
            found = suppliers().annotate(normal_gstin=Upper(Trim("gst_number"))).filter(normal_gstin=gstin)\
                .exclude(pk=instance.pk if instance else None).first()
            if found:
                raise Refusal(f"This GSTIN belongs to {found.name}, already in your suppliers.", "gstin_taken",
                              supplier=supplier_ref(found))
        created = instance is None
        before = {field: getattr(instance, field) for field in FIELDS if field != "id"} if instance else {}
        customer = instance or Customer()
        for field, value in data.items():
            setattr(customer, field, value)
        customer.is_supplier = True
        try:
            with transaction.atomic():
                customer.save()
        except IntegrityError:
            name_problem(data["name"], instance)
            raise ValidationError({"name": ["This supplier couldn't be saved. Check the supplier details and try again."]}) from None
        changes = {field: {"old": str(value) if value is not None else None,
                           "new": str(getattr(customer, field)) if getattr(customer, field) is not None else None}
                   for field, value in before.items() if value != getattr(customer, field)}
        AuditLog.objects.create(action="created" if created else "updated", entity="customer", entity_id=customer.pk,
                                entity_name=customer.name, user=user, changes=changes,
                                details="New supplier" if created else "Supplier details updated")
        if created and enrich:
            # Import dry runs roll back this callback with their rows.
            from billing.gstin import enrich_customer

            transaction.on_commit(lambda: enrich_customer(customer))
        return customer
