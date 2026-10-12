"""Product records, figures and writes under v3's permission matrix."""
from decimal import Decimal, InvalidOperation

from django.db.models import Q
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.api.permissions import V3Permission
from billing.api.sales import Pages
from billing.cache import uncached
from billing.models import Product
from billing.params import text_param
from billing.services.catalog import (
    KINDS,
    PRODUCT_FIELDS,
    catalog_figures,
    catalog_summary,
    effective_kind,
    product_detail,
    product_names,
    product_row,
    scope,
)
from billing.tax_rules import GST_SLABS
from billing.text import percent


class CatalogPages(Pages):
    page_size = 20


def get_product(pk, lock=False):
    products = uncached(Product)
    if lock:
        products = products.select_for_update()
    product = (products if lock else products.only(*PRODUCT_FIELDS)).filter(pk=pk).first()
    if product is None:
        raise NotFound("This product isn't on file.")
    return product


class CatalogList(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"POST": "product.edit"}

    def post(self, request):
        return write_product(request)

    def get(self, request):
        params = request.query_params
        period = scope(params)
        show = params.get("show", "all")
        if show not in ("all", "sold", "bought"):
            raise ValidationError({"show": ["Choose all, sold or bought."]})
        ordering = params.get("ordering", "name")
        if ordering not in ("name", "-sold", "hsn"):
            raise ValidationError({"ordering": ["Sort by name, -sold or hsn."]})
        kind = params.get("kind", "")
        if kind and kind not in KINDS:
            raise ValidationError({"kind": ["Pick a kind from the list."]})
        rate = None
        if params.get("gst_rate"):
            try:
                rate = Decimal(params["gst_rate"])
                if not rate.is_finite() or rate not in GST_SLABS:
                    raise ValueError
            except (InvalidOperation, ValueError):
                raise ValidationError({"gst_rate": ["Choose one of the GST rates."]}) from None
        all_names = list(uncached(Product).values_list("id", "name"))
        twins = {}
        for pk, name in all_names:
            twins.setdefault(name.lower(), []).append({"id": pk, "name": name})
        total = len(all_names)
        q = text_param(params, "q")[:100]
        products = uncached(Product)
        if show != "all":
            products = products.filter(purchase_only=show == "bought")
        if q:
            products = products.filter(Q(name__icontains=q) | Q(hsn_code__icontains=q)
                                       | Q(purity__icontains=q) | Q(description__icontains=q))
        # Filter/sort from small columns; descriptions and rates cross the wire only for the page.
        products = [p for p in products.only("id", "name", "hsn_code", "kind", "gst_tax_rate", "default_unit")
                    if (not kind or effective_kind(p) == kind)
                    and (rate is None or Decimal(percent(p.gst_tax_rate)) == rate)]
        aliases = product_names(products) if params.get("figures") == "1" or ordering == "-sold" else {}
        figures = catalog_figures(products, aliases, period) if aliases else {}
        products.sort(key=lambda p: ((-Decimal(figures[p.pk]["taxable"]) if ordering == "-sold" else p.hsn_code)
                                     if ordering != "name" else p.name.lower(), p.name.lower(), p.pk))
        pager = CatalogPages()
        page = pager.paginate_queryset(products, request, view=self)
        complete = {p.pk: p for p in uncached(Product).filter(pk__in=[p.pk for p in page])
                    .only(*(field for field in PRODUCT_FIELDS if field != "updated_at"))}
        rows = [{**product_row(complete[p.pk]), **({"sold": figures[p.pk]} if params.get("figures") == "1" else {})}
                for p in page if p.pk in complete]
        response = pager.get_paginated_response(rows)
        response.data.update(total_products=total, twins=[values for values in twins.values() if len(values) > 1])
        if params.get("figures") == "1":
            response.data["summary"] = catalog_summary([name for values in aliases.values() for name in values], period,
                                                        not (q or kind or rate is not None or show != "all"))
        return response


class CatalogDetail(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"PUT": "product.edit", "DELETE": "product.edit"}

    def put(self, request, pk):
        return write_product(request, pk)

    def delete(self, request, pk):
        return delete_product(request, pk)

    def get(self, request, pk):
        return Response(product_detail(get_product(pk), request.query_params))


