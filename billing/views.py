from datetime import datetime
from decimal import Decimal

from django.http import HttpResponse
from django.shortcuts import redirect, render

# Create your views here.
from django.urls import reverse_lazy
from django.views import View
from django.views.generic import DeleteView, ListView
from num2words import num2words
from openpyxl.workbook import Workbook

from billing.constants import (
    DOWNLOAD_SHEET_FIELD_NAMES,
    INVOICE_TYPE_CHOICES,
    INVOICE_TYPE_INWARD,
    INVOICE_TYPE_OUTWARD,
    PAGINATION_PAGE_SIZE,
)
from billing.forms import BusinessForm, CustomerForm, ProductForm
from billing.models import Business, Customer, Invoice, LineItem, Product
from billing.utils import split_dates


class InitialView(View):
    def get(self, request):
        return render(request, "base.html")


class CustomerView(View):
    def get(self, request):
        customer = (
            None
            if not request.GET.get("customer_id")
            else Customer.objects.get(id=int(request.GET.get("customer_id")))
        )
        form = CustomerForm(instance=customer)
        return render(request, "partials/customer_form.html", {"form": form})

    def post(self, request):
        form = CustomerForm(request.POST)
        if form.is_valid():
            form.save()
            return redirect("customer_detail", customer_id=form.instance.id)
        return render(request, "partials/customer_form.html", {"form": form})


class CustomerEditView(View):
    def get(self, request, customer_id=None):
        customer = None if not customer_id else Customer.objects.get(id=customer_id)
        form = CustomerForm(instance=customer)
        return render(request, "partials/customer_form.html", {"form": form})

    def post(self, request, customer_id):
        customer = None if not customer_id else Customer.objects.get(id=customer_id)
        form = CustomerForm(request.POST, instance=customer)
        if form.is_valid():
            form.save()
            return redirect("customer_detail", customer_id=form.instance.id)
        return render(request, "partials/customer_form.html", {"form": form})


class CustomerListView(ListView):
    model = Customer
    template_name = "customer_list.html"
    context_object_name = "customers"
    paginate_by = PAGINATION_PAGE_SIZE

    def get_queryset(self):
        filter_kwargs = {}
        customer_name = self.request.GET.get("customer_name")
        business_id = self.request.GET.get("business_id")

        if customer_name:
            filter_kwargs["name__icontains"] = customer_name
        if business_id:
            filter_kwargs["businesses"] = business_id

        return Customer.objects.filter(**filter_kwargs).order_by("id")

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context["title"] = "Customers"
        context["businesses"] = Business.objects.all()
        context["business_id"] = (
            int(self.request.GET.get("business_id"))
            if self.request.GET.get("business_id")
            else ""
        )
        context["customer_name"] = self.request.GET.get("customer_name", "")
        return context

    def get(self, request, *args, **kwargs):
        if request.htmx and request.GET.get("page"):
            return render(
                request,
                "partials/customer_data_list.html",
                context=self.get_context_data(object_list=self.get_queryset()),
            )
        return super().get(request, *args, *kwargs)


class CustomerDetailView(View):
    def get(self, request, customer_id):
        customer = Customer.objects.get(id=customer_id)
        invoices = Invoice.objects.filter(customer=customer).order_by(
            "-type_of_invoice", "-invoice_date", "-invoice_number"
        )

        context = {
            "object": customer,
            "invoices": invoices,
            "invoice_count": invoices.count(),
        }
        return render(request, "customer_detail.html", context)

    def post(self, request):
        return render(request, "customer_detail.html")


class CustomerDeleteView(DeleteView):
    model = Customer
    success_url = reverse_lazy("customer_list")
    template_name = "customer_list.html"


# Create views for Business just like Customer Views
class BusinessView(View):
    def get(self, request):
        business = (
            None
            if not request.GET.get("business_id")
            else Business.objects.get(id=int(request.GET.get("business_id")))
        )
        form = BusinessForm(instance=business)
        return render(request, "partials/business_form.html", {"form": form})

    def post(self, request):
        form = BusinessForm(request.POST)
        if form.is_valid():
            form.save()
            return redirect("business_detail", business_id=form.instance.id)
        return render(request, "partials/business_form.html", {"form": form})


