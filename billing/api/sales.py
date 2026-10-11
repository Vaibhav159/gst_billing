"""/api/sales/: v3's bills endpoint (part 1 API contract, section 2).

v3 reads and writes sales here, never through v2's invoices/, whose contract stays as it is
(design decision 4). Sales only: an inward bill's id is a 404 here. Every action names its
permission key in v3_actions; V3Permission refuses the rest.
"""

from django.db.models import Q
from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from billing import numbering
from billing.cache import uncached
from billing.constants import BILL_ACTIVE, BILL_CANCELLED, INVOICE_TYPE_OUTWARD, SENT_VIA_CHOICES
from billing.fy import fy_label, fy_of, fy_range
from billing.models import BinnedInvoice, Business, Invoice
from billing.params import PICK_A_FIRM, date_param, firm_param, fy_param, id_param, month_param, text_param
from billing.period_lock import closed_months
from billing.services.bill_reads import bill_detail, bill_rows, facets, filter_bills, ordered, summary
from billing.services.bin import bin_bill, bin_row, live_bin, restore_from_bin
from billing.services.sales import cancel_bill, mobile_of, move_bill, record_send, renumber_bill, sent_block
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
    """A reason (or other text, like a send's number) refused in the contract's one sentence, `words`,
    whatever is wrong with it: missing when it's needed, null, blank, not text, too long or a null
    character. Never DRF's own words (Ruling 1A-5)."""

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


SAY_HOW = "Say how it was sent: whatsapp or share."
TYPE_A_MOBILE = "Type a 10-digit mobile number, like 98290 41122."


class SentSerializer(serializers.Serializer):
    # Missing, null or anything but the two ways gets the one sentence (Ruling 1A-5).
    via = serializers.ChoiceField(
        choices=SENT_VIA_CHOICES,
        error_messages={"required": SAY_HOW, "null": SAY_HOW, "invalid_choice": SAY_HOW},
    )
    # Optional; null, not text or a null character is no number either.
    to = Reason(TYPE_A_MOBILE, required=False, allow_blank=True, default="")

    def validate_to(self, value):
        if value.strip() and not mobile_of(value):
            raise serializers.ValidationError(TYPE_A_MOBILE)
        return mobile_of(value)


class TypedNumber(serializers.Field):
    """A bill number as typed: text, or a JSON number read as its digits. Anything else (missing, null, a list,
    an object, true) is no number typed, which the number check refuses in the contract's words with the next
    free number; a null character or a space reaches that check too, which names Rule 46 (Ruling 1A-5)."""

    def __init__(self):
        super().__init__(required=False)

    def run_validation(self, data=serializers.empty):
        if isinstance(data, str):
            return data
        return str(data) if isinstance(data, int | float) and not isinstance(data, bool) else ""

    def to_representation(self, value):
        return value


class RenumberSerializer(serializers.Serializer):
    invoice_number = TypedNumber()


PICK_THE_FIRM = "Pick the firm to move it to."


class FirmField(serializers.PrimaryKeyRelatedField):
    """A firm by its id, read when the request comes, around cacheops (Ruling 1A-34): the move freezes this firm
    on the bill, so it must be the firm as it is now."""

    def get_queryset(self):
        return uncached(Business)


class MoveSerializer(RenumberSerializer):
    # Missing, null, blank, not an id or no such firm: the one sentence (Ruling 1A-5).
    business = FirmField(error_messages={"required": PICK_THE_FIRM, "null": PICK_THE_FIRM,
                                         "does_not_exist": PICK_THE_FIRM, "incorrect_type": PICK_THE_FIRM})


class Pages(PageNumberPagination):
    page_size = 40
    page_size_query_param = "page_size"
    max_page_size = 200
    invalid_page_message = "This list has no page {page_number}."


class BinPages(Pages):
    invalid_page_message = "There's no such page of deleted bills."  # contract 3.1


