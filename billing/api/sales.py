"""/api/sales/: v3's bills endpoint (part 1 API contract, section 2).

v3 reads and writes sales here, never through v2's invoices/, whose contract stays as it is
(design decision 4). Sales only: an inward bill's id is a 404 here. Every action names its
permission key in v3_actions; V3Permission refuses the rest.
"""

from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from billing.fy import fy_range
from billing.models import BinnedInvoice, Invoice
from billing.params import fy_param
from billing.period_lock import closed_months
from billing.services.bin import bin_bill, bin_row, live_bin, restore_from_bin
from billing.services.sales import cancel_bill
from billing.text import person, stamp

from .permissions import V3Permission

# What each field reads from a body that isn't an object: a value no field takes.
_UNUSABLE = object()


def valid(serializer_class, data, **kwargs):
    """The validated data, or a 400 with field errors.

    A body that isn't an object (a list, a string) carries nothing usable, so every field refuses
    it in its own words, the contract's: never DRF's "Expected a dictionary", and never an optional
    field passing by default, as a DELETE with no reason would (Ruling 1A-5).
    """
    if not isinstance(data, dict):
        data = dict.fromkeys(serializer_class(**kwargs).fields, _UNUSABLE)
    serializer = serializer_class(data=data, **kwargs)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


SAY_WHY = "Say why in a few words. It goes into the audit log."


class Reason(serializers.CharField):
    """A reason refused in the contract's one sentence, `words`, whatever is wrong with it: missing
    when it's needed, null, blank, not text, too long or a null character. Never DRF's own words
    (Ruling 1A-5)."""

    def __init__(self, words, **kwargs):
        self.words = words
        super().__init__(**kwargs)

    def run_validation(self, data=serializers.empty):
        try:
            return super().run_validation(data)
        except serializers.ValidationError:
            raise serializers.ValidationError(self.words) from None


class CancelSerializer(serializers.Serializer):
    reason = Reason(SAY_WHY, max_length=255)


class DeleteSerializer(serializers.Serializer):
    reason = Reason("Keep the reason to 80 characters.", max_length=80, required=False, allow_blank=True,
                    allow_null=True, default="")

    def validate_reason(self, value):
        return value or ""  # null is no reason


class Pages(PageNumberPagination):
    page_size = 40
    page_size_query_param = "page_size"
    max_page_size = 200
    invalid_page_message = "This list has no page {page_number}."


class SalesViewSet(viewsets.GenericViewSet):
    permission_classes = [V3Permission]
    queryset = Invoice.objects.sales().select_related("customer", "business")
    lookup_value_regex = r"\d+"
    v3_actions = {"cancel": "bill.cancel", "destroy": "bill.delete"}

    def destroy(self, request, pk=None):
        """To the bin with a reason; 200 with the bin row, whose id Restore and Undo use.

        bin_bill locks the bill and checks its month (409 month_closed) in one transaction.
        """
        reason = valid(DeleteSerializer, request.data)["reason"]
        binned, _entry = bin_bill(self.get_object(), request.user, reason)
        return Response(bin_row(binned))

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        reason = valid(CancelSerializer, request.data)["reason"]
        invoice = cancel_bill(self.get_object(), request.user, reason)
        return Response({
            "id": invoice.pk, "invoice_number": invoice.invoice_number, "status": invoice.status,
            "cancel_reason": invoice.cancel_reason, "cancelled_at": stamp(invoice.cancelled_at),
            "cancelled_by": person(invoice.cancelled_by),
        })


class BinViewSet(viewsets.GenericViewSet):
    """/api/bin/: deleted sales, and Restore (part 1 API contract, section 3). Owner only."""

    permission_classes = [V3Permission]
    pagination_class = Pages
    lookup_value_regex = r"\d+"
    v3_actions = {"list": "bill.delete", "restore": "bill.delete"}

    def get_queryset(self):
        qs = live_bin()
        params = self.request.query_params
        firm = params.get("business_id") or ""
        if firm:
            if not firm.isdecimal():
                raise serializers.ValidationError({"business_id": ["Pick the firm."]})
            qs = qs.filter(business_id=firm)
        fy = fy_param(params)
        if fy is not None:
            qs = qs.filter(invoice_date__range=fy_range(fy))
        q = (params.get("q") or "").strip()
        if q:
            # The customer's name as the row shows it, the bill's own: the customer may be gone since.
            qs = qs.filter(Q(invoice_number__icontains=q) | Q(data__customer_name__icontains=q))
        return qs

    def list(self, request):
        page = self.paginate_queryset(self.get_queryset())
        closed = closed_months({b.business_id for b in page})
        return self.get_paginated_response([bin_row(b, closed) for b in page])

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        invoice = restore_from_bin(get_object_or_404(BinnedInvoice, pk=pk), request.user)
        return Response({"id": invoice.pk, "invoice_number": invoice.invoice_number})
