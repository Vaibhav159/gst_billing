import csv
import logging
from calendar import monthrange
from datetime import datetime
from decimal import Decimal

from django.db.models import (
    Count,
    F,
    IntegerField,
    Q,
    Sum,
)
from django.db.models.functions import Cast, Coalesce, ExtractMonth, ExtractYear
from django.http import HttpResponse
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
from billing.models import Business, Customer, Invoice, LineItem, Product
from billing.utils import (
    AIInvoiceProcessingError,
    AIInvoiceProcessor,
    CSVImportError,
    process_customer_csv,
    process_invoice_csv,
    process_product_csv,
)

from .serializers import (
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
class BusinessViewSet(viewsets.ModelViewSet):
    queryset = Business.objects.all().order_by("name")
    serializer_class = BusinessSerializer
    parser_classes = [MultiPartParser, FormParser, JSONParser]
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
class CustomerViewSet(viewsets.ModelViewSet):
    queryset = Customer.objects.all().prefetch_related("businesses").order_by("name")
    serializer_class = CustomerSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
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
        source.delete()

        return Response(
            {
                "message": f"Successfully merged '{source_name}' into '{target.name}'.",
                "invoices_transferred": invoices_transferred,
                "target_id": target.id,
            }
        )



@method_decorator(csrf_exempt, name="dispatch")
class ProductViewSet(viewsets.ModelViewSet):
    queryset = Product.objects.all().order_by("name")
    serializer_class = ProductSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
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
class InvoiceViewSet(viewsets.ModelViewSet):
    queryset = (
        Invoice.objects.all()
        .select_related("customer", "business")
        .order_by("-invoice_date")
    )
    serializer_class = InvoiceSerializer

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

        # Annotate with total tax and item count
        queryset = queryset.annotate(
            total_tax=Coalesce(
                Sum(F("lineitem__cgst") + F("lineitem__sgst") + F("lineitem__igst")),
                Decimal("0.00"),
            ),
            line_item_count=Count("lineitem"),
        )

        return queryset

    @action(detail=True, methods=["post"])
    def update_line_items(self, request, pk=None):
        """Replace all line items for an invoice"""
        invoice = self.get_object()
        line_items_data = request.data.get("line_items", [])

        # Delete existing line items
        LineItem.objects.filter(invoice=invoice).delete()

        # Create new line items
        for item_data in line_items_data:
            qty = Decimal(str(item_data.get("quantity", 1)))
            rate = Decimal(str(item_data.get("rate", 0)))
            amount = Decimal(str(item_data.get("amount", qty * rate)))
            LineItem.objects.create(
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
            )

        # Update invoice total
        invoice.save()  # This triggers the total_amount recalculation

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

        return Response(data)

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
    def next_invoice_number(self, request):
        """Get the next invoice number for a business"""
        business_id = request.query_params.get("business_id")
        invoice_type = request.query_params.get("type_of_invoice", INVOICE_TYPE_OUTWARD)

        if not business_id:
            return Response(
                {"error": "Business ID is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        # Get the financial year
        from datetime import datetime

        today = datetime.now().date()
        # Get financial year start date (April 1st)
        start_date = (
            datetime(today.year - 1, 4, 1).date()
            if today.month < 4
            else datetime(today.year, 4, 1).date()
        )

        # Get the last invoice number for this business in the current financial year
        last_invoice = None
        if invoice_type == INVOICE_TYPE_OUTWARD:
            # For 'outward' invoices, cast invoice_number to integer for correct numeric sorting.
            last_invoice = (
                Invoice.objects.filter(
                    business_id=business_id,
                    invoice_date__gte=start_date,
                    type_of_invoice=invoice_type,
                )
                .annotate(
                    invoice_number_as_int=Cast(
                        "invoice_number", output_field=IntegerField()
                    )
                )
                .order_by("-invoice_number_as_int")
                .first()
            )
        else:
            # For other invoice types, maintain the original behavior (lexical sort)
            last_invoice = (
                Invoice.objects.filter(
                    business_id=business_id,
                    invoice_date__gte=start_date,
                    type_of_invoice=invoice_type,
                )
                .order_by("-invoice_number")
                .first()
            )

        next_number = 1
        if last_invoice:
            try:
                # Attempt to convert the invoice_number string to an integer and increment.
                next_number = int(last_invoice.invoice_number) + 1
            except (ValueError, IndexError):
                logger.warning(
                    f"Could not parse invoice_number '{last_invoice.invoice_number}' as int "
                    f"for business {business_id}, type {invoice_type}. Resetting next number to 1."
                )
                next_number = 1  # Reset if parsing fails

        # Format the invoice number string
        # prefix = "OUT" if invoice_type == "outward" else "IN"
        next_invoice_number_str = f"{next_number!s}"

        return Response({"next_invoice_number": next_invoice_number_str})


@method_decorator(csrf_exempt, name="dispatch")
class LineItemViewSet(viewsets.ModelViewSet):
    queryset = LineItem.objects.all().select_related("invoice")
    serializer_class = LineItemSerializer
    pagination_class = StandardResultsSetPagination

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

        for inv_data in invoices_data:
            try:
                firm_name = inv_data.get("firmName", "")
                firm_gstin = inv_data.get("firmGSTIN", "")

                # Find business by ID, GSTIN, or name
                business = None
                if business_id:
                    try:
                        business = Business.objects.get(id=int(business_id))
                    except (Business.DoesNotExist, ValueError):
                        pass

                if not business and firm_gstin:
                    business = Business.objects.filter(
                        gst_number__iexact=firm_gstin
                    ).first()

                if not business and firm_name:
                    business = Business.objects.filter(
                        name__icontains=firm_name
                    ).first()

                if not business:
                    errors.append(
                        f"Business not found for invoice {inv_data.get('invoiceNumber', '?')}: {firm_name} ({firm_gstin})"
                    )
                    skipped_count += 1
                    continue

                # Find or create customer
                customer_name = inv_data.get("customerName", "")
                customer_gst = inv_data.get("customerGST", "")

                if not customer_name:
                    errors.append(
                        f"No customer name for invoice {inv_data.get('invoiceNumber', '?')}"
                    )
                    skipped_count += 1
                    continue

                customer = None
                if customer_gst and customer_gst not in ("-", ""):
                    # Try by GST first
                    is_pan = "(PAN)" in customer_gst
                    clean_gst = customer_gst.replace("(PAN)", "").strip()
                    if is_pan:
                        customer = Customer.objects.filter(
                            pan_number__iexact=clean_gst
                        ).first()
                    else:
                        customer = Customer.objects.filter(
                            gst_number__iexact=clean_gst
                        ).first()

                if not customer:
                    customer = Customer.objects.filter(
                        name__iexact=customer_name
                    ).first()

                if not customer:
                    # Create customer
                    clean_gst = ""
                    clean_pan = ""
                    if customer_gst and customer_gst not in ("-", ""):
                        if "(PAN)" in customer_gst:
                            clean_pan = customer_gst.replace("(PAN)", "").strip()
                        else:
                            clean_gst = customer_gst
                    customer = Customer.objects.create(
                        name=customer_name,
                        gst_number=clean_gst,
                        pan_number=clean_pan,
                        state_name="RAJASTHAN",
                        workspace_id=1,
                    )
                    customer.save()
                    # Link customer to business
                    if business and business.pk:
                        customer.businesses.add(business)

                # Check for duplicate invoice
                invoice_number = str(inv_data.get("invoiceNumber", ""))
                invoice_date = inv_data.get("invoice_date", "")
                inv_type = inv_data.get("type", "OUTWARD")
                type_of_invoice = (
                    INVOICE_TYPE_INWARD
                    if inv_type == "INWARD"
                    else INVOICE_TYPE_OUTWARD
                )

                existing = Invoice.objects.filter(
                    invoice_number=invoice_number,
                    business=business,
                    invoice_date=invoice_date,
                ).first()

                if existing:
                    skipped_count += 1
                    continue

                # Create invoice
                invoice = Invoice.objects.create(
                    invoice_number=invoice_number,
                    invoice_date=invoice_date,
                    customer=customer,
                    business=business,
                    type_of_invoice=type_of_invoice,
                    total_amount=Decimal(str(inv_data.get("total", 0))),
                    workspace_id=1,
                )

                # Create line items
                items = inv_data.get("items", [])
                for item in items:
                    qty = Decimal(str(item.get("qty", 0)))
                    rate = Decimal(str(item.get("rate", 0)))
                    gst_rate = Decimal(str(item.get("gstRate", 3))) / Decimal("100")
                    net_amount = qty * rate
                    tax_amount = net_amount * gst_rate

                    cgst = Decimal(str(item.get("cgst", 0)))
                    sgst = Decimal(str(item.get("sgst", 0)))
                    igst = Decimal(str(item.get("igst", 0)))

                    # If taxes weren't pre-calculated, calculate them
                    if cgst == 0 and sgst == 0 and igst == 0:
                        if invoice.is_igst_applicable:
                            igst = tax_amount
                        else:
                            cgst = tax_amount / 2
                            sgst = tax_amount / 2

                    amount = net_amount + cgst + sgst + igst

                    LineItem.objects.create(
                        invoice=invoice,
                        customer=customer,
                        product_name=item.get("productName", "Item"),
                        hsn_code=item.get("hsn", "711319"),
                        gst_tax_rate=gst_rate,
                        quantity=qty,
                        rate=rate,
                        cgst=cgst,
                        sgst=sgst,
                        igst=igst,
                        amount=amount,
                        workspace_id=1,
                    )

                # Update invoice total
                invoice.save()
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

        return Response(
            {
                "created": created_count,
                "skipped": skipped_count,
                "errors": errors[:20],  # Limit error messages
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

            # Validate file type
            allowed_types = ["image/jpeg", "image/jpg", "image/png", "image/webp"]
            if image_file.content_type not in allowed_types:
                return Response(
                    {
                        "error": "Invalid file type. Please upload a JPEG, PNG, or WebP image."
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
        """Create invoice from AI-extracted data"""
        try:
            # Validate required fields
            required_fields = ["business_id", "invoice_data"]
            for field in required_fields:
                if field not in request.data:
                    return Response(
                        {"error": f"Missing required field: {field}"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            business_id = request.data["business_id"]
            invoice_data = request.data["invoice_data"]

            # Validate business exists
            try:
                business = Business.objects.get(id=business_id)
            except Business.DoesNotExist:
                return Response(
                    {"error": "Business not found"}, status=status.HTTP_400_BAD_REQUEST
                )

            # Create or get customer
            customer_data = {
                "name": invoice_data.get("customer_name", ""),
                "address": invoice_data.get("customer_address", ""),
                "gst_number": invoice_data.get("customer_gst_number", ""),
                "pan_number": invoice_data.get("customer_pan_number", ""),
                "mobile_number": invoice_data.get("customer_mobile_number", ""),
            }

            customer = Customer.objects.get(name=customer_data["name"])

            # Create invoice
            invoice = Invoice.objects.create(
                customer=customer,
                business=business,
                invoice_number=invoice_data.get("invoice_number", ""),
                invoice_date=invoice_data.get("invoice_date", datetime.now().date()),
                type_of_invoice=INVOICE_TYPE_OUTWARD,
                total_amount=invoice_data.get("total_amount", 0),
            )

            # Create line items
            line_items_created = 0
            for item_data in invoice_data.get("line_items", []):
                LineItem.objects.create(
                    customer=customer,
                    invoice=invoice,
                    product_name=item_data.get("product_name", ""),
                    hsn_code=item_data.get("hsn_code", ""),
                    gst_tax_rate=item_data.get("gst_tax_rate", 0.03),
                    quantity=item_data.get("quantity", 0),
                    rate=item_data.get("rate", 0),
                    amount=item_data.get("amount", 0),
                )
                line_items_created += 1

            # Update invoice total
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
            logger.error(f"Error creating invoice from AI data: {e}", exc_info=True)
            return Response(
                {"error": "An unexpected error occurred while creating the invoice"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