class SalesViewSet(viewsets.GenericViewSet):
    permission_classes = [V3Permission]
    pagination_class = Pages
    lookup_value_regex = r"\d+"
    v3_actions = {"cancel": "bill.cancel", "destroy": "bill.delete", "sent": "bill.send",
                  "renumber": "bill.edit", "move": "bill.edit"}

    def get_queryset(self):
        # Built for each request, as sales() reads around cacheops (Ruling 1A-34).
        return Invoice.objects.sales().select_related("customer", "business")

    def list(self, request):
        """The bills list: a page of BillRows, the whole filtered set's summary, and the facets when asked (2.1)."""
        params = request.query_params
        bills = filter_bills(self.get_queryset(), params)
        page = self.paginate_queryset(ordered(bills, params))
        response = self.get_paginated_response(bill_rows(page))
        response.data["summary"] = summary(bills, BILL_CANCELLED if params.get("status") == BILL_CANCELLED else BILL_ACTIVE)
        if params.get("facets") == "1":
            response.data["facets"] = facets(self.get_queryset(), params)
        return response

    def retrieve(self, request, pk=None):
        """One bill (BillDetail); a deleted one still in the bin is the contract's 404 with its bin row (2.2)."""
        invoice = self.get_queryset().select_related("cancelled_by").filter(pk=pk).first()
        if invoice is not None:
            return Response(bill_detail(invoice))
        # live_bin(): not a row v2's undo already brought back, and only the deleter joined, so a row whose firm or
        # customer v2 deleted still answers (Ruling 1A-6).
        binned = live_bin().filter(original_id=pk, type_of_invoice=INVOICE_TYPE_OUTWARD).first()
        if binned is None:
            raise Http404("No Invoice matches the given query.")
        return Response({"detail": "This bill was deleted.", "code": "deleted", "binned": bin_row(binned)}, status=404)

    @action(detail=False, methods=["get"], url_path="next-number")
    def next_number(self, request):
        firm, day = firm_param(request.query_params), date_param(request.query_params, "invoice_date", today=True)
        return Response({"business": firm.pk, "fy": fy_label(fy_of(day)), "invoice_date": day.isoformat(),
                         **numbering.next_number(firm, day), "full_number": numbering.full_number_on(firm, day)})

    @action(detail=False, methods=["get"], url_path="check-number")
    def check_number(self, request):
        params = request.query_params
        typed = params.get("invoice_number", "")
        try:
            firm, day = firm_param(params), date_param(params, "invoice_date", today=True)
        except serializers.ValidationError as refused:
            # Always 200: it only checks (contract 2.12). Without a firm or a date it can read, it says so in
            # next-number's words (Ruling 1A-5).
            return Response(numbering.unchecked(typed, str(next(iter(refused.detail.values()))[0])))
        exclude = params.get("exclude_id") or ""
        return Response(numbering.check_number(firm, day, typed, exclude_invoice=int(exclude)
                                               if exclude.isascii() and exclude.isdigit() else None))

    @action(detail=False, methods=["get"], url_path="paper-book")
    def paper_book(self, request):
        firm = firm_param(request.query_params)
        month = month_param(request.query_params)
        if month is None:
            raise serializers.ValidationError({"month": ["Give the month like 2026-09."]})
        return Response(numbering.paper_book(firm, *month))

    @action(detail=True, methods=["post"])
    def renumber(self, request, pk=None):
        typed = valid(RenumberSerializer, request.data)["invoice_number"]
        invoice, old = renumber_bill(self.get_object(), request.user, typed)
        return Response({"id": invoice.pk, "invoice_number": invoice.invoice_number, "previous": old})

    @action(detail=True, methods=["post"])
    def move(self, request, pk=None):
        data = valid(MoveSerializer, request.data)
        invoice, old_firm, old_number = move_bill(self.get_object(), request.user, data["business"], data["invoice_number"])
        return Response({"id": invoice.pk, "business": invoice.business_id, "invoice_number": invoice.invoice_number,
                         "previous": {"business": old_firm.pk, "invoice_number": old_number}})

    @action(detail=True, methods=["post"])
    def sent(self, request, pk=None):
        data = valid(SentSerializer, request.data)
        invoice = record_send(self.get_object(), request.user, data["via"], data["to"])
        return Response({"id": invoice.pk, "sent": sent_block(invoice)})

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
    pagination_class = BinPages
    lookup_value_regex = r"\d+"
    v3_actions = {"list": "bill.delete", "restore": "bill.delete"}

    def get_queryset(self):
        qs = live_bin()
        params = self.request.query_params
        firm = id_param(params, "business_id", PICK_A_FIRM)
        if firm is not None:
            qs = qs.filter(business_id=firm)
        fy = fy_param(params)
        if fy is not None:
            qs = qs.filter(invoice_date__range=fy_range(fy))
        q = text_param(params, "q")
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
        try:
            binned = get_object_or_404(BinnedInvoice, pk=pk)
        except Http404:
            raise NotFound("That deleted bill isn't in the bin any more.") from None  # contract 3.2
        return Response(bill_detail(restore_from_bin(binned, request.user)))
