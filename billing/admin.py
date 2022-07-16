from django.contrib import admin

from billing.models import Business, Customer, LineItem, Invoice


@admin.register(Business)
class BusinessAdmin(admin.ModelAdmin):
    list_display = ("name", "address", "gst_number")
    list_filter = ("name", "address", "gst_number")
    search_fields = ("name", "address", "gst_number")
    ordering = ("name", "address", "gst_number")


@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ("name", "address", "gst_number", "business")
    list_filter = ("name", "address", "gst_number", "business")
    search_fields = ("name", "address", "gst_number", "business")
    ordering = ("name", "address", "gst_number", "business")


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
    model = Invoice.line_items.through
    extra = 1


@admin.register(Invoice)
class InvoiceAdmin(admin.ModelAdmin):
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
        ("Line Items", {"fields": ("line_items",)}),
        (
            "Meta Data",
            {"classes": ("collapse",), "fields": ("created_at", "updated_at")},
        ),
    )
    inlines = [LineInline]