def validate_product(data, instance=None):
    """Full product form: strict shapes and contract words; off-slab legacy values may stay."""
    import re

    from billing.constants import UNIT_CHOICES
    from billing.services.catalog import per_unit
    from billing.tax_rules import normalize_rate

    if not isinstance(data, dict):
        raise ValidationError({"detail": "Send a product as an object."})
    errors = {}
    values = {}
    TEXT_WORDS = {"purity": "Type the purity as text, like 22K or 925.", "description": "Type the description as text."}
    for key, maximum, missing, length in (
        ("name", 255, "Enter the product's name, as it should print on bills.", "Keep the name to 255 characters."),
        ("hsn_code", 8, "Enter the HSN code. Every bill line needs one for GSTR-1.", ""),
        ("purity", 20, "Keep the purity short, like 22K or 925 (20 characters at most).", "Keep the purity short, like 22K or 925 (20 characters at most)."),
        ("description", 1000, "Keep the description to 1,000 characters.", "Keep the description to 1,000 characters."),
    ):
        value = data.get(key, "")
        if not isinstance(value, str) or "\x00" in value:
            errors[key] = [TEXT_WORDS.get(key, missing)]
            continue
        value = " ".join(value.split()) if key == "name" else value.strip()
        values[key] = value
        if not value and key in ("name", "hsn_code"):
            errors[key] = [missing]
        elif key == "hsn_code" and re.fullmatch(r"[0-9]{4,8}", value) is None:
            errors[key] = [f"HSN codes have 4 to 8 digits; this has {len(value)}."]
        elif len(value) > maximum:
            errors[key] = [length]
    unit = data.get("unit", "gms")
    if not isinstance(unit, str) or unit not in dict(UNIT_CHOICES):
        errors["unit"] = ["Pick a unit from the list."]
        unit = "gms"
    values["default_unit"] = unit
    kind = data.get("kind")
    if kind == "":
        kind = None
    if kind is not None and (not isinstance(kind, str) or kind not in KINDS):
        errors["kind"] = ["Pick a kind from the list."]
    else:
        values["kind"] = kind
    bought = data.get("purchase_only", False)
    if not isinstance(bought, bool):
        errors["purchase_only"] = ["Choose whether this product is Bought only."]
    else:
        values["purchase_only"] = bought
    raw = data.get("gst_percent")
    if raw is None or raw == "":
        errors["gst_percent"] = ["Choose the GST rate. There's no default, so a wrong rate can't slip onto bills."]
    else:
        try:
            rate = Decimal(str(raw))
            same = instance is not None and rate == Decimal(percent(instance.gst_tax_rate))
            if not rate.is_finite() or (rate not in GST_SLABS and not same):
                raise ValueError
            values["gst_tax_rate"] = instance.gst_tax_rate if same else normalize_rate(rate)
        except (InvalidOperation, ValueError):
            errors["gst_percent"] = ["Choose one of the GST rates: 0, 0.1, 0.25, 1, 1.5, 3, 5, 12, 18, 28 or 40%."]
    raw = data.get("usual_rate")
    values["usual_rate"] = None
    if raw is not None and raw != "":
        try:
            rate = Decimal(str(raw))
            if not rate.is_finite() or not 0 < rate < 100000000 or rate.as_tuple().exponent < -3:
                raise ValueError
            values["usual_rate"] = rate
        except (InvalidOperation, ValueError):
            errors["usual_rate"] = [f"Type the rate {per_unit(unit)}, like 6470.00, or leave it empty."]
    if "name" not in errors and (instance is None or values["name"].lower() != instance.name.lower()):
        twin = uncached(Product).filter(name__iexact=values["name"]).exclude(pk=instance.pk if instance else None).values_list("name", flat=True).first()
        if twin:
            errors["name"] = [f"There's already a product called {twin}. Names that differ only in capital letters confuse the bill form; use a different name."]
    if errors:
        raise ValidationError(errors)
    return values


def write_product(request, pk=None):
    from django.db import IntegrityError, transaction

    from billing.api.mixins import EXCLUDED_FIELDS, snapshot_of
    from billing.models import AuditLog
    from billing.services.audit import change_rows
    from billing.services.catalog import catalog_names_lock, per_unit
    from billing.text import inr

    try:
        with transaction.atomic():
            catalog_names_lock()
            product = get_product(pk, lock=True) if pk is not None else None
            values = validate_product(request.data, product)
            old = snapshot_of(product) if product else None
            if product is None:
                product = Product.objects.create(**values)
                changes = []
                details = f"HSN {product.hsn_code} · GST {percent(product.gst_tax_rate)}% · {per_unit(product.default_unit)}"
                if product.usual_rate is not None:
                    details += f" · {inr(product.usual_rate)}"
                AuditLog.objects.create(entity="product", entity_id=product.pk, entity_name=product.name,
                                        user=request.user, action="created", details=details, snapshot=snapshot_of(product))
            else:
                changed = [key for key, value in values.items() if getattr(product, key) != value]
                for key in changed:
                    setattr(product, key, values[key])
                changes = []
                if changed:
                    product.save(update_fields=[*changed, "updated_at"])
                    fresh = snapshot_of(product)
                    raw = {key: {"old": old[key], "new": fresh[key]} for key in changed if key not in EXCLUDED_FIELDS}
                    changes = change_rows(Product, raw)
                    details = " · ".join(f"{c['field']} {c['from']} → {c['to']}" for c in changes)
                    AuditLog.objects.create(entity="product", entity_id=product.pk, entity_name=product.name,
                                            user=request.user, action="updated", details=details, changes=raw, snapshot=old)
            result = product_detail(product, request.query_params)
            if pk is not None:
                result["changes"] = changes
            return Response(result, status=201 if pk is None else 200)
    except IntegrityError:
        # A v2 writer does not share the catalog lock; exact-name uniqueness still gives words.
        validate_product(request.data)
        raise ValidationError({"name": ["Someone saved a product with this name just now. Check the catalog, then save again."]}) from None


def delete_product(request, pk):
    from django.db import transaction

    from billing.api.mixins import snapshot_of
    from billing.models import AuditLog
    from billing.refusals import Refusal
    from billing.services.catalog import catalog_names_lock, product_uses

    with transaction.atomic():
        catalog_names_lock()
        product = get_product(pk, lock=True)
        uses = product_uses(product)
        if any(uses.values()):
            parts = [f"{count} {label if count == 1 else plural}" for key, label, plural in (
                ("sales", "sales bill", "sales bills"), ("cancelled", "cancelled bill", "cancelled bills"),
                ("purchases", "purchase bill", "purchase bills"), ("bin", "bill in the bin", "bills in the bin"))
                     if (count := uses[key])]
            words = parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]
            raise Refusal(f"{product.name} is on {words}, so it can't be deleted. Mark it Bought only to hide it from sales bills instead.",
                          "in_use", uses={**uses, "drafts": 0, "captures": 0})
        entry = AuditLog.objects.create(entity="product", entity_id=product.pk, entity_name=product.name,
                                       user=request.user, action="deleted", details=f"HSN {product.hsn_code} · on no bills · restorable",
                                       snapshot=snapshot_of(product))
        product.delete()
        return Response({"audit_id": entry.pk})
