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
    def get(self, request, pk):
        return Response(product_detail(get_product(pk), request.query_params))
