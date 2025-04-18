import math
from datetime import datetime
from decimal import Decimal

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import CharField, Count, F, IntegerField, Sum, Value
from django.db.models.functions import (
    Cast,
    Coalesce,
    Concat,
    ExtractDay,
    ExtractMonth,
    ExtractYear,
)
from simple_history.models import HistoricalRecords

from billing.constants import (
    BILLING_DECIMAL_PLACE_PRECISION,
    GST_CODE,
    GST_TAX_RATE,
    HSN_CODE,
    INVOICE_TYPE_CHOICES,
    INVOICE_TYPE_OUTWARD,
    STATE_CHOICES,
)


class AbstractBaseModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


def get_state_code_from_state_name(state_name):
    # invert the GST_CODE dict
    if not state_name:
        return ""

    state_code = [k for k, v in GST_CODE.items() if v == state_name]

    return int(state_code[0]) if state_code else ""


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
    pan_number = models.CharField(
        max_length=10,
        verbose_name="PAN Number",
        help_text="PAN Number of the business.",
        blank=True,
        null=True,
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
    state_name = models.CharField(
        max_length=255,
        verbose_name="State Name",
        help_text="State Name of the business.",
        blank=True,
        null=True,
        choices=STATE_CHOICES,
    )
    primary_color_theme = models.CharField(
        default="#d04e00",
        verbose_name="Primary Color Theme",
        help_text="Primary Color Theme of the business.",
        max_length=15,
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

    @property
    def clean_state_name(self):
        return self.state_name.upper() if self.state_name else ""

    @property
    def state_code(self):
        return get_state_code_from_state_name(self.state_name)


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

    state_name = models.CharField(
        max_length=255,
        verbose_name="State Name",
        help_text="State Name of the business.",
        blank=True,
        null=True,
        choices=STATE_CHOICES,
    )

    def __str__(self):
        return self.name

    @property
    def clean_state_name(self):
        return self.state_name.upper() if self.state_name else ""

    @property
    def state_code(self):
        return get_state_code_from_state_name(self.state_name)


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
        default=INVOICE_TYPE_OUTWARD,
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

    @classmethod
    def get_next_invoice_number(cls, business_id):
        from datetime import datetime

        today = datetime.now().date()
        # Get financial year start date (April 1st)
        start_date = (
            datetime(today.year - 1, 4, 1).date()
            if today.month < 4
            else datetime(today.year, 4, 1).date()
        )

        last_invoice = (
            cls.objects.filter(
                business_id=business_id,
                invoice_date__gte=start_date,
                type_of_invoice=INVOICE_TYPE_OUTWARD,
            )
            .annotate(invoice_number_int=Cast("invoice_number", IntegerField()))
            .order_by("-invoice_number_int")
            .first()
        )

        if last_invoice:
            try:
                next_number = int(last_invoice.invoice_number) + 1
            except ValueError:
                # If invoice_number is not an integer, return 1
                next_number = 1
            return next_number
        return 1

    @classmethod
    def get_financial_years(cls):
        # Get the earliest invoice date or default to current year
        earliest_date = cls.objects.order_by("invoice_date").first()
        start_year = (
            earliest_date.invoice_date.year if earliest_date else datetime.now().year
        )

        current_year = datetime.now().year
        financial_years = []

        for year in range(start_year, current_year):
            fy = f"{year}-{str(year+1)[2:]}"  # Format: "2020-21"
            financial_years.append((fy, fy))

        return financial_years


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
    def gst_tax_in_percentage(self):
        return f"{int(self.gst_tax_rate * 100)}%"

    @property
    def amount_without_tax(self):
        return self.rate * self.quantity

    @classmethod
    def create_line_item_for_invoice(cls, product_name, quantity, rate, invoice_id):
        quantity, rate = Decimal(str(quantity)), Decimal(str(rate))
        # gst_tax_rate_in_decimal = Decimal(str(gst_tax_rate)) / 100

        product = Product.objects.filter(name=product_name).last()

        hsn_code = product.hsn_code if product else HSN_CODE
        gst_tax_rate_in_decimal = product.gst_tax_rate if product else GST_TAX_RATE

        line_item = LineItem(
            product_name=product_name,
            quantity=quantity,
            rate=rate,
            invoice_id=invoice_id,
            hsn_code=hsn_code,
            customer_id=Invoice.objects.get(id=invoice_id).customer_id,
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

    @staticmethod
    def custom_round_off(num: Decimal):
        rounding = num - int(num)

        if rounding < 0.5:
            return f"-{rounding}"
        else:
            return f"+{1 - rounding}"

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

        invoice_summary_data["round_off"] = cls.custom_round_off(
            invoice_summary_data["total_amount"]
        )

        invoice_summary_data["total_amount"] = cls.custom_round(
            invoice_summary_data["total_amount"]
        )

        return invoice_summary_data

    @classmethod
    def get_line_item_data_for_download(cls, start_date, end_date, business):

        # convert invoice date to 21/04/2021 format
        # quantity as 1.000 gm, rate as 1 / g

        line_item_data = (
            cls.objects.filter(
                invoice__invoice_date__range=[start_date, end_date],
                invoice__business=business,
            )
            .annotate(
                gst_tax=Concat(
                    F("gst_tax_rate") * 100, Value("%"), output_field=CharField()
                ),
                invoice_date=Concat(
                    ExtractDay("invoice__invoice_date"),
                    Value("/"),
                    ExtractMonth("invoice__invoice_date"),
                    Value("/"),
                    ExtractYear("invoice__invoice_date"),
                    output_field=CharField(),
                ),
                quantity_with_unit=Concat(
                    F("quantity"),
                    Value(" gm"),
                    output_field=CharField(),
                ),
                rate_with_unit=Concat(
                    F("rate"),
                    Value(" / g"),
                    output_field=CharField(),
                ),
                amount_before_tax=F("quantity") * F("rate"),
                # Include invoice type and ID to avoid additional queries
                invoice_type=F("invoice__type_of_invoice"),
                invoice_id_for_filter=F("invoice__id"),
            )
            .values_list(
                "invoice__invoice_number",
                "invoice_date",
                "customer__name",
                "customer__gst_number",
                "product_name",
                "hsn_code",
                "gst_tax",
                "quantity_with_unit",
                "rate_with_unit",
                "amount_before_tax",
                "cgst",
                "sgst",
                "igst",
                "amount",
                "invoice_type",  # Add invoice type to the result
                "invoice_id_for_filter",  # Add invoice ID to the result
            )
            .order_by("invoice__invoice_date", "invoice__invoice_number")
        )

        return line_item_data


class Product(AbstractBaseModel):
    name = models.CharField(
        max_length=255,
        verbose_name="Product Name",
        help_text="Name of the product",
        unique=True,
    )

    hsn_code = models.CharField(
        max_length=255,
        verbose_name="HSN Code",
        help_text="HSN Code of the product.",
        default=HSN_CODE,
    )

    gst_tax_rate = models.DecimalField(
        max_digits=12,
        decimal_places=BILLING_DECIMAL_PLACE_PRECISION,
        validators=[
            MinValueValidator(Decimal("0.00")),
            MaxValueValidator(Decimal("1.00")),
        ],
        default=GST_TAX_RATE,
        verbose_name="GST Tax Rate",
        help_text="GST Tax Rate of the product.",
    )
