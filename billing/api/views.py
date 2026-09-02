import contextlib
import csv
import logging
from calendar import monthrange
from datetime import datetime
from decimal import Decimal

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import (
    Count,
    F,
    IntegerField,
    Q,
    Sum,
)
from django.db.models.functions import Coalesce, ExtractMonth, ExtractYear
from django.http import HttpResponse
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from num2words import num2words
from openpyxl import Workbook
from rest_framework import filters, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.constants import (
    DOWNLOAD_SHEET_FIELD_NAMES,
    INVOICE_TYPE_INWARD,
    INVOICE_TYPE_OUTWARD,
)
from billing.models import AuditLog, Business, Customer, FiledPeriod, Invoice, LineItem, Product
from billing.period_lock import assert_period_unlocked
from billing.services import gstr1
from billing.services.ai_import import create_from_ai
from billing.services.bulk_import import run_bulk_import
from billing.services.line_items import build_line_items
from billing.utils import (
    AIInvoiceProcessingError,
    AIInvoiceProcessor,
    CSVImportError,
    process_customer_csv,
    process_invoice_csv,
    process_product_csv,
)

from .mixins import AuditLogMixin, ProtectedDeleteMixin
from .permissions import AdminOnlyPermission, RoleBasedPermission, get_user_role
from .serializers import (
    AuditLogSerializer,
    BusinessSerializer,
    CustomerSerializer,
    FiledPeriodSerializer,
    InvoiceListSerializer,
    InvoiceSerializer,
    InvoiceSummarySerializer,
    LineItemSerializer,
    ProductSerializer,
)

# Money crosses the portal boundary at two decimals. Sums are accumulated as
# Decimal and quantized once here, rather than with `float +=`, which produced
# artifacts like 3.0000000000000004 in filing figures (audit A12).

logger = logging.getLogger(__name__)


class StandardResultsSetPagination(PageNumberPagination):
    page_size = 15
    page_size_query_param = "page_size"
    max_page_size = 1000

    def get_page_size(self, request):
        limit = request.query_params.get("limit")
        if limit:
            try:
                return min(int(limit), self.max_page_size)
            except ValueError:
                pass
        return super().get_page_size(request)


@method_decorator(csrf_exempt, name="dispatch")
class BusinessViewSet(ProtectedDeleteMixin, AuditLogMixin, viewsets.ModelViewSet):
    audit_entity = "business"
    queryset = Business.objects.all().order_by("name")
    serializer_class = BusinessSerializer
    permission_classes = [RoleBasedPermission]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_entity_name(self, instance):
        return instance.name
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["name", "gst_number"]
    ordering_fields = ["name", "created_at", "gst_number", "mobile_number", "address"]
    ordering = ["name"]
    pagination_class = StandardResultsSetPagination

    # Removed caching to ensure fresh data
    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)

        # Get business IDs from current page
        business_ids = [item["id"] for item in response.data.get("results", [])]
        if not business_ids:
            return response

        # Bulk fetch metrics to avoid N+1 subqueries
        # Total revenue (outward) and purchases (inward)
        invoices = Invoice.objects.filter(business_id__in=business_ids)

        # Apply date filters
        start_date = request.query_params.get("start_date")
        end_date = request.query_params.get("end_date")
        if start_date:
            invoices = invoices.filter(invoice_date__gte=start_date)
        if end_date:
            invoices = invoices.filter(invoice_date__lte=end_date)

        stats = invoices.values("business_id", "type_of_invoice").annotate(
            total=Sum("total_amount"), count=Count("id")
        )

        # Map stats for easy lookup
        stats_map = {}
        for s in stats:
            bid = s["business_id"]
            if bid not in stats_map:
                stats_map[bid] = {
                    "total_revenue": 0,
                    "total_purchases": 0,
                    "invoice_count": 0,
                }

            if s["type_of_invoice"] == INVOICE_TYPE_OUTWARD:
                stats_map[bid]["total_revenue"] = float(s["total"] or 0)
            else:
                stats_map[bid]["total_purchases"] = float(s["total"] or 0)

            stats_map[bid]["invoice_count"] += s["count"]

        # Inject metrics into response
        for item in response.data.get("results", []):
            biz_stats = stats_map.get(item["id"], {})
            item["total_revenue"] = biz_stats.get("total_revenue", 0)
            item["total_purchases"] = biz_stats.get("total_purchases", 0)
            item["invoice_count"] = biz_stats.get("invoice_count", 0)
            # customer_count is already in get_queryset (simple join)

        return response

    def get_queryset(self):
        queryset = super().get_queryset()

        # Filter by search term
        search_term = self.request.query_params.get("search", "")
        if search_term:
            queryset = queryset.filter(
                Q(name__icontains=search_term) | Q(gst_number__icontains=search_term)
            )

        # Only annotate customer_count here as it's a simple direct join and doesn't
        # multiply rows based on invoices
        queryset = queryset.annotate(customer_count=Count("customer", distinct=True))

        return queryset

    @action(detail=False, methods=["get"])
    def performance(self, request):
        """Get performance metrics for each business"""
        from django.db.models import Count, Q, Sum

        # Get query parameters
        start_date = request.query_params.get("start_date")
        end_date = request.query_params.get("end_date")

        # Base query
        query = Invoice.objects.all()

        # Apply filters
        if start_date:
            query = query.filter(invoice_date__gte=start_date)
        if end_date:
            query = query.filter(invoice_date__lte=end_date)

        # Group by business, calculate totals
        business_data = (
            query.values("business", "business__name")
            .annotate(
                outward_total=Sum("total_amount", filter=Q(type_of_invoice="outward")),
                inward_total=Sum("total_amount", filter=Q(type_of_invoice="inward")),
                outward_count=Count("id", filter=Q(type_of_invoice="outward")),
                inward_count=Count("id", filter=Q(type_of_invoice="inward")),
            )
            .order_by("-outward_total")
        )

        # Format the response
        result = []
        for business in business_data:
            result.append(
                {
                    "id": business["business"],
                    "name": business["business__name"],
                    "outward_total": business["outward_total"] or 0,
                    "inward_total": business["inward_total"] or 0,
                    "outward_count": business["outward_count"] or 0,
                    "inward_count": business["inward_count"] or 0,
                }
            )

        return Response(result)


