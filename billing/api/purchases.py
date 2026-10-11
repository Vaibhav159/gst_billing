"""v3 purchases: typed supplier bills and their credit month, never sales."""
import re
from collections.abc import Mapping

from django.http import Http404
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from billing.api.inward_bills_service import find_duplicate
from billing.cache import uncached
from billing.constants import UNIT_CHOICES
from billing.credit import credit_month_choices
from billing.models import BinnedInvoice, Business, Customer
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
from billing.services.purchases import check_purchase, move_credit, save_purchase
from billing.tax_rules import GST_SLABS, has_gstin, unit_split

from .body import Picked, valid
from .permissions import V3Permission
from .sales import LINE_MOST, DeleteSerializer, Pages, Reason, Text, TypedNumber, _amount

ADD_ONE = "Add at least one item from the bill."
MONTH_WORDS = "Give the month like 2026-09."


class PurchaseLines(serializers.ListSerializer):
    def to_internal_value(self, data):
        if not isinstance(data, list) or not data:
            raise serializers.ValidationError([ADD_ONE])
        if len(data) > 200:
            raise serializers.ValidationError(["A bill can have at most 200 items."])
        return super().to_internal_value(data)

    def run_child_validation(self, data):
        return super().run_child_validation(data if isinstance(data, Mapping) else {})


class PurchaseLineSerializer(serializers.Serializer):
    product_name = Text("Choose the item from the bill.", long="Keep the item's name to 255 characters.", max_length=255)
    hsn_code = Reason("Type the HSN code from the bill: 4 to 8 digits.", required=False, allow_blank=True, default="")
    gst_percent = TypedNumber()
    quantity = TypedNumber()
    rate = TypedNumber()
    unit = serializers.ChoiceField(choices=[u for u, _ in UNIT_CHOICES], default="gms",
        error_messages=dict.fromkeys(("invalid_choice", "null"), "Pick a unit from the list."))
    note = Text("Keep the note to 60 characters.", max_length=60, required=False, allow_blank=True, allow_null=True, default="")
    amount_only = serializers.BooleanField(required=False, default=False,
        error_messages={"invalid": "Say whether the bill gives only this line's value.", "null": "Say whether the bill gives only this line's value."})
    taxable = TypedNumber()

    class Meta:
        list_serializer_class = PurchaseLines

    def validate(self, attrs):
        errors = {}
        hsn = attrs["hsn_code"].strip()
        if hsn and not re.fullmatch(r"[0-9]{4,8}", hsn):
            errors["hsn_code"] = ["Type the HSN code from the bill: 4 to 8 digits."]
        percent = _amount(attrs["gst_percent"])
        if percent not in GST_SLABS:
            errors["gst_percent"] = ["Choose the slab printed on the bill (0% if it charges no GST)."]
        quantity, rate = _amount(attrs["quantity"]), _amount(attrs["rate"])
        if attrs["amount_only"]:
            taxable = _amount(attrs["taxable"])
            if taxable is None or taxable <= 0:
                errors["taxable"] = ["Type the line's value from the bill."]
            else:
                quantity, rate = unit_split(quantity or 0, rate or 0, taxable)
                attrs["note"] = "Amount only"
        if quantity is None or not 0 < quantity <= LINE_MOST:
            errors["quantity"] = [f"Type the quantity in {dict(UNIT_CHOICES)[attrs['unit']].lower()}." ]
        if rate is None or rate <= 0:
            errors["rate"] = ["Type the rate printed on the bill."]
        if errors:
            raise serializers.ValidationError(errors)
        return {**attrs, "hsn_code": hsn, "gst_percent": str(percent), "quantity": quantity, "rate": rate}


class CreditMonth(serializers.Field):
    def __init__(self, **kwargs):
        super().__init__(allow_null=True, error_messages={"required": MONTH_WORDS, "invalid": MONTH_WORDS}, **kwargs)

    def to_internal_value(self, data):
        if not isinstance(data, str) or not re.fullmatch(r"20[0-9]{2}-(0[1-9]|1[0-2])", data):
            self.fail("invalid")
        return data