class BusinessEditView(View):
    def get(self, request, business_id=None):
        business = None if not business_id else Business.objects.get(id=business_id)
        form = BusinessForm(instance=business)
        return render(request, "partials/business_form.html", {"form": form})

    def post(self, request, business_id):
        business = None if not business_id else Business.objects.get(id=business_id)
        form = BusinessForm(request.POST, instance=business)
        if form.is_valid():
            form.save()
            return redirect("business_detail", business_id=form.instance.id)
        return render(request, "partials/business_form.html", {"form": form})


class BusinessListView(ListView):
    model = BusinessForm
    template_name = "business_list.html"
    context_object_name = "businesses"
    paginate_by = PAGINATION_PAGE_SIZE

    def get_queryset(self):
        return Business.objects.all().order_by("id")

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context["title"] = "Businesses"
        return context

    def get(self, request, *args, **kwargs):
        if request.htmx and request.GET.get("page"):
            return render(
                request,
                "partials/business_data_list.html",
                context=self.get_context_data(object_list=self.get_queryset()),
            )
        return super().get(request, *args, *kwargs)


class BusinessDetailView(View):
    def get(self, request, business_id):
        business = Business.objects.get(id=business_id)
        customers = business.customer_set.all()
        invoices = Invoice.objects.filter(business=business).order_by("-invoice_date")[
            :5
        ]  # Last 5 invoices

        context = {
            "object": business,
            "customers": customers,
            "recent_invoices": invoices,
            "customer_count": customers.count(),
            "invoice_count": Invoice.objects.filter(business=business).count(),
        }
        return render(request, "business_detail.html", context)

    def post(self, request):
        return render(request, "business_detail.html")


class BusinessDeleteView(DeleteView):
    model = Business
    success_url = reverse_lazy("business_list")
    template_name = "business_list.html"


# invoicing print page
class InvoiceView(View):
    def get(self, request, *args, **kwargs):
        return render(request, "invoicing/invoice.html")


# invoice views
class InvoiceListView(ListView):
    model = Invoice
    template_name = "invoice_list.html"
    context_object_name = "invoices"
    paginate_by = PAGINATION_PAGE_SIZE

    def get_dates_from_fy(self, fy):
        if not fy:
            return None, None

        start_year = int(fy.split("-")[0])
        start_date = datetime(start_year, 4, 1)  # April 1st
        end_date = datetime(start_year + 1, 3, 31)  # March 31st next year
        return start_date, end_date

    def get_queryset(self):
        business_id = self.request.GET.get("business_id")
        financial_year = self.request.GET.get("financial_year")
        type_of_invoice = self.request.GET.get("type_of_invoice")
        invoice_number = self.request.GET.get("invoice_number")

        filter_kwargs = {}

        if business_id:
            filter_kwargs["business_id"] = business_id

        if financial_year:
            start_date, end_date = self.get_dates_from_fy(financial_year)
            if start_date and end_date:
                filter_kwargs["invoice_date__gte"] = start_date
                filter_kwargs["invoice_date__lte"] = end_date

        if type_of_invoice:
            filter_kwargs["type_of_invoice"] = type_of_invoice

        if invoice_number:
            filter_kwargs["invoice_number__icontains"] = invoice_number

        return Invoice.objects.filter(**filter_kwargs).order_by(
            "-type_of_invoice", "-invoice_date", "-invoice_number"
        )

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context["title"] = "Invoices"
        business_id = (
            int(self.request.GET.get("business_id"))
            if self.request.GET.get("business_id")
            else ""
        )
        context["business_id"] = business_id
        context["start_date"] = self.request.GET.get("start_date")
        context["end_date"] = self.request.GET.get("end_date")
        context["financial_years"] = Invoice.get_financial_years()
        context["selected_fy"] = self.request.GET.get("financial_year", "")
        context["businesses"] = Business.objects.all()
        context["invoice_types_list"] = INVOICE_TYPE_CHOICES
        context["type_of_invoice_selected"] = self.request.GET.get("type_of_invoice")
        context["invoice_number"] = self.request.GET.get("invoice_number", "")

        # Calculate total amount and average amount
        invoices = self.get_queryset()
        total_amount_inward = sum(
            invoices.filter(type_of_invoice=INVOICE_TYPE_INWARD).values_list(
                "total_amount", flat=True
            )
        )
        total_amount_outward = sum(
            invoices.filter(type_of_invoice=INVOICE_TYPE_OUTWARD).values_list(
                "total_amount", flat=True
            )
        )

        context["total_amount_inward"] = total_amount_inward
        context["total_amount_outward"] = total_amount_outward

        return context

    def get(self, request, *args, **kwargs):
        if request.htmx and request.GET.get("page"):
            context = self.get_context_data(object_list=self.get_queryset())
            return render(
                request,
                "partials/invoice_data_list.html",
                context=context,
            )
        return super().get(request, *args, *kwargs)