@method_decorator(csrf_exempt, name="dispatch")
class CustomerViewSet(ProtectedDeleteMixin, AuditLogMixin, viewsets.ModelViewSet):
    audit_entity = "customer"
    queryset = Customer.objects.all().prefetch_related("businesses").order_by("name")
    serializer_class = CustomerSerializer
    permission_classes = [RoleBasedPermission]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]

    def perform_create(self, serializer):
        super().perform_create(serializer)
        # Registry completes whatever the form left blank (address/state/PAN)
        # — the frontend autofills too, but this covers raw API creates and
        # anything the user skipped. Empty fields only; quiet on failure.
        from billing.gstin import enrich_customer

        # After commit, not inside the request's transaction: the lookup is a
        # blocking network call and used to hold the row open for its
        # duration on every customer create.
        transaction.on_commit(lambda inst=serializer.instance: enrich_customer(inst))

    def get_entity_name(self, instance):
        return instance.name
    search_fields = ["name", "gst_number", "mobile_number"]
    ordering_fields = ["name", "gst_number", "mobile_number", "pan_number"]
    ordering = ["name"]
    pagination_class = StandardResultsSetPagination

    # Removed caching to ensure fresh data
    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)

        # Get customer IDs from current page
        customer_ids = [item["id"] for item in response.data.get("results", [])]
        if not customer_ids:
            return response

        # Bulk fetch metrics for all customers on the page
        invoices = Invoice.objects.filter(customer_id__in=customer_ids)

        # Apply date filters
        start_date = request.query_params.get("start_date")
        end_date = request.query_params.get("end_date")
        if start_date:
            invoices = invoices.filter(invoice_date__gte=start_date)
        if end_date:
            invoices = invoices.filter(invoice_date__lte=end_date)

        stats = invoices.values("customer_id", "type_of_invoice").annotate(
            total=Sum("total_amount"), count=Count("id")
        )

        # Map stats for easy lookup
        stats_map = {}
        for s in stats:
            cid = s["customer_id"]
            if cid not in stats_map:
                stats_map[cid] = {"total_revenue": 0, "invoice_count": 0}

            if s["type_of_invoice"] == INVOICE_TYPE_OUTWARD:
                stats_map[cid]["total_revenue"] = float(s["total"] or 0)

            stats_map[cid]["invoice_count"] += s["count"]

        # Inject metrics into response
        for item in response.data.get("results", []):
            cust_stats = stats_map.get(item["id"], {})
            item["total_revenue"] = cust_stats.get("total_revenue", 0)
            item["invoice_count"] = cust_stats.get("invoice_count", 0)

        return response

    def get_queryset(self):
        queryset = super().get_queryset()

        # Apply search filter manually for more control
        search_term = self.request.query_params.get("search", "")
        if search_term:
            queryset = queryset.filter(
                Q(name__icontains=search_term)
                | Q(gst_number__icontains=search_term)
                | Q(mobile_number__icontains=search_term)
            )

        # Filter by business_id
        business_id = self.request.query_params.get("business_id")
        if business_id:
            queryset = queryset.filter(businesses__id=business_id)

        return queryset

    @action(detail=False, methods=["get"])
    def search(self, request):
        """Search customers by name"""
        query = request.query_params.get("customer_name", "")
        if query and len(query) >= 2:
            customers = Customer.objects.filter(name__icontains=query).prefetch_related(
                "businesses"
            )[:10]
            serializer = self.get_serializer(customers, many=True)
            return Response(serializer.data)
        return Response([])

    @action(detail=False, methods=["get"])
    def top(self, request):
        """Get top customers by revenue"""
        from django.db.models import Count, F, Sum

        # Get query parameters
        start_date = request.query_params.get("start_date")
        end_date = request.query_params.get("end_date")
        business_id = request.query_params.get("business")
        limit = int(request.query_params.get("limit", 5))

        # Base query - focus on outward invoices (sales)
        query = Invoice.objects.filter(type_of_invoice="outward")

        # Apply filters
        if start_date:
            query = query.filter(invoice_date__gte=start_date)
        if end_date:
            query = query.filter(invoice_date__lte=end_date)
        if business_id:
            query = query.filter(business_id=business_id)

        # Group by customer, calculate totals
        top_customers = (
            query.values("customer", "customer__name")
            .annotate(
                total_amount=Sum("total_amount"),
                invoice_count=Count("id"),
                type_of_invoice=F("type_of_invoice"),
            )
            .order_by("-total_amount")[:limit]
        )

        # Format the response
        result = []
        for customer in top_customers:
            result.append(
                {
                    "id": customer["customer"],
                    "name": customer["customer__name"],
                    "total_amount": customer["total_amount"],
                    "invoice_count": customer["invoice_count"],
                    "type_of_invoice": customer["type_of_invoice"],
                }
            )

        return Response(result)

    @action(detail=False, methods=["get"])
    def export_csv(self, request):
        """Export customers to CSV"""
        # Get filter parameters from request
        search_term = request.query_params.get("search", "")
        business_id = request.query_params.get("business_id", "")

        # Build filter kwargs
        filter_kwargs = {}
        if search_term:
            filter_kwargs["name__icontains"] = search_term
        if business_id:
            filter_kwargs["businesses"] = business_id

        # Get customers with related businesses
        customers = (
            Customer.objects.filter(**filter_kwargs)
            .prefetch_related("businesses")
            .order_by("id")
        )

        # Create HTTP response with CSV content type
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="customers_export.csv"'

        # Create CSV writer
        writer = csv.writer(response)

        # Write header row
        writer.writerow(
            [
                "Customer Name",
                "Address",
                "GST Number",
                "PAN Number",
                "Mobile Number",
                "State Name",
                "Associated Businesses",
                "Created At",
                "Updated At",
            ]
        )

        # Write customer data
        for customer in customers:
            # Get associated business names
            business_names = ", ".join(
                [business.name for business in customer.businesses.all()]
            )

            writer.writerow(
                [
                    customer.name,
                    customer.address or "",
                    customer.gst_number or "",
                    customer.pan_number or "",
                    customer.mobile_number or "",
                    customer.state_name or "",
                    business_names,
                    customer.created_at.strftime("%Y-%m-%d %H:%M:%S"),
                    customer.updated_at.strftime("%Y-%m-%d %H:%M:%S"),
                ]
            )

        # Log export
        with contextlib.suppress(Exception):
            AuditLog.objects.create(
                action="exported",
                entity="customer",
                entity_id=0,
                entity_name=f"Customer CSV ({customers.count()} records)",
                user=request.user if request.user and request.user.is_authenticated else None,
                details=f"Exported {customers.count()} customers to CSV",
            )

        return response

    @action(detail=False, methods=["post"], permission_classes=[AdminOnlyPermission])
    def merge(self, request):
        """Merge source customer into target customer.
        Transfers all invoices and line items from source to target, then deletes source.
        """
        source_id = request.data.get("source_id")
        target_id = request.data.get("target_id")

        if not source_id or not target_id:
            return Response(
                {"error": "Both source_id and target_id are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if str(source_id) == str(target_id):
            return Response(
                {"error": "Source and target must be different customers."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            source = Customer.objects.get(id=source_id)
            target = Customer.objects.get(id=target_id)
        except Customer.DoesNotExist:
            return Response(
                {"error": "Customer not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Nothing here was transactional: invoice update -> line update ->
        # delete, and a failure midway left invoices on a customer whose lines
        # had moved. It also never asked whether any of those invoices sat in
        # a filed month.
        for biz_id, inv_date in (
            Invoice.objects.filter(customer=source)
            .values_list("business_id", "invoice_date").distinct()
        ):
            assert_period_unlocked(biz_id, inv_date, "edit")

        with transaction.atomic():
            invoices_transferred = Invoice.objects.filter(customer=source).update(
                customer=target
            )
            LineItem.objects.filter(customer=source).update(customer=target)
            for business in source.businesses.all():
                target.businesses.add(business)
            source_name = source.name
            source_id = source.pk
            source.delete()

        # Log merge
        with contextlib.suppress(Exception):
            AuditLog.objects.create(
                action="merged",
                entity="customer",
                entity_id=target.pk,
                entity_name=target.name,
                user=request.user if request.user and request.user.is_authenticated else None,
                details=f"Merged '{source_name}' (#{source_id}) into '{target.name}' ({invoices_transferred} invoices transferred)",
            )

        return Response(
            {
                "message": f"Successfully merged '{source_name}' into '{target.name}'.",
                "invoices_transferred": invoices_transferred,
                "target_id": target.id,
            }
        )



@method_decorator(csrf_exempt, name="dispatch")
class ProductViewSet(AuditLogMixin, viewsets.ModelViewSet):
    audit_entity = "product"
    queryset = Product.objects.all().order_by("name")
    serializer_class = ProductSerializer
    permission_classes = [RoleBasedPermission]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]

    def get_entity_name(self, instance):
        return instance.name
    search_fields = ["name", "hsn_code"]
    ordering_fields = ["name", "hsn_code", "gst_tax_rate"]
    ordering = ["name"]
    pagination_class = StandardResultsSetPagination

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)

        # Get product names from current page
        product_names = [item["name"] for item in response.data.get("results", [])]
        if not product_names:
            return response

        # Bulk fetch metrics from LineItem grouping by product_name
        # Use case-insensitive matching via Lower() to handle case mismatches
        from django.db.models.functions import Lower

        product_names_lower = [name.lower() for name in product_names]
        line_items = LineItem.objects.annotate(
            product_name_lower=Lower("product_name")
        ).filter(product_name_lower__in=product_names_lower)

        # Apply date filters via the associated invoice
        start_date = request.query_params.get("start_date")
        end_date = request.query_params.get("end_date")
        if start_date:
            line_items = line_items.filter(invoice__invoice_date__gte=start_date)
        if end_date:
            line_items = line_items.filter(invoice__invoice_date__lte=end_date)

        stats = line_items.values("product_name_lower", "invoice__type_of_invoice").annotate(
            total_rev=Sum("amount"),
            total_qty=Sum("quantity"),
            total_usage=Count("id"),
        )

        # Map stats for easy lookup (keyed by lowercase name)
        stats_map = {}
        for s in stats:
            name = s["product_name_lower"]
            if name not in stats_map:
                stats_map[name] = {"total_revenue": 0, "qty_sold": 0, "usage_count": 0}

            if s["invoice__type_of_invoice"] == INVOICE_TYPE_OUTWARD:
                stats_map[name]["total_revenue"] = float(s["total_rev"] or 0)
                stats_map[name]["qty_sold"] = float(s["total_qty"] or 0)

            stats_map[name]["usage_count"] += s["total_usage"]

        # Inject metrics into response (lookup by lowercase name)
        for item in response.data.get("results", []):
            prod_stats = stats_map.get(item["name"].lower(), {})
            item["total_revenue"] = prod_stats.get("total_revenue", 0)
            item["qty_sold"] = prod_stats.get("qty_sold", 0)
            item["usage_count"] = prod_stats.get("usage_count", 0)

        return response

    def get_queryset(self):
        queryset = super().get_queryset()

        # Apply search filter manually for more control
        search_term = self.request.query_params.get("search", "")
        if search_term:
            queryset = queryset.filter(
                Q(name__icontains=search_term) | Q(hsn_code__icontains=search_term)
            )

        return queryset

    @action(detail=False, methods=["get"])
    def search(self, request):
        """Search products by name"""
        query = request.query_params.get("product_name", "")

        # If query is empty or too short, return all products (limited to 20)
        if not query:
            products = Product.objects.all().order_by("name")[:20]
            serializer = self.get_serializer(products, many=True)
            return Response(serializer.data)
        # If query is provided and at least 2 characters, filter by it
        elif len(query) >= 2:
            products = Product.objects.filter(name__icontains=query).order_by("name")[
                :20
            ]
            serializer = self.get_serializer(products, many=True)
            return Response(serializer.data)
        # If query is too short, return empty list
        return Response([])

    @action(detail=False, methods=["get"])
    def top(self, request):
        """Get top products by sales volume or amount"""
        from django.db.models import Count, Sum

        # Get query parameters
        start_date = request.query_params.get("start_date")
        end_date = request.query_params.get("end_date")
        business_id = request.query_params.get("business")
        limit = int(request.query_params.get("limit", 5))
        sort_by = request.query_params.get(
            "sort_by", "amount"
        )  # 'amount' or 'quantity'

        # Base query - focus on outward invoices (sales)
        query = LineItem.objects.filter(invoice__type_of_invoice="outward")

        # Apply filters
        if start_date:
            query = query.filter(invoice__invoice_date__gte=start_date)
        if end_date:
            query = query.filter(invoice__invoice_date__lte=end_date)
        if business_id:
            query = query.filter(invoice__business_id=business_id)

        # Group by product name ALONE. Grouping by (name, hsn, rate) split one
        # product across several rows whenever historical line items carried a
        # different HSN or rate — the same "Silver Payal" appearing twice in a
        # Top Products list reads as a bug. hsn_variants tells the UI when the
        # underlying data disagrees so it can say so instead of hiding it.
        from django.db.models import Max
        top_products = query.values("product_name").annotate(
            total_amount=Sum("amount"),
            total_quantity=Sum("quantity"),
            invoice_count=Count("invoice", distinct=True),
            hsn_pick=Max("hsn_code"),
            rate_pick=Max("gst_tax_rate"),
            unit_pick=Max("unit"),
            hsn_variants=Count("hsn_code", distinct=True),
        )

        # Sort by the requested field
        if sort_by == "quantity":
            top_products = top_products.order_by("-total_quantity")[:limit]
        else:  # Default to 'amount'
            top_products = top_products.order_by("-total_amount")[:limit]

        # Format the response
        result = []
        for product in top_products:
            # Try to find the corresponding Product model instance
            product_obj = Product.objects.filter(name=product["product_name"]).first()

            result.append(
                {
                    "id": product_obj.id if product_obj else None,
                    "name": product["product_name"],
                    "hsn_code": product["hsn_pick"],
                    "gst_tax_rate": product["rate_pick"],
                    "total_amount": product["total_amount"],
                    "total_quantity": product["total_quantity"],
                    "invoice_count": product["invoice_count"],
                    # Real unit off the line items — the UI printed "units" for
                    # everything, including grams.
                    "unit": product.get("unit_pick") or "",
                    "hsn_variants": product.get("hsn_variants", 1),
                }
            )

        return Response(result)

    @action(detail=False, methods=["get"])
    def defaults(self, request):
        """Get default values for products"""
        from billing.constants import GST_TAX_RATE, HSN_CODE

        defaults = {"hsn_code": HSN_CODE, "gst_tax_rate": float(GST_TAX_RATE)}

        return Response(defaults)

    @action(detail=True, methods=["get"])
    def hsn_usage(self, request, pk=None):
        """How this product's name actually appears on invoice lines, grouped
        by HSN code — the drill-down behind Top Products' "+N more" flag.

        Line items store product_name as text, so when the catalog HSN
        changes (or an import carried its own code) the history drifts
        silently. Each variant is named with its usage window so the drift
        can be repaired: new lines follow the catalog automatically, old
        lines are fixed by editing their invoices.
        """
        from django.db.models import Max, Min

        product = self.get_object()
        rows = (
            LineItem.objects.filter(product_name=product.name)
            .values("hsn_code")
            .annotate(
                lines=Count("id"),
                quantity=Sum("quantity"),
                amount=Sum("amount"),
                first_used=Min("invoice__invoice_date"),
                last_used=Max("invoice__invoice_date"),
            )
            .order_by("-lines")
        )
        catalog = (product.hsn_code or "").strip()
        return Response(
            {
                "catalog_hsn": catalog,
                "variants": [
                    {
                        **r,
                        "matches_catalog": (r["hsn_code"] or "").strip() == catalog,
                    }
                    for r in rows
                ],
            }
        )


@method_decorator(csrf_exempt, name="dispatch")
class InvoiceViewSet(AuditLogMixin, viewsets.ModelViewSet):
    audit_entity = "invoice"
    permission_classes = [RoleBasedPermission]
    queryset = (
        Invoice.objects.all()
        .select_related("customer", "business")
        .order_by("-invoice_date")
    )
    serializer_class = InvoiceSerializer

    def get_entity_name(self, instance):
        cust = getattr(instance, "customer", None)
        return f"#{instance.invoice_number} - {cust.name if cust else 'Unknown'}"

    def get_serializer_class(self):
        if self.action == "list":
            # Allow export to request full serializer with line items
            if self.request.query_params.get("include_items") == "true":
                return InvoiceSerializer
            return InvoiceListSerializer
        return InvoiceSerializer

    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = [
        "invoice_number",
        "customer__name",
        "business__name",
    ]
    ordering_fields = [
        "invoice_date",
        "created_at",
        "invoice_number",
        "total_amount",
        "type_of_invoice",
        "customer__name",
        "business__name",
    ]
    ordering = ["-invoice_date", "-created_at"]
    pagination_class = StandardResultsSetPagination

    # Removed caching to ensure fresh data
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        queryset = super().get_queryset()

        # Prefetch line items when full serializer is requested (for export)
        if self.request.query_params.get("include_items") == "true":
            queryset = queryset.prefetch_related("lineitem_set")

        # Filter by invoice number
        invoice_number = self.request.query_params.get("invoice_number")
        if invoice_number:
            queryset = queryset.filter(invoice_number__icontains=invoice_number)

        # Filter by business
        business_id = self.request.query_params.get("business_id")
        if business_id:
            queryset = queryset.filter(business_id=business_id)

        # Filter by customer
        customer_id = self.request.query_params.get("customer_id")
        if customer_id:
            queryset = queryset.filter(customer_id=customer_id)

        # Filter by date range
        start_date = self.request.query_params.get("start_date")
        end_date = self.request.query_params.get("end_date")
        if start_date and end_date:
            queryset = queryset.filter(invoice_date__range=[start_date, end_date])

        # Filter by invoice type
        invoice_type = self.request.query_params.get("type_of_invoice")
        if invoice_type:
            queryset = queryset.filter(type_of_invoice=invoice_type)

        # Reconciliation drill-down: invoices whose lines carry a given GST
        # slab (percent, e.g. 3). Rates are stored as fractions (0.03), so
        # accept both spellings. distinct() because the join can multiply.
        gst_rate = self.request.query_params.get("gst_rate")
        if gst_rate:
            try:
                pct = Decimal(str(gst_rate))
                frac = pct / 100
                queryset = queryset.filter(
                    Q(lineitem__gst_tax_rate=frac) | Q(lineitem__gst_tax_rate=pct)
                ).distinct()
            except Exception:
                pass

        # Reconciliation drill-down: B2B (customer holds a GSTIN) vs B2C.
        segment = self.request.query_params.get("segment")
        if segment == "b2b":
            queryset = queryset.exclude(customer__gst_number__isnull=True).exclude(customer__gst_number="")
        elif segment == "b2c":
            queryset = queryset.filter(Q(customer__gst_number__isnull=True) | Q(customer__gst_number=""))

        # Filter by payment mode; "none" selects rows where it was never set.
        payment_mode = self.request.query_params.get("payment_mode")
        if payment_mode == "none":
            queryset = queryset.filter(payment_mode="")
        elif payment_mode:
            queryset = queryset.filter(payment_mode=payment_mode)

        # Data-hygiene filters used by DataQualityBanner drill-down URLs:
        #   ?empty=1      → invoices with zero line items
        #   ?no_hsn=1     → invoices with at least one HSN-less line item
        #   ?dups=1       → invoices whose (business, number, FY, type)
        #                   collides with another row
        if self.request.query_params.get("empty") == "1":
            queryset = queryset.filter(lineitem__isnull=True)

        if self.request.query_params.get("no_hsn") == "1":
            # An invoice qualifies if it has at least one line item whose
            # hsn_code is empty/null. The lineitem__isnull=False guard is
            # critical: without it, the LEFT JOIN makes invoices with ZERO
            # line items match `lineitem__hsn_code__isnull=True` and they'd
            # bleed in. distinct() collapses any row duplication.
            queryset = queryset.filter(
                lineitem__isnull=False,
            ).filter(
                Q(lineitem__hsn_code__isnull=True) | Q(lineitem__hsn_code="")
            ).distinct()

        if self.request.query_params.get("dups") == "1":
            # Bucket by (business, number, FY, type) and keep only invoices in
            # buckets of size > 1. Done in Python because the FY needs Apr-Mar
            # math we can't easily express in SQL without a CASE expression.
            from collections import defaultdict
            buckets = defaultdict(list)
            for inv in queryset.values("id", "business_id", "invoice_number", "invoice_date", "type_of_invoice"):
                d = inv["invoice_date"]
                if not d or not inv["invoice_number"]:
                    continue
                fy = d.year if d.month >= 4 else d.year - 1
                key = (inv["business_id"], inv["invoice_number"], fy, inv["type_of_invoice"])
                buckets[key].append(inv["id"])
            dup_ids = [i for ids in buckets.values() if len(ids) > 1 for i in ids]
            queryset = queryset.filter(id__in=dup_ids)

        # Annotate via correlated Subqueries instead of a JOIN+GROUP BY.
        #
        # The previous version chained
        #     .annotate(total_tax=Sum(F("lineitem__cgst")+...),
        #               line_item_count=Count("lineitem"))
        # which:
        #   (a) returned WRONG numbers — joining lineitem once and then
        #       both Sum-ing and Count-ing across that same join causes
        #       row-multiplication: total_tax = real_tax × line_item_count.
        #   (b) baked the join into every consumer of get_queryset()
        #       (stats / gst_summary / gstr_export / etc.), so even
        #       endpoints that don't need these annotations paid for the
        #       join. With dev DB at ~900 invoices that's tolerable; at
        #       prod scale it gets noticeable.
        #
        # Subqueries are independent per-row, no row inflation, and
        # downstream actions that don't reference total_tax / line_item_count
        # don't pay for them at all (Postgres skips uncorrelated
        # subqueries that aren't selected).
        from django.db.models import DecimalField, OuterRef, Subquery
        line_items_per_invoice = LineItem.objects.filter(invoice=OuterRef("pk"))
        tax_sum = (
            line_items_per_invoice
            .values("invoice")
            .annotate(t=Sum(F("cgst") + F("sgst") + F("igst")))
            .values("t")
        )
        item_count = (
            line_items_per_invoice
            .values("invoice")
            .annotate(c=Count("id"))
            .values("c")
        )
        queryset = queryset.annotate(
            total_tax=Coalesce(Subquery(tax_sum, output_field=DecimalField()), Decimal("0.00")),
            line_item_count=Coalesce(Subquery(item_count, output_field=IntegerField()), 0),
        )

        return queryset

    def create(self, request, *args, **kwargs):
        """
        Create an invoice + its line items in a single round-trip.

        Pass `line_items` in the request body alongside the invoice fields and
        we'll bulk-create them inside the same transaction as the invoice, then
        update total_amount. Saves the previous "POST /invoices/ then POST
        /invoices/{id}/update_line_items/" pair (was 2 round-trips, ~1s; now
        one ~500ms call).
        """
        line_items_data = request.data.get("line_items") or []

        # Strip line_items from the payload that goes into InvoiceSerializer —
        # the serializer doesn't know about them, and DRF would 400 on extras
        # if we ever turn on strict validation.
        payload = {k: v for k, v in request.data.items() if k != "line_items"}
        assert_period_unlocked(payload.get("business"), payload.get("invoice_date"), "create")
        serializer = self.get_serializer(data=payload)
        serializer.is_valid(raise_exception=True)

        try:
            with transaction.atomic():
                self.perform_create(serializer)  # saves invoice + writes audit log
                invoice = serializer.instance

                if line_items_data:
                    new_lis, new_total = build_line_items(invoice, line_items_data, source="form")
                    LineItem.objects.bulk_create(new_lis, batch_size=100)
                    # Bypass save()'s sum() roundtrip — we already know the total.
                    invoice.total_amount = new_total
                    Invoice.objects.filter(pk=invoice.pk).update(total_amount=new_total)

        except IntegrityError:
            # The DB-level guard (uniq_outward_number_per_business_fy) caught a
            # duplicate the read-then-write suggestion raced past. Same shape
            # as the pre-save duplicate check so the frontend shows its normal
            # duplicate dialog instead of a generic failure.
            return Response(
                {
                    "error": "duplicate_invoice_number",
                    "detail": (
                        "An outward invoice with this number already exists for "
                        "this business in the same financial year."
                    ),
                },
                status=status.HTTP_409_CONFLICT,
            )

        # Re-serialize so the response includes the persisted total + line items.
        invoice.refresh_from_db()
        out = self.get_serializer(invoice)
        headers = self.get_success_headers(out.data)
        return Response(out.data, status=status.HTTP_201_CREATED, headers=headers)

    def perform_update(self, serializer):
        inst = serializer.instance
        assert_period_unlocked(inst.business_id, inst.invoice_date, "edit")
        vd = serializer.validated_data
        assert_period_unlocked(
            getattr(vd.get("business"), "id", None) or inst.business_id,
            vd.get("invoice_date") or inst.invoice_date,
            "edit",
        )
        super().perform_update(serializer)

    def perform_destroy(self, instance):
        assert_period_unlocked(instance.business_id, instance.invoice_date, "delete")
        super().perform_destroy(instance)

    _LINE_SNAPSHOT_FIELDS = (
        "product_name", "hsn_code", "gst_tax_rate", "quantity", "rate",
        "cgst", "sgst", "igst", "amount", "unit",
    )

    def _full_snapshot(self, instance):
        # The header alone is not an invoice. Line items cascade away on delete
        # and were never recorded, so undoing a deleted invoice recreated a row
        # with the old total and zero lines — an "empty invoice" that counted
        # in dashboards but vanished from GSTR rate and HSN tables.
        data = super()._full_snapshot(instance)
        data["line_items"] = [
            {f: (str(getattr(li, f)) if getattr(li, f) is not None else None)
             for f in self._LINE_SNAPSHOT_FIELDS}
            for li in instance.lineitem_set.all()
        ]
        return data

    @action(detail=True, methods=["post"])
    def update_line_items(self, request, pk=None):
        """
        Replace all line items for an invoice in ONE round trip.
        Optionally also patches invoice-level fields (customer, business,
        invoice_number, invoice_date, type_of_invoice) — pass them under the
        "invoice" key — so the front-end can skip the separate PATCH call.

        Optimized: bulk_create line items, compute total from incoming data
        (skip the sum() query in Invoice.save()), single transaction, single
        audit-log entry.
        """
        invoice = self.get_object()
        assert_period_unlocked(invoice.business_id, invoice.invoice_date, "edit")
        _incoming = request.data.get("invoice") or {}
        assert_period_unlocked(
            _incoming.get("business") or invoice.business_id,
            _incoming.get("invoice_date") or invoice.invoice_date,
            "edit",
        )
        line_items_data = request.data.get("line_items", [])
        invoice_data = request.data.get("invoice", {})

        old_total = invoice.total_amount
        old_inv_number = invoice.invoice_number
        old_inv_date = invoice.invoice_date

        with transaction.atomic():
            # Two concurrent replaces persisted BOTH line sets under one total;
            # the row lock serialises them.
            invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
            # 1. Patch invoice-level fields if provided (in-memory only)
            if invoice_data:
                if invoice_data.get("customer"):
                    invoice.customer_id = invoice_data["customer"]
                if invoice_data.get("business"):
                    invoice.business_id = invoice_data["business"]
                if "invoice_number" in invoice_data:
                    invoice.invoice_number = invoice_data["invoice_number"]
                if "invoice_date" in invoice_data:
                    invoice.invoice_date = invoice_data["invoice_date"]
                if "type_of_invoice" in invoice_data:
                    invoice.type_of_invoice = invoice_data["type_of_invoice"]

            # 2. Delete old line items + bulk-create new ones.
            # _raw_delete bypasses the post_delete signal in billing/signals.py
            # that would otherwise re-sum line items + UPDATE invoice each time.
            # We're already setting total_amount explicitly below.
            old_lis_qs = LineItem.objects.filter(invoice=invoice)
            old_lis_qs._raw_delete(old_lis_qs.db)

            # After the in-memory patch above, so a changed customer/business
            # is reflected in the interstate decision.
            new_lis, new_total = build_line_items(invoice, line_items_data, source="form")
            if new_lis:
                LineItem.objects.bulk_create(new_lis, batch_size=100)

            # 3. Save the header through save(): a queryset update() skipped
            #    simple-history (this is the hot edit path, so the history table
            #    missed most real total changes) and surfaced a duplicate number
            #    as a raw 500 instead of the create path's clean 409.
            invoice.total_amount = new_total
            try:
                with transaction.atomic():
                    invoice.save()
            except IntegrityError:
                # The lines were already replaced above; a 409 must undo that
                # too, or the invoice keeps the new lines under the old number.
                transaction.set_rollback(True)
                return Response(
                    {"error": f"Invoice number {invoice.invoice_number} already exists for this business in this financial year.",
                     "code": "duplicate_invoice_number"},
                    status=status.HTTP_409_CONFLICT,
                )
            # bulk_create and _raw_delete send no signals, so cacheops never
            # heard about the new lines — prod could serve the deleted ones
            # for up to 30 minutes.
            # Only when cacheops is really on. It defers invalidation inside
            # atomic() and flushes at commit — outside any try here — so in
            # FAKE mode (CI) or with cacheops off, the call just booked a Redis
            # connection failure for later.
            cacheops_live = getattr(settings, "CACHEOPS_ENABLED", True) and not getattr(settings, "CACHEOPS_FAKE", False)
            try:
                if cacheops_live:
                    from cacheops import invalidate_model, invalidate_obj
                    invalidate_model(LineItem)
                    invalidate_obj(invoice)
            except Exception:
                # cacheops opens a Redis connection to invalidate; without one
                # (CI's Postgres job, a Redis restart) that raised out of the
                # request after the lines were already replaced.
                logger.warning("cacheops invalidation failed after line-item replace", exc_info=True)

            # 4. Single audit log entry
            try:
                changes = {}
                if old_total != new_total:
                    changes["total_amount"] = {"old": str(old_total), "new": str(new_total)}
                if old_inv_number != invoice.invoice_number:
                    changes["invoice_number"] = {"old": str(old_inv_number), "new": str(invoice.invoice_number)}
                if str(old_inv_date) != str(invoice.invoice_date):
                    changes["invoice_date"] = {"old": str(old_inv_date), "new": str(invoice.invoice_date)}
                details = f"Updated line items ({len(line_items_data)} items)"
                if changes:
                    details += f" + {', '.join(changes.keys())}"
                AuditLog.objects.create(
                    action="updated",
                    entity="invoice",
                    entity_id=invoice.pk,
                    entity_name=self.get_entity_name(invoice),
                    user=request.user if request.user and request.user.is_authenticated else None,
                    details=details,
                    changes=changes or None,
                )
            except Exception:
                logger.exception("Failed to log line items update")

        # Return updated invoice with line items, customer, business in 2 queries.
        # (1 select_related for invoice+customer+business, 1 prefetch for line_items)
        invoice = (
            Invoice.objects
            .select_related("customer", "business")
            .prefetch_related("lineitem_set")
            .get(pk=invoice.pk)
        )
        return Response(InvoiceSerializer(invoice).data)

    @action(detail=True, methods=["get"])
    def summary(self, request, pk=None):
        """Get invoice summary"""
        invoice = self.get_object()
        summary = LineItem.get_invoice_summary(invoice_id=invoice.id)
        serializer = InvoiceSummarySerializer(summary)
        return Response(serializer.data)

    @action(detail=True, methods=["get"])
    def print(self, request, pk=None):
        """Get printable invoice data"""
        invoice = self.get_object()
        line_items = LineItem.objects.filter(invoice_id=invoice.id)
        summary = LineItem.get_invoice_summary(invoice_id=invoice.id)

        # Convert amount to words using num2words
        total_amount = summary.get("total_amount", 0)
        try:
            # Convert to integer rupees for cleaner output
            rupees = int(total_amount)
            # Convert to words and capitalize first letter
            amount_in_words = num2words(rupees, lang="en_IN").title() + " Rupees Only"
        except Exception:
            # Fallback if num2words fails
            amount_in_words = f"{total_amount} Rupees Only"

        data = {
            "invoice": InvoiceSerializer(invoice).data,
            "line_items": LineItemSerializer(line_items, many=True).data,
            "amount_in_words": amount_in_words,
            **summary,
        }

        # Log print action
        with contextlib.suppress(Exception):
            AuditLog.objects.create(
                action="printed",
                entity="invoice",
                entity_id=invoice.pk,
                entity_name=f"#{invoice.invoice_number} - {invoice.customer.name}",
                user=request.user if request.user and request.user.is_authenticated else None,
                details=f"Printed invoice (total: {invoice.total_amount})",
            )

        return Response(data)

    @action(detail=True, methods=["get", "post"])
    def eway_bill(self, request, pk=None):
        """Get or update e-way bill details for an invoice."""
        invoice = self.get_object()

        if request.method == "GET":
            return Response({
                "invoice_id": invoice.id,
                "invoice_number": invoice.invoice_number,
                "total_amount": float(invoice.total_amount),
                "eway_bill_number": invoice.eway_bill_number,
                "transporter_name": invoice.transporter_name,
                "transporter_gstin": invoice.transporter_gstin,
                "vehicle_number": invoice.vehicle_number,
                "vehicle_type": invoice.vehicle_type,
                "transport_mode": invoice.transport_mode,
                "distance_km": invoice.distance_km,
                "requires_eway": float(invoice.total_amount) > 50000,
            })

        # POST — save e-way bill details
        assert_period_unlocked(invoice.business_id, invoice.invoice_date, "edit")
        fields = ["eway_bill_number", "transporter_name", "transporter_gstin",
                   "vehicle_number", "vehicle_type", "transport_mode", "distance_km"]
        for field in fields:
            if field in request.data:
                setattr(invoice, field, request.data[field])
        invoice.save()

        with contextlib.suppress(Exception):
            AuditLog.objects.create(
                action="updated", entity="invoice", entity_id=invoice.pk,
                entity_name=f"#{invoice.invoice_number} - E-way Bill",
                user=request.user if request.user.is_authenticated else None,
                details=f"E-way bill updated: {invoice.eway_bill_number or 'pending'}",
            )

        return Response({"message": "E-way bill details saved", "eway_bill_number": invoice.eway_bill_number})

    @action(detail=False, methods=["get"])
    def totals(self, request):
        """Get total amounts for invoices with the same filters as list"""
        queryset = self.get_queryset()

        # Calculate totals
        inward_total = (
            queryset.filter(type_of_invoice="inward").aggregate(Sum("total_amount"))[
                "total_amount__sum"
            ]
            or 0
        )
        outward_total = (
            queryset.filter(type_of_invoice="outward").aggregate(Sum("total_amount"))[
                "total_amount__sum"
            ]
            or 0
        )

        data = {
            "inward_total": inward_total,
            "outward_total": outward_total,
            "net_total": outward_total - inward_total,
        }

        return Response(data)

    @action(detail=False, methods=["get"])
    def all_ids(self, request):
        """Get all invoice IDs matching the current filters"""
        queryset = self.get_queryset()

        # Get only the IDs to minimize data transfer
        invoice_ids = list(queryset.values_list("id", flat=True))

        data = {"ids": invoice_ids, "count": len(invoice_ids)}

        return Response(data)

    @action(detail=False, methods=["get"])
    def monthly_totals(self, request):
        """Get monthly totals for invoices (outward and inward)"""
        from django.db.models.functions import ExtractMonth, ExtractYear

        # Use the same queryset as list to apply filters
        queryset = self.get_queryset()

        # Annotate with month and year
        queryset = queryset.annotate(
            month=ExtractMonth("invoice_date"), year=ExtractYear("invoice_date")
        )

        # Group by month and year, calculate totals
        from django.db.models import Count, Q

        monthly_data = (
            queryset.values("month", "year")
            .annotate(
                outward_total=Sum("total_amount", filter=Q(type_of_invoice="outward")),
                inward_total=Sum("total_amount", filter=Q(type_of_invoice="inward")),
                outward_count=Count("id", filter=Q(type_of_invoice="outward")),
                inward_count=Count("id", filter=Q(type_of_invoice="inward")),
            )
            .order_by("year", "month")
        )

        return Response(monthly_data)

    @action(detail=False, methods=["get"])
    def distribution(self, request):
        """Get distribution of invoices by type"""
        # Use the same queryset as list to apply filters
        queryset = self.get_queryset()

        # Calculate totals by type
        from django.db.models import Count

        outward_total = queryset.filter(type_of_invoice="outward").aggregate(
            total=Sum("total_amount"), count=Count("id")
        )

        inward_total = queryset.filter(type_of_invoice="inward").aggregate(
            total=Sum("total_amount"), count=Count("id")
        )

        other_total = queryset.exclude(
            type_of_invoice__in=["outward", "inward"]
        ).aggregate(total=Sum("total_amount"), count=Count("id"))

        distribution = {
            "outward_total": outward_total["total"] or 0,
            "outward_count": outward_total["count"] or 0,
            "inward_total": inward_total["total"] or 0,
            "inward_count": inward_total["count"] or 0,
            "other_total": other_total["total"] or 0,
            "other_count": other_total["count"] or 0,
        }

        return Response(distribution)

    @action(detail=False, methods=["get"])
    def stats(self, request):
        """Get consolidated dashboard stats"""
        queryset = self.get_queryset()

        results = {}
        # 1. Totals
        #
        # Invoice-level sums and line-item tax sums MUST come from separate
        # aggregates. Putting them in one .aggregate() makes Django join
        # billing_lineitem, so an invoice with N line items appears N times and
        # Sum("total_amount") / Count("id") count it N times — a 2-line invoice
        # was inflating dashboard sales by its own value. (Same row-
        # multiplication trap already documented in get_queryset(); it survived
        # here.) The tax sums are correct over the joined rows, since one row
        # per line item is exactly what they want.
        totals = queryset.aggregate(
            outward=Coalesce(
                Sum("total_amount", filter=Q(type_of_invoice="outward")),
                Decimal("0.00"),
            ),
            inward=Coalesce(
                Sum("total_amount", filter=Q(type_of_invoice="inward")),
                Decimal("0.00"),
            ),
            count=Count("id"),
            outward_count=Count("id", filter=Q(type_of_invoice="outward")),
            inward_count=Count("id", filter=Q(type_of_invoice="inward")),
        )
        tax_totals = LineItem.objects.filter(
            invoice_id__in=queryset.values("id")
        ).aggregate(
            outward_tax=Coalesce(
                Sum(
                    F("cgst") + F("sgst") + F("igst"),
                    filter=Q(invoice__type_of_invoice="outward"),
                ),
                Decimal("0.00"),
            ),
            inward_tax=Coalesce(
                Sum(
                    F("cgst") + F("sgst") + F("igst"),
                    filter=Q(invoice__type_of_invoice="inward"),
                ),
                Decimal("0.00"),
            ),
        )
        totals.update(tax_totals)

        # 2. Monthly summary
        monthly_raw = (
            queryset.annotate(
                month=ExtractMonth("invoice_date"), year=ExtractYear("invoice_date")
            )
            .values("month", "year")
            .annotate(
                outward_total=Coalesce(
                    Sum("total_amount", filter=Q(type_of_invoice="outward")),
                    Decimal("0.00"),
                ),
                inward_total=Coalesce(
                    Sum("total_amount", filter=Q(type_of_invoice="inward")),
                    Decimal("0.00"),
                ),
                outward_count=Count("id", filter=Q(type_of_invoice="outward")),
                inward_count=Count("id", filter=Q(type_of_invoice="inward")),
            )
            .order_by("-year", "-month")
        )

        results["totals"] = {
            "outward": float(totals["outward"]),
            "inward": float(totals["inward"]),
            "net": float(totals["outward"] - totals["inward"]),
            "tax": float(totals["outward_tax"]),
            "inward_tax": float(totals["inward_tax"]),
            "count": totals["count"],
            "outward_count": totals["outward_count"],
            "inward_count": totals["inward_count"],
        }
        # Per-month output tax, aggregated on LineItem directly — joining the
        # tax into monthly_raw's invoice-level query would re-introduce the
        # row-multiplication bug fixed in `totals` above. The Easy-mode GST
        # tile needs this to show a real month instead of FY totals.
        monthly_tax = {
            (t["y"], t["m"]): float(t["tax"] or 0)
            for t in LineItem.objects.filter(
                invoice_id__in=queryset.values("id"),
                invoice__type_of_invoice="outward",
            )
            .annotate(m=ExtractMonth("invoice__invoice_date"),
                      y=ExtractYear("invoice__invoice_date"))
            .values("y", "m")
            .annotate(tax=Sum(F("cgst") + F("sgst") + F("igst")))
        }
        results["monthly"] = [
            {
                "month": m["month"],
                "year": m["year"],
                "outward_total": float(m["outward_total"]),
                "inward_total": float(m["inward_total"]),
                "outward_count": m["outward_count"],
                "inward_count": m["inward_count"],
                "outward_tax": monthly_tax.get((m["year"], m["month"]), 0.0),
            }
            for m in monthly_raw
        ]

        # 3. Top Customers
        top_customers = (
            queryset.filter(type_of_invoice="outward")
            .values("customer_id", "customer__name")
            .annotate(total=Sum("total_amount"))
            .order_by("-total")[:5]
        )
        results["top_customers"] = [
            {
                "id": c["customer_id"],
                "name": c["customer__name"],
                "total": float(c["total"] or 0),
            }
            for c in top_customers
        ]

        # 4. Top Products — grouped by name only. Grouping by (name, hsn) split
        # one product into several rows whenever historical line items carried a
        # different HSN, so the same product appeared twice in the widget. `unit`
        # comes off the line items; the widget used to print "units" for
        # everything, grams included.
        from django.db.models import Max as _Max
        top_products = (
            LineItem.objects.filter(
                invoice__in=queryset, invoice__type_of_invoice="outward"
            )
            .values("product_name")
            .annotate(
                total_rev=Sum("amount"),
                total_qty=Sum("quantity"),
                # aliases must not shadow the field names, or Count() below
                # resolves to the aggregate instead of the column
                hsn_pick=_Max("hsn_code"),
                unit_pick=_Max("unit"),
                hsn_variants=Count("hsn_code", distinct=True),
            )
            .order_by("-total_rev")[:5]
        )
        results["top_products"] = [
            {
                "name": p["product_name"],
                "total": float(p["total_rev"] or 0),
                "qty": float(p["total_qty"] or 0),
                "hsn": p["hsn_pick"] or "",
                "unit": p["unit_pick"] or "",
                "hsn_variants": p["hsn_variants"],
            }
            for p in top_products
        ]

        # 5. Recent Invoices
        recent_invoices = InvoiceListSerializer(
            queryset.order_by("-created_at")[:5], many=True
        ).data
        results["recent_invoices"] = recent_invoices

        # 6. Tax Distribution (CGST/SGST/IGST breakdown)
        tax_agg = LineItem.objects.filter(invoice__in=queryset).aggregate(
            cgst=Coalesce(Sum("cgst"), Decimal("0.00")),
            sgst=Coalesce(Sum("sgst"), Decimal("0.00")),
            igst=Coalesce(Sum("igst"), Decimal("0.00")),
        )
        results["tax_distribution"] = {
            "cgst": float(tax_agg["cgst"]),
            "sgst": float(tax_agg["sgst"]),
            "igst": float(tax_agg["igst"]),
        }

        return Response(results)

    @action(detail=False, methods=["get"])
    def check_duplicate(self, request):
        """Check if an invoice number already exists for a business in a given
        financial year + invoice type.

        Previously only checked (business, invoice_number, current-FY-by-today).
        That missed:
          - duplicates on the SAME number in the SAME FY but a *different type*
            (an outward "12" can legitimately coexist with an inward "12")
          - back-dated entry into a *past* FY — the today-based check would
            misreport "no duplicate" because the past FY wasn't even in scope.
        A real audit of the prod DB found 6 same-(business, number, FY, type)
        collisions that slipped through the old check.

        Now the FY is derived from the supplied invoice_date when provided
        (falls back to today's FY), and type_of_invoice gates the lookup.
        """
        invoice_number = request.query_params.get("invoice_number", "")
        business_id = request.query_params.get("business_id", "")
        exclude_id = request.query_params.get("exclude_id", "")
        type_of_invoice = (request.query_params.get("type_of_invoice") or "").lower()
        invoice_date_str = request.query_params.get("invoice_date", "")

        if not invoice_number or not business_id:
            return Response({"exists": False})

        # Resolve the FY from the supplied invoice_date when present; fall
        # back to "this FY by wall-clock today" for backward compat.
        target_date = None
        if invoice_date_str:
            try:
                target_date = datetime.strptime(invoice_date_str, "%Y-%m-%d").date()
            except (TypeError, ValueError):
                target_date = None
        if target_date is None:
            target_date = timezone.localdate()
        fy_start = datetime(
            target_date.year if target_date.month >= 4 else target_date.year - 1,
            4, 1,
        ).date()
        fy_end = datetime(fy_start.year + 1, 3, 31).date()

        qs = Invoice.objects.filter(
            invoice_number=invoice_number,
            business_id=business_id,
            invoice_date__gte=fy_start,
            invoice_date__lte=fy_end,
        )
        if type_of_invoice in ("outward", "inward"):
            qs = qs.filter(type_of_invoice=type_of_invoice)
        if exclude_id:
            qs = qs.exclude(id=exclude_id)

        exists = qs.exists()
        return Response({
            "exists": exists,
            "message": (
                f"Invoice #{invoice_number} already exists for this business "
                f"in FY {fy_start.year}-{str(fy_start.year + 1)[2:]}"
                + (f" ({type_of_invoice})" if type_of_invoice in ("outward", "inward") else "")
                if exists else ""
            ),
        })

    @action(detail=False, methods=["get"])
    def data_quality(self, request):
        """Snapshot of common data-hygiene issues that will bite at filing time.

        Surfaces:
          - invoices_no_line_items   : invoices with zero LineItems (won't
                                       appear on GSTR-1 rate-slab tables)
          - line_items_missing_hsn   : line items with empty hsn_code
                                       (unfilable in GSTR-1 HSN summary)
          - duplicate_invoice_groups : same (business, number, FY, type)
                                       collisions — GST portal rejects these
                                       on filing.

        Counts only — drill-downs come from existing list APIs (filterable).
        """
        from django.db.models import Case, When
        from django.db.models.functions import ExtractYear
        empty_inv = Invoice.objects.filter(lineitem__isnull=True).count()
        no_hsn = LineItem.objects.filter(
            Q(hsn_code__isnull=True) | Q(hsn_code="")
        ).count()

        # Same-(business, number, FY, type) collisions.
        # FY math (Apr-Mar) used to be done in a Python loop streaming
        # every Invoice row to the application — ~1000 rows = ~50ms over
        # a remote DB. Push it to SQL: derive `fy` as a CASE expression
        # on the year of invoice_date, then GROUP BY in the database.
        fy_year = Case(
            When(invoice_date__month__gte=4, then=ExtractYear("invoice_date")),
            default=ExtractYear("invoice_date") - 1,
        )
        dup_groups = (
            Invoice.objects
            .exclude(invoice_date__isnull=True)
            .exclude(invoice_number__isnull=True)
            .exclude(invoice_number="")
            .annotate(_fy=fy_year)
            .values("business_id", "invoice_number", "_fy", "type_of_invoice")
            .annotate(c=Count("id"))
            .filter(c__gt=1)
            .count()
        )

        return Response({
            "invoices_no_line_items": empty_inv,
            "line_items_missing_hsn": no_hsn,
            "duplicate_invoice_groups": dup_groups,
            "has_issues": (empty_inv + no_hsn + dup_groups) > 0,
        })

    @action(detail=False, methods=["get"])
    def gst_summary(self, request):
        return gstr1.gst_summary(self, request)

    @action(detail=False, methods=["get"])
    def gstr_export(self, request):
        return gstr1.gstr_export(self, request)

    @action(detail=False, methods=["get"], url_path="gstr1-portal-json")
    def gstr1_portal_json(self, request):
        return gstr1.gstr1_portal_json(self, request)

    @action(detail=False, methods=["get"])
    def next_invoice_number(self, request):
        """Get the next invoice number for a business.

        Accepts optional `invoice_date` (YYYY-MM-DD) so back-dated entries get
        the next number for the *date's* FY, not today's FY. Without it,
        defaults to today (legacy behaviour).
        """
        business_id = request.query_params.get("business_id")
        invoice_type = request.query_params.get("type_of_invoice", INVOICE_TYPE_OUTWARD)
        invoice_date_str = request.query_params.get("invoice_date")

        if not business_id:
            return Response(
                {"error": "Business ID is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        # Get the financial year
        from datetime import datetime

        ref_date = None
        if invoice_date_str:
            try:
                ref_date = datetime.strptime(invoice_date_str, "%Y-%m-%d").date()
            except ValueError:
                ref_date = None
        if not ref_date:
            ref_date = timezone.localdate()
        # Get financial year start date (April 1st)
        start_date = (
            datetime(ref_date.year - 1, 4, 1).date()
            if ref_date.month < 4
            else datetime(ref_date.year, 4, 1).date()
        )

        # Find the highest trailing number, but only among invoice_numbers
        # whose shape we recognize. Without this filter, an invoice with a
        # programmatically-generated body like "P1778291284" would extract
        # the timestamp suffix and become the "max", leaking 1.7-billion as
        # the suggested next number.
        # Recognized shapes: pure digits ("100"), or PREFIX/FY/digits
        # ("SGJ/2024-25/108"). Anything else is skipped.
        import re

        # Scope to the chosen FY (start_date .. start_date + 1 year - 1 day),
        # so a back-dated entry in FY 2024-25 doesn't get its next-number
        # inferred from FY 2025-26 invoices.
        fy_end = datetime(start_date.year + 1, 3, 31).date()
        fy_invoices = Invoice.objects.filter(
            business_id=business_id,
            invoice_date__gte=start_date,
            invoice_date__lte=fy_end,
            type_of_invoice=invoice_type,
        ).only("invoice_number")

        recognized_pattern = re.compile(r"^(?:\d+|[A-Za-z]+/\d{4}-\d{2}/\d+)\s*$")
        max_num = 0
        last_invoice = None
        for inv in fy_invoices:
            if not recognized_pattern.match(inv.invoice_number or ""):
                continue
            m = re.search(r"(\d+)\s*$", inv.invoice_number)
            if m:
                n = int(m.group(1))
                if n > max_num:
                    max_num = n
                    last_invoice = inv

        next_number = 1
        if last_invoice:
            inv_num = last_invoice.invoice_number
            try:
                next_number = int(inv_num) + 1
            except (ValueError, IndexError):
                match = re.search(r"(\d+)\s*$", inv_num)
                if match:
                    next_number = int(match.group(1)) + 1
                else:
                    logger.warning(
                        f"Could not parse invoice_number '{inv_num}' "
                        f"for business {business_id}, type {invoice_type}."
                    )
                    next_number = 1

        # Build the next invoice number
        fy_start = start_date.year
        fy_str = f"{fy_start}-{str(fy_start + 1)[2:]}"

        # Use business's invoice_prefix field first, then fall back to detecting from existing invoices
        try:
            biz = Business.objects.get(id=business_id)
            prefix = biz.invoice_prefix.strip() if biz.invoice_prefix else ""
        except Business.DoesNotExist:
            prefix = ""

        if not prefix:
            # Fall back: detect from existing invoices
            sample = Invoice.objects.filter(business_id=business_id).exclude(
                invoice_number__regex=r"^\d+$"
            ).order_by("-id").first()
            if sample:
                match = re.match(r"^([A-Za-z]+)/\d{4}-\d{2}/", sample.invoice_number)
                if match:
                    prefix = match.group(1)

        next_invoice_number_str = f"{prefix}/{fy_str}/{next_number}" if prefix else str(next_number)

        return Response({"next_invoice_number": next_invoice_number_str})


@method_decorator(csrf_exempt, name="dispatch")
class LineItemViewSet(viewsets.ModelViewSet):
    queryset = LineItem.objects.all().select_related("invoice")
    serializer_class = LineItemSerializer
    pagination_class = StandardResultsSetPagination
    permission_classes = [RoleBasedPermission]

    def get_queryset(self):
        queryset = super().get_queryset()

        # Filter by invoice if provided in URL path or query params
        invoice_id = self.kwargs.get("invoice_id") or self.request.query_params.get(
            "invoice_id"
        )
        if invoice_id:
            queryset = queryset.filter(invoice_id=invoice_id)

        return queryset

    def perform_update(self, serializer):
        inv = serializer.instance.invoice
        assert_period_unlocked(inv.business_id, inv.invoice_date, "edit")
        super().perform_update(serializer)

    def perform_destroy(self, instance):
        inv = instance.invoice
        assert_period_unlocked(inv.business_id, inv.invoice_date, "edit")
        super().perform_destroy(instance)

    def create(self, request, *args, **kwargs):
        # Get invoice_id from URL path if available
        invoice_id = self.kwargs.get("invoice_id")
        if invoice_id:
            _inv = Invoice.objects.filter(id=invoice_id).only("business_id", "invoice_date").first()
            if _inv:
                assert_period_unlocked(_inv.business_id, _inv.invoice_date, "edit")
            try:
                # Use the LineItem.create_line_item_for_invoice method directly
                # This method handles all the calculations and validations
                line_item = LineItem.create_line_item_for_invoice(
                    product_name=request.data.get("product_name"),
                    quantity=request.data.get("quantity"),
                    rate=request.data.get("rate"),
                    invoice_id=invoice_id,
                )

                # Update the invoice total_amount
                invoice_obj = Invoice.objects.get(id=invoice_id)
                invoice_obj.total_amount = sum(
                    LineItem.objects.filter(invoice_id=invoice_id).values_list(
                        "amount", flat=True
                    )
                )
                invoice_obj.save()

                # Return the serialized line item
                serializer = self.get_serializer(line_item)
                return Response(serializer.data, status=status.HTTP_201_CREATED)

            except Invoice.DoesNotExist:
                return Response(
                    {"error": f"Invoice with ID {invoice_id} does not exist"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            except Exception as e:
                return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        # Plain POST /line-items/ with the invoice in the body: the guard above
        # only ran for URL-kwarg creates, and the post-save signal then rewrote
        # a filed invoice's total.
        body_invoice_id = request.data.get("invoice")
        if body_invoice_id:
            _inv = Invoice.objects.filter(id=body_invoice_id).only("business_id", "invoice_date").first()
            if _inv is None:
                return Response({"error": f"Invoice with ID {body_invoice_id} does not exist"}, status=status.HTTP_404_NOT_FOUND)
            assert_period_unlocked(_inv.business_id, _inv.invoice_date, "edit")
        return super().create(request, *args, **kwargs)

    @action(detail=False, methods=["post"])
    def create_for_invoice(self, request):
        """Create a line item for an invoice"""
        invoice_id = request.data.get("invoice_id")
        product_name = request.data.get("item_name")
        qty = request.data.get("qty")
        rate = request.data.get("rate")

        if not all([invoice_id, product_name, qty, rate]):
            return Response(
                {"error": "Missing required fields"}, status=status.HTTP_400_BAD_REQUEST
            )

        # Had no lock check at all, and a bad id 500ed inside the model helper.
        target = Invoice.objects.filter(id=invoice_id).only("business_id", "invoice_date").first()
        if target is None:
            return Response({"error": f"Invoice with ID {invoice_id} does not exist"}, status=status.HTTP_404_NOT_FOUND)
        assert_period_unlocked(target.business_id, target.invoice_date, "edit")

        line_item = LineItem.create_line_item_for_invoice(
            invoice_id=invoice_id,
            product_name=product_name,
            rate=rate,
            quantity=qty,
        )

        # Update invoice total
        line_items = LineItem.objects.filter(invoice_id=invoice_id)
        Invoice.objects.filter(id=invoice_id).update(
            total_amount=sum(line_items.values_list("amount", flat=True))
        )

        return Response(LineItemSerializer(line_item).data)


@method_decorator(csrf_exempt, name="dispatch")
class ReportView(APIView):
    """
    API endpoint for generating reports.
    Provides functionality to generate Excel reports of invoice data
    filtered by date range and invoice type.
    """
    permission_classes = [RoleBasedPermission]

    def get(self, request, *args, **kwargs):
        # Just return a simple response for API health check
        return Response({"message": "Report API ready"})

    @staticmethod
    def get_date_range_string(start_date, end_date):
        """Format date range into a readable string for display in reports."""
        start_date_obj = datetime.strptime(start_date, "%Y-%m-%d")
        end_date_obj = datetime.strptime(end_date, "%Y-%m-%d")

        start_date_str = datetime.strftime(start_date_obj, "%B %Y")
        end_date_str = datetime.strftime(end_date_obj, "%B %Y")

        # If same month and year, just return one date
        if start_date_str == end_date_str:
            return start_date_str
        # If same year, don't repeat the year
        elif start_date_obj.year == end_date_obj.year:
            return f"{start_date_str} to {datetime.strftime(end_date_obj, '%B')}-{end_date_obj.year}"
        # Different years
        else:
            return f"{start_date_str} to {end_date_str}"

    @staticmethod
    def add_invoice_data_to_sheet(
        business, business_name, date_range, line_items, sheet, supply_type
    ):
        """Add invoice data to an Excel sheet and calculate totals."""

        # Helper function to create rows with proper spacing
        def create_row_with_spacing(data):
            return ([""]) * 5 + [data]

        # Return zeros if no data
        if not line_items:
            return (
                Decimal("0"),
                Decimal("0"),
                Decimal("0"),
                Decimal("0"),
                Decimal("0"),
            )

        # Initialize totals
        total_taxable_value = total_cgst = total_sgst = total_igst = (
            total_invoice_value
        ) = Decimal("0")

        # Add header information
        sheet.append(create_row_with_spacing(business_name))
        sheet.append(create_row_with_spacing(supply_type))
        sheet.append(create_row_with_spacing(f"Month: {date_range}"))
        sheet.append(create_row_with_spacing(f"GSTIN: {business.gst_number}"))
        sheet.append([])
        sheet.append(DOWNLOAD_SHEET_FIELD_NAMES)

        # Add data rows and calculate totals
        for idx, item in enumerate(line_items, start=1):
            # Exclude the metadata fields (invoice_type and invoice_id_for_filter)
            sheet.append([idx] + list(item[:14]))

            # Extract values for totals calculation
            taxable_value = item[9]  # amount_before_tax
            cgst = item[10]  # cgst
            sgst = item[11]  # sgst
            igst = item[12]  # igst
            invoice_value = item[13]  # amount

            # Update running totals
            total_taxable_value += taxable_value
            total_cgst += cgst
            total_sgst += sgst
            total_igst += igst
            total_invoice_value += invoice_value

        # Add grand total row
        sheet.append(
            [""] * 5
            + [
                "Grand Total",
                "",
                "",
                "",
                "",
                total_taxable_value,
                total_cgst,
                total_sgst,
                total_igst,
                total_invoice_value,
            ]
        )

        return (
            total_taxable_value,
            total_cgst,
            total_sgst,
            total_igst,
            total_invoice_value,
        )

    @classmethod
    def get_monthly_date_ranges(cls, start_date, end_date):
        """Split a date range into monthly chunks for more detailed reporting."""
        start_date_obj = datetime.strptime(start_date, "%Y-%m-%d")
        end_date_obj = datetime.strptime(end_date, "%Y-%m-%d")

        monthly_ranges = []
        current_date = start_date_obj

        while current_date <= end_date_obj:
            year = current_date.year
            month = current_date.month

            # Get the last day of the current month
            _, last_day = monthrange(year, month)
            month_end = datetime(year, month, last_day)

            # Ensure we don't go beyond the end date
            if month_end > end_date_obj:
                month_end = end_date_obj

            # Add the date range for this month
            month_start_str = current_date.strftime("%Y-%m-%d")
            month_end_str = month_end.strftime("%Y-%m-%d")
            monthly_ranges.append((month_start_str, month_end_str))

            # Move to the first day of the next month
            current_date = (
                datetime(year + 1, 1, 1)
                if month == 12
                else datetime(year, month + 1, 1)
            )

        return monthly_ranges

    @classmethod
    def process_invoice_data(
        cls,
        line_items,
        invoice_type,
        business,
        business_name,
        date_range_string,
        sheet,
        overall_totals,
    ):
        """Process invoice data for a specific type (inward or outward)."""
        # Filter items by invoice type
        if invoice_type == INVOICE_TYPE_OUTWARD:
            filtered_items = [
                item for item in line_items if item[14] == INVOICE_TYPE_OUTWARD
            ]
            supply_type = "Outward Supply"
            totals_key = "outward"
        else:  # INVOICE_TYPE_INWARD
            filtered_items = [
                item for item in line_items if item[14] == INVOICE_TYPE_INWARD
            ]
            supply_type = "Inward Supply"
            totals_key = "inward"

        # Skip if no data for this type
        if not filtered_items:
            return

        # Add data to sheet and get totals
        totals = cls.add_invoice_data_to_sheet(
            business,
            business_name,
            date_range_string,
            filtered_items,
            sheet,
            supply_type,
        )

        # Update overall totals
        overall_totals[f"{totals_key}_taxable"] += totals[0]
        overall_totals[f"{totals_key}_cgst"] += totals[1]
        overall_totals[f"{totals_key}_sgst"] += totals[2]
        overall_totals[f"{totals_key}_igst"] += totals[3]
        overall_totals[f"{totals_key}_total"] += totals[4]

    @classmethod
    def add_aggregated_totals(cls, sheet, totals, date_range_str, invoice_type):
        """Add aggregated totals to the report sheet."""
        # Add outward totals if applicable
        if totals["outward_taxable"] and invoice_type in [INVOICE_TYPE_OUTWARD, "both"]:
            sheet.append([])  # Add spacing
            sheet.append(
                [""] * 5
                + [
                    f"Aggregated Outward Supply ({date_range_str})",
                    "",
                    "",
                    "",
                    "",
                    totals["outward_taxable"],
                    totals["outward_cgst"],
                    totals["outward_sgst"],
                    totals["outward_igst"],
                    totals["outward_total"],
                ]
            )

        # Add inward totals if applicable
        if totals["inward_taxable"] and invoice_type in [INVOICE_TYPE_INWARD, "both"]:
            sheet.append(
                [""] * 5
                + [
                    f"Aggregated Inward Supply ({date_range_str})",
                    "",
                    "",
                    "",
                    "",
                    totals["inward_taxable"],
                    totals["inward_cgst"],
                    totals["inward_sgst"],
                    totals["inward_igst"],
                    totals["inward_total"],
                ]
            )

        # NET row (Outward − Inward). This used to ADD sales to purchases —
        # a figure that means nothing and that the CA review flagged (D7).
        # Outward − inward is the real position: sales margin on value, and
        # output tax − ITC on the tax columns (the GSTR-3B shape).
        if invoice_type == "both" and (
            totals["outward_taxable"] or totals["inward_taxable"]
        ):
            sheet.append([])
            sheet.append(
                [""] * 5
                + [
                    f"NET (OUTWARD − INWARD) ({date_range_str})",
                    "",
                    "",
                    "",
                    "",
                    totals["outward_taxable"] - totals["inward_taxable"],
                    totals["outward_cgst"] - totals["inward_cgst"],
                    totals["outward_sgst"] - totals["inward_sgst"],
                    totals["outward_igst"] - totals["inward_igst"],
                    totals["outward_total"] - totals["inward_total"],
                ]
            )

        sheet.append([])  # Add spacing

    @classmethod
    def generate_report_for_business(
        cls, workbook, business, start_date, end_date, invoice_type
    ):
        """Generate a report sheet for a specific business."""
        # Create a sheet for this business
        business_name = business.name
        sheet_name = business_name[:31]  # Excel limits sheet names to 31 chars
        sheet = workbook.create_sheet(title=sheet_name)

        # Initialize summary totals
        overall_totals = {
            "outward_taxable": Decimal("0"),
            "outward_cgst": Decimal("0"),
            "outward_sgst": Decimal("0"),
            "outward_igst": Decimal("0"),
            "outward_total": Decimal("0"),
            "inward_taxable": Decimal("0"),
            "inward_cgst": Decimal("0"),
            "inward_sgst": Decimal("0"),
            "inward_igst": Decimal("0"),
            "inward_total": Decimal("0"),
        }

        # Get monthly date ranges
        monthly_ranges = cls.get_monthly_date_ranges(start_date, end_date)

        # Process each month separately
        for month_start_date, month_end_date in monthly_ranges:
            date_range_string = cls.get_date_range_string(
                month_start_date, month_end_date
            )

            # Get all line item data for the month in a single query
            line_items = LineItem.get_line_item_data_for_download(
                start_date=month_start_date, end_date=month_end_date, business=business
            )

            # Process outward invoices if requested
            if invoice_type in [INVOICE_TYPE_OUTWARD, "both"]:
                cls.process_invoice_data(
                    line_items,
                    INVOICE_TYPE_OUTWARD,
                    business,
                    business_name,
                    date_range_string,
                    sheet,
                    overall_totals,
                )

            # Process inward invoices if requested
            if invoice_type in [INVOICE_TYPE_INWARD, "both"]:
                cls.process_invoice_data(
                    line_items,
                    INVOICE_TYPE_INWARD,
                    business,
                    business_name,
                    date_range_string,
                    sheet,
                    overall_totals,
                )

        # Add aggregated sections at the end
        date_range_str = cls.get_date_range_string(start_date, end_date)
        cls.add_aggregated_totals(sheet, overall_totals, date_range_str, invoice_type)

    @classmethod
    def generate_csv_response(cls, start_date, end_date, invoice_type):
        """Generate an Excel file and return as an HTTP response."""
        # Create workbook and remove default sheet
        workbook = Workbook()
        workbook.remove(workbook.active)

        # Generate a sheet for each business
        for business in Business.objects.all():
            cls.generate_report_for_business(
                workbook, business, start_date, end_date, invoice_type
            )

        # Prepare HTTP response with Excel file
        response = HttpResponse(
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )

        # Set filename with date range
        date_range = cls.get_date_range_string(start_date, end_date)
        filename = f"invoices_{date_range}.xlsx"
        response["Content-Disposition"] = (
            f"attachment; filename=\"{filename}\"; filename*=UTF-8''{filename}"
        )

        workbook.save(response)
        return response

    def post(self, request, *args, **kwargs):
        """Handle POST request to generate a report."""
        # Get parameters from request
        start_date = request.data.get("start_date")
        end_date = request.data.get("end_date")
        invoice_type = request.data.get("invoice_type", "both")

        # Validate required parameters
        if not start_date or not end_date:
            return Response(
                {"error": "Start date and end date are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Generate and return the Excel file
        return self.generate_csv_response(start_date, end_date, invoice_type)


class CSVImportView(APIView):
    """
    API endpoint for importing data from CSV files.
    Supports importing invoices, customers, and products.
    """
    permission_classes = [RoleBasedPermission]

    parser_classes = [MultiPartParser]

    def get(self, request):
        # Just return a simple response
        return Response({"message": "CSV Import API ready"})

    def post(self, request):
        # Log the request for debugging
        logger.info(f"Received CSV import request: {request.data}")
        logger.info(f"Files in request: {request.FILES}")

        # Check if file is provided
        if "file" not in request.FILES:
            return Response(
                {"error": "No file provided"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get the import type
        import_type = request.data.get("import_type", "invoice")
        if import_type not in ["invoice", "customer", "product"]:
            return Response(
                {
                    "error": "Invalid import type. Must be one of: invoice, customer, product"
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check if business_id is provided for invoice and customer imports
        business_id = request.data.get("business_id")
        if import_type in ["invoice", "customer"] and not business_id:
            return Response(
                {"error": "Business ID is required for invoice"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get the uploaded file
        csv_file = request.FILES["file"]
        logger.info(f"Received file: {csv_file.name}, size: {csv_file.size}")

        # Check file extension
        if not csv_file.name.endswith(".csv"):
            return Response(
                {"error": "File must be a CSV file"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Process the CSV file
        try:
            # Read the file content
            file_content = csv_file.read()
            logger.info(f"File content length: {len(file_content)}")

            # Process the CSV file based on import type
            if import_type == "invoice":
                result = process_invoice_csv(file_content, int(business_id))
            elif import_type == "customer":
                result = process_customer_csv(file_content, int(business_id))
            elif import_type == "product":
                result = process_product_csv(file_content)

            logger.info(f"Import result for {import_type}: {result}")

            return Response(result, status=status.HTTP_201_CREATED)
        except CSVImportError as e:
            logger.error(f"CSV import error: {e}")
            return Response(
                {"error": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception as e:
            logger.error(f"Unexpected error during import: {e}", exc_info=True)
            return Response(
                {"error": "An unexpected error occurred during import"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class BulkInvoiceImportView(APIView):
    """
    API endpoint for bulk importing invoices from parsed Excel data.
    Accepts JSON with invoice data (parsed on the frontend from Excel files).

    Optimized: pre-fetches businesses/customers/duplicates in batches and uses
    bulk_create for line items, dropping ~200 round-trips for a 23-invoice import
    down to ~10. Wrapped in a single transaction for atomicity.
    """
    permission_classes = [RoleBasedPermission]

    def post(self, request):
        return run_bulk_import(request)

@method_decorator(csrf_exempt, name="dispatch")
class AIInvoiceProcessingView(APIView):
    """
    API endpoint for AI-powered invoice processing using Google Gemini.
    Processes invoice images and extracts structured data.
    """
    permission_classes = [RoleBasedPermission]

    parser_classes = [MultiPartParser]

    def post(self, request):
        """Process an invoice image and extract data"""
        try:
            # Validate request
            if "image" not in request.FILES:
                return Response(
                    {"error": "No image file provided"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            image_file = request.FILES["image"]

            # HEIC added for iPhone photo uploads — pillow-heif registered
            # an opener on Pillow, and AIInvoiceProcessor._normalize_image
            # always re-encodes to JPEG before going to Gemini (which only
            # accepts JPEG/PNG inline). Browsers send `image/heic` or
            # `image/heif`; some HEIC files come through as
            # `application/octet-stream` because the browser couldn't
            # sniff them — we let those through and rely on PIL to
            # validate during normalization.
            allowed_types = [
                "image/jpeg", "image/jpg", "image/png",
                "image/heic", "image/heif",
                "application/octet-stream",  # fallback for .heic from some browsers
            ]
            if image_file.content_type not in allowed_types:
                return Response(
                    {
                        "error": (
                            f"Unsupported image type '{image_file.content_type}'. "
                            "Upload a JPEG, PNG, or HEIC."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Validate file size (max 20MB — bumped from 10MB to handle
            # modern iPhone HEIC photos which routinely hit 10-15MB).
            if image_file.size > 20 * 1024 * 1024:
                return Response(
                    {
                        "error": "File too large. Maximum size is 20MB."
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # business_id is OPTIONAL — when omitted, the AI extracts the
            # recipient GSTIN from the invoice and the frontend looks up
            # the matching Business after extraction. When provided, the
            # prompt is scoped to that business's customers for better
            # match accuracy on suppliers we already know.
            business_id = request.data.get("business_id") or None

            # Process the image with AI
            processor = AIInvoiceProcessor()
            extracted_data = processor.process_invoice_image(
                image_file, business_id=business_id
            )

            # Auto-detect which Business this invoice belongs to AND the
            # invoice direction. We check EVERY GSTIN the AI extracted
            # (buyer, seller, AND the legacy customer_gst_number),
            # because in practice the AI sometimes ignores the
            # buyer/seller split and only fills the legacy customer
            # field — particularly on Indian invoices where the "Bill
            # To" block is the most visually prominent block.
            #
            # Routing:
            #   - GSTIN matches on buyer or customer side → our business
            #     bought from someone → INWARD. The "customer" (in the
            #     app's data-model sense, i.e. the OTHER party) is the
            #     seller.
            #   - GSTIN matches on seller side → our business sold to
            #     someone → OUTWARD. The "customer" is the buyer.
            #
            # If the AI confused itself and put our business's data into
            # the customer_* fields, we'll detect this here and clear
            # them — user fills in the actual supplier/buyer manually
            # rather than seeing their own business listed as the
            # customer (the previous behaviour, which the user flagged
            # as wrong).
            matched_business = None
            detected_type = None
            our_role: str | None = None  # "buyer" or "seller"
            inter_firm_buyer = None      # set when BOTH parties are our firms

            buyer_gstin = (extracted_data.get("buyer_gst_number") or "").strip().upper()
            seller_gstin = (extracted_data.get("seller_gst_number") or "").strip().upper()
            customer_gstin = (extracted_data.get("customer_gst_number") or "").strip().upper()

            buyer_biz = (
                Business.objects.filter(gst_number=buyer_gstin).first()
                if buyer_gstin else None
            )
            seller_biz = (
                Business.objects.filter(gst_number=seller_gstin).first()
                if seller_gstin else None
            )
            # Legacy fallback: the AI sometimes only fills the customer_*
            # fields (usually the buyer — the "Bill To" block is the most
            # prominent on Indian invoices).
            if buyer_biz is None and seller_biz is None and customer_gstin:
                buyer_biz = Business.objects.filter(gst_number=customer_gstin).first()

            if buyer_biz and seller_biz and buyer_biz.id != seller_biz.id:
                # ── INTER-FIRM: both parties are our businesses. One
                # physical bill = two ledger entries. Primary is the
                # OUTWARD for the seller firm; the create endpoint also
                # writes the INWARD mirror for the buyer firm (see
                # AIInvoiceCreateView inter_firm handling). Detected
                # this way, the sale AND the purchase/ITC side both
                # land without the user importing the bill twice.
                matched_business = {
                    "id": seller_biz.id, "name": seller_biz.name,
                    "gst_number": seller_biz.gst_number,
                }
                inter_firm_buyer = {
                    "id": buyer_biz.id, "name": buyer_biz.name,
                    "gst_number": buyer_biz.gst_number,
                }
                our_role = "seller"
                detected_type = INVOICE_TYPE_OUTWARD
                # The outward entry's customer is the buyer firm.
                extracted_data["customer_name"] = buyer_biz.name
                extracted_data["customer_gst_number"] = buyer_biz.gst_number
            elif seller_biz:
                matched_business = {
                    "id": seller_biz.id, "name": seller_biz.name,
                    "gst_number": seller_biz.gst_number,
                }
                our_role = "seller"
                detected_type = INVOICE_TYPE_OUTWARD
            elif buyer_biz:
                matched_business = {
                    "id": buyer_biz.id, "name": buyer_biz.name,
                    "gst_number": buyer_biz.gst_number,
                }
                our_role = "buyer"
                detected_type = INVOICE_TYPE_INWARD

            if matched_business and not inter_firm_buyer:
                # Promote the OTHER party into the legacy customer_*
                # fields the review form binds against. Preference
                # order: the explicit field for that side → the legacy
                # customer field if it's not our own business name.
                our_gstin = matched_business["gst_number"]
                our_name_upper = matched_business["name"].upper()
                if our_role == "buyer":
                    other_name = extracted_data.get("seller_name") or ""
                    other_gstin = seller_gstin
                else:
                    other_name = extracted_data.get("buyer_name") or ""
                    other_gstin = buyer_gstin

                # Fall back to the legacy customer_* fields ONLY if they
                # don't refer to our own business (avoids the AI's
                # mistake leaking through to the review form).
                legacy_name = extracted_data.get("customer_name") or ""
                if not other_name and legacy_name and legacy_name.upper() != our_name_upper:
                    other_name = legacy_name
                if not other_gstin and customer_gstin and customer_gstin != our_gstin:
                    other_gstin = customer_gstin

                extracted_data["customer_name"] = other_name
                extracted_data["customer_gst_number"] = other_gstin

                # ── Backfill from existing Customer if we can find one ──
                # AI vision often misses small text like GSTINs (15
                # alphanumeric chars in fine print). The Customer table
                # is the source of truth — if a Customer matches the
                # extracted name and/or GSTIN, copy the missing fields
                # (GSTIN, address, PAN, mobile) from the DB record so
                # the review form is fully populated.
                # Match priority:
                #   1. Exact GSTIN match (most reliable identifier)
                #   2. Case-insensitive name match scoped to the
                #      matched business (multi-state suppliers have
                #      distinct rows; we want the one this business
                #      actually transacts with)
                existing = None
                if other_gstin:
                    existing = Customer.objects.filter(gst_number=other_gstin).first()
                if existing is None and other_name:
                    existing = (
                        Customer.objects.filter(
                            businesses__id=matched_business["id"],
                            name__iexact=other_name,
                        ).first()
                    )
                if existing:
                    # Always trust DB for canonical name (handles AI
                    # casing/whitespace differences). Backfill the rest
                    # only when AI didn't extract them.
                    extracted_data["customer_name"] = existing.name
                    if not extracted_data.get("customer_gst_number") and existing.gst_number:
                        extracted_data["customer_gst_number"] = existing.gst_number
                    for db_field, ai_key in (
                        ("address", "customer_address"),
                        ("pan_number", "customer_pan_number"),
                        ("mobile_number", "customer_mobile_number"),
                    ):
                        if not extracted_data.get(ai_key) and getattr(existing, db_field, ""):
                            extracted_data[ai_key] = getattr(existing, db_field)

            # Strip internal-only fields before responding. _key_index
            # / _key_total are re-surfaced at the top level so the UI
            # can show "Gemini #2/3" during a bulk import.
            extracted_data.pop("_provider", None)
            key_index = extracted_data.pop("_key_index", None)  # 1-indexed
            key_total = extracted_data.pop("_key_total", None)

            return Response(
                {
                    "success": True,
                    "data": extracted_data,
                    "matched_business": matched_business,  # null if no DB match
                    "detected_type": detected_type,        # "inward" / "outward" / null
                    # Inter-firm: both GSTINs on the bill are OUR firms.
                    # matched_business is the seller (outward side);
                    # this is the buyer firm that gets the inward mirror.
                    "inter_firm": inter_firm_buyer is not None,
                    "inter_firm_buyer_business": inter_firm_buyer,
                    # Which of the N rotated Gemini keys handled this
                    # request. Lets the UI show "Gemini #2/3" so the
                    # user can see when they're burning through the
                    # key pool.
                    "key_index": key_index,
                    "key_total": key_total,
                    "message": "Invoice data extracted successfully",
                }
            )

        except AIInvoiceProcessingError as e:
            logger.error(f"AI invoice processing error: {e}")
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            logger.error(
                f"Unexpected error during AI invoice processing: {e}", exc_info=True
            )
            return Response(
                {"error": "An unexpected error occurred while processing the invoice"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


@method_decorator(csrf_exempt, name="dispatch")
class AIInvoiceCreateView(APIView):
    """
    API endpoint for creating invoices from AI-extracted data.
    """
    permission_classes = [RoleBasedPermission]

    # Accept both JSON (legacy / non-AI flows) and multipart (AI Import
    # which now ships the original source image alongside the extracted
    # data so we can store an audit-trail copy).
    parser_classes = [MultiPartParser, JSONParser]

    # One transaction: invoice -> files -> lines -> total -> inter-firm mirror.
    # A mid-flight failure (a Decimal like "1,250") used to leave a stub
    # invoice carrying the AI's total and zero lines.
    @transaction.atomic
    def post(self, request):
        return create_from_ai(request)

class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only viewset for audit log entries with undo support."""
    permission_classes = [RoleBasedPermission]

    queryset = AuditLog.objects.all().select_related("user")
    serializer_class = AuditLogSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        queryset = super().get_queryset()

        action_filter = self.request.query_params.get("action")
        if action_filter and action_filter != "all":
            queryset = queryset.filter(action=action_filter)

        entity = self.request.query_params.get("entity")
        if entity and entity != "all":
            queryset = queryset.filter(entity=entity)

        entity_id = self.request.query_params.get("entity_id")
        if entity_id:
            queryset = queryset.filter(entity_id=entity_id)

        search = self.request.query_params.get("search")
        if search:
            queryset = queryset.filter(
                Q(entity_name__icontains=search) | Q(details__icontains=search)
            )

        return queryset

    @action(detail=False, methods=["post"], permission_classes=[permissions.IsAuthenticated])
    def log(self, request):
        # A viewer printing or exporting is a legitimate event to record; the
        # only write here is the log row itself.
        """Allow frontend to log actions (print, export, batch operations)."""
        action_type = request.data.get("action", "")
        entity = request.data.get("entity", "invoice")
        entity_id = request.data.get("entity_id", 0)
        entity_name = request.data.get("entity_name", "")
        details = request.data.get("details", "")

        ALLOWED_ACTIONS = {"printed", "exported", "imported", "merged"}
        if action_type not in ALLOWED_ACTIONS:
            return Response({"error": f"Action must be one of: {ALLOWED_ACTIONS}"}, status=400)

        try:
            AuditLog.objects.create(
                action=action_type,
                entity=entity,
                entity_id=entity_id,
                entity_name=entity_name,
                user=request.user if request.user and request.user.is_authenticated else None,
                details=details,
            )
            return Response({"status": "logged"})
        except Exception as e:
            return Response({"error": str(e)}, status=500)

    @action(detail=True, methods=["post"], permission_classes=[AdminOnlyPermission])
    def undo(self, request, pk=None):
        # Undo is a full write primitive — undoing a "created" entry deletes the
        # object — so it is delete-class: admin only. It used to fall through to
        # bare IsAuthenticated, and a viewer deleted a customer through it.
        """Undo an audit log entry by restoring the previous state."""
        entry = self.get_object()

        MODEL_MAP = {
            "invoice": Invoice,
            "customer": Customer,
            "product": Product,
            "business": Business,
        }

        model = MODEL_MAP.get(entry.entity)
        if not model:
            return Response({"error": f"Unknown entity: {entry.entity}"}, status=400)

        def _resolve_fk(field, raw_value):
            """Resolve an FK snapshot value to an integer PK, even if older
            audit entries stored the related object's __str__ (a name) rather
            than the ID."""
            if raw_value is None or raw_value == "None" or raw_value == "":
                return None
            try:
                return int(raw_value)
            except (TypeError, ValueError):
                pass
            # Older snapshots may have stored the __str__ — try a name lookup
            related = field.related_model
            for cand in ("name", "invoice_number", "username"):
                if hasattr(related, cand):
                    obj = related.objects.filter(**{cand: raw_value}).first()
                    if obj:
                        return obj.pk
            return None

        try:
            # Every branch is one transaction: a restore that recreates the header
            # and then fails on a line must leave nothing behind.
            with transaction.atomic():
                if entry.action == "deleted" and entry.snapshot:
                    # Recreate the deleted object
                    snap = entry.snapshot
                    field_names = {f.name for f in model._meta.concrete_fields}
                    kwargs = {}
                    for k, v in snap.items():
                        if k not in field_names or k == "id":
                            continue
                        field = model._meta.get_field(k)
                        if v is None or v == "None":
                            kwargs[k] = None if field.null else ""
                        elif hasattr(field, "related_model") and field.related_model:
                            # FK field — resolve to integer PK (handles new + legacy snapshots)
                            kwargs[k + "_id"] = _resolve_fk(field, v)
                        else:
                            kwargs[k] = v
                    if model is Invoice:
                        assert_period_unlocked(kwargs.get("business_id"), kwargs.get("invoice_date"), "create")
                    obj = model.objects.create(**kwargs)
                    for line in snap.get("line_items") or []:
                        LineItem.objects.create(
                            invoice=obj, customer_id=obj.customer_id, workspace_id=1,
                            **{k: (None if v in (None, "None") else v) for k, v in line.items()},
                        )
                    if snap.get("line_items"):
                        obj.save()  # re-sums total_amount from the restored lines
                    AuditLog.objects.create(
                        action="created",
                        entity=entry.entity,
                        entity_id=obj.pk,
                        entity_name=str(obj),
                        user=request.user if request.user.is_authenticated else None,
                        details=f"Restored via undo (was #{entry.entity_id})",
                    )
                    return Response({"message": f"Restored {entry.entity}: {entry.entity_name}", "new_id": obj.pk})

                elif entry.action == "updated" and entry.snapshot:
                    # Revert to the snapshot state
                    try:
                        obj = model.objects.get(pk=entry.entity_id)
                    except model.DoesNotExist:
                        return Response({"error": "Record no longer exists"}, status=404)

                    snap = entry.snapshot
                    if model is Invoice:
                        assert_period_unlocked(obj.business_id, obj.invoice_date, "edit")
                        assert_period_unlocked(snap.get("business"), snap.get("invoice_date"), "edit")
                    field_names = {f.name for f in model._meta.concrete_fields}
                    for k, v in snap.items():
                        if k not in field_names or k == "id":
                            continue
                        field = model._meta.get_field(k)
                        if hasattr(field, "related_model") and field.related_model:
                            setattr(obj, k + "_id", _resolve_fk(field, v))
                        else:
                            if v is None or v == "None":
                                setattr(obj, k, None if field.null else "")
                            else:
                                setattr(obj, k, v)
                    obj.save()
                    AuditLog.objects.create(
                        action="updated",
                        entity=entry.entity,
                        entity_id=obj.pk,
                        entity_name=str(obj),
                        user=request.user if request.user.is_authenticated else None,
                        details=f"Reverted via undo to state before: {entry.details}",
                    )
                    return Response({"message": f"Reverted {entry.entity}: {entry.entity_name}"})

                elif entry.action == "created":
                    # Delete the created object
                    try:
                        obj = model.objects.get(pk=entry.entity_id)
                        if model is Invoice:
                            assert_period_unlocked(obj.business_id, obj.invoice_date, "delete")
                        name = str(obj)
                        obj.delete()
                        AuditLog.objects.create(
                            action="deleted",
                            entity=entry.entity,
                            entity_id=entry.entity_id,
                            entity_name=name,
                            user=request.user if request.user.is_authenticated else None,
                            details=f"Deleted via undo (was created at {entry.timestamp})",
                        )
                        return Response({"message": f"Deleted {entry.entity}: {name}"})
                    except model.DoesNotExist:
                        return Response({"error": "Record already deleted"}, status=404)

                else:
                    return Response({"error": "Cannot undo this action (no snapshot available)"}, status=400)

        except APIException:
            raise  # a filed-period refusal is a 4xx, not an undo failure
        except Exception as e:
            logger.exception(f"Undo failed for audit entry {pk}")
            return Response({"error": str(e)}, status=500)


@method_decorator(csrf_exempt, name="dispatch")
class ITCReclaimLedgerView(APIView):
    """
    GET  /api/itc-ledger/<business_id>/  — fetch the ECRRS opening balance for a
                                            business; auto-creates a zero row on
                                            first access so the frontend always
                                            gets a valid object.
    PATCH /api/itc-ledger/<business_id>/ — update opening_cgst/sgst/igst.

    The closing balance is computed live elsewhere (gst_summary) — this endpoint
    only owns the *opening* declaration that GSTN expects taxpayers to seed once.
    """

    permission_classes = [RoleBasedPermission]
    audit_entity = "itc_ledger"

    def _get_or_create(self, business_id):
        try:
            business = Business.objects.get(id=business_id)
        except Business.DoesNotExist:
            return None, Response(
                {"error": f"Business {business_id} not found"},
                status=status.HTTP_404_NOT_FOUND,
            )
        from billing.models import ITCReclaimLedger
        ledger, _ = ITCReclaimLedger.objects.get_or_create(
            business=business,
            defaults={"workspace_id": getattr(business, "workspace_id", 1) or 1},
        )
        return ledger, None

    def get(self, request, business_id):
        ledger, err = self._get_or_create(business_id)
        if err:
            return err
        from .serializers import ITCReclaimLedgerSerializer
        return Response(ITCReclaimLedgerSerializer(ledger).data)

    def patch(self, request, business_id):
        ledger, err = self._get_or_create(business_id)
        if err:
            return err
        from .serializers import ITCReclaimLedgerSerializer
        serializer = ITCReclaimLedgerSerializer(ledger, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        # Auto-stamp opening_as_of when the user mutates an opening_* field but
        # doesn't supply an explicit date — saves them a click on every edit.
        if "opening_as_of" not in request.data and any(
            k in request.data for k in ("opening_cgst", "opening_sgst", "opening_igst")
        ):
            serializer.save(opening_as_of=timezone.localdate())
        else:
            serializer.save()
        return Response(serializer.data)


@method_decorator(csrf_exempt, name="dispatch")
class ProfileView(APIView):
    """Get/update user profile."""
    # Self-scoped writes (a user editing their own profile) must stay open to
    # viewers, so this is IsAuthenticated on purpose — explicitly, not by
    # falling through to the default.
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        return Response({
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "full_name": user.get_full_name() or user.username,
            "date_joined": user.date_joined.isoformat(),
        })

    def patch(self, request):
        user = request.user
        if "first_name" in request.data:
            user.first_name = request.data["first_name"]
        if "last_name" in request.data:
            user.last_name = request.data["last_name"]
        if "email" in request.data:
            user.email = request.data["email"]
        user.save()
        return Response({
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "full_name": user.get_full_name() or user.username,
        })


@method_decorator(csrf_exempt, name="dispatch")
class UserManagementView(APIView):
    """Admin-only endpoint to list, create, and manage users with roles."""
    permission_classes = [AdminOnlyPermission]

    def get(self, request):
        from django.contrib.auth.models import User
        users = User.objects.all().prefetch_related("groups").order_by("username")
        return Response([
            {
                "id": u.id,
                "username": u.username,
                "email": u.email,
                "first_name": u.first_name,
                "last_name": u.last_name,
                "full_name": u.get_full_name() or u.username,
                "role": get_user_role(u),
                "is_active": u.is_active,
                "date_joined": u.date_joined.isoformat(),
                "last_login": u.last_login.isoformat() if u.last_login else None,
            }
            for u in users
        ])

    def post(self, request):
        """Create a new user with a role."""
        from django.contrib.auth.models import Group, User
        username = request.data.get("username", "").strip()
        password = request.data.get("password", "")
        email = request.data.get("email", "")
        role = request.data.get("role", "editor")
        first_name = request.data.get("first_name", "")
        last_name = request.data.get("last_name", "")

        if not username or not password:
            return Response({"error": "Username and password required"}, status=400)

        if User.objects.filter(username=username).exists():
            return Response({"error": f"User '{username}' already exists"}, status=400)

        if role not in ("admin", "editor", "viewer"):
            return Response({"error": "Role must be admin, editor, or viewer"}, status=400)

        user = User.objects.create_user(
            username=username, password=password, email=email,
            first_name=first_name, last_name=last_name,
        )
        group = Group.objects.get(name=role)
        user.groups.add(group)

        return Response({
            "id": user.id,
            "username": user.username,
            "role": role,
            "message": f"User '{username}' created with role '{role}'",
        }, status=201)

    def patch(self, request):
        """Update a user's role or status."""
        from django.contrib.auth.models import Group, User
        user_id = request.data.get("user_id")
        if not user_id:
            return Response({"error": "user_id required"}, status=400)

        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response({"error": "User not found"}, status=404)

        # Update role
        new_role = request.data.get("role")
        if new_role and new_role in ("admin", "editor", "viewer"):
            user.groups.clear()
            user.groups.add(Group.objects.get(name=new_role))

        # Update active status
        if "is_active" in request.data:
            user.is_active = request.data["is_active"]
            user.save(update_fields=["is_active"])

        # Update password
        if request.data.get("password"):
            user.set_password(request.data["password"])
            user.save()

        return Response({
            "id": user.id,
            "username": user.username,
            "role": get_user_role(user),
            "is_active": user.is_active,
            "message": "User updated",
        })


class FiledPeriodViewSet(viewsets.ModelViewSet):
    """Lock/unlock filed months. Every transition is audit-logged —
    the unlock trail is the whole point."""

    queryset = FiledPeriod.objects.select_related("business").order_by(
        "business__name", "-year", "-month"
    )
    serializer_class = FiledPeriodSerializer
    permission_classes = [RoleBasedPermission]
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        business_id = self.request.query_params.get("business_id")
        if business_id:
            qs = qs.filter(business_id=business_id)
        year = self.request.query_params.get("year")
        if year:
            qs = qs.filter(year=year)
        return qs

    def perform_create(self, serializer):
        period = serializer.save(workspace_id=1)
        AuditLog.objects.create(
            action="locked", entity="period", entity_id=period.id,
            entity_name=f"{period.business.name} {period.month:02d}/{period.year}",
            user=self.request.user if self.request.user.is_authenticated else None,
            details=f"Month marked as filed & locked. {('Note: ' + period.note) if period.note else ''}".strip(),
        )

    def perform_destroy(self, instance):
        label = f"{instance.business.name} {instance.month:02d}/{instance.year}"
        pid = instance.id
        instance.delete()
        AuditLog.objects.create(
            action="unlocked", entity="period", entity_id=pid, entity_name=label,
            user=self.request.user if self.request.user.is_authenticated else None,
            details="Filed month unlocked for corrections — re-lock after editing.",
        )