class PurchaseSerializer(serializers.Serializer):
    business = Picked(Business, "Choose which firm bought this.", fields=("name", "gst_number", "state_name"))
    supplier = Picked(Customer, "Choose the supplier, or add a new one.", fields=("name", "gst_number", "state_name", "is_supplier"))
    invoice_number = Text("Type the bill number printed on the supplier's bill.", long="Keep the bill number to 50 characters.", max_length=50)
    invoice_date = serializers.DateField(error_messages={
        **dict.fromkeys(("required", "null"), "Type the date printed on the bill, like 08 Oct 2026."),
        **dict.fromkeys(("invalid", "datetime"), "Type the date like 2026-09-30.")})
    payment_mode = serializers.ChoiceField(choices=["", "cash", "bank", "credit", "mixed"], default="",
        error_messages=dict.fromkeys(("invalid_choice", "null"),
        "Choose how it was paid: cash, UPI / bank, udhaar, or part cash, part UPI."))
    itc_eligible = serializers.BooleanField(default=True, error_messages=dict.fromkeys(("invalid", "null"), "Say whether credit is allowed."))
    itc_month = CreditMonth(required=False)
    buyer_gstin = Text("Type the buyer's GSTIN.", required=False, allow_blank=True, default="")
    buyer_ack = serializers.BooleanField(default=False, error_messages=dict.fromkeys(("invalid", "null"), "Say whether to record this bill anyway."))
    duplicate_ok = serializers.BooleanField(default=False, error_messages=dict.fromkeys(("invalid", "null"), "Say whether this is a different bill with the same number."))
    needs_review = serializers.BooleanField(default=False, error_messages=dict.fromkeys(("invalid", "null"), "Say whether this bill needs a check."))
    capture = serializers.IntegerField(required=False, allow_null=True, default=None, min_value=1, max_value=2147483647,
        error_messages=dict.fromkeys(("invalid", "min_value", "max_value", "max_string_length"), "That photo isn't in the inbox any more."))
    source = serializers.ChoiceField(choices=["typed", "capture"], default="typed",
        error_messages=dict.fromkeys(("invalid_choice", "null"), "Choose typed or capture for the source."))
    lines = PurchaseLineSerializer(many=True, error_messages=dict.fromkeys(("required", "null"), ADD_ONE))

    def validate_buyer_gstin(self, value):
        value = value.strip().upper()
        if value and not has_gstin(value):
            raise serializers.ValidationError(f"{value} isn't a GSTIN (15 characters, starting with the 2-digit state code).")
        return value

    def to_internal_value(self, data):
        if self.context.get("invoice") and isinstance(data, Mapping):
            # POST-only values and a PUT's review marker are ignored, including malformed values.
            data = {k: v for k, v in data.items() if k not in ("capture", "source", "needs_review")}
        return super().to_internal_value(data)


class MoveCreditSerializer(serializers.Serializer):
    itc_month = CreditMonth()


class PurchasesViewSet(viewsets.GenericViewSet):
    permission_classes = [V3Permission]
    pagination_class = Pages
    lookup_value_regex = r"\d+"
    v3_actions = {"create": "purchase.create", "update": "purchase.edit", "checked": "purchase.edit",
                  "credit_month": "purchase.edit", "destroy": "purchase.delete"}

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

    def create(self, request):
        return Response(purchase_detail(save_purchase(valid(PurchaseSerializer, request.data), request.user)), status=201)

    def update(self, request, pk=None):
        bill = self.get_object()
        data = valid(PurchaseSerializer, request.data, context={"invoice": bill})
        return Response(purchase_detail(save_purchase(data, request.user, bill)))

    def destroy(self, request, pk=None):
        from billing.services.purchase_bin import bin_purchase, purchase_bin_row

        data = valid(DeleteSerializer, request.data)
        return Response(purchase_bin_row(bin_purchase(self.get_object(), request.user, data["reason"])))

    @action(detail=True, methods=["post"])
    def checked(self, request, pk=None):
        bill = check_purchase(self.get_object(), request.user)
        return Response({"id": bill.pk, "needs_review": bill.needs_review})

    @action(detail=True, methods=["put"], url_path="credit-month")
    def credit_month(self, request, pk=None):
        data = valid(MoveCreditSerializer, request.data)
        return Response(move_credit(self.get_object(), request.user, data["itc_month"]))

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
