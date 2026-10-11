"""Catalog figures match current and unclaimed earlier names, around cacheops."""
from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Case, CharField, Count, F, Q, Sum, Value, When
from django.db.models.functions import Lower, Round
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from billing.cache import uncached
from billing.constants import BILL_CANCELLED, INVOICE_TYPE_INWARD, INVOICE_TYPE_OUTWARD
from billing.fy import fy_of, fy_range
from billing.models import AuditLog, BinnedInvoice, Business, FiledPeriod, Invoice, LineItem, Product
from billing.numbering import REF_FIELDS, bill_ref
from billing.params import PICK_A_FIRM, fy_param, id_param
from billing.services.firms import firm_ref
from billing.tax_rules import GST_SLABS
from billing.text import money, percent, stamp

KINDS = tuple(value for value, _label in Product._meta.get_field("kind").choices)
PRODUCT_FIELDS = ("id", "name", "hsn_code", "gst_tax_rate", "default_unit", "kind", "purity", "usual_rate",
                  "purchase_only", "description", "updated_at")
HSN_TEXT = {
    "7113": "Jewellery of gold, silver or platinum", "71131910": "Gold jewellery", "71131920": "Silver jewellery",
    "7114": "Articles of gold or silver (utensils)", "7118": "Coins", "7108": "Gold, unwrought (bullion)",
    "7106": "Silver, unwrought (bars)", "7102": "Diamonds, cut and polished",
    "71023100": "Diamonds, rough (non-industrial)", "9988": "Job work on jewellery",
    "9983": "Hallmarking and other professional services", "4819": "Cartons and jewellery boxes",
}
ZERO = Decimal("0")


def three(value):
    return str(Decimal(value or 0).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP))


def effective_kind(product):
    return product.kind_effective


def product_row(product):
    rate = percent(product.gst_tax_rate)
    return {"id": product.pk, "name": product.name, "hsn_code": product.hsn_code,
            "hsn_text": HSN_TEXT.get(product.hsn_code, ""), "gst_percent": rate,
            "slab_ok": Decimal(rate) in GST_SLABS, "unit": product.default_unit, "kind": product.kind or None,
            "kind_effective": effective_kind(product), "kind_set": bool(product.kind), "purity": product.purity,
            "usual_rate": three(product.usual_rate) if product.usual_rate is not None else None,
            "purchase_only": product.purchase_only, "description": product.description}


def scope(params):
    start, end = fy_range(fy_param(params) or fy_of())
    business = id_param(params, "business_id", PICK_A_FIRM)
    if business is not None and not uncached(Business).filter(pk=business).exists():
        raise ValidationError({"business_id": [PICK_A_FIRM]})
    return start, min(end, timezone.localdate()) if fy_of(start) == fy_of() else end, business


def product_names(products):
    """One audit read for the products; a current holder owns its name over historical aliases."""
    holders = defaultdict(set)
    for pk, name in uncached(Product).values_list("id", "name"):
        holders[name.lower()].add(pk)
    names = {product.pk: [product.name] for product in products}
    for pk, changes in uncached(AuditLog).filter(entity="product", entity_id__in=names, changes__has_key="name") \
            .order_by("timestamp", "id").values_list("entity_id", "changes"):
        change = changes.get("name")
        if not isinstance(change, dict):
            continue
        for key in ("old", "new"):
            name = change.get(key)
            if not isinstance(name, str) or not name or holders[name.lower()] - {pk}:
                continue
            if name not in names[pk]:
                names[pk].append(name)
    return names


def matching_lines(names):
    return uncached(LineItem).alias(product_key=Lower("product_name")).filter(product_key__in={n.lower() for n in names})


def scoped_lines(names, period, kind=INVOICE_TYPE_OUTWARD):
    start, end, business = period
    lines = matching_lines(names).filter(invoice__type_of_invoice=kind, invoice__invoice_date__range=(start, end))
    return lines.filter(invoice__business_id=business) if business is not None else lines


def _aggregates(active=None):
    return {"bills": Count("invoice_id", distinct=True, filter=active),
            "taxable": Sum(Round(F("quantity") * F("rate"), 2), filter=active),
            "tax": Sum(Round(F("cgst"), 2) + Round(F("sgst"), 2) + Round(F("igst"), 2), filter=active),
            "quantity": Sum("quantity", filter=active)}


