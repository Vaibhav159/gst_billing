from rest_framework import serializers

from billing.models import Business, Customer, Invoice, LineItem, Product


class BusinessSerializer(serializers.ModelSerializer):
    class Meta:
        model = Business
        fields = "__all__"


class CustomerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Customer
        fields = "__all__"


class ProductSerializer(serializers.ModelSerializer):
    class Meta:
        model = Product
        fields = "__all__"


class LineItemSerializer(serializers.ModelSerializer):
    # Keep item_name for backward compatibility
    item_name = serializers.CharField(source="product_name", read_only=True)

    # Expose unit-aware display helpers and normalized fields
    quantity_with_unit = serializers.CharField(
        source="quantity_with_unit_display", read_only=True
    )
    rate_with_unit = serializers.CharField(
        source="rate_with_unit_display", read_only=True
    )
    unit_label = serializers.CharField(read_only=True)
    rate_label = serializers.CharField(read_only=True)
    quantity_in_grams = serializers.DecimalField(
        max_digits=14, decimal_places=3, read_only=True, allow_null=True
    )
    rate_per_gram = serializers.DecimalField(
        max_digits=14, decimal_places=6, read_only=True, allow_null=True
    )

    class Meta:
        model = LineItem
        fields = "__all__"

    def to_representation(self, instance):
        # Ensure product_name is always included in the response and attach display helpers
        ret = super().to_representation(instance)
        # Make sure product_name is present
        if "product_name" not in ret or ret["product_name"] is None:
            ret["product_name"] = ""
        # Ensure the new read-only fields exist even when None
        ret.setdefault(
            "quantity_with_unit",
            (
                instance.quantity_with_unit_display
                if hasattr(instance, "quantity_with_unit_display")
                else ""
            ),
        )
        ret.setdefault(
            "rate_with_unit",
            (
                instance.rate_with_unit_display
                if hasattr(instance, "rate_with_unit_display")
                else ""
            ),
        )
        ret.setdefault(
            "unit_label", instance.unit_label if hasattr(instance, "unit_label") else ""
        )
        ret.setdefault(
            "rate_label", instance.rate_label if hasattr(instance, "rate_label") else ""
        )
        # quantity_in_grams and rate_per_gram may be None for non-weight units
        ret.setdefault(
            "quantity_in_grams",
            (
                instance.quantity_in_grams
                if hasattr(instance, "quantity_in_grams")
                else None
            ),
        )
        ret.setdefault(
            "rate_per_gram",
            instance.rate_per_gram if hasattr(instance, "rate_per_gram") else None,
        )
        return ret


class InvoiceSerializer(serializers.ModelSerializer):
    line_items = LineItemSerializer(many=True, read_only=True, source="lineitem_set")
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    business_name = serializers.CharField(source="business.name", read_only=True)
    is_igst_applicable = serializers.BooleanField(read_only=True)

    class Meta:
        model = Invoice
        fields = "__all__"


class InvoiceSummarySerializer(serializers.Serializer):
    total_items = serializers.IntegerField()
    amount_without_tax = serializers.DecimalField(max_digits=10, decimal_places=2)
    total_cgst_tax = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False
    )
    total_sgst_tax = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False
    )
    total_igst_tax = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False
    )
    total_tax = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False
    )
    round_off = serializers.CharField(required=False)
    total_amount = serializers.DecimalField(max_digits=10, decimal_places=2)
