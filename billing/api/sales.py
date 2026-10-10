"""/api/sales/: v3's bills endpoint (part 1 API contract, section 2).

v3 reads and writes sales here, never through v2's invoices/, whose contract stays as it is
(design decision 4). Sales only: an inward bill's id is a 404 here. Every action names its
permission key in v3_actions; V3Permission refuses the rest.
"""

from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from billing.models import Invoice
from billing.services.sales import cancel_bill
from billing.text import person, stamp

from .permissions import V3Permission


def valid(serializer_class, data, **kwargs):
    """The validated data, or a 400 with field errors.

    A body that isn't an object carries nothing usable, so it counts as an empty one: the 400 then
    names the fields in the contract's words, not DRF's "Expected a dictionary" (Ruling 1A-5).
    """
    serializer = serializer_class(data=data if isinstance(data, dict) else {}, **kwargs)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


SAY_WHY = "Say why in a few words. It goes into the audit log."


class CancelReason(serializers.CharField):
    """The contract's one 400 for a cancel reason that can't be used, whatever is wrong with it:
    missing, null, blank, not text, over 255 characters or a null character. Never DRF's own
    words (Ruling 1A-5)."""

    def run_validation(self, data=serializers.empty):
        try:
            return super().run_validation(data)
        except serializers.ValidationError:
            raise serializers.ValidationError(SAY_WHY) from None


class CancelSerializer(serializers.Serializer):
    reason = CancelReason(max_length=255)


class SalesViewSet(viewsets.GenericViewSet):
    permission_classes = [V3Permission]
    queryset = Invoice.objects.sales().select_related("customer", "business")
    lookup_value_regex = r"\d+"
    v3_actions = {"cancel": "bill.cancel"}

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        reason = valid(CancelSerializer, request.data)["reason"]
        invoice = cancel_bill(self.get_object(), request.user, reason)
        return Response({
            "id": invoice.pk, "invoice_number": invoice.invoice_number, "status": invoice.status,
            "cancel_reason": invoice.cancel_reason, "cancelled_at": stamp(invoice.cancelled_at),
            "cancelled_by": person(invoice.cancelled_by),
        })