class InvoiceAddView(View):
    def get(self, request, *args, **kwargs):
        context = {
            "businesses": Business.objects.all(),
            "type_of_invoices": INVOICE_TYPE_CHOICES,
        }
        if not request.htmx:
            return render(request, "partials/add_invoice_form.html", context=context)

        business_id = request.GET.get("business")

        if business_id:
            context["customers"] = Customer.objects.filter(businesses__in=business_id)
            context["next_invoice_number"] = Invoice.get_next_invoice_number(
                business_id
            )

        return render(request, "partials/add_invoice_form.html", context=context)

    def post(self, request, *args, **kwargs):
        data = request.POST
        error_list = []
        business_id, customer_id, invoice_number, invoice_date, type_of_invoice = (
            data["business"],
            data["customer"],
            data["invoice_number"],
            data["invoice_date"],
            data["type_of_invoice"],
        )
        if not business_id:
            error_list.append("business")

        if not customer_id:
            error_list.append("customer")

        if not invoice_number:
            error_list.append("invoice_number")

        if error_list:
            return render(
                request,
                "partials/add_invoice_form.html",
                context={
                    "error_message": f"{', '.join(error_list)} can't be empty",
                },
            )

        invoice = Invoice.objects.create(
            business_id=business_id,
            customer_id=customer_id,
            invoice_number=invoice_number,
            invoice_date=invoice_date,
            type_of_invoice=type_of_invoice,
        )

        invoice.refresh_from_db()

        response = render(request, "invoice_detail.html", context={"invoice": invoice})

        response["HX-Push"] = f"/billing/invoice/{invoice.id}"

        return response


class InvoiceDetailView(View):
    def get(self, request, invoice_id):
        line_items = LineItem.objects.filter(invoice_id=invoice_id)
        context = {
            "invoice": Invoice.objects.get(id=invoice_id),
            "line_items": line_items,
            **LineItem.get_invoice_summary(invoice_id=invoice_id),
        }
        return render(request, "invoice_detail.html", context)

    def post(self, request):
        return render(request, "invoice_detail.html")


class InvoiceDeleteView(DeleteView):
    model = Invoice
    success_url = reverse_lazy("invoice_list")
    template_name = "invoice_list.html"


# LineItemsView
class LineItemView(View):
    def get(self, request):
        invoice_id = request.GET.get("invoice_id")
        total_line_items = LineItem.objects.filter(invoice_id=invoice_id).count()
        return render(
            request,
            "partials/line_item_add.html",
            {
                "total_line_items": total_line_items,
                "invoice_id": invoice_id,
                "product_list": Product.objects.all(),
            },
        )

    def post(self, request):
        data = request.POST
        invoice_id, product_name, qty, rate = (
            data["invoice_id"],
            data["item_name"],
            data["qty"],
            data["rate"],
        )
        line_item = LineItem.create_line_item_for_invoice(
            invoice_id=invoice_id,
            product_name=product_name,
            rate=rate,
            quantity=qty,
        )
        line_items = LineItem.objects.filter(invoice_id=invoice_id)
        Invoice.objects.filter(id=invoice_id).update(
            total_amount=sum(line_items.values_list("amount", flat=True))
        )

        response = render(
            request,
            "line_item_detail.html",
            {
                "object": line_item,
                "index": line_items.count(),
                "invoice": Invoice.objects.get(id=invoice_id),
            },
        )

        response["HX-Trigger"] = "newLineItem"

        return response


