import logging
from calendar import monthrange
from datetime import datetime
from decimal import Decimal

from django.db.models import Q, Sum
from django.http import HttpResponse
from django.utils.decorators import method_decorator
from django.views.decorators.cache import cache_page
from django.views.decorators.csrf import csrf_exempt
from openpyxl import Workbook
from rest_framework import filters, status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.constants import (
    DOWNLOAD_SHEET_FIELD_NAMES,
    INVOICE_TYPE_INWARD,
    INVOICE_TYPE_OUTWARD,
)
from billing.models import Business, Customer, Invoice, LineItem, Product
from billing.utils import CSVImportError, process_invoice_csv

from .serializers import (
    BusinessSerializer,
    CustomerSerializer,
    InvoiceSerializer,
    InvoiceSummarySerializer,
    LineItemSerializer,
    ProductSerializer,
)

logger = logging.getLogger(__name__)


class StandardResultsSetPagination(PageNumberPagination):
    page_size = 15
    page_size_query_param = "page_size"
    max_page_size = 100


@method_decorator(csrf_exempt, name="dispatch")
class BusinessViewSet(viewsets.ModelViewSet):
    queryset = Business.objects.all().order_by("name")
    serializer_class = BusinessSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["name", "gst_number"]
    ordering_fields = ["name", "created_at"]
    ordering = ["name"]
    pagination_class = StandardResultsSetPagination

    # Removed caching to ensure fresh data
    def list(self, request, *args, **kwargs):
        # Optimize query with select_related if needed
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        queryset = super().get_queryset()

        # Apply search filter manually for more control
        search_term = self.request.query_params.get("search", "")
        if search_term:
            queryset = queryset.filter(
                Q(name__icontains=search_term) | Q(gst_number__icontains=search_term)
            )

        return queryset


@method_decorator(csrf_exempt, name="dispatch")
class CustomerViewSet(viewsets.ModelViewSet):
    queryset = Customer.objects.all().prefetch_related("businesses").order_by("name")
    serializer_class = CustomerSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["name", "gst_number", "mobile_number"]
    ordering_fields = ["name", "created_at"]
    ordering = ["name"]
    pagination_class = StandardResultsSetPagination

    # Removed caching to ensure fresh data
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

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