def _figures(group, quantities, unit, cancelled=None):
    unit = "gms" if unit in ("g", "gms") else unit
    result = {"bills": group.get("bills") or 0, "quantity": three(quantities.get(unit)),
              "other_units": [{"unit": key, "quantity": three(value)} for key, value in sorted(quantities.items())
                              if key != unit],
              "taxable": money(group.get("taxable")), "tax": money(group.get("tax"))}
    if cancelled is not None:
        result["cancelled"] = cancelled
    return result


def catalog_figures(products, aliases, period):
    """SQL groups by matched name; a second narrow group keeps historical units separate."""
    if not products:
        return {}
    clauses = [When(product_key__in=[n.lower() for n in aliases[p.pk]], then=Value(p.name.lower())) for p in products]
    lines = scoped_lines([name for values in aliases.values() for name in values], period).annotate(
        canonical=Case(*clauses, output_field=CharField()))
    active = ~Q(invoice__status=BILL_CANCELLED)
    groups = {r["canonical"]: r for r in lines.values("canonical").annotate(
        **_aggregates(active), cancelled=Count("invoice_id", distinct=True, filter=~active)).order_by()}
    quantities = defaultdict(dict)
    for row in lines.counted().annotate(
            u=Case(When(unit__in=("g", "gms"), then=Value("gms")), default=F("unit"))) \
            .values("canonical", "u").annotate(quantity=Sum("quantity")).order_by():
        quantities[row["canonical"]][row["u"]] = row["quantity"]
    return {p.pk: _figures(groups.get(p.name.lower(), {}), quantities[p.name.lower()], p.default_unit,
                           groups.get(p.name.lower(), {}).get("cancelled", 0)) for p in products}


def catalog_summary(names, period, show_empty):
    lines = scoped_lines(names, period)
    active = ~Q(invoice__status=BILL_CANCELLED)
    added = lines.aggregate(**_aggregates(active), cancelled=Count("invoice_id", distinct=True, filter=~active))
    start, end, business = period
    empty = Invoice.objects.sales().counted().filter(invoice_date__range=(start, end), lineitem__isnull=True)
    if business is not None:
        empty = empty.filter(business_id=business)
    refs = list(empty.select_related("customer").only(*REF_FIELDS).order_by("invoice_date", "id")[:2]) if show_empty else []
    return {"taxable": money(added["taxable"]), "bills": added["bills"], "cancelled": added["cancelled"],
            "no_items": [bill_ref(bill) for bill in refs], "no_items_count": empty.count() if show_empty else 0}


def product_uses(product, names=None):
    names = names or product_names([product])[product.pk]
    lines = matching_lines(names)
    sale = Q(invoice__type_of_invoice=INVOICE_TYPE_OUTWARD)
    cancelled = Q(invoice__status=BILL_CANCELLED)
    uses = lines.aggregate(sales=Count("invoice_id", distinct=True, filter=sale & ~cancelled),
                           cancelled=Count("invoice_id", distinct=True, filter=sale & cancelled),
                           purchases=Count("invoice_id", distinct=True, filter=Q(invoice__type_of_invoice=INVOICE_TYPE_INWARD)))
    keys = {name.lower() for name in names}
    uses["bin"] = sum(any(isinstance(line, dict) and str(line.get("product_name", "")).lower() in keys
                          for line in (rows or []))
                      for rows in uncached(BinnedInvoice).live().values_list("data__lines", flat=True))
    return uses


def _line_bills(lines):
    return lines.select_related("invoice__customer", "invoice__business").only(
        "invoice_id", "quantity", "rate", "unit", "invoice__business_id",
        "invoice__business__name", "invoice__business__short_name", *(f"invoice__{field}" for field in REF_FIELDS))


