"""The v3 supplier register, independent of v2's customer write contract."""

from decimal import Decimal

from django.db.models import Q
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from billing.api.body import UNSTORABLE, valid
from billing.api.permissions import V3Permission
from billing.api.serializers import PAN_WORDS, CustomerSerializer
from billing.fy import fy_of
from billing.gstin import validate
from billing.params import PICK_A_FIRM, fy_param, id_param, text_param
from billing.services import suppliers as service
from billing.tax_rules import clean_gstin, gstin_problem, state_name_from_gstin
from billing.text import money

NAME_WORDS = "Type the supplier's name as it's printed on their bill."


class SupplierSerializer(CustomerSerializer):
    class Meta(CustomerSerializer.Meta):
        fields = ("name", "gst_number", "state_name", "city", "address", "mobile_number", "pan_number", "email")
        extra_kwargs = {
            "name": {"validators": [], "error_messages": dict.fromkeys(("required", "null", "blank", "invalid", "max_length"), NAME_WORDS)},
            "pan_number": {"error_messages": {"max_length": PAN_WORDS, "invalid": PAN_WORDS}},
            "email": {"error_messages": {"invalid": "This doesn't look like an email address."}},
        }

    def to_internal_value(self, data):
        if isinstance(data, dict):
            data = {key: UNSTORABLE.sub("", value) if isinstance(value, str) else value for key, value in data.items()}
        return super().to_internal_value(data)

    def validate_gst_number(self, value):
        problem = gstin_problem(value)
        if problem:
            raise serializers.ValidationError(problem)
        gstin = clean_gstin(value)
        if gstin:
            ok, problem = validate(gstin)
            if not ok:
                raise serializers.ValidationError(f"{gstin} doesn't check out: {problem} Correct it, or leave it blank for an unregistered party.")
        return gstin

    def validate(self, data):
        gstin = data.get("gst_number", self.instance.gst_number if self.instance else "")
        if gstin and validate(gstin)[0]:
            data["state_name"] = state_name_from_gstin(gstin)
        return data


class SupplierPages(PageNumberPagination):
    page_size = 100
    page_size_query_param = "page_size"
    max_page_size = 500
    invalid_page_message = "This list has no page {page_number}."


class SupplierViewSet(viewsets.GenericViewSet):
    permission_classes = [V3Permission]
    pagination_class = SupplierPages
    lookup_value_regex = r"\d+"
    v3_actions = {"create": "supplier.edit", "update": "supplier.edit"}

    def scope(self):
        params = self.request.query_params
        return id_param(params, "business_id", PICK_A_FIRM), fy_param(params) or fy_of()

    def list(self, request):
        from billing.services.purchase_reads import supplier_ref

        firm, fy = self.scope()
        rows = service.suppliers()
        if query := text_param(request.query_params, "q"):
            rows = rows.filter(Q(name__icontains=query) | Q(city__icontains=query) | Q(state_name__icontains=query) | Q(gst_number__icontains=query))
        ordering = request.query_params.get("ordering", "-total")
        if ordering not in ("-total", "name"):
            raise serializers.ValidationError({"ordering": ["Choose name or -total for the supplier list."]})
        # Only ids and sort names cross the wire for the full matching register.
        names = list(rows.values_list("id", "name"))
        figures = service.supplier_figures([pk for pk, _name in names], firm, fy)
        names.sort(key=lambda row: ((-Decimal(figures[row[0]]["total"]), row[1].casefold(), row[0]) if ordering == "-total"
                                    else (row[1].casefold(), row[0])))
        page = self.paginate_queryset([pk for pk, _name in names])
        found = {customer.pk: customer for customer in rows.filter(pk__in=page).only("id", "name", "gst_number", "state_name", "city")}
        response = self.get_paginated_response([{**supplier_ref(found[pk]), "figures": figures[pk]} for pk in page])
        response.data["summary"] = {"suppliers": len(names), "bills": sum(row["bills"] for row in figures.values()),
                                    **{key: money(sum((Decimal(row[key]) for row in figures.values()), Decimal("0"))) for key in ("total", "tax")}}
        return response

    def retrieve(self, request, pk=None):
        return Response(service.supplier_detail(service.get_supplier(pk), *self.scope()))

    def create(self, request):
        customer = service.save_supplier(valid(SupplierSerializer, request.data), request.user)
        return Response(service.supplier_object(customer), status=201)

    def update(self, request, pk=None):
        customer = service.get_supplier(pk)
        data = valid(SupplierSerializer, request.data, instance=customer)
        return Response(service.supplier_object(service.save_supplier(data, request.user, customer)))

    @action(detail=True, methods=["get"])
    def memory(self, request, pk=None):
        firm = id_param(request.query_params, "business_id", PICK_A_FIRM)
        return Response(service.memory(service.get_supplier(pk), firm))
