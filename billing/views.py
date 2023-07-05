from datetime import datetime

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
    GST_TAX_RATE,
    INVOICE_TYPE_CHOICES,
    INVOICE_TYPE_INWARD,
    INVOICE_TYPE_OUTWARD,
    PAGINATION_PAGE_SIZE,
)
from billing.forms import BusinessForm, CustomerForm
from billing.models import Business, Customer, Invoice, LineItem


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
        return Customer.objects.all().order_by("id")

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context["title"] = "Customers"
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
        context = {
            "object": Customer.objects.get(id=customer_id),
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
        context = {
            "object": Business.objects.get(id=business_id),
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

    def get_queryset(self):
        business_id = self.request.GET.get("business_id")
        start_date = self.request.GET.get("start_date")
        end_date = self.request.GET.get("end_date")
        type_of_invoice = self.request.GET.get("type_of_invoice")

        filter_kwargs = {}

        if business_id:
            filter_kwargs["business_id"] = business_id

        if start_date:
            start_date = datetime.strptime(start_date, "%Y-%m-%d")
            filter_kwargs["invoice_date__gte"] = start_date

        if end_date:
            end_date = datetime.strptime(end_date, "%Y-%m-%d")
            filter_kwargs["invoice_date__lte"] = end_date

        if type_of_invoice:
            filter_kwargs["type_of_invoice"] = type_of_invoice

        return Invoice.objects.filter(**filter_kwargs).order_by("id")

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
        context["businesses"] = Business.objects.all()
        context["invoice_types_list"] = INVOICE_TYPE_CHOICES
        context["type_of_invoice_selected"] = self.request.GET.get("type_of_invoice")
        return context

    def get(self, request, *args, **kwargs):
        if request.htmx and request.GET.get("page"):
            return render(
                request,
                "partials/invoice_data_list.html",
                context=self.get_context_data(object_list=self.get_queryset()),
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
                "gst_tax_rate": GST_TAX_RATE * 100,
            },
        )

    def post(self, request):
        data = request.POST
        invoice_id, product_name, qty, rate, gst_tax_rate = (
            data["invoice_id"],
            data["item_name"],
            data["qty"],
            data["rate"],
            data["gst_tax_rate"],
        )
        line_item = LineItem.create_line_item_for_invoice(
            invoice_id=invoice_id,
            product_name=product_name,
            rate=rate,
            quantity=qty,
            gst_tax_rate=gst_tax_rate,
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
        tax_rate = f"{GST_TAX_RATE * 100} %"

        invoice_summary = LineItem.get_invoice_summary(invoice_id=invoice_id)

        return render(
            request,
            "invoicing/invoice.html",
            context={
                "invoice": invoice,
                "line_items": line_items,
                "tax_rate": tax_rate,
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

    @staticmethod
    def generate_report_for_business(workbook, business, start_date, end_date):
        def create_row_with_spacing(data):
            return ([""] * 5) + [data]

        date_range_string = DownloadInvoicesView.get_date_range_string(
            start_date, end_date
        )
        business_name = business.name

        line_item_data = LineItem.get_line_item_data_for_download(
            start_date=start_date, end_date=end_date, business=business
        )

        sheet = workbook.create_sheet(title=business_name)

        outwards_invoices = line_item_data.filter(
            invoice__type_of_invoice=INVOICE_TYPE_OUTWARD
        )

        if outwards_invoices:

            sheet.append(create_row_with_spacing(business_name))
            sheet.append(create_row_with_spacing("Outward Supply"))
            sheet.append(create_row_with_spacing(f"Month: {date_range_string}"))
            sheet.append(create_row_with_spacing(f"GSTIN: {business.gst_number}"))
            sheet.append([])

            sheet.append(DOWNLOAD_SHEET_FIELD_NAMES)

            for idx, outward in enumerate(outwards_invoices, start=1):
                sheet.append([idx] + list(outward))

            sheet.append([])

        inward_invoices = line_item_data.filter(
            invoice__type_of_invoice=INVOICE_TYPE_INWARD
        )

        if inward_invoices:
            sheet.append(create_row_with_spacing(business_name))
            sheet.append(create_row_with_spacing("Inward Supply"))
            sheet.append(create_row_with_spacing(f"Month: {date_range_string}"))
            sheet.append(create_row_with_spacing(f"GSTIN: {business.gst_number}"))

            sheet.append([])

            sheet.append(DOWNLOAD_SHEET_FIELD_NAMES)

            for idx, inward in enumerate(inward_invoices, start=1):
                sheet.append([idx] + list(inward))

            sheet.append([])

    @classmethod
    def generate_csv_response(cls, start_date, end_date):
        # Generate Excel file and return HTTP response

        workbook = Workbook()
        # remove default sheet
        workbook.remove(workbook.active)

        for business in Business.objects.all():
            DownloadInvoicesView.generate_report_for_business(
                workbook, business, start_date, end_date
            )

        response = HttpResponse(
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
        response[
            "Content-Disposition"
        ] = f'attachment; filename="invoices_{cls.get_date_range_string(start_date, end_date)}.xlsx"'

        workbook.save(response)

        return response

    def post(self, request, *args, **kwargs):
        # Retrieve invoices queryset, generate CSV, and return HTTP response
        start_date = request.POST.get("start_invoice_date")
        end_date = request.POST.get("end_invoice_date")

        return self.generate_csv_response(start_date, end_date)

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
