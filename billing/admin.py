from django.contrib import admin
from django.core.exceptions import PermissionDenied
from django.utils.safestring import mark_safe
from rest_framework.exceptions import APIException
from simple_history.admin import SimpleHistoryAdmin

from billing.period_lock import assert_period_unlocked


class PeriodLockAdminMixin:
    """The admin bypassed the filed-period lock entirely — invoice and line
    edits in filed months, and history reverts, all went straight through."""

    def _invoice_of(self, obj):
        return obj if obj.__class__.__name__ == "Invoice" else getattr(obj, "invoice", None)

    def _assert(self, obj, action):
        inv = self._invoice_of(obj)
        if inv is None:
            return
        try:
            assert_period_unlocked(inv.business_id, inv.invoice_date, action)
        except APIException as e:
            raise PermissionDenied(str(e.detail)) from e

    def save_model(self, request, obj, form, change):
        self._assert(obj, "edit" if change else "create")
        if change and isinstance(obj, Invoice):
            # v2's columns only (Ruling 1A-16): a full save would undo a cancel that landed after the
            # read, and a history revert would bring back an old status.
            obj._history_user = request.user  # as SimpleHistoryAdmin.save_model sets it
            obj.save(update_fields=Invoice.v2_columns())
            return
        super().save_model(request, obj, form, change)

    def delete_model(self, request, obj):
        self._assert(obj, "delete")
        super().delete_model(request, obj)

    def save_formset(self, request, form, formset, change):
        self._assert(form.instance, "edit")
        super().save_formset(request, form, formset, change)

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
class LineItemAdmin(PeriodLockAdminMixin, admin.ModelAdmin):
    # The customer is the invoice's (LineItem.save), and a line stays on its
    # invoice (H5): editable here, they made the drift H6 removed.
    readonly_fields = ("customer",)

    def get_readonly_fields(self, request, obj=None):
        return (*super().get_readonly_fields(request, obj), *(("invoice",) if obj else ()))

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
    readonly_fields = ("customer",)  # the invoice's (LineItem.save)


@admin.register(Invoice)
class InvoiceAdmin(PeriodLockAdminMixin, SimpleHistoryAdmin):
    list_display = ("invoice_number", "invoice_date", "customer", "business", "total_amount")
    list_filter = ("business", "type_of_invoice", "invoice_date")
    # FK and datetime names here raised FieldError the moment anyone typed in
    # the search box; these are the text lookups that were meant.
    search_fields = ("invoice_number", "customer__name", "business__name")
    ordering = ("-invoice_date", "-id")
    # total_amount is derived from the lines; it was hand-editable here.
    readonly_fields = ("created_at", "updated_at", "total_amount")
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
                # invoice_date was missing, so creating an invoice here failed
                # outright on the NOT NULL column.
                "fields": (
                    "invoice_number",
                    "invoice_date",
                    "type_of_invoice",
                    "total_amount",
                )
            },
        ),
    )
    inlines = [LineInline]
