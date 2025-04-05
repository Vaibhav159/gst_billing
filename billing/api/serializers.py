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
    item_name = serializers.CharField(source="product_name", read_only=True)

    class Meta:
        model = LineItem
        fields = "__all__"


class InvoiceSerializer(serializers.ModelSerializer):
    line_items = LineItemSerializer(many=True, read_only=True, source="lineitem_set")
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    business_name = serializers.CharField(source="business.name", read_only=True)

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
