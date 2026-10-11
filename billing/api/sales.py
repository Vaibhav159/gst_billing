"""/api/sales/: v3's bills endpoint (part 1 API contract, section 2).

v3 reads and writes sales here, never through v2's invoices/, whose contract stays as it is
(design decision 4). Sales only: an inward bill's id is a 404 here. Every action names its
permission key in v3_actions; V3Permission refuses the rest.
"""

import re
from collections.abc import Mapping
from decimal import Decimal, InvalidOperation

from django.db.models import Q
from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from billing import numbering
from billing.constants import (
    BILL_ACTIVE,
    BILL_CANCELLED,
    GST_CODE,
    INVOICE_TYPE_OUTWARD,
    SENT_VIA_CHOICES,
    UNIT_CHOICES,
)
from billing.fy import fy_label, fy_of, fy_range
from billing.models import BinnedInvoice, Business, Customer, Invoice
from billing.params import PICK_A_FIRM, date_param, firm_param, fy_param, id_param, month_param, text_param
from billing.period_lock import closed_months
from billing.services.bill_reads import Reads, bill_detail, bill_rows, facets, filter_bills, ordered, summary
from billing.services.bin import bin_bill, bin_row, live_bin, restore_from_bin
from billing.services.sales import (
    LINE_MOST,
    MOST,
    cancel_bill,
    mobile_of,
    move_bill,
    record_send,
    refile_heads,
    renumber_bill,
    save_bill,
    save_eway,
    sent_block,
)
from billing.tax_rules import GST_SLABS
from billing.text import person, stamp

from .body import UNSTORABLE, Picked, valid
from .permissions import V3Permission

SAY_WHY = "Say why in a few words. It goes into the audit log."


class Reason(serializers.CharField):
    """A reason (or other text, like a send's number) refused in the contract's one sentence, `words`,
    whatever is wrong with it: missing when it's needed, null, blank, not text, too long (`long`, when
    given) or a null character. Never DRF's own words (Ruling 1A-5)."""

    def __init__(self, words, long=None, **kwargs):
        self.words, self.long = words, long or words
        super().__init__(**kwargs)

    def run_validation(self, data=serializers.empty):
        try:
            return super().run_validation(data)
        except serializers.ValidationError as refused:
            raise serializers.ValidationError(self.long if "max_length" in refused.get_codes() else self.words) from None


class Text(Reason):
    """Typed text (a name, a note): what no column can store is dropped, not refused, and null is no text ("")."""

    def run_validation(self, data=serializers.empty):
        value = super().run_validation(UNSTORABLE.sub("", data) if isinstance(data, str) else data)
        return "" if value is None else value


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
    """A number as typed (a bill number, a line's figure or HSN code): text, or a JSON number read as its digits.
    Anything else (missing, null, a list, an object, true) is nothing typed, which the check after it refuses in the
    contract's words (the bill number's with the next free number); a null character or a space reaches that check
    too, which names Rule 46 for a bill number (Ruling 1A-5)."""

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


class MoveSerializer(RenumberSerializer):
    business = Picked(Business, PICK_THE_FIRM)


# A line's figures (contract 2.3). The slabs are tax_rules' own list; the units in the rate's words ("Type the rate
# per piece."): one unit, in words.
SLABS = frozenset(GST_SLABS)
WEIGHED_IN_GRAMS = ("gms", "g")
WEIGHED = ("kg", "ct", "oz", "tola")
PER = {"gms": "gram", "g": "gram", "kg": "kg", "ct": "carat", "oz": "ounce", "tola": "tola", "pcs": "piece",
       "nos": "piece", "unit": "unit", "mtr": "metre", "ltr": "litre", "ml": "ml", "box": "box", "pair": "pair",
       "set": "set", "dozen": "dozen"}
ADD_ONE = "Add at least one item: pick a product, then type its weight."


def _amount(text):
    """A decimal from what was sent ("12.345", or a JSON number's digits), or None when it isn't one with at most 3
    places that a bill's columns can hold: "NaN", "1e400", 40 digits or another script's digits are none (Ruling
    1A-5)."""
    text = str(text).strip()
    try:
        value = Decimal(text) if text.isascii() else None
    except (InvalidOperation, ValueError):
        return None
    if value is None or not value.is_finite() or -value.as_tuple().exponent > 3 or abs(value) > MOST:
        return None
    return value


class Lines(serializers.ListSerializer):
    """A bill's lines. Words about the lines as a whole are a plain list (["Add at least one item: …"]), never DRF's
    own list checks, which nest theirs under non_field_errors; a line's are keyed by its position (contract §1). A
    line that isn't an object carries no item: its name is missing."""

    def to_internal_value(self, data):
        if not isinstance(data, list) or not data:
            raise serializers.ValidationError([ADD_ONE])
        if len(data) > 200:
            raise serializers.ValidationError(["A bill can have at most 200 items."])
        return super().to_internal_value(data)

    def run_child_validation(self, data):
        return super().run_child_validation(data if isinstance(data, Mapping) else {})