@method_decorator(csrf_exempt, name="dispatch")
class ProductViewSet(viewsets.ModelViewSet):
    queryset = Product.objects.all().order_by("name")
    serializer_class = ProductSerializer
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["name", "hsn_code"]
    ordering_fields = ["name", "created_at"]
    ordering = ["name"]
    pagination_class = StandardResultsSetPagination

    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

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

    @method_decorator(cache_page(60 * 60 * 30))  # Cache for 30 days
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
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ["invoice_number", "customer__name", "business__name"]
    ordering_fields = ["invoice_date", "created_at", "invoice_number"]
    ordering = ["-invoice_date"]
    pagination_class = StandardResultsSetPagination

    # Removed caching to ensure fresh data
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    def get_queryset(self):
        queryset = super().get_queryset()

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

        return queryset

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

        data = {
            "invoice": InvoiceSerializer(invoice).data,
            "line_items": LineItemSerializer(line_items, many=True).data,
            **LineItem.get_invoice_summary(invoice_id=invoice.id),
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
    def next_invoice_number(self, request):
        """Get the next invoice number for a business"""
        business_id = request.query_params.get("business_id")
        invoice_type = request.query_params.get("type_of_invoice", "outward")

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

        # Generate the next invoice number
        if last_invoice:
            try:
                # Try to extract the numeric part of the invoice number
                # Assuming the number to be of type str
                next_number = int(last_invoice.invoice_number) + 1
            except (ValueError, IndexError):
                next_number = 1

        # Format the invoice number
        # prefix = "OUT" if invoice_type == "outward" else "IN"
        invoice_number = f"{next_number!s}"

        return Response({"next_invoice_number": invoice_number})


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
    """

    def get(self, request, *args, **kwargs):
        # Just return a simple response
        return Response({"message": "Report API ready"})

    @staticmethod
    def get_date_range_string(start_date, end_date):
        start_date_obj = datetime.strptime(start_date, "%Y-%m-%d")
        end_date_obj = datetime.strptime(end_date, "%Y-%m-%d")

        start_date_str = datetime.strftime(start_date_obj, "%B %Y")
        end_date_str = datetime.strftime(end_date_obj, "%B %Y")

        if start_date_str == end_date_str:
            return start_date_str
        else:
            if start_date_obj.year == end_date_obj.year:
                return f"{start_date_str} to {datetime.strftime(end_date_obj, '%B')}-{end_date_obj.year}"
            else:
                return f"{start_date_str} to {end_date_str}"

    @staticmethod
    def add_invoice_data_to_sheet(
        business, business_name, date_range, line_items, sheet, supply_type
    ):
        def create_row_with_spacing(data):
            return ([""]) * 5 + [data]

        if not line_items:
            # Return zero values if there are no invoices for this section
            return (
                Decimal("0"),
                Decimal("0"),
                Decimal("0"),
                Decimal("0"),
                Decimal("0"),
            )

        total_taxable_value = total_cgst = total_sgst = total_igst = (
            total_invoice_value
        ) = Decimal("0")

        sheet.append(create_row_with_spacing(business_name))
        sheet.append(create_row_with_spacing(supply_type))
        sheet.append(create_row_with_spacing(f"Month: {date_range}"))
        sheet.append(create_row_with_spacing(f"GSTIN: {business.gst_number}"))
        sheet.append([])

        sheet.append(DOWNLOAD_SHEET_FIELD_NAMES)

        # Add data rows
        for idx, item in enumerate(line_items, start=1):
            # For tuples from get_line_item_data_for_download
            sheet.append([idx] + list(item))

            # Extract tax values from the tuple
            # The order matches the query in LineItem.get_line_item_data_for_download
            taxable_value, cgst, sgst, igst, invoice_value = item[-5:]

            # Update totals
            total_taxable_value += taxable_value
            total_cgst += cgst
            total_sgst += sgst
            total_igst += igst
            total_invoice_value += invoice_value

        # Add totals row
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
    def generate_report_for_business(
        cls, workbook, business, start_date, end_date, invoice_type
    ):
        # Create a sheet for this business
        business_name = business.name
        sheet_name = business_name[:31]  # Excel limits sheet names to 31 chars
        sheet = workbook.create_sheet(title=sheet_name)

        # Initialize summary totals
        overall_outward_taxable = 0
        overall_outward_cgst = 0
        overall_outward_sgst = 0
        overall_outward_igst = 0
        overall_outward_total = 0

        overall_inward_taxable = 0
        overall_inward_cgst = 0
        overall_inward_sgst = 0
        overall_inward_igst = 0
        overall_inward_total = 0

        # Split date range into months
        start_date_obj = datetime.strptime(start_date, "%Y-%m-%d")
        end_date_obj = datetime.strptime(end_date, "%Y-%m-%d")

        # Generate month-wise date ranges
        month_wise_split_date = []
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
            month_wise_split_date.append((month_start_str, month_end_str))

            # Move to the first day of the next month
            current_date = (
                datetime(year + 1, 1, 1)
                if month == 12
                else datetime(year, month + 1, 1)
            )

        # Process each month separately
        for month_start_date, month_end_date in month_wise_split_date:
            date_range_string = cls.get_date_range_string(
                month_start_date, month_end_date
            )

            # Get base data for the month
            base_line_item_data = LineItem.get_line_item_data_for_download(
                start_date=month_start_date, end_date=month_end_date, business=business
            )

            # Process Outward if requested ('outward' or 'both')
            if invoice_type in [INVOICE_TYPE_OUTWARD, "both"]:
                outwards_invoices = []
                for item in base_line_item_data:
                    # Check if this is an outward invoice
                    # We need to determine this based on the invoice type
                    # This is a simplification - adjust based on your actual data structure
                    invoice_number = item[0]  # First element is invoice number
                    invoice = Invoice.objects.filter(
                        invoice_number=invoice_number
                    ).first()
                    if invoice and invoice.type_of_invoice == INVOICE_TYPE_OUTWARD:
                        outwards_invoices.append(item)

                if outwards_invoices:  # Only add section if there's data
                    (out_taxable, out_cgst, out_sgst, out_igst, out_total) = (
                        cls.add_invoice_data_to_sheet(
                            business,
                            business_name,
                            date_range_string,
                            outwards_invoices,
                            sheet,
                            supply_type="Outward Supply",
                        )
                    )
                    overall_outward_taxable += out_taxable
                    overall_outward_cgst += out_cgst
                    overall_outward_sgst += out_sgst
                    overall_outward_igst += out_igst
                    overall_outward_total += out_total

            # Process Inward if requested ('inward' or 'both')
            if invoice_type in [INVOICE_TYPE_INWARD, "both"]:
                inward_invoices = []
                for item in base_line_item_data:
                    # Check if this is an inward invoice
                    # We need to determine this based on the invoice type
                    # This is a simplification - adjust based on your actual data structure
                    invoice_number = item[0]  # First element is invoice number
                    invoice = Invoice.objects.filter(
                        invoice_number=invoice_number
                    ).first()
                    if invoice and invoice.type_of_invoice == INVOICE_TYPE_INWARD:
                        inward_invoices.append(item)

                if inward_invoices:  # Only add section if there's data
                    (in_taxable, in_cgst, in_sgst, in_igst, in_total) = (
                        cls.add_invoice_data_to_sheet(
                            business,
                            business_name,
                            date_range_string,
                            inward_invoices,
                            sheet,
                            supply_type="Inward Supply",
                        )
                    )
                    overall_inward_taxable += in_taxable
                    overall_inward_cgst += in_cgst
                    overall_inward_sgst += in_sgst
                    overall_inward_igst += in_igst
                    overall_inward_total += in_total

        # Add aggregated sections at the end
        date_range_str = cls.get_date_range_string(start_date, end_date)

        # Only add aggregated outward if it has data and was requested
        if overall_outward_taxable and invoice_type in [INVOICE_TYPE_OUTWARD, "both"]:
            sheet.append([])  # Add a blank row for spacing
            sheet.append(
                [""] * 5
                + [
                    f"Aggregated Outward Supply ({date_range_str})",
                    "",
                    "",
                    "",
                    "",
                    overall_outward_taxable,
                    overall_outward_cgst,
                    overall_outward_sgst,
                    overall_outward_igst,
                    overall_outward_total,
                ]
            )

        # Only add aggregated inward if it has data and was requested
        if overall_inward_taxable and invoice_type in [INVOICE_TYPE_INWARD, "both"]:
            sheet.append(
                [""] * 5
                + [
                    f"Aggregated Inward Supply ({date_range_str})",
                    "",
                    "",
                    "",
                    "",
                    overall_inward_taxable,
                    overall_inward_cgst,
                    overall_inward_sgst,
                    overall_inward_igst,
                    overall_inward_total,
                ]
            )
            sheet.append([])  # Add a blank row for spacing

    @classmethod
    def generate_csv_response(cls, start_date, end_date, invoice_type):
        # Generate Excel file and return HTTP response
        workbook = Workbook()
        # Remove default sheet
        workbook.remove(workbook.active)

        for business in Business.objects.all():
            cls.generate_report_for_business(
                workbook, business, start_date, end_date, invoice_type
            )

        response = HttpResponse(
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
        # Ensure the filename has the correct extension and is properly formatted for all browsers
        date_range = cls.get_date_range_string(start_date, end_date)
        filename = f"invoices_{date_range}.xlsx"
        # Use both Content-Disposition formats for maximum browser compatibility
        response["Content-Disposition"] = (
            f"attachment; filename=\"{filename}\"; filename*=UTF-8''{filename}"
        )

        workbook.save(response)
        return response

    def post(self, request, *args, **kwargs):
        # Get parameters from request
        start_date = request.data.get("start_date")
        end_date = request.data.get("end_date")
        invoice_type = request.data.get("invoice_type", "both")

        if not start_date or not end_date:
            return Response(
                {"error": "Start date and end date are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Generate and return the Excel file
        return self.generate_csv_response(start_date, end_date, invoice_type)


@method_decorator(csrf_exempt, name="dispatch")
class InvoiceImportView(APIView):
    """
    API endpoint for importing invoices from CSV files.
    """

    parser_classes = [MultiPartParser]

    def get(self, request, *args, **kwargs):
        # Just return a simple response
        return Response({"message": "Import API ready"})

    def post(self, request, *args, **kwargs):
        # Check if file is provided
        if "file" not in request.FILES:
            return Response(
                {"error": "No file provided"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check if business_id is provided
        business_id = request.data.get("business_id")
        if not business_id:
            return Response(
                {"error": "Business ID is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get the uploaded file
        csv_file = request.FILES["file"]

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

            # Process the CSV file
            result = process_invoice_csv(file_content, int(business_id))

            return Response(result, status=status.HTTP_201_CREATED)
        except CSVImportError as e:
            return Response(
                {"error": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception as e:
            logging.error(f"Error processing CSV file: {e!s}")
            return Response(
                {"error": "An unexpected error occurred while processing the CSV file"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


# CSRF token endpoint removed - using JWT authentication instead


class PublicAPIView(APIView):
    """
    Public API endpoint that doesn't require authentication.
    This is useful for checking if the API is working without authentication.
    """

    permission_classes = []

    def get(self, request, *args, **kwargs):
        return Response(
            {
                "message": "This is a public endpoint that doesn't require authentication.",
                "status": "API is working correctly.",
            }
        )
