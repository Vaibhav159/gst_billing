import math
from decimal import Decimal

from django.db import models
from django.db.models import Sum, Count, F
from django.db.models.functions import Coalesce
from simple_history.models import HistoricalRecords

from billing.constants import (
    BILLING_DECIMAL_PLACE_PRECISION,
    GST_TAX_RATE,
    HSN_CODE,
    INVOICE_TYPE_CHOICES,
    INVOICE_TYPE_INWARD,
)


class AbstractBaseModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Business(AbstractBaseModel):
    name = models.CharField(
        max_length=255,
        unique=True,
        verbose_name="Business Name",
        help_text="Name of the business",
    )
    address = models.CharField(
        max_length=255,
        verbose_name="Business Address",
        help_text="Address of the business where it is located.",
    )
    gst_number = models.CharField(
        max_length=255,
        verbose_name="GST Number",
        help_text="GST Number of the business.",
    )
    mobile_number = models.CharField(
        max_length=255,
        verbose_name="Mobile Number",
        help_text="Mobile Number of the business.",
    )
    bank_name = models.CharField(
        max_length=255,
        verbose_name="Bank Name",
        help_text="Bank Name of the business.",
        blank=True,
        null=True,
    )
    bank_account_number = models.CharField(
        max_length=255,
        verbose_name="A/c. No.",
        help_text="Bank Account Number of the business.",
        blank=True,
        null=True,
    )
    bank_ifsc_code = models.CharField(
        max_length=255,
        verbose_name="IFSC Code",
        help_text="IFSC Code of the Bank Account.",
        blank=True,
        null=True,
    )
    bank_branch_name = models.CharField(
        max_length=255,
        verbose_name="Branch Name",
        help_text="Branch Name of the Bank Account.",
        blank=True,
        null=True,
    )

    class Meta:
        verbose_name = "Business"
        verbose_name_plural = "Businesses"

    def __str__(self):
        return self.name

    def get_bank_details(self):
        return {
            "bank_name": self.bank_name,
            "bank_account_number": self.bank_account_number,
            "bank_ifsc_code": self.bank_ifsc_code,
            "bank_branch_name": self.bank_branch_name,
        }


class Customer(AbstractBaseModel):
    name = models.CharField(
        max_length=255,
        verbose_name="Customer Name",
        help_text="Name of the customer",
        unique=True,
    )
    address = models.CharField(
        max_length=255,
        verbose_name="Customer Address",
        help_text="Address of the customer.",
        null=True,
        blank=True,
    )
    gst_number = models.CharField(
        max_length=255,
        verbose_name="GST Number",
        help_text="GST Number of the customer.",
        null=True,
        blank=True,
    )
    businesses = models.ManyToManyField(
        Business,
        verbose_name="Businesses",
        help_text="Businesses associated of the customer.",
    )
    pan_number = models.CharField(
        max_length=10,
        verbose_name="PAN Number",
        help_text="PAN Number of the customer.",
        blank=True,
        null=True,
    )
    mobile_number = models.CharField(
        max_length=12,
        verbose_name="Mobile Number",
        help_text="Mobile Number of the customer.",
        blank=True,
        null=True,
    )

    def __str__(self):
        return self.name


class Invoice(AbstractBaseModel):
    customer = models.ForeignKey(
        Customer,
        on_delete=models.CASCADE,
        verbose_name="Customer",
        help_text="Customer of the invoice.",
    )
    business = models.ForeignKey(
        Business,
        on_delete=models.CASCADE,
        verbose_name="Business",
        help_text="Business of the invoice.",
    )
    invoice_number = models.CharField(
        max_length=255,
        verbose_name="Invoice Number",
        help_text="Invoice Number of the invoice.",
    )
    total_amount = models.DecimalField(
        max_digits=12,
        decimal_places=BILLING_DECIMAL_PLACE_PRECISION,
        default=0,
        verbose_name="Total Amount",
        help_text="Total Amount of the invoice.",
    )
    invoice_date = models.DateField(help_text="Date at which invoice was raised.")
    type_of_invoice = models.CharField(
        max_length=255,
        verbose_name="Type of Invoice",
        help_text="Type of Invoice.",
        choices=INVOICE_TYPE_CHOICES,
        default=INVOICE_TYPE_INWARD,
    )

    history = HistoricalRecords()

    def __str__(self):
        return f"{self.invoice_number}_{self.customer.name}"

    def save(self, *args, **kwargs):
        self.total_amount = sum(
            LineItem.objects.filter(invoice=self).values_list("amount", flat=True)
        )
        super().save(*args, **kwargs)

    @property
    def is_igst_applicable(self):
        # check if customer and business are from same state using GSTIN
        return (
            self.customer.gst_number
            and self.customer.gst_number[0:2] != self.business.gst_number[0:2]
        )


