import csv
import logging
from calendar import monthrange
from datetime import datetime
from decimal import Decimal

from django.db import transaction
from django.db.models import (
    Count,
    F,
    IntegerField,
    Q,
    Sum,
)
from django.db.models.functions import Cast, Coalesce, ExtractMonth, ExtractYear
from django.http import HttpResponse
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from num2words import num2words
from openpyxl import Workbook
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.constants import (
    DOWNLOAD_SHEET_FIELD_NAMES,
    INVOICE_TYPE_INWARD,
    INVOICE_TYPE_OUTWARD,
)
from billing.models import AuditLog, Business, Customer, Invoice, LineItem, Product
from billing.utils import (
    AIInvoiceProcessingError,
    AIInvoiceProcessor,
    CSVImportError,
    process_customer_csv,
    process_invoice_csv,
    process_product_csv,
)

from .mixins import AuditLogMixin
from .permissions import RoleBasedPermission, AdminOnlyPermission, get_user_role
from .serializers import (
    AuditLogSerializer,
    BusinessSerializer,
    CustomerSerializer,
    InvoiceListSerializer,
    InvoiceSerializer,
    InvoiceSummarySerializer,
    LineItemSerializer,
    ProductSerializer,
)

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
class BusinessViewSet(AuditLogMixin, viewsets.ModelViewSet):
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
class CustomerViewSet(AuditLogMixin, viewsets.ModelViewSet):
    audit_entity = "customer"
    queryset = Customer.objects.all().prefetch_related("businesses").order_by("name")
    serializer_class = CustomerSerializer
    permission_classes = [RoleBasedPermission]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]

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
        try:
            AuditLog.objects.create(
                action="exported",
                entity="customer",
                entity_id=0,
                entity_name=f"Customer CSV ({customers.count()} records)",
                user=request.user if request.user and request.user.is_authenticated else None,
                details=f"Exported {customers.count()} customers to CSV",
            )
        except Exception:
            pass

        return response

    @action(detail=False, methods=["post"])
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

        # Transfer all invoices from source to target
        invoices_transferred = Invoice.objects.filter(customer=source).update(
            customer=target
        )

        # Transfer all line items from source to target
        LineItem.objects.filter(customer=source).update(customer=target)

        # Merge business associations
        for business in source.businesses.all():
            target.businesses.add(business)

        # Delete the source customer
        source_name = source.name
        source_id = source.pk
        source.delete()

        # Log merge
        try:
            AuditLog.objects.create(
                action="merged",
                entity="customer",
                entity_id=target.pk,
                entity_name=target.name,
                user=request.user if request.user and request.user.is_authenticated else None,
                details=f"Merged '{source_name}' (#{source_id}) into '{target.name}' ({invoices_transferred} invoices transferred)",
            )
        except Exception:
            pass

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

        # Group by product name, calculate totals
        top_products = query.values(
            "product_name", "hsn_code", "gst_tax_rate"
        ).annotate(
            total_amount=Sum("amount"),
            total_quantity=Sum("quantity"),
            invoice_count=Count("invoice", distinct=True),
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
                    "hsn_code": product["hsn_code"],
                    "gst_tax_rate": product["gst_tax_rate"],
                    "total_amount": product["total_amount"],
                    "total_quantity": product["total_quantity"],
                    "invoice_count": product["invoice_count"],
                }
            )

        return Response(result)

    @action(detail=False, methods=["get"])
    def defaults(self, request):
        """Get default values for products"""
        from billing.constants import GST_TAX_RATE, HSN_CODE

        defaults = {"hsn_code": HSN_CODE, "gst_tax_rate": float(GST_TAX_RATE)}

        return Response(defaults)


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
        from django.db.models import OuterRef, Subquery, DecimalField, IntegerField
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
        serializer = self.get_serializer(data=payload)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            self.perform_create(serializer)  # saves invoice + writes audit log
            invoice = serializer.instance

            if line_items_data:
                new_total = Decimal("0")
                new_lis = []
                for item_data in line_items_data:
                    qty = Decimal(str(item_data.get("quantity", 1)))
                    rate = Decimal(str(item_data.get("rate", 0)))
                    amount = Decimal(str(item_data.get("amount", qty * rate)))
                    new_total += amount
                    new_lis.append(LineItem(
                        invoice=invoice,
                        customer=invoice.customer,
                        product_name=item_data.get("product_name", ""),
                        hsn_code=item_data.get("hsn_code", ""),
                        gst_tax_rate=Decimal(str(item_data.get("gst_tax_rate", 0))),
                        quantity=qty,
                        rate=rate,
                        cgst=Decimal(str(item_data.get("cgst", 0))),
                        sgst=Decimal(str(item_data.get("sgst", 0))),
                        igst=Decimal(str(item_data.get("igst", 0))),
                        amount=amount,
                        unit=item_data.get("unit", "gms"),
                        workspace_id=1,
                    ))
                LineItem.objects.bulk_create(new_lis, batch_size=100)
                # Bypass save()'s sum() roundtrip — we already know the total.
                invoice.total_amount = new_total
                Invoice.objects.filter(pk=invoice.pk).update(total_amount=new_total)

        # Re-serialize so the response includes the persisted total + line items.
        invoice.refresh_from_db()
        out = self.get_serializer(invoice)
        headers = self.get_success_headers(out.data)
        return Response(out.data, status=status.HTTP_201_CREATED, headers=headers)

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
        line_items_data = request.data.get("line_items", [])
        invoice_data = request.data.get("invoice", {})

        old_total = invoice.total_amount
        old_inv_number = invoice.invoice_number
        old_inv_date = invoice.invoice_date

        with transaction.atomic():
            # 1. Patch invoice-level fields if provided (in-memory only)
            if invoice_data:
                if "customer" in invoice_data and invoice_data["customer"]:
                    invoice.customer_id = invoice_data["customer"]
                if "business" in invoice_data and invoice_data["business"]:
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

            new_lis = []
            new_total = Decimal("0")
            for item_data in line_items_data:
                qty = Decimal(str(item_data.get("quantity", 1)))
                rate = Decimal(str(item_data.get("rate", 0)))
                amount = Decimal(str(item_data.get("amount", qty * rate)))
                new_total += amount
                new_lis.append(LineItem(
                    invoice=invoice,
                    customer=invoice.customer,
                    product_name=item_data.get("product_name", ""),
                    hsn_code=item_data.get("hsn_code", ""),
                    gst_tax_rate=Decimal(str(item_data.get("gst_tax_rate", 0))),
                    quantity=qty,
                    rate=rate,
                    cgst=Decimal(str(item_data.get("cgst", 0))),
                    sgst=Decimal(str(item_data.get("sgst", 0))),
                    igst=Decimal(str(item_data.get("igst", 0))),
                    amount=amount,
                    unit=item_data.get("unit", "gms"),
                    workspace_id=1,
                ))
            if new_lis:
                LineItem.objects.bulk_create(new_lis, batch_size=100)

            # 3. Update invoice with the precomputed total — skip the SELECT
            #    that Invoice.save() would do (sum of line items).
            invoice.total_amount = new_total
            # Use update() to bypass save()'s sum query
            update_fields = {
                "total_amount": new_total,
                "customer_id": invoice.customer_id,
                "business_id": invoice.business_id,
                "invoice_number": invoice.invoice_number,
                "invoice_date": invoice.invoice_date,
                "type_of_invoice": invoice.type_of_invoice,
            }
            Invoice.objects.filter(pk=invoice.pk).update(**update_fields)

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
        try:
            AuditLog.objects.create(
                action="printed",
                entity="invoice",
                entity_id=invoice.pk,
                entity_name=f"#{invoice.invoice_number} - {invoice.customer.name}",
                user=request.user if request.user and request.user.is_authenticated else None,
                details=f"Printed invoice (total: {invoice.total_amount})",
            )
        except Exception:
            pass

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
        fields = ["eway_bill_number", "transporter_name", "transporter_gstin",
                   "vehicle_number", "vehicle_type", "transport_mode", "distance_km"]
        for field in fields:
            if field in request.data:
                setattr(invoice, field, request.data[field])
        invoice.save()

        try:
            AuditLog.objects.create(
                action="updated", entity="invoice", entity_id=invoice.pk,
                entity_name=f"#{invoice.invoice_number} - E-way Bill",
                user=request.user if request.user.is_authenticated else None,
                details=f"E-way bill updated: {invoice.eway_bill_number or 'pending'}",
            )
        except Exception:
            pass

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
        totals = queryset.aggregate(
            outward=Coalesce(
                Sum("total_amount", filter=Q(type_of_invoice="outward")),
                Decimal("0.00"),
            ),
            inward=Coalesce(
                Sum("total_amount", filter=Q(type_of_invoice="inward")),
                Decimal("0.00"),
            ),
            outward_tax=Coalesce(
                Sum(
                    F("lineitem__cgst") + F("lineitem__sgst") + F("lineitem__igst"),
                    filter=Q(type_of_invoice="outward"),
                ),
                Decimal("0.00"),
            ),
            inward_tax=Coalesce(
                Sum(
                    F("lineitem__cgst") + F("lineitem__sgst") + F("lineitem__igst"),
                    filter=Q(type_of_invoice="inward"),
                ),
                Decimal("0.00"),
            ),
            count=Count("id"),
        )

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
        }
        results["monthly"] = [
            {
                "month": m["month"],
                "year": m["year"],
                "outward_total": float(m["outward_total"]),
                "inward_total": float(m["inward_total"]),
                "outward_count": m["outward_count"],
                "inward_count": m["inward_count"],
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

        # 4. Top Products (include hsn_code for dashboard display)
        top_products = (
            LineItem.objects.filter(
                invoice__in=queryset, invoice__type_of_invoice="outward"
            )
            .values("product_name", "hsn_code")
            .annotate(total_rev=Sum("amount"), total_qty=Sum("quantity"))
            .order_by("-total_rev")[:5]
        )
        results["top_products"] = [
            {
                "name": p["product_name"],
                "total": float(p["total_rev"] or 0),
                "qty": float(p["total_qty"] or 0),
                "hsn": p["hsn_code"] or "",
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
            target_date = datetime.now().date()
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
        """Server-side GST summary for GSTR-1/3B — grouped by rate slab and HSN."""
        queryset = self.get_queryset()
        invoice_ids = list(queryset.values_list("id", flat=True))
        items = LineItem.objects.filter(invoice_id__in=invoice_ids)
        # business_id from query string — used for the per-business ECRRS ledger
        # below. None when querying across all businesses.
        try:
            business_id = int(request.query_params.get("business_id") or 0) or None
        except (TypeError, ValueError):
            business_id = None

        # 1. Rate-wise breakdown (GSTR-1 style).
        #
        # Was: a for-loop over ["outward","inward"] firing two separate
        # GROUP-BY queries against LineItem. With ~100ms remote-DB round
        # trip latency that's ~200ms baseline.
        #
        # Now: a single GROUP-BY on (type_of_invoice, gst_tax_rate). One
        # query, bucketed into outward/inward in Python.
        rate_slabs = {"outward": [], "inward": []}
        slab_data = (
            items
            .values("invoice__type_of_invoice", "gst_tax_rate")
            .annotate(
                taxable=Coalesce(Sum(F("quantity") * F("rate")), Decimal("0")),
                cgst=Coalesce(Sum("cgst"), Decimal("0")),
                sgst=Coalesce(Sum("sgst"), Decimal("0")),
                igst=Coalesce(Sum("igst"), Decimal("0")),
                total=Coalesce(Sum("amount"), Decimal("0")),
                count=Count("invoice", distinct=True),
            )
            .order_by("invoice__type_of_invoice", "gst_tax_rate")
        )
        for s in slab_data:
            inv_type = s["invoice__type_of_invoice"]
            if inv_type not in rate_slabs:
                continue
            rate_slabs[inv_type].append({
                "rate": float(s["gst_tax_rate"]) * 100 if s["gst_tax_rate"] <= 1 else float(s["gst_tax_rate"]),
                "taxable": float(s["taxable"]),
                "cgst": float(s["cgst"]),
                "sgst": float(s["sgst"]),
                "igst": float(s["igst"]),
                "total": float(s["total"]),
                "invoice_count": s["count"],
            })

        # 2. HSN-wise breakdown
        hsn_data = (
            items
            .values("hsn_code")
            .annotate(
                taxable=Coalesce(Sum(F("quantity") * F("rate")), Decimal("0")),
                cgst=Coalesce(Sum("cgst"), Decimal("0")),
                sgst=Coalesce(Sum("sgst"), Decimal("0")),
                igst=Coalesce(Sum("igst"), Decimal("0")),
                total=Coalesce(Sum("amount"), Decimal("0")),
                total_qty=Coalesce(Sum("quantity"), Decimal("0")),
                count=Count("id"),
            )
            .order_by("-taxable")
        )
        hsn_summary = [
            {
                "hsn_code": h["hsn_code"] or "N/A",
                "taxable": float(h["taxable"]),
                "cgst": float(h["cgst"]),
                "sgst": float(h["sgst"]),
                "igst": float(h["igst"]),
                "total": float(h["total"]),
                "qty": float(h["total_qty"]),
                "count": h["count"],
            }
            for h in hsn_data
        ]

        # 3. GSTR-3B summary (net tax) — one aggregate with Q-filter
        #    pairs instead of two .filter().aggregate() round-trips.
        from django.db.models import Q as _Q
        combined = items.aggregate(
            outward_cgst=Coalesce(Sum("cgst", filter=_Q(invoice__type_of_invoice="outward")), Decimal("0")),
            outward_sgst=Coalesce(Sum("sgst", filter=_Q(invoice__type_of_invoice="outward")), Decimal("0")),
            outward_igst=Coalesce(Sum("igst", filter=_Q(invoice__type_of_invoice="outward")), Decimal("0")),
            inward_cgst=Coalesce(Sum("cgst", filter=_Q(invoice__type_of_invoice="inward")), Decimal("0")),
            inward_sgst=Coalesce(Sum("sgst", filter=_Q(invoice__type_of_invoice="inward")), Decimal("0")),
            inward_igst=Coalesce(Sum("igst", filter=_Q(invoice__type_of_invoice="inward")), Decimal("0")),
        )
        outward_tax = {"cgst": combined["outward_cgst"], "sgst": combined["outward_sgst"], "igst": combined["outward_igst"]}
        inward_tax = {"cgst": combined["inward_cgst"], "sgst": combined["inward_sgst"], "igst": combined["inward_igst"]}
        gstr3b = {
            "output_tax": {
                "cgst": float(outward_tax["cgst"]),
                "sgst": float(outward_tax["sgst"]),
                "igst": float(outward_tax["igst"]),
                "total": float(outward_tax["cgst"] + outward_tax["sgst"] + outward_tax["igst"]),
            },
            "input_tax_credit": {
                "cgst": float(inward_tax["cgst"]),
                "sgst": float(inward_tax["sgst"]),
                "igst": float(inward_tax["igst"]),
                "total": float(inward_tax["cgst"] + inward_tax["sgst"] + inward_tax["igst"]),
            },
            "net_payable": {
                "cgst": float(outward_tax["cgst"] - inward_tax["cgst"]),
                "sgst": float(outward_tax["sgst"] - inward_tax["sgst"]),
                "igst": float(outward_tax["igst"] - inward_tax["igst"]),
                "total": float(
                    (outward_tax["cgst"] + outward_tax["sgst"] + outward_tax["igst"])
                    - (inward_tax["cgst"] + inward_tax["sgst"] + inward_tax["igst"])
                ),
            },
        }

        # ── GSTR-3B Table 4 (current portal structure as of May 2026) ──
        # Sub-rows: 4(A)(1) imports, 4(A)(5) all other ITC (= current period
        # inward tax), 4(B)(1) non-reclaimable reversal, 4(B)(2) reclaimable
        # reversal, 4(C) Net = 4(A) - 4(B), 4(D)(1) reclaimed, 4(D)(2) ineligible.
        # The reversal/reclaim rows aren't tracked by line item yet, so they
        # default to 0 — the frontend lets the user override them per period.
        # The ECRRS opening balance comes from the ITCReclaimLedger model
        # (per-business). When the user is viewing "All Businesses" we
        # aggregate the opening balances across every ledger so the
        # carry-forward card on the frontend stays accurate — previously this
        # was just None for the All-Businesses view, which silently hid the
        # number the user came here looking for.
        from billing.models import ITCReclaimLedger
        opening_balance = None
        if business_id:
            ledger = ITCReclaimLedger.objects.filter(business_id=business_id).first()
            if ledger:
                cgst = float(ledger.opening_cgst or 0)
                sgst = float(ledger.opening_sgst or 0)
                igst = float(ledger.opening_igst or 0)
                opening_balance = {
                    "cgst": cgst,
                    "sgst": sgst,
                    "igst": igst,
                    "total": cgst + sgst + igst,
                    "as_of": ledger.opening_as_of.isoformat() if ledger.opening_as_of else None,
                    "business_count": 1,
                    "configured": True,
                }
        else:
            agg = ITCReclaimLedger.objects.aggregate(
                c=Sum("opening_cgst"),
                s=Sum("opening_sgst"),
                i=Sum("opening_igst"),
            )
            c = float(agg["c"] or 0)
            s = float(agg["s"] or 0)
            i = float(agg["i"] or 0)
            biz_count = ITCReclaimLedger.objects.exclude(
                Q(opening_cgst=0) & Q(opening_sgst=0) & Q(opening_igst=0)
            ).count()
            # Surface even a 0-total response so the frontend can distinguish
            # "no business has a ledger" from "ledger exists but is zero".
            opening_balance = {
                "cgst": c,
                "sgst": s,
                "igst": i,
                "total": c + s + i,
                "as_of": None,
                "business_count": biz_count,
                "configured": biz_count > 0,
            }

        gstr3b_table4 = {
            # 4(A) ITC Available
            "a_1_imports_goods": {"cgst": 0.0, "sgst": 0.0, "igst": 0.0},
            "a_2_imports_services": {"cgst": 0.0, "sgst": 0.0, "igst": 0.0},
            "a_3_rcm": {"cgst": 0.0, "sgst": 0.0, "igst": 0.0},
            "a_4_isd": {"cgst": 0.0, "sgst": 0.0, "igst": 0.0},
            "a_5_all_other_itc": {
                "cgst": float(inward_tax["cgst"]),
                "sgst": float(inward_tax["sgst"]),
                "igst": float(inward_tax["igst"]),
            },
            "a_total": {
                "cgst": float(inward_tax["cgst"]),
                "sgst": float(inward_tax["sgst"]),
                "igst": float(inward_tax["igst"]),
            },
            # 4(B) ITC Reversed — kept at 0 until per-line reversal tracking lands
            "b_1_non_reclaimable": {"cgst": 0.0, "sgst": 0.0, "igst": 0.0},
            "b_2_reclaimable": {"cgst": 0.0, "sgst": 0.0, "igst": 0.0},
            "b_total": {"cgst": 0.0, "sgst": 0.0, "igst": 0.0},
            # 4(C) Net ITC available = 4(A) - 4(B)
            "c_net_itc": {
                "cgst": float(inward_tax["cgst"]),
                "sgst": float(inward_tax["sgst"]),
                "igst": float(inward_tax["igst"]),
            },
            # 4(D) Other details
            "d_1_reclaimed": {"cgst": 0.0, "sgst": 0.0, "igst": 0.0},
            "d_2_ineligible": {"cgst": 0.0, "sgst": 0.0, "igst": 0.0},
            # ECRRS reclaim ledger context
            "ecrrs_opening_balance": opening_balance,
            "ecrrs_closing_balance": opening_balance,  # opening + 4(B)(2) - 4(D)(1); both 0 for now
        }

        # ── ITC Aging (Sec 16(4) cut-off) ──
        # ITC must be claimed by Nov 30 of the FY *following* the invoice date,
        # else it's forfeit. Bucket inward invoices by days-until-cutoff and
        # surface anything within 60 days as urgent.
        from datetime import date as _date, timedelta
        today = _date.today()
        inward_with_dates = (
            queryset.filter(type_of_invoice="inward")
            .values("id", "invoice_number", "invoice_date", "total_amount")
            .annotate(
                tax=Coalesce(
                    Sum(F("lineitem__cgst") + F("lineitem__sgst") + F("lineitem__igst")),
                    Decimal("0"),
                ),
            )
        )
        aging_buckets = {
            "fresh": {"label": "≤ 60 days to cutoff", "count": 0, "tax": 0.0},
            "warning": {"label": "60–180 days", "count": 0, "tax": 0.0},
            "stale": {"label": "180+ days (still claimable)", "count": 0, "tax": 0.0},
            "expired": {"label": "Past Sec 16(4) cutoff (forfeit)", "count": 0, "tax": 0.0},
        }
        urgent_invoices = []
        for inv in inward_with_dates:
            inv_date = inv["invoice_date"]
            if not inv_date:
                continue
            # FY of invoice: Apr-Mar
            fy_start = inv_date.year if inv_date.month >= 4 else inv_date.year - 1
            cutoff = _date(fy_start + 1, 11, 30)  # Nov 30 of following FY
            days_left = (cutoff - today).days
            tax_amt = float(inv["tax"])
            if days_left < 0:
                bucket = "expired"
            elif days_left <= 60:
                bucket = "fresh"
            elif days_left <= 180:
                bucket = "warning"
            else:
                bucket = "stale"
            aging_buckets[bucket]["count"] += 1
            aging_buckets[bucket]["tax"] += tax_amt
            if bucket in ("fresh", "expired") and len(urgent_invoices) < 50:
                urgent_invoices.append({
                    "id": inv["id"],
                    "invoice_number": inv["invoice_number"],
                    "invoice_date": inv_date.isoformat(),
                    "total_amount": float(inv["total_amount"]),
                    "tax": tax_amt,
                    "cutoff": cutoff.isoformat(),
                    "days_left": days_left,
                    "bucket": bucket,
                })
        urgent_invoices.sort(key=lambda x: x["days_left"])

        # ── GSTR-1 vs GSTR-3B reconciliation ──
        # In a clean book, the rate-slab tax (cgst+sgst+igst per rate) should
        # match GSTR-3B output_tax exactly. Variance != 0 hints at line items
        # with missing/wrong rate annotations or out-of-band tax adjustments.
        gstr1_total_tax = sum(
            r["cgst"] + r["sgst"] + r["igst"]
            for r in rate_slabs.get("outward", [])
        )
        gstr1_3b_recon = {
            "gstr1_total_tax": gstr1_total_tax,
            "gstr3b_output_tax": gstr3b["output_tax"]["total"],
            "variance": gstr3b["output_tax"]["total"] - gstr1_total_tax,
        }

        # ── Effective ITC + Net Tax including carry-forward ──
        # The user came looking for "last year's carry-forward GST" on the
        # main summary, not buried inside Table 4. We compute effective
        # numbers here so the frontend can show:
        #     Output Tax            = period output
        #     Current-period ITC    = period inward tax
        # +   Carry-forward ITC     = opening balance from ledger
        # =   Effective ITC         = sum of the two
        # =   Effective Net Tax     = Output - Effective ITC
        carry_total = opening_balance["total"] if opening_balance else 0.0
        current_itc_total = gstr3b["input_tax_credit"]["total"]
        output_total = gstr3b["output_tax"]["total"]
        effective = {
            "carry_forward_itc": carry_total,
            "current_itc": current_itc_total,
            "effective_itc": current_itc_total + carry_total,
            "effective_net_tax": output_total - (current_itc_total + carry_total),
        }

        return Response({
            "rate_slabs": rate_slabs,
            "hsn_summary": hsn_summary,
            "gstr3b": gstr3b,
            "gstr3b_table4": gstr3b_table4,
            "itc_aging": {
                "buckets": aging_buckets,
                "urgent_invoices": urgent_invoices,
            },
            "gstr1_3b_recon": gstr1_3b_recon,
            # Promoted to top-level so the Summary view doesn't have to
            # reach into gstr3b_table4.ecrrs_opening_balance. Keeps the old
            # nested copy for backwards compat with the GSTR-3B tab.
            "carry_forward_itc": opening_balance,
            "effective": effective,
        })

    @action(detail=False, methods=["get"])
    def gstr_export(self, request):
        """Export GSTR-1, GSTR-3B, and 2B matching data in GST portal format."""
        queryset = self.get_queryset()
        invoice_ids = list(queryset.values_list("id", flat=True))

        # Prefetch line items so the per-invoice loops below don't fire one
        # query per invoice (the previous N+1 made this endpoint take ~12s
        # for ~95 invoices over a remote-DB connection).
        outward_invoices = list(
            queryset.filter(type_of_invoice="outward")
            .select_related("customer", "business")
            .prefetch_related("lineitem_set")
        )
        inward_invoices = list(
            queryset.filter(type_of_invoice="inward")
            .select_related("customer", "business")
            .prefetch_related("lineitem_set")
        )

        # ── GSTR-1 ──

        # B2B: Invoices to registered dealers (customer has GSTIN)
        b2b_data = {}
        for inv in outward_invoices:
            cust_gst = inv.customer.gst_number.strip() if inv.customer.gst_number else ""
            if not cust_gst or len(cust_gst) < 15:
                continue  # Skip unregistered
            items = inv.lineitem_set.all()
            inv_items = []
            for li in items:
                inv_items.append({
                    "num": int(li.id),
                    "itm_det": {
                        "txval": float(li.quantity * li.rate),
                        "rt": float(li.gst_tax_rate) * 100 if li.gst_tax_rate <= 1 else float(li.gst_tax_rate),
                        "camt": float(li.cgst),
                        "samt": float(li.sgst),
                        "iamt": float(li.igst),
                    },
                })
            if cust_gst not in b2b_data:
                b2b_data[cust_gst] = {"ctin": cust_gst, "inv": []}
            b2b_data[cust_gst]["inv"].append({
                "inum": inv.invoice_number,
                "idt": inv.invoice_date.strftime("%d-%m-%Y") if inv.invoice_date else "",
                "val": float(inv.total_amount),
                "pos": inv.customer.gst_number[:2] if inv.customer.gst_number else "",
                "rchrg": "N",
                "inv_typ": "R",
                "itms": inv_items,
            })
        b2b = list(b2b_data.values())

        # B2CS: Invoices to unregistered (no GSTIN, intra-state, <=2.5L)
        b2cs = []
        b2cs_agg = {}
        for inv in outward_invoices:
            cust_gst = inv.customer.gst_number.strip() if inv.customer.gst_number else ""
            if cust_gst and len(cust_gst) >= 15:
                continue  # Skip registered
            biz_state = inv.business.gst_number[:2] if inv.business.gst_number else ""
            cust_state = inv.customer.gst_number[:2] if inv.customer.gst_number and len(inv.customer.gst_number) >= 2 else biz_state
            if cust_state != biz_state:
                continue  # Inter-state goes to B2CL
            items = inv.lineitem_set.all()
            for li in items:
                rate = float(li.gst_tax_rate) * 100 if li.gst_tax_rate <= 1 else float(li.gst_tax_rate)
                key = f"{biz_state}-{rate}"
                if key not in b2cs_agg:
                    b2cs_agg[key] = {"pos": biz_state, "rt": rate, "txval": 0, "camt": 0, "samt": 0, "typ": "OE"}
                b2cs_agg[key]["txval"] += float(li.quantity * li.rate)
                b2cs_agg[key]["camt"] += float(li.cgst)
                b2cs_agg[key]["samt"] += float(li.sgst)
        b2cs = list(b2cs_agg.values())

        # B2CL: Large invoices to unregistered (>2.5L, inter-state)
        b2cl = []
        for inv in outward_invoices:
            if float(inv.total_amount) <= 250000:
                continue
            cust_gst = inv.customer.gst_number.strip() if inv.customer.gst_number else ""
            if cust_gst and len(cust_gst) >= 15:
                continue
            biz_state = inv.business.gst_number[:2] if inv.business.gst_number else ""
            cust_state = inv.customer.gst_number[:2] if inv.customer.gst_number and len(inv.customer.gst_number) >= 2 else biz_state
            if cust_state == biz_state:
                continue  # Intra-state goes to B2CS
            items = inv.lineitem_set.all()
            inv_items = [{
                "num": int(li.id),
                "itm_det": {
                    "txval": float(li.quantity * li.rate),
                    "rt": float(li.gst_tax_rate) * 100 if li.gst_tax_rate <= 1 else float(li.gst_tax_rate),
                    "iamt": float(li.igst),
                },
            } for li in items]
            b2cl.append({
                "pos": cust_state,
                "inv": [{
                    "inum": inv.invoice_number,
                    "idt": inv.invoice_date.strftime("%d-%m-%Y") if inv.invoice_date else "",
                    "val": float(inv.total_amount),
                    "itms": inv_items,
                }],
            })

        # HSN Summary
        items_all = LineItem.objects.filter(invoice_id__in=invoice_ids)
        hsn_agg = {}
        for li in items_all.filter(invoice__type_of_invoice="outward"):
            hsn = li.hsn_code or "0"
            if hsn not in hsn_agg:
                hsn_agg[hsn] = {"hsn_sc": hsn, "qty": 0, "txval": 0, "camt": 0, "samt": 0, "iamt": 0}
            hsn_agg[hsn]["qty"] += float(li.quantity)
            hsn_agg[hsn]["txval"] += float(li.quantity * li.rate)
            hsn_agg[hsn]["camt"] += float(li.cgst)
            hsn_agg[hsn]["samt"] += float(li.sgst)
            hsn_agg[hsn]["iamt"] += float(li.igst)
        hsn = list(hsn_agg.values())

        gstr1 = {"b2b": b2b, "b2cs": b2cs, "b2cl": b2cl, "hsn": {"data": hsn}}

        # ── GSTR-3B ──
        outward_items = items_all.filter(invoice__type_of_invoice="outward")
        inward_items = items_all.filter(invoice__type_of_invoice="inward")

        ot = outward_items.aggregate(
            txval=Coalesce(Sum(F("quantity") * F("rate")), Decimal("0")),
            cgst=Coalesce(Sum("cgst"), Decimal("0")),
            sgst=Coalesce(Sum("sgst"), Decimal("0")),
            igst=Coalesce(Sum("igst"), Decimal("0")),
        )
        it = inward_items.aggregate(
            txval=Coalesce(Sum(F("quantity") * F("rate")), Decimal("0")),
            cgst=Coalesce(Sum("cgst"), Decimal("0")),
            sgst=Coalesce(Sum("sgst"), Decimal("0")),
            igst=Coalesce(Sum("igst"), Decimal("0")),
        )

        gstr3b = {
            "sup_details": {
                "osup_det": {"txval": float(ot["txval"]), "camt": float(ot["cgst"]), "samt": float(ot["sgst"]), "iamt": float(ot["igst"])},
            },
            "itc_elg": {
                "itc_avl": [{"ty": "IMPG", "iamt": float(it["igst"]), "camt": float(it["cgst"]), "samt": float(it["sgst"])}],
            },
            "intr_ltfee": {
                "intr_details": {"iamt": 0, "camt": 0, "samt": 0},
            },
            "tax_pmt": {
                "cgst": float(ot["cgst"] - it["cgst"]),
                "sgst": float(ot["sgst"] - it["sgst"]),
                "igst": float(ot["igst"] - it["igst"]),
            },
        }

        # ── GSTR-2B Matching (basic) ──
        # Compare inward invoices against expected data
        inward_list = []
        for inv in inward_invoices:
            items = inv.lineitem_set.all()
            total_tax = sum(float(li.cgst + li.sgst + li.igst) for li in items)
            total_taxable = sum(float(li.quantity * li.rate) for li in items)
            inward_list.append({
                "invoice_number": inv.invoice_number,
                "invoice_date": inv.invoice_date.strftime("%d-%m-%Y") if inv.invoice_date else "",
                "supplier_name": inv.customer.name,
                "supplier_gstin": inv.customer.gst_number or "",
                "taxable_value": total_taxable,
                "tax_amount": total_tax,
                "total": float(inv.total_amount),
            })

        return Response({
            "gstr1": gstr1,
            "gstr3b": gstr3b,
            "gstr2b": {"inward_invoices": inward_list},
        })

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
            ref_date = datetime.now().date()
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
        from datetime import timedelta
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

        if prefix:
            next_invoice_number_str = f"{prefix}/{fy_str}/{next_number}"
        else:
            next_invoice_number_str = str(next_number)

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

    def create(self, request, *args, **kwargs):
        # Get invoice_id from URL path if available
        invoice_id = self.kwargs.get("invoice_id")
        if invoice_id:
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

        # If no invoice_id is provided, use the default create method
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

        # Grand Total (Outward + Inward combined)
        if invoice_type == "both" and (
            totals["outward_taxable"] or totals["inward_taxable"]
        ):
            sheet.append([])
            sheet.append(
                [""] * 5
                + [
                    f"GRAND TOTAL ({date_range_str})",
                    "",
                    "",
                    "",
                    "",
                    totals["outward_taxable"] + totals["inward_taxable"],
                    totals["outward_cgst"] + totals["inward_cgst"],
                    totals["outward_sgst"] + totals["inward_sgst"],
                    totals["outward_igst"] + totals["inward_igst"],
                    totals["outward_total"] + totals["inward_total"],
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

    def post(self, request):
        invoices_data = request.data.get("invoices", [])
        business_id = request.data.get("business_id")

        if not invoices_data:
            return Response(
                {"error": "No invoices provided"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        created_count = 0
        skipped_count = 0
        errors = []

        # ---------- PHASE 1: bulk lookups (one query each) ----------

        # Pre-fetch all businesses (small table, usually <10 rows)
        all_businesses = list(Business.objects.all())
        biz_by_id = {b.pk: b for b in all_businesses}
        biz_by_gstin = {(b.gst_number or "").lower(): b for b in all_businesses if b.gst_number}
        biz_by_name = {(b.name or "").lower(): b for b in all_businesses}

        forced_business = None
        if business_id:
            try:
                forced_business = biz_by_id.get(int(business_id))
            except (TypeError, ValueError):
                pass

        # Build customer lookup dicts in ONE query.
        # Customer table is small (~few hundred rows); fetching all is cheaper
        # than per-row .filter() calls.
        cust_by_gst = {}
        cust_by_pan = {}
        cust_by_name = {}
        for c in Customer.objects.all().only("id", "name", "gst_number", "pan_number"):
            if c.gst_number:
                cust_by_gst[c.gst_number.upper()] = c
            if c.pan_number:
                cust_by_pan[c.pan_number.upper()] = c
            if c.name:
                cust_by_name[c.name.lower()] = c

        # Product master lookup. Two-tier so case-only duplicates in the
        # master (e.g. "GOLD COIN" 3% AND "gold coin" 12%) don't silently
        # apply the wrong tax rate based on DB iteration order.
        # exact-case wins → falls back to lowercase first-seen.
        product_by_exact = {}
        product_by_ci = {}
        for p in Product.objects.all().only("id", "name", "hsn_code", "gst_tax_rate").order_by("name"):
            if not p.name:
                continue
            if p.name not in product_by_exact:
                product_by_exact[p.name] = p
            ci_key = p.name.lower()
            if ci_key not in product_by_ci:
                product_by_ci[ci_key] = p

        def lookup_product(name):
            if not name:
                return None
            return product_by_exact.get(name) or product_by_ci.get(name.lower())

        # ---------- PRE-PASS: bulk-create new customers in ONE round-trip ----------
        # Walk all invoices, identify customer names that don't exist yet, dedupe,
        # bulk_create. Avoids N serial INSERTs when many invoices reference new
        # customers (saves ~700ms on a 10-new-customer import on Neon Singapore).
        needed_new = {}  # name_lower -> {name, gst, pan}
        for inv_data in invoices_data:
            cn = (inv_data.get("customerName") or "").strip()
            cg = (inv_data.get("customerGST") or "").strip()
            if not cn:
                continue
            key = cn.lower()
            # Already in cache (pre-existing)? skip
            if key in cust_by_name:
                continue
            clean_gst = ""
            clean_pan = ""
            if cg and cg not in ("-", ""):
                if "(PAN)" in cg:
                    clean_pan = cg.replace("(PAN)", "").strip()
                    if clean_pan.upper() in cust_by_pan:
                        continue
                else:
                    clean_gst = cg
                    if clean_gst.upper() in cust_by_gst:
                        continue
            needed_new[key] = {"name": cn, "gst": clean_gst, "pan": clean_pan}

        if needed_new:
            new_objs = [
                Customer(
                    name=info["name"], gst_number=info["gst"],
                    pan_number=info["pan"], state_name="RAJASTHAN",
                    workspace_id=1,
                ) for info in needed_new.values()
            ]
            Customer.objects.bulk_create(new_objs, batch_size=200)
            # Update caches with the freshly-created customers
            for c in new_objs:
                cust_by_name[c.name.lower()] = c
                if c.gst_number:
                    cust_by_gst[c.gst_number.upper()] = c
                if c.pan_number:
                    cust_by_pan[c.pan_number.upper()] = c

        # Bulk fetch existing invoices (for duplicate detection) keyed by
        # (business_id, invoice_number, invoice_date)
        wanted_inv_keys = set()
        for inv_data in invoices_data:
            inv_no = str(inv_data.get("invoiceNumber", "") or "")
            inv_date = inv_data.get("invoice_date", "") or ""
            wanted_inv_keys.add((inv_no, inv_date))
        # Dedup key includes type_of_invoice — sales bill #1 and purchase bill #1
        # are different documents, even with the same number/date/firm.
        existing_invoice_keys = set()
        if wanted_inv_keys:
            inv_no_list = list({k[0] for k in wanted_inv_keys})
            inv_date_list = list({k[1] for k in wanted_inv_keys if k[1]})
            for inv in Invoice.objects.filter(
                invoice_number__in=inv_no_list,
                invoice_date__in=inv_date_list,
            ).only("id", "invoice_number", "invoice_date", "business_id", "type_of_invoice"):
                existing_invoice_keys.add(
                    (inv.business_id, str(inv.invoice_number), str(inv.invoice_date),
                     (inv.type_of_invoice or INVOICE_TYPE_OUTWARD).lower())
                )

        # ---------- PHASE 2: process invoices in a single transaction ----------
        invoices_to_create = []  # [(Invoice instance, source dict for line items)]
        line_items_to_create = []
        audit_logs_to_create = []
        # Per-invoice audit metadata (pk, display name, item count). Audit logs
        # are emitted after total_amount is recomputed from line items so the
        # message reflects the persisted total, not the stale in-memory value.
        pending_invoice_audits: list[dict] = []
        new_customers_added_to_biz = []  # (customer, business) pairs

        with transaction.atomic():
            for inv_data in invoices_data:
                try:
                    firm_name = (inv_data.get("firmName") or "").strip()
                    firm_gstin = (inv_data.get("firmGSTIN") or "").strip()

                    # Resolve business from cache
                    business = forced_business
                    if not business and firm_gstin:
                        business = biz_by_gstin.get(firm_gstin.lower())
                    if not business and firm_name:
                        # icontains substitute: try exact, then any name containing
                        business = biz_by_name.get(firm_name.lower())
                        if not business:
                            for nm, b in biz_by_name.items():
                                if firm_name.lower() in nm or nm in firm_name.lower():
                                    business = b
                                    break

                    if not business:
                        errors.append(
                            f"Business not found for invoice {inv_data.get('invoiceNumber', '?')}: {firm_name} ({firm_gstin})"
                        )
                        skipped_count += 1
                        continue

                    customer_name = (inv_data.get("customerName") or "").strip()
                    customer_gst = (inv_data.get("customerGST") or "").strip()

                    if not customer_name:
                        errors.append(
                            f"No customer name for invoice {inv_data.get('invoiceNumber', '?')}"
                        )
                        skipped_count += 1
                        continue

                    # Resolve customer from cache
                    customer = None
                    clean_gst = ""
                    clean_pan = ""
                    if customer_gst and customer_gst not in ("-", ""):
                        if "(PAN)" in customer_gst:
                            clean_pan = customer_gst.replace("(PAN)", "").strip()
                            customer = cust_by_pan.get(clean_pan.upper())
                        else:
                            clean_gst = customer_gst
                            customer = cust_by_gst.get(clean_gst.upper())
                    if not customer:
                        customer = cust_by_name.get(customer_name.lower())

                    if not customer:
                        # Should not happen — pre-pass should have bulk-created
                        # everything. Defensive fallback.
                        customer = Customer.objects.create(
                            name=customer_name, gst_number=clean_gst,
                            pan_number=clean_pan, state_name="RAJASTHAN",
                            workspace_id=1,
                        )
                        # Update ALL lookup caches so a later row referencing the
                        # same GST/PAN under a different name resolves to this
                        # customer instead of creating a duplicate.
                        cust_by_name[customer_name.lower()] = customer
                        if clean_gst:
                            cust_by_gst[clean_gst.upper()] = customer
                        if clean_pan:
                            cust_by_pan[clean_pan.upper()] = customer

                    if business and business.pk and customer.pk:
                        # Track for M2M attach (idempotent — .add() is a no-op if exists)
                        new_customers_added_to_biz.append((customer, business))

                    # Resolve invoice type first so duplicate key includes it.
                    invoice_number = str(inv_data.get("invoiceNumber", ""))
                    invoice_date = inv_data.get("invoice_date", "")
                    inv_type = inv_data.get("type", "OUTWARD")
                    type_of_invoice = (
                        INVOICE_TYPE_INWARD
                        if inv_type == "INWARD"
                        else INVOICE_TYPE_OUTWARD
                    )

                    # Duplicate check — must match on business + bill# + date AND type
                    dup_key = (business.pk, invoice_number, str(invoice_date), type_of_invoice.lower())
                    if dup_key in existing_invoice_keys:
                        skipped_count += 1
                        continue

                    # Build invoice in memory; bulk_create later
                    invoice = Invoice(
                        invoice_number=invoice_number,
                        invoice_date=invoice_date,
                        customer=customer,
                        business=business,
                        type_of_invoice=type_of_invoice,
                        total_amount=Decimal(str(inv_data.get("total", 0))),
                        workspace_id=1,
                    )
                    invoices_to_create.append((invoice, inv_data))
                    # Mark as seen so a duplicate row in the same payload is skipped
                    existing_invoice_keys.add(dup_key)
                    created_count += 1

                except Exception as e:
                    logger.error(
                        f"Error importing invoice {inv_data.get('invoiceNumber', '?')}: {e}",
                        exc_info=True,
                    )
                    errors.append(
                        f"Error importing invoice {inv_data.get('invoiceNumber', '?')}: {str(e)}"
                    )
                    skipped_count += 1

            # ---------- PHASE 3: bulk writes ----------
            # Bulk-create invoices in ONE round-trip. PostgreSQL fills in PKs.
            # If bulk_create raises for one bad row (e.g. malformed date), we
            # don't want the whole batch to 500. Try the bulk path first; on
            # failure, fall back to per-row create so good rows still land
            # and bad rows surface as per-row errors.
            if invoices_to_create:
                invoice_objs = [pair[0] for pair in invoices_to_create]
                try:
                    Invoice.objects.bulk_create(invoice_objs, batch_size=200)
                except Exception as bulk_err:
                    logger.warning(
                        "bulk_create failed (%s); falling back to per-row create", bulk_err
                    )
                    surviving = []
                    for invoice, inv_data in invoices_to_create:
                        try:
                            invoice.save()
                            surviving.append((invoice, inv_data))
                        except Exception as row_err:
                            errors.append(
                                f"Invoice {inv_data.get('invoiceNumber','?')}: "
                                f"could not create — {row_err}"
                            )
                            created_count -= 1
                            skipped_count += 1
                    invoices_to_create = surviving
                    invoice_objs = [pair[0] for pair in surviving]
                # Now invoice.pk is populated; build line items + audit logs.
                for invoice, inv_data in invoices_to_create:
                    items = inv_data.get("items", [])
                    is_igst = invoice.is_igst_applicable
                    for item in items:
                        # Excel cells can come through as numbers (e.g. HSN "711319"
                        # parsed as int) — coerce to str before .strip() so one
                        # numeric cell can't AttributeError the whole batch.
                        product_name = str(item.get("productName") or "").strip()
                        # Resolve HSN + GST rate from Product master if not supplied.
                        # Never silently default — if the row has no GST rate AND
                        # no matching product, fail with a clear message.
                        product = lookup_product(product_name)
                        hsn_code = str(item.get("hsn") or "").strip()
                        gst_rate_raw_in = item.get("gstRate")
                        if gst_rate_raw_in in (None, "", 0, "0"):
                            if not product:
                                errors.append(
                                    f"Invoice {inv_data.get('invoiceNumber','?')} item '{product_name}': "
                                    f"product not found in Product list and no GST rate supplied. "
                                    f"Add the product first or include a GST Rate column."
                                )
                                continue
                            gst_rate = Decimal(str(product.gst_tax_rate))
                            if not hsn_code:
                                hsn_code = product.hsn_code or ""
                        else:
                            gst_rate_raw = Decimal(str(gst_rate_raw_in))
                            gst_rate = gst_rate_raw if gst_rate_raw <= 1 else gst_rate_raw / Decimal("100")
                            if not hsn_code and product:
                                hsn_code = product.hsn_code or ""

                        qty = Decimal(str(item.get("qty", 0)))
                        rate = Decimal(str(item.get("rate", 0)))
                        cgst = Decimal(str(item.get("cgst", 0)))
                        sgst = Decimal(str(item.get("sgst", 0)))
                        igst = Decimal(str(item.get("igst", 0)))
                        # User-supplied gross amount takes precedence — they may not have qty/rate
                        user_amount = Decimal(str(item.get("amount", 0)))
                        net_amount = qty * rate
                        if net_amount == 0 and user_amount > 0:
                            net_amount = user_amount - cgst - sgst - igst
                            if net_amount < 0:
                                net_amount = user_amount / (1 + gst_rate)
                        tax_amount = net_amount * gst_rate
                        if cgst == 0 and sgst == 0 and igst == 0:
                            if is_igst:
                                igst = tax_amount
                            else:
                                cgst = tax_amount / 2
                                sgst = tax_amount / 2
                        amount = user_amount if user_amount > 0 else (net_amount + cgst + sgst + igst)

                        # Validate per-field DB constraints BEFORE bulk_create so
                        # a single bad row doesn't 500 the whole batch.
                        # quantity / cgst / sgst / igst are NUMERIC(10,3) → abs < 10^7
                        # rate / amount / gst_tax_rate are NUMERIC(12,3) → abs < 10^9
                        OVERFLOW_10 = Decimal("10000000")
                        OVERFLOW_12 = Decimal("1000000000")
                        bad = None
                        if abs(qty) >= OVERFLOW_10: bad = ("quantity", qty)
                        elif abs(cgst) >= OVERFLOW_10: bad = ("cgst", cgst)
                        elif abs(sgst) >= OVERFLOW_10: bad = ("sgst", sgst)
                        elif abs(igst) >= OVERFLOW_10: bad = ("igst", igst)
                        elif abs(rate) >= OVERFLOW_12: bad = ("rate", rate)
                        elif abs(amount) >= OVERFLOW_12: bad = ("amount", amount)
                        if bad:
                            errors.append(
                                f"Invoice {inv_data.get('invoiceNumber','?')} item '{product_name}': "
                                f"{bad[0]} value {bad[1]} exceeds DB limit. "
                                f"Likely qty×rate computation error — check input."
                            )
                            continue

                        line_items_to_create.append(LineItem(
                            invoice=invoice, customer=invoice.customer,
                            product_name=product_name or "Item",
                            hsn_code=hsn_code or "",
                            gst_tax_rate=gst_rate,
                            quantity=qty, rate=rate,
                            cgst=cgst, sgst=sgst, igst=igst, amount=amount,
                            workspace_id=1,
                        ))
                    # Stash the metadata we need for the audit log; the actual
                    # AuditLog row is appended below after total_amount has been
                    # recomputed from line items, so the logged total isn't stale.
                    pending_invoice_audits.append({
                        "pk": invoice.pk,
                        "name": f"#{invoice.invoice_number} - {invoice.customer.name}",
                        "item_count": len(items),
                    })

            if line_items_to_create:
                LineItem.objects.bulk_create(line_items_to_create, batch_size=200)

            # If any invoices ended up with NO line items (all their items errored
            # out during product/GST resolution), they must be removed — leaving
            # stub invoices behind would corrupt counters and confuse downstream
            # reports. (total_amount defaults to 0 so NULL isn't the failure mode.)
            empty_inv_ids: list[int] = []
            if invoices_to_create:
                from django.db.models import OuterRef, Subquery, Sum, DecimalField
                from django.db.models.functions import Coalesce
                invoice_ids = [inv.pk for inv, _ in invoices_to_create if inv.pk]
                if invoice_ids:
                    # Find invoices with no line items and decrement counters
                    empty_inv_ids = list(
                        Invoice.objects.filter(pk__in=invoice_ids, lineitem__isnull=True)
                        .values_list("pk", flat=True)
                    )
                    if empty_inv_ids:
                        # Roll back stub invoices and adjust counters
                        Invoice.objects.filter(pk__in=empty_inv_ids).delete()
                        invoice_ids = [pk for pk in invoice_ids if pk not in empty_inv_ids]
                        created_count -= len(empty_inv_ids)
                        skipped_count += len(empty_inv_ids)

                    # Safety net: recompute Invoice.total_amount = SUM(line_items)
                    # for the surviving invoices. bulk_create skips the post_save
                    # signal that normally keeps total in sync, so we re-derive.
                    if invoice_ids:
                        sub = (LineItem.objects
                               .filter(invoice=OuterRef("pk"))
                               .values("invoice")
                               .annotate(s=Sum("amount"))
                               .values("s"))
                        Invoice.objects.filter(pk__in=invoice_ids).update(
                            total_amount=Coalesce(
                                Subquery(sub, output_field=DecimalField()),
                                Decimal("0"),
                                output_field=DecimalField(),
                            )
                        )

            # Emit the deferred per-invoice audit logs now that total_amount
            # has been recomputed from line items (and dropped invoices that
            # were rolled back as empty).
            if pending_invoice_audits:
                empty_set = set(empty_inv_ids)
                surviving_pks = [a["pk"] for a in pending_invoice_audits if a["pk"] not in empty_set]
                live_totals = dict(
                    Invoice.objects.filter(pk__in=surviving_pks).values_list("pk", "total_amount")
                )
                for meta in pending_invoice_audits:
                    if meta["pk"] in empty_set:
                        continue
                    audit_logs_to_create.append(AuditLog(
                        action="imported", entity="invoice",
                        entity_id=meta["pk"],
                        entity_name=meta["name"],
                        user=request.user if request.user and request.user.is_authenticated else None,
                        details=(
                            f"Imported from Excel ({meta['item_count']} items, "
                            f"total: {live_totals.get(meta['pk'], 0)})"
                        ),
                    ))

            # Add per-row error entries to the audit log so failures are
            # visible in the UI's audit log page (not just Django logs).
            if errors:
                for err_msg in errors[:50]:  # cap to avoid runaway
                    audit_logs_to_create.append(AuditLog(
                        action="imported", entity="invoice",
                        entity_id=0, entity_name="(failed row)",
                        user=request.user if request.user and request.user.is_authenticated else None,
                        details=f"Import error: {err_msg[:500]}",
                    ))

            if audit_logs_to_create:
                AuditLog.objects.bulk_create(audit_logs_to_create, batch_size=200)

            # Link new customers to businesses via M2M — bulk_create the through-table
            # rows instead of N individual .add() calls (each is its own round-trip).
            if new_customers_added_to_biz:
                Through = Customer.businesses.through
                # Dedupe pairs (customer_id, business_id) — a customer might appear
                # in multiple invoices for the same business.
                seen_pairs = set()
                m2m_rows = []
                for cust, biz in new_customers_added_to_biz:
                    if not cust.pk or not biz.pk:
                        continue
                    key = (cust.pk, biz.pk)
                    if key in seen_pairs:
                        continue
                    seen_pairs.add(key)
                    m2m_rows.append(Through(customer_id=cust.pk, business_id=biz.pk))
                if m2m_rows:
                    Through.objects.bulk_create(m2m_rows, ignore_conflicts=True, batch_size=200)

        return Response(
            {
                "created": created_count,
                "skipped": skipped_count,
                "errors": errors[:20],
                "message": f"Successfully imported {created_count} invoices. {skipped_count} skipped.",
            },
            status=status.HTTP_201_CREATED,
        )


@method_decorator(csrf_exempt, name="dispatch")
class AIInvoiceProcessingView(APIView):
    """
    API endpoint for AI-powered invoice processing using Google Gemini.
    Processes invoice images and extracts structured data.
    """

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

            # NIM's chat-completions endpoint officially supports PNG/JPG
            # only. WebP was in the allowed list previously but NVIDIA's
            # docs don't confirm it; rather than gamble on undocumented
            # behavior, reject up-front with a clear message.
            allowed_types = ["image/jpeg", "image/jpg", "image/png"]
            if image_file.content_type not in allowed_types:
                return Response(
                    {
                        "error": (
                            f"Unsupported image type '{image_file.content_type}'. "
                            "Upload a JPEG or PNG."
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Validate file size (max 10MB)
            if image_file.size > 10 * 1024 * 1024:
                return Response(
                    {
                        "error": "File size too large. Please upload an image smaller than 10MB."
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            business_id = request.data.get("business_id")
            if not business_id:
                return Response(
                    {"error": "Business ID is required"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Process the image with AI
            processor = AIInvoiceProcessor()
            extracted_data = processor.process_invoice_image(
                image_file, business_id=business_id
            )

            return Response(
                {
                    "success": True,
                    "data": extracted_data,
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

    def post(self, request):
        """Create an invoice from AI-extracted data.

        Three latent bugs in the previous version were fixed here:
          1. `Customer.objects.get(name=...)` raised DoesNotExist (→ 500)
             when the AI returned a name that wasn't an exact match.
             Case-insensitive lookup scoped to the chosen business now,
             with a clear 400 + customer_name in the response so the
             frontend can prompt the user to create them first.
          2. `type_of_invoice` was hardcoded OUTWARD. Now respects the
             `type_of_invoice` field in the request body (defaulting to
             OUTWARD), so purchase invoices can be imported too.
          3. The `customer_data` dict was built but never used — the
             extracted address/GST/PAN/mobile from OCR was silently
             dropped. Now we backfill empty customer fields from
             extracted data (never overwrite curated values; OCR can
             misread a GSTIN).
        """
        try:
            for field in ("business_id", "invoice_data"):
                if field not in request.data:
                    return Response(
                        {"error": f"Missing required field: {field}"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            business_id = request.data["business_id"]
            invoice_data = request.data["invoice_data"]
            type_of_invoice = (
                request.data.get("type_of_invoice") or INVOICE_TYPE_OUTWARD
            )
            if type_of_invoice not in (INVOICE_TYPE_OUTWARD, INVOICE_TYPE_INWARD):
                return Response(
                    {"error": "type_of_invoice must be 'outward' or 'inward'"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            try:
                business = Business.objects.get(id=business_id)
            except Business.DoesNotExist:
                return Response(
                    {"error": "Business not found"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            extracted_name = (invoice_data.get("customer_name") or "").strip()
            if not extracted_name:
                return Response(
                    {"error": "Customer name missing in extracted data."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Case-insensitive match scoped to this business. The AI
            # prompt restricts answers to existing customer names but
            # small variations (whitespace, casing) slip through.
            customer = (
                Customer.objects.filter(
                    businesses__id=business_id, name__iexact=extracted_name
                ).first()
            )
            if not customer:
                return Response(
                    {
                        "error": (
                            f"Customer '{extracted_name}' not found for this "
                            "business. Create the customer first, then re-run "
                            "AI import."
                        ),
                        "customer_name": extracted_name,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Backfill empty customer fields — never overwrite curated
            # data because OCR can misread a GSTIN/PAN by a digit.
            dirty = False
            for db_field, extracted_key in (
                ("address", "customer_address"),
                ("gst_number", "customer_gst_number"),
                ("pan_number", "customer_pan_number"),
                ("mobile_number", "customer_mobile_number"),
            ):
                val = (invoice_data.get(extracted_key) or "").strip()
                if val and not getattr(customer, db_field, ""):
                    setattr(customer, db_field, val)
                    dirty = True
            if dirty:
                customer.save()

            invoice = Invoice.objects.create(
                customer=customer,
                business=business,
                invoice_number=invoice_data.get("invoice_number", ""),
                invoice_date=invoice_data.get("invoice_date")
                or datetime.now().date(),
                type_of_invoice=type_of_invoice,
                total_amount=invoice_data.get("total_amount", 0) or 0,
            )

            line_items_created = 0
            for item_data in invoice_data.get("line_items", []) or []:
                LineItem.objects.create(
                    customer=customer,
                    invoice=invoice,
                    product_name=item_data.get("product_name", "") or "",
                    hsn_code=item_data.get("hsn_code", "") or "",
                    gst_tax_rate=item_data.get("gst_tax_rate", 0.03) or 0.03,
                    quantity=item_data.get("quantity", 0) or 0,
                    rate=item_data.get("rate", 0) or 0,
                    amount=item_data.get("amount", 0) or 0,
                )
                line_items_created += 1

            # Recompute invoice total from line items — `amount` is the
            # tax-inclusive line subtotal (matches InvoiceForm's contract),
            # so summing gives the true total even if the AI's
            # `total_amount` was off.
            invoice.total_amount = sum(
                LineItem.objects.filter(invoice=invoice).values_list(
                    "amount", flat=True
                )
            )
            invoice.save()

            return Response(
                {
                    "success": True,
                    "invoice_id": invoice.id,
                    "invoice_number": invoice.invoice_number,
                    "customer_name": customer.name,
                    "line_items_created": line_items_created,
                    "total_amount": invoice.total_amount,
                    "message": "Invoice created successfully",
                }
            )

        except Exception as e:
            logger.error(
                f"Error creating invoice from AI data: {e}", exc_info=True
            )
            return Response(
                {"error": f"Could not create invoice: {e!s}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    """Read-only viewset for audit log entries with undo support."""

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

    @action(detail=False, methods=["post"])
    def log(self, request):
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

    @action(detail=True, methods=["post"])
    def undo(self, request, pk=None):
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
                obj = model.objects.create(**kwargs)
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
            serializer.save(opening_as_of=timezone.now().date())
        else:
            serializer.save()
        return Response(serializer.data)


@method_decorator(csrf_exempt, name="dispatch")
class ProfileView(APIView):
    """Get/update user profile."""

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
        from django.contrib.auth.models import User, Group
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
        from django.contrib.auth.models import User, Group
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
