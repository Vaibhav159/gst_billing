

from django.http import Http404
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from billing.api.inward_bills_service import find_duplicate
from billing.cache import uncached
from billing.credit import credit_month_choices
from billing.models import BinnedInvoice, Customer
from billing.params import date_param, firm_param, id_param, text_param
from billing.services.purchase_reads import (
    LINE_FIELDS,
    PICK_SUPPLIER,
    ROW_FIELDS,
    filter_purchases,
    ordered,
    purchase_detail,
    purchase_facets,
    purchase_queryset,
    purchase_ref,
    purchase_rows,
    purchase_summary,
    read_lines,
    usual_rate,
)

from .body import valid
from .permissions import V3Permission
from .sales import DeleteSerializer, Pages


class PurchasesViewSet(viewsets.GenericViewSet):
    permission_classes = [V3Permission]

    pagination_class = Pages

    lookup_value_regex = r"\d+"

    v3_actions = {"destroy": "purchase.delete"}

    def get_queryset(self):
        return purchase_queryset()


    def get_object(self):
        bill = self.get_queryset().filter(pk=self.kwargs["pk"]).first()
        if bill is None:
            raise Http404("No purchase matches the given query.")
        self.check_object_permissions(self.request, bill)
        return bill


    def list(self, request):
        params = request.query_params
        for key, values, words in [("facets", ("1",), "Choose 1 for facets."),
                                   ("summary", ("0", "1"), "Choose 0 or 1 for summary.")]:
            if key in params and params[key] not in values:
                raise serializers.ValidationError({key: [words]})
        duplicates, lines = {}, {}
        bills = filter_purchases(self.get_queryset(), params, duplicates)
        page = self.paginate_queryset(ordered(bills, params).only(*ROW_FIELDS))
        # A page needs item columns; the rest of the FY needs only checks and sums.
        read_lines(page, LINE_FIELDS, lines)
        facets = purchase_facets(self.get_queryset(), params, lines, duplicates) if params.get("facets") == "1" else None
        response = self.get_paginated_response(purchase_rows(page, params.get("include") == "lines", lines, duplicates))
        if params.get("summary") != "0":
            response.data["summary"] = purchase_summary(bills, lines)
        if facets is not None:
            response.data["facets"] = facets
        return response


    def retrieve(self, request, pk=None):
        bill = self.get_queryset().filter(pk=pk).first()
        if bill:
            return Response(purchase_detail(bill))
        binned = BinnedInvoice.objects.live().filter(original_id=pk, type_of_invoice="inward").select_related("deleted_by").first()
        if binned:
            from billing.services.purchase_bin import purchase_bin_row
            return Response({"detail": "This purchase was deleted.", "code": "deleted", "binned": purchase_bin_row(binned)}, status=404)
        raise Http404("No purchase matches the given query.")


    @action(detail=False, methods=["get"], url_path="credit-months")
    def credit_months(self, request):
        firm = firm_param(request.query_params)
        day = date_param(request.query_params, "invoice_date", today=True)
        return Response(credit_month_choices(firm, day))


    @action(detail=False, methods=["get"], url_path="check-duplicate")
    def check_duplicate(self, request):
        params = request.query_params
        try:
            firm = firm_param(params)
            supplier_id = id_param(params, "supplier_id", PICK_SUPPLIER)
            supplier = uncached(Customer).filter(pk=supplier_id).only("gst_number").first()
            day = date_param(params, "invoice_date", today=True)
            exclude = id_param(params, "exclude_id", PICK_SUPPLIER)
            number = text_param(params, "invoice_number")
            if supplier is None or not number or len(number) > 50:
                raise serializers.ValidationError("unchecked")
        except (serializers.ValidationError, ValueError, OverflowError):
            return Response({"duplicate": None, "same_spelling": False, "unchecked": True})
        existing = find_duplicate(firm, number, supplier=supplier, invoice_date=day, exclude_id=exclude)
        return Response({"duplicate": purchase_ref(existing) if existing else None,
                         "same_spelling": existing.invoice_number == number if existing else True})


    @action(detail=False, methods=["get"], url_path="usual-rate")
    def usual_rate(self, request):
        return Response(usual_rate(request.query_params))


    def destroy(self, request, pk=None):
        from billing.services.purchase_bin import bin_purchase, purchase_bin_row

        data = valid(DeleteSerializer, request.data)
        return Response(purchase_bin_row(bin_purchase(self.get_object(), request.user, data["reason"])))



class PurchaseBinViewSet(viewsets.GenericViewSet):
    permission_classes = [V3Permission]
    lookup_value_regex = r"\d+"
    v3_actions = {"restore": "purchase.delete"}

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        from billing.services.purchase_bin import restore_purchase

        binned = BinnedInvoice.objects.filter(pk=pk, type_of_invoice="inward").first()
        if binned is None:
            raise Http404("That deleted purchase isn't in the bin any more.")
        return Response(purchase_detail(restore_purchase(binned, request.user)))