class LineItem(AbstractBaseModel):
    customer = models.ForeignKey(
        Customer,
        on_delete=models.CASCADE,
        verbose_name="Customer",
        help_text="Customer of the line item.",
    )

    invoice = models.ForeignKey(
        Invoice,
        on_delete=models.CASCADE,
        verbose_name="Invoice",
        help_text="Invoice of the line item.",
    )

    product_name = models.CharField(
        max_length=255, verbose_name="Product Name", help_text="Name of the product."
    )
    hsn_code = models.CharField(
        max_length=255, verbose_name="HSN Code", help_text="HSN Code of the product."
    )
    gst_tax_rate = models.DecimalField(
        max_digits=12,
        decimal_places=BILLING_DECIMAL_PLACE_PRECISION,
        default=GST_TAX_RATE,
        verbose_name="GST Tax Rate",
        help_text="GST Tax Rate of the product.",
    )
    quantity = models.DecimalField(
        max_digits=10,
        decimal_places=BILLING_DECIMAL_PLACE_PRECISION,
        verbose_name="Quantity",
        help_text="Quantity of the product.",
    )
    rate = models.DecimalField(
        max_digits=12,
        decimal_places=BILLING_DECIMAL_PLACE_PRECISION,
        verbose_name="Rate",
        help_text="Rate of the product.",
    )
    cgst = models.DecimalField(
        max_digits=10,
        decimal_places=BILLING_DECIMAL_PLACE_PRECISION,
        verbose_name="CGST",
        help_text="CGST of the product.",
        default=0,
    )
    sgst = models.DecimalField(
        max_digits=10,
        decimal_places=BILLING_DECIMAL_PLACE_PRECISION,
        verbose_name="SGST",
        help_text="SGST of the product.",
        default=0,
    )
    igst = models.DecimalField(
        max_digits=10,
        decimal_places=BILLING_DECIMAL_PLACE_PRECISION,
        verbose_name="IGST",
        help_text="IGST of the product.",
        default=0,
    )
    amount = models.DecimalField(
        max_digits=12,
        decimal_places=BILLING_DECIMAL_PLACE_PRECISION,
        verbose_name="Amount",
        help_text="Amount of the product.",
    )

    def __str__(self):
        return self.product_name

    @property
    def amount_without_tax(self):
        return self.rate * self.quantity

    @classmethod
    def create_line_item_for_invoice(
        cls, product_name, quantity, rate, invoice_id, gst_tax_rate
    ):
        quantity, rate = Decimal(str(quantity)), Decimal(str(rate))
        gst_tax_rate_in_decimal = Decimal(str(gst_tax_rate)) / 100

        line_item = LineItem(
            product_name=product_name,
            quantity=quantity,
            rate=rate,
            invoice_id=invoice_id,
            hsn_code=HSN_CODE,
            customer_id=1,
            gst_tax_rate=gst_tax_rate_in_decimal,
        )

        net_amount = quantity * rate

        tax_amount = net_amount * gst_tax_rate_in_decimal

        invoice = Invoice.objects.get(id=invoice_id)

        if invoice.is_igst_applicable:
            line_item.igst = tax_amount
        else:
            line_item.cgst = tax_amount / 2
            line_item.sgst = tax_amount / 2

        line_item.amount = line_item.sgst + line_item.cgst + line_item.igst + net_amount
        line_item.save()

        return line_item

    @staticmethod
    def custom_round(num: Decimal):
        if num - int(num) < 0.5:
            return math.floor(num)
        else:
            return math.ceil(num)

    @classmethod
    def get_invoice_summary(cls, invoice_id):
        invoice_summary_data = cls.objects.filter(invoice_id=invoice_id).aggregate(
            total_amount=Coalesce(Sum("amount"), Decimal(0)),
            total_cgst_tax=Sum("cgst"),
            total_sgst_tax=Sum("sgst"),
            total_igst_tax=Sum("igst"),
            total_items=Count("id"),
            total_tax=Sum(F("cgst") + F("sgst") + F("igst")),
            amount_without_tax=Sum(F("quantity") * F("rate")),
        )

        invoice_summary_data["total_amount"] = cls.custom_round(
            invoice_summary_data["total_amount"]
        )

        return invoice_summary_data


