from django.contrib import admin
from django.utils.safestring import mark_safe
from simple_history.admin import SimpleHistoryAdmin

from billing.models import Business, Customer, LineItem, Invoice


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

        if html_text:
            html_text = f"<ol>{html_text}</ol>"
        else:
            html_text = "No Businesses linked"

        return mark_safe(html_text)


@admin.register(LineItem)
class LineItemAdmin(admin.ModelAdmin):
    list_display = (
        "customer",
        "product_name",
        "hsn_code",
        "quantity",
        "rate",
        "cgst",
        "sgst",
        "amount",
    )
    list_filter = (
        "customer",
        "product_name",
        "hsn_code",
        "quantity",
        "rate",
        "cgst",
        "sgst",
        "amount",
    )
    search_fields = (
        "customer",
        "product_name",
        "hsn_code",
        "quantity",
        "rate",
        "cgst",
        "sgst",
        "amount",
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


class LineInline(admin.TabularInline):
    model = LineItem
    extra = 1


@admin.register(Invoice)
class InvoiceAdmin(SimpleHistoryAdmin):
    list_display = ("customer", "business", "created_at", "updated_at")
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
                    "total_amount",
                )
            },
        ),
    )
    inlines = [LineInline]
