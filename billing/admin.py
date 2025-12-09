from django.contrib import admin
from django.utils.safestring import mark_safe
from simple_history.admin import SimpleHistoryAdmin

from billing.models import Business, Customer, Invoice, LineItem


@admin.register(Business)
class BusinessAdmin(admin.ModelAdmin):
    list_display = ("name", "address", "gst_number")
    list_filter = ("name", "address", "gst_number")
    search_fields = ("name", "address", "gst_number")
    ordering = ("name", "address", "gst_number")


@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ("name", "address", "gst_number", "businesses_linked")
    list_filter = ("name", "address", "gst_number", "businesses")
    search_fields = ("name", "address", "gst_number", "businesses__name")
    ordering = (
        "name",
        "address",
        "gst_number",
    )

    def businesses_linked(self, obj):
        businesses_linked_to_customer = obj.businesses.values_list("name", flat=True)

        html_text = ""
        for business_name in businesses_linked_to_customer:
            html_text += f"<li>{business_name}</li>"

        html_text = f"<ol>{html_text}</ol>" if html_text else "No Businesses linked"

        return mark_safe(html_text)


@admin.register(LineItem)
class LineItemAdmin(admin.ModelAdmin):
    # Display unit-aware fields in the admin list view
    list_display = (
        "customer",
        "product_name",
        "hsn_code",
        "quantity_with_unit_display",
        "rate_with_unit_display",
        "cgst",
        "sgst",
        "amount",
    )
    list_filter = (
        "customer",
        "product_name",
        "hsn_code",
        "unit",
        "cgst",
        "sgst",
        "amount",
    )
    search_fields = (
        "customer__name",
        "product_name",
        "hsn_code",
    )
    ordering = (
        "customer",
        "product_name",
        "hsn_code",
        "quantity",
        "rate",
        "cgst",
        "sgst",
        "amount",
    )

    def quantity_with_unit_display(self, obj):
        # Use model helper for consistent formatting
        return getattr(obj, "quantity_with_unit_display", obj.quantity)

    quantity_with_unit_display.short_description = "Quantity"

    def rate_with_unit_display(self, obj):
        return getattr(obj, "rate_with_unit_display", obj.rate)

    rate_with_unit_display.short_description = "Rate"


class LineInline(admin.TabularInline):
    model = LineItem
    extra = 1
    fields = ("product_name", "hsn_code", "quantity", "unit", "rate", "amount")
    readonly_fields = ("amount",)


@admin.register(Invoice)
class InvoiceAdmin(SimpleHistoryAdmin):
    list_display = ("customer", "business", "created_at", "updated_at", "invoice_date")
    list_filter = ("customer", "business", "created_at", "updated_at")
    search_fields = ("customer", "business", "created_at", "updated_at")
    ordering = ("customer", "business", "created_at", "updated_at")
    readonly_fields = ("created_at", "updated_at")
    exclude = ("created_at", "updated_at")
    date_hierarchy = "created_at"
    raw_id_fields = ("customer", "business")
    autocomplete_fields = ("customer", "business")
    fieldsets = (
        ("Invoice", {"fields": ("customer", "business")}),
        (
            "Meta Data",
            {"classes": ("collapse",), "fields": ("created_at", "updated_at")},
        ),
        (
            "Bill Info",
            {
                "fields": (
                    "invoice_number",
                    "invoice_date",
                    "total_amount",
                )
            },
        ),
    )
    inlines = [LineInline]