#
#
# # Create a InvoiceExcelImport model to import the Excel file to Invoice model and LineItem model.
# class InvoiceExcelImport(AbstractBaseModel):
#     IMPORT_STATUS_CHOICES = (
#         ("PENDING", "Pending"),
#         ("IN_PROGRESS", "In Progress"),
#         ("COMPLETED", "Completed"),
#     )
#
#     import_excel_file = models.FileField(
#         upload_to="invoice_excel_imports",
#         verbose_name="Import Excel File",
#         help_text="Import Excel File.",
#     )
#     business = models.ForeignKey(
#         Business,
#         on_delete=models.CASCADE,
#         verbose_name="Business",
#         help_text="Business where import is happening.",
#     )
#
#     failed_excel_file = models.FileField(
#         upload_to="invoice_excel_imports",
#         verbose_name="Failed Excel File",
#         help_text="Failed Excel File.",
#         blank=True,
#         null=True,
#     )
#     status = models.CharField(
#         max_length=255,
#         verbose_name="Status",
#         help_text="Status of the import.",
#         choices=IMPORT_STATUS_CHOICES,
#         default=IMPORT_STATUS_CHOICES[0][0],
#     )
#
#     def __str__(self):
#         return f"{self.import_excel_file.name}"
#
#     def save(self, *args, **kwargs):
#         super().save(*args, **kwargs)
#
#         if self.status == "PENDING":
#             self.status = "IN_PROGRESS"
#             self.save()
#             self.import_invoice_excel_file()
#
#     def import_invoice_excel_file(self):
#         try:
#             # Read the Excel file.
#             wb = openpyxl.load_workbook(self.import_excel_file)
#             ws = wb.active
#
#             # Iterate over the rows of the Excel file.
#             for row in ws.iter_rows(min_row=2, values_only=True):
#                 # search for the customer in the database using the customer name or GSTIN.
#                 customer = Customer.objects.get(
#                     Q(name=row[3]) | Q(gstin=row[4])
#                 )
#
#                 # extract the values from the row
#                 invoice_number = row[1]
#                 invoice_date = row[2]
#
#                 # Create a Invoice object.
#                 invoice = Invoice.objects.create(
#                     invoice_number=invoice_number,
#                     invoice_date=invoice_date,
#                     customer_id=customer.id,
#                     business_id=self.business_id,
#                 )
#
#                 # single line item
#                 product_name = row[5]
#                 hsn_code = row[6]
#                 gst_tax_rate = row[7]
#                 quantity = row[8]  # in grams
#                 rate = row[9]  # per gram
#                 cgst = row[10]
#                 sgst = row[11]
#                 amount = row[12]
#
#                 # Create a LineItem object.
#                 LineItem.create_line_item_for_invoice(
#                     product_name=row[2],
#                     quantity=row[3],
#                     rate=row[4],
#                     invoice_id=invoice.id,
#                 )
#
#                 product_name, quantity, rate = row
#                 LineItem.create_line_item_for_invoice(
#                     product_name=product_name,
#                     quantity=quantity,
#                     rate=rate,
#                     invoice_id=invoice.id,
#                 )
#
#             # Update the status of the InvoiceExcelImport object.
#             self.status = "COMPLETED"
#             self.save()
#         except Exception as e:
#             # If any exception occurs, then update the status of the InvoiceExcelImport object.
#             self.status = "COMPLETED"
#             self.save()
#             raise e