class LineSerializer(serializers.Serializer):
    """One line as sent (contract 2.3). Its figures come as text or JSON numbers; validate() reads them in the words
    of the line's unit. Whether the line the builder makes of them fits its columns is save_bill's to say."""

    product_name = Text("Type the item's name.", long="Keep the item's name to 255 characters.", max_length=255)
    hsn_code = TypedNumber()
    gst_percent = TypedNumber()
    quantity = TypedNumber()
    unit = serializers.ChoiceField(choices=[u for u, _ in UNIT_CHOICES], default="gms",
                                   error_messages=dict.fromkeys(("invalid_choice", "null"), "Pick a unit from the list."))
    rate = TypedNumber()
    note = Text("Keep the note to 60 characters; it prints under the item.", max_length=60, required=False,
                allow_blank=True, allow_null=True, default="")

    class Meta:
        list_serializer_class = Lines

    def validate(self, attrs):
        unit, errors = attrs["unit"], {}
        if not re.fullmatch(r"[0-9]{4,8}", attrs["hsn_code"].strip()):
            errors["hsn_code"] = ["Type the HSN code, 4 to 8 digits (7113 for jewellery)."]
        percent = _amount(attrs["gst_percent"])
        if percent not in SLABS:
            errors["gst_percent"] = ["Choose the GST rate. Gold and silver jewellery is 3%; cut diamonds are 0.25%."]
        quantity, rate = _amount(attrs["quantity"]), _amount(attrs["rate"])
        if quantity is None or not 0 < quantity <= LINE_MOST:
            errors["quantity"] = ["Type the weight in grams, like 12.345." if unit in WEIGHED_IN_GRAMS else
                                  "Type the weight, like 1.250." if unit in WEIGHED else "Type how many pieces."]
        if rate is None or rate <= 0:
            errors["rate"] = [f"Type the rate per {PER[unit]}."]
        if errors:
            raise serializers.ValidationError(errors)
        return {**attrs, "hsn_code": attrs["hsn_code"].strip(), "gst_percent": format((percent + 0).normalize(), "f"),
                "quantity": quantity, "rate": rate}


CHOOSE_A_CUSTOMER = "Choose who this bill is for. Pick Walk-in customer for a counter sale."
NOT_A_DRAFT = "That isn't an unfinished bill's id."


class DraftId(serializers.UUIDField):
    """The unfinished bill a new bill becomes (2.3): its id, the UUID the client made, as text; or null. Anything else
    is refused in words (Ruling 1A-5), a number too, which DRF would read as a UUID."""

    def __init__(self):
        super().__init__(required=False, allow_null=True, default=None, error_messages={"invalid": NOT_A_DRAFT})

    def to_internal_value(self, data):
        if not isinstance(data, str):
            self.fail("invalid", value=data)
        return super().to_internal_value(data)


class SaleSerializer(serializers.Serializer):
    """What POST and PUT sales/ take (part 1 API contract, 2.3), each problem in the contract's words. draft_id is POST
    only: an edit takes no draft."""

    business = Picked(Business, "Pick the firm.")
    customer = Picked(Customer, CHOOSE_A_CUSTOMER)
    invoice_number = TypedNumber()
    invoice_date = serializers.DateField(error_messages={
        **dict.fromkeys(("required", "null"), "Type the date of the bill."),
        **dict.fromkeys(("invalid", "datetime"), "Type the date like 2026-09-30.")})
    payment_mode = serializers.ChoiceField(
        choices=["", "cash", "bank", "credit", "mixed"], required=False, default="",
        error_messages=dict.fromkeys(("invalid_choice", "null"),
                                     "Choose how it was paid: cash, UPI / bank, udhaar, or part cash, part UPI."))
    place_of_supply = serializers.ChoiceField(
        choices=list(GST_CODE), required=False, allow_null=True, default=None,
        error_messages={"invalid_choice": "Choose the state the goods are delivered to."})
    notes = Text("Keep the note to 500 characters.", max_length=500, required=False, allow_blank=True, allow_null=True,
                 default="")
    paper = serializers.BooleanField(required=False, default=False, error_messages=dict.fromkeys(
        ("invalid", "null"), "Say whether the bill is from the paper bill book."))
    replaces = serializers.IntegerField(required=False, allow_null=True, default=None, error_messages=dict.fromkeys(
        ("invalid", "max_string_length"), "Only a cancelled bill can be made again."))
    draft_id = DraftId()
    lines = LineSerializer(many=True, error_messages=dict.fromkeys(("required", "null"), ADD_ONE))