class InvoiceSummaryView(View):
    """
    Displays the summary of the invoice.
    """

    def get(self, request):
        invoice_id = request.GET["invoice_id"]

        return render(
            request,
            "partials/invoice_summary.html",
            context={
                "invoice": Invoice.objects.get(id=invoice_id),
                **LineItem.get_invoice_summary(invoice_id=invoice_id),
            },
        )


class PrintInvoiceView(View):
    """
    Displays the printable invoice.
    """

    def get(self, request, invoice_id=None):
        invoice = Invoice.objects.get(id=invoice_id)
        line_items = LineItem.objects.filter(invoice_id=invoice_id)
        invoice_summary = LineItem.get_invoice_summary(invoice_id=invoice_id)

        return render(
            request,
            "invoicing/invoice.html",
            context={
                "invoice": invoice,
                "line_items": line_items,
                "print_view": True,
                "amount_in_words": num2words(
                    invoice_summary["total_amount"], lang="en_IN"
                ).title(),
                **invoice_summary,
                **invoice.business.get_bank_details(),
            },
        )


class DownloadInvoicesView(View):
    """
    Downloads the invoices in csv format in a given range.
    """

    @staticmethod
    def get_date_range_string(start_date, end_date):
        start_date = datetime.strptime(start_date, "%Y-%m-%d")
        end_date = datetime.strptime(end_date, "%Y-%m-%d")

        start_date_str = datetime.strftime(start_date, "%B %Y")
        end_date_str = datetime.strftime(end_date, "%B %Y")

        if start_date_str == end_date_str:
            return start_date_str
        else:
            if start_date.year == end_date.year:
                return f"{start_date_str} to {datetime.strftime(end_date, '%B')}-{end_date.year}"
            else:
                return f"{start_date_str} to {end_date_str}"

    @classmethod
    def generate_report_for_business(
        cls, workbook, business, start_date, end_date, invoice_type
    ):

        business_name = business.name
        sheet = workbook.create_sheet(title=business_name)

        # Initialize overall totals for the business
        overall_outward_taxable = Decimal("0")
        overall_outward_cgst = Decimal("0")
        overall_outward_sgst = Decimal("0")
        overall_outward_igst = Decimal("0")
        overall_outward_total = Decimal("0")

        overall_inward_taxable = Decimal("0")
        overall_inward_cgst = Decimal("0")
        overall_inward_sgst = Decimal("0")
        overall_inward_igst = Decimal("0")
        overall_inward_total = Decimal("0")

        month_wise_split_date = split_dates(start_date, end_date)

        for month_start_date, month_end_date in month_wise_split_date:
            date_range_string = DownloadInvoicesView.get_date_range_string(
                month_start_date, month_end_date
            )

            # Get base data for the month
            base_line_item_data = LineItem.get_line_item_data_for_download(
                start_date=month_start_date, end_date=month_end_date, business=business
            )

            # Process Outward if requested ('outward' or 'both')
            if invoice_type in [INVOICE_TYPE_OUTWARD, "both"]:
                outwards_invoices = base_line_item_data.filter(
                    invoice__type_of_invoice=INVOICE_TYPE_OUTWARD
                )
                if outwards_invoices.exists():  # Only add section if there's data
                    (out_taxable, out_cgst, out_sgst, out_igst, out_total) = (
                        DownloadInvoicesView.add_invoice_data_to_sheet(
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
                inward_invoices = base_line_item_data.filter(
                    invoice__type_of_invoice=INVOICE_TYPE_INWARD
                )
                if inward_invoices.exists():  # Only add section if there's data
                    (in_taxable, in_cgst, in_sgst, in_igst, in_total) = (
                        DownloadInvoicesView.add_invoice_data_to_sheet(
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

    @staticmethod
    def add_invoice_data_to_sheet(
        business,
        business_name,
        date_range_string,
        invoices,
        sheet,
        supply_type,
    ):
        def create_row_with_spacing(data):
            return ([""] * 5) + [data]

        if not invoices:
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
        sheet.append(create_row_with_spacing(f"Month: {date_range_string}"))
        sheet.append(create_row_with_spacing(f"GSTIN: {business.gst_number}"))
        sheet.append([])

        sheet.append(DOWNLOAD_SHEET_FIELD_NAMES)

        for idx, outward in enumerate(invoices, start=1):
            sheet.append([idx] + list(outward))

            taxable_value, cgst, sgst, igst, invoice_value = outward[-5:]

            total_taxable_value += taxable_value
            total_cgst += cgst
            total_sgst += sgst
            total_igst += igst
            total_invoice_value += invoice_value

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

        sheet.append([])

        # Return the calculated totals for this section
        return (
            total_taxable_value,
            total_cgst,
            total_sgst,
            total_igst,
            total_invoice_value,
        )

    @classmethod
    def generate_csv_response(cls, start_date, end_date, invoice_type):
        # Generate Excel file and return HTTP response

        workbook = Workbook()
        # remove default sheet
        workbook.remove(workbook.active)

        for business in Business.objects.all():
            DownloadInvoicesView.generate_report_for_business(
                workbook, business, start_date, end_date, invoice_type
            )

        response = HttpResponse(
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
        response["Content-Disposition"] = (
            f'attachment; filename="invoices_{cls.get_date_range_string(start_date, end_date)}.xlsx"'
        )

        workbook.save(response)

        return response

    def post(self, request, *args, **kwargs):
        # Retrieve invoices queryset, generate CSV, and return HTTP response
        start_date = request.POST.get("start_invoice_date")
        end_date = request.POST.get("end_invoice_date")
        invoice_type = request.POST.get("invoice_type")

        return self.generate_csv_response(start_date, end_date, invoice_type)

    def get(self, request, *args, **kwargs):
        context = {
            "businesses": Business.objects.all(),
            "type_of_invoices": INVOICE_TYPE_CHOICES,
        }
        if not request.htmx:
            return render(request, "reports.html", context=context)

        business_id = request.GET.get("business")

        if business_id:
            context["customers"] = Customer.objects.filter(businesses__in=business_id)

        return render(request, "reports.html", context=context)


# Create views for Product
class ProductView(View):
    def get(self, request):
        product = (
            None
            if not request.GET.get("product_id")
            else Product.objects.get(id=int(request.GET.get("product_id")))
        )
        form = ProductForm(instance=product)
        return render(request, "partials/business_form.html", {"form": form})

    def post(self, request):
        form = ProductForm(request.POST)
        if form.is_valid():
            form.save()
            return redirect("product_list")
        return render(request, "partials/business_form.html", {"form": form})


class ProductListView(ListView):
    model = ProductForm
    template_name = "product_list.html"
    context_object_name = "businesses"
    paginate_by = PAGINATION_PAGE_SIZE

    def get_queryset(self):
        return Product.objects.all().order_by("id")

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context["title"] = "Products"
        return context

    def get(self, request, *args, **kwargs):
        if request.htmx and request.GET.get("page"):
            return render(
                request,
                "partials/business_data_list.html",
                context=self.get_context_data(object_list=self.get_queryset()),
            )
        return super().get(request, *args, *kwargs)


class ProductEditView(View):
    def get(self, request, product_id=None):
        product = None if not product_id else Product.objects.get(id=product_id)
        form = ProductForm(instance=product)
        return render(request, "partials/business_form.html", {"form": form})

    def post(self, request, product_id):
        product = None if not product_id else Product.objects.get(id=product_id)
        form = ProductForm(request.POST, instance=product)
        if form.is_valid():
            form.save()
            return redirect("product_list")
        return render(request, "partials/business_form.html", {"form": form})


class ProductDeleteView(DeleteView):
    model = Product
    success_url = reverse_lazy("product_list")
    template_name = "product_list.html"


class CustomerSearchView(View):
    def get(self, request):
        search_term = request.GET.get("customer_name", "").strip()
        customers = []

        if search_term and len(search_term) >= 2:
            customers = Customer.objects.filter(
                name__icontains=search_term
            ).prefetch_related("businesses")[
                :10
            ]  # Limit to 10 results

        return render(
            request, "partials/customer_search_results.html", {"customers": customers}
        )


class LineItemDeleteView(DeleteView):
    model = LineItem

    def delete(self, request, *args, **kwargs):
        self.object = self.get_object()
        self.object.delete()
        return HttpResponse(status=200)

    def get(self, request, *args, **kwargs):
        return self.delete(request, *args, **kwargs)