def hsn_on_bills(product, names):
    lines = matching_lines(names)
    groups = []
    for row in lines.values("hsn_code").annotate(lines=Count("id")).order_by("-lines", "hsn_code"):
        key = row["hsn_code"]
        group = {**row, "matches": key == product.hsn_code, "sales": [], "purchases": []}
        for kind, target in ((INVOICE_TYPE_OUTWARD, "sales"), (INVOICE_TYPE_INWARD, "purchases")):
            ids = lines.filter(hsn_code=key, invoice__type_of_invoice=kind).values("invoice_id")
            bills = uncached(Invoice).filter(pk__in=ids).order_by("-invoice_date", "-id")
            if target == "sales":
                group[target] = [bill_ref(b) for b in bills.select_related("customer").only(*REF_FIELDS)[:3]]
            else:
                group[target] = [{"id": pk, "bill_no": number} for pk, number in bills.values_list("id", "invoice_number")[:3]]
        groups.append(group)
    closed = set(uncached(FiledPeriod).values_list("business_id", "year", "month"))
    ids = lines.filter(hsn_code="", invoice__type_of_invoice=INVOICE_TYPE_OUTWARD).counted().values("invoice_id")
    bills = uncached(Invoice).filter(pk__in=ids).select_related("customer", "business").only(
        *REF_FIELDS, "business_id", "business__name", "business__short_name").order_by("invoice_date", "id")
    blocking = [{"bill": bill_ref(b), "business": firm_ref(b.business), "month": b.invoice_date.strftime("%Y-%m")}
                for b in bills if (b.business_id, b.invoice_date.year, b.invoice_date.month) not in closed]
    return {"lines": sum(g["lines"] for g in groups), "groups": groups, "blocking": blocking}


def product_detail(product, params):
    period = scope(params)
    names = product_names([product])[product.pk]
    sold = catalog_figures([product], {product.pk: names}, period)[product.pk]
    bought_lines = scoped_lines(names, period, INVOICE_TYPE_INWARD).counted()
    quantities = {r["u"]: r["quantity"] for r in bought_lines.annotate(
        u=Case(When(unit__in=("g", "gms"), then=Value("gms")), default=F("unit"))).values("u")
        .annotate(quantity=Sum("quantity")).order_by()}
    bought = _figures(bought_lines.aggregate(**_aggregates()), quantities, product.default_unit)
    sales = scoped_lines(names, period).counted()
    unit_filter = Q(unit__in=("g", "gms")) if product.default_unit in ("g", "gms") else Q(unit=product.default_unit)
    own_unit = sales.filter(unit_filter).aggregate(units=Sum("quantity"), taxable=Sum(Round(F("quantity") * F("rate"), 2)))
    by_firm = defaultdict(dict)
    for kind, lines in (("sold", sales), ("bought", bought_lines)):
        for row in lines.values("invoice__business_id").annotate(**{**_aggregates(), "quantity": Sum("quantity", filter=unit_filter)}).order_by():
            by_firm[row["invoice__business_id"]][kind] = {"bills": row["bills"], "quantity": three(row["quantity"]), "taxable": money(row["taxable"])}
    empty = {"bills": 0, "quantity": "0.000", "taxable": "0.00"}
    firms = [{"business": firm_ref(b), "sold": by_firm[b.pk].get("sold", empty), "bought": by_firm[b.pk].get("bought", empty)}
             for b in uncached(Business).filter(pk__in=by_firm).only("id", "name", "short_name").order_by("name", "id")]
    limit = 200 if params.get("lines") == "all" else 8
    latest = _line_bills(sales).order_by("-invoice__invoice_date", "-invoice_id", "-id")[:limit]
    return {**product_row(product), "sold": sold, "bought": bought, "by_firm": firms,
            "average_rate": three(own_unit["taxable"] / own_unit["units"]) if own_unit["units"] else None,
            "lines": [{"bill": bill_ref(li.invoice), "business": firm_ref(li.invoice.business),
                       "quantity": three(li.quantity), "unit": li.unit, "rate": three(li.rate),
                       "taxable": money(li.quantity * li.rate)} for li in latest],
            "line_count": sales.count(), "hsn_on_bills": hsn_on_bills(product, names),
            "uses": product_uses(product, names), "earlier_names": [name for name in names if name != product.name],
            "updated_at": stamp(product.updated_at)}


def catalog_names_lock():
    """Serialize v3 name checks, including audit restores, while keeping exact-case DB uniqueness.

    PostgreSQL is production and CI. SQLite's test database serializes writes itself.
    """
    from django.db import connection

    if connection.vendor == "postgresql":
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(41001)")


def per_unit(unit):
    return "per piece" if unit in ("pcs", "nos", "unit") else f"per {'g' if unit == 'gms' else unit}"