class EwaySerializer(serializers.Serializer):
    """What PUT sales/{id}/eway/ takes (contract 2.8): each field optional; what's sent replaces what's stored, and a
    null text clears it."""

    eway_bill_number = Text("An e-way bill number has 12 digits; this has 0.", required=False, allow_blank=True,
                            allow_null=True)
    transport_mode = serializers.ChoiceField(choices=["Road", "Rail", "Air", "Ship"], required=False,
                                             error_messages=dict.fromkeys(("invalid_choice", "null"),
                                                                          "Choose Road, Rail, Air or Ship."))
    transporter_name = Text("Type the transporter's name.", long="Keep the transporter's name to 255 characters.",
                            max_length=255, required=False, allow_blank=True, allow_null=True)
    transporter_gstin = Text("A transporter's GSTIN or transporter ID has 15 characters.", required=False,
                             allow_blank=True, allow_null=True)
    vehicle_number = Text("Type it like RJ14AB1234 (state, district, letters, 4 digits).", required=False,
                          allow_blank=True, allow_null=True)
    vehicle_type = serializers.ChoiceField(
        choices=["Regular", "ODC"], required=False,
        error_messages=dict.fromkeys(("invalid_choice", "null"), "Choose Regular or Over dimensional cargo (ODC)."))
    distance_km = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=4000,
                                           error_messages=dict.fromkeys(("invalid", "min_value", "max_value",
                                                                         "max_string_length"),
                                                                        "Type the distance in whole kilometres, 1 to 4,000."))

    def validate_eway_bill_number(self, value):
        digits = re.sub(r"[^0-9]", "", value)  # spaces dropped (contract 2.8)
        if value.strip() and len(digits) != 12:
            raise serializers.ValidationError(f"An e-way bill number has 12 digits; this has {len(digits)}.")
        return digits

    def validate_transporter_gstin(self, value):
        gstin = value.strip().upper()
        if gstin and len(gstin) != 15:
            raise serializers.ValidationError("A transporter's GSTIN or transporter ID has 15 characters.")
        return gstin

    def validate_vehicle_number(self, value):
        vehicle = re.sub(r"[\s-]", "", value).upper()
        if vehicle and not re.fullmatch(r"[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}", vehicle):
            raise serializers.ValidationError("Type it like RJ14AB1234 (state, district, letters, 4 digits).")
        return vehicle


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
    v3_actions = {"create": "bill.create", "update": "bill.edit", "cancel": "bill.cancel", "destroy": "bill.delete",
                  "sent": "bill.send", "renumber": "bill.edit", "move": "bill.edit", "eway": "bill.edit",
                  "fix_heads": "bill.edit"}

    def get_queryset(self):
        # sales() reads around cacheops (Ruling 1A-34). Built for each request for tests/test_v3_cacheops.py, which
        # turns cacheops on after import: a queryset built at import keeps no cache profile, so nocache() does nothing
        # on it there. Production imports with cacheops on, where either way would do (billing/cache.py).
        return Invoice.objects.sales().select_related("customer", "business")

    def list(self, request):
        """The bills list: a page of BillRows, the whole filtered set's summary, and the facets when asked (2.1).

        The facets come first: their FY-wide reads (the firm's numbers, the active bills and their lines) serve the
        page and the summary too, so one request reads them once (Ruling 1A-39).
        """
        params = request.query_params
        for key, choices, words in (
            ("facets", ("1", "months", "elsewhere"), "Choose 1, months or elsewhere for facets."),
            ("summary", ("0", "1"), "Choose 0 or 1 for summary."),
        ):
            if key in params and params[key] not in choices:
                raise serializers.ValidationError({key: [words]})
        bills = filter_bills(self.get_queryset(), params)
        page = self.paginate_queryset(ordered(bills, params))
        reads = Reads()
        shown = facets(self.get_queryset(), params, reads) if params.get("facets") else None
        response = self.get_paginated_response(bill_rows(page, reads))
        of = BILL_CANCELLED if params.get("status") == BILL_CANCELLED else BILL_ACTIVE
        if params.get("summary") != "0":
            response.data["summary"] = summary(bills, of, reads)
        if shown is not None:
            response.data["facets"] = shown
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

    def create(self, request):
        """POST sales/: a bill from the paper book or the counter (2.3); 201 with its BillDetail."""
        return Response(bill_detail(save_bill(valid(SaleSerializer, request.data), request.user)), status=201)

    def update(self, request, pk=None):
        """PUT sales/{id}/: the bill changed (2.3); its BillDetail."""
        invoice = self.get_object()
        return Response(bill_detail(save_bill(valid(SaleSerializer, request.data), request.user, invoice)))

    @action(detail=True, methods=["put"])
    def eway(self, request, pk=None):
        """PUT sales/{id}/eway/: the e-way bill's details (2.8); the BillDetail."""
        invoice = save_eway(self.get_object(), request.user, valid(EwaySerializer, request.data))
        return Response(bill_detail(invoice))

    @action(detail=True, methods=["post"], url_path="fix-heads")
    def fix_heads(self, request, pk=None):
        """POST sales/{id}/fix-heads/: the tax heads re-filed for the place of supply (2.9); the BillDetail."""
        return Response(bill_detail(refile_heads(self.get_object(), request.user)))

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
