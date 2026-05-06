import base64
import mimetypes

from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from billing.models import Business, Customer, Invoice, LineItem, Product


class BusinessSerializer(serializers.ModelSerializer):
    total_revenue = serializers.DecimalField(
        max_digits=12, decimal_places=2, read_only=True
    )
    total_purchases = serializers.DecimalField(
        max_digits=12, decimal_places=2, read_only=True
    )
    customer_count = serializers.IntegerField(read_only=True)
    invoice_count = serializers.IntegerField(read_only=True)
    signature_image_base64 = serializers.SerializerMethodField()

    class Meta:
        model = Business
        fields = "__all__"

    def get_signature_image_base64(self, obj):
        if not obj.signature_image:
            return None
        try:
            img_path = obj.signature_image.path
            with open(img_path, "rb") as f:
                data = f.read()
            # Detect actual mime type from file magic bytes, not extension
            if data[:3] == b"\xff\xd8\xff":
                mime = "image/jpeg"
            elif data[:8] == b"\x89PNG\r\n\x1a\n":
                mime = "image/png"
            else:
                mime = "image/png"  # fallback
            encoded = base64.b64encode(data).decode("utf-8")
            return f"data:{mime};base64,{encoded}"
        except Exception:
            return None


class CustomerSerializer(serializers.ModelSerializer):
    total_revenue = serializers.DecimalField(
        max_digits=12, decimal_places=2, read_only=True
    )
    invoice_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Customer
        fields = "__all__"


class ProductSerializer(serializers.ModelSerializer):
    total_revenue = serializers.DecimalField(
        max_digits=12, decimal_places=2, read_only=True
    )
    qty_sold = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    usage_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Product
        fields = "__all__"


class LineItemSerializer(serializers.ModelSerializer):
    # Keep item_name for backward compatibility
    item_name = serializers.CharField(source="product_name", read_only=True)

    class Meta:
        model = LineItem
        fields = "__all__"

    def to_representation(self, instance):
        # Ensure product_name is always included in the response
        ret = super().to_representation(instance)
        # Make sure product_name is present
        if "product_name" not in ret or ret["product_name"] is None:
            ret["product_name"] = ""
        return ret


class InvoiceSerializer(serializers.ModelSerializer):
    line_items = LineItemSerializer(many=True, read_only=True, source="lineitem_set")
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    business_name = serializers.CharField(source="business.name", read_only=True)
    is_igst_applicable = serializers.BooleanField(read_only=True)

    class Meta:
        model = Invoice
        fields = "__all__"


class InvoiceListSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    business_name = serializers.CharField(source="business.name", read_only=True)
    is_igst_applicable = serializers.BooleanField(read_only=True)
    # Annotated fields
    total_tax = serializers.DecimalField(
        max_digits=12, decimal_places=2, read_only=True, required=False
    )
    line_item_count = serializers.IntegerField(read_only=True, required=False)

    class Meta:
        model = Invoice
        fields = [
            "id",
            "invoice_number",
            "invoice_date",
            "total_amount",
            "type_of_invoice",
            "customer",
            "customer_name",
            "business",
            "business_name",
            "is_igst_applicable",
            "total_tax",
            "line_item_count",
            "created_at",
            "updated_at",
        ]


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


class AuditLogSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    can_undo = serializers.SerializerMethodField()

    class Meta:
        from billing.models import AuditLog

        model = AuditLog
        fields = [
            "id", "action", "entity", "entity_id", "entity_name",
            "user", "user_name", "details", "changes", "timestamp",
            "can_undo",
        ]
        read_only_fields = fields

    def get_user_name(self, obj):
        if obj.user:
            return obj.user.get_full_name() or obj.user.username
        return "System"

    def get_can_undo(self, obj):
        if obj.action in ("deleted", "updated") and obj.snapshot:
            return True
        if obj.action == "created":
            return True
        return False


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        from .permissions import get_user_role
        token = super().get_token(user)
        token["username"] = user.username
        token["full_name"] = user.get_full_name() or user.username
        token["role"] = get_user_role(user)
        return token
