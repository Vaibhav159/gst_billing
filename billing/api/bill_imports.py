"""Batch imports share the bill services; the browser parses Excel, CSV and photo reads."""

from rest_framework import serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.api.body import Picked, valid
from billing.api.permissions import V3Permission
from billing.api.sales import TypedNumber
from billing.models import Business
from billing.services.purchase_imports import import_bills


class PairSerializer(serializers.Serializer):
    seller = Picked(Business, "Pick the seller firm from the list.")
    invoice_number = TypedNumber()


class ImportSerializer(serializers.Serializer):
    file_name = serializers.CharField(required=False, allow_blank=True, default="", max_length=255,
                                     error_messages=dict.fromkeys(("invalid", "null", "max_length"), "Keep the file name to 255 characters."))
    dry_run = serializers.BooleanField(required=False, default=True,
                                      error_messages=dict.fromkeys(("invalid", "null"), "Say whether this is a check before importing."))
    bills = serializers.JSONField(error_messages=dict.fromkeys(("required", "null", "invalid"), "There are no bills to import."))
    suppliers = serializers.JSONField(required=False, default=list)
    customers = serializers.JSONField(required=False, default=list)

    def validate_bills(self, value):
        if not isinstance(value, list) or not value:
            raise serializers.ValidationError("There are no bills to import.")
        if len(value) > 300:
            raise serializers.ValidationError("An import can hold at most 300 bills. Split the file.")
        return value

    def validate(self, data):
        for key in ("suppliers", "customers"):
            rows = data[key]
            if not isinstance(rows, list) or len(rows) > 100:
                raise serializers.ValidationError({key: [f"An import can add at most 100 {key}. Split the file."]})
            seen = set()
            for row in rows:
                ref = row.get("ref") if isinstance(row, dict) else None
                if not isinstance(ref, str) or not ref.strip() or ref in seen:
                    raise serializers.ValidationError({key: ["Give each new party a different reference."]})
                seen.add(ref)
        return data


class PurchaseImportView(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"POST": "purchase.import"}
    sales = False

    def post(self, request):
        data = valid(ImportSerializer, request.data)
        return Response(import_bills(data, request.user, sales=self.sales))


class SalesImportView(PurchaseImportView):
    v3_actions = {"POST": "bill.create"}
    sales = True
