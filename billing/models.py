from decimal import Decimal

from django.db import models
from django.db.models import Sum, Count, F

from billing.constants import BILLING_DECIMAL_PLACE_PRECISION, GST_TAX_RATE, HSN_CODE


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
    landline_number = models.CharField(
        max_length=255,
        verbose_name="Landline Number",
        help_text="Landline Number of the business.",
        blank=True,
        null=True,
    )

    class Meta:
        verbose_name = "Business"
        verbose_name_plural = "Businesses"

    def __str__(self):
        return self.name


class Customer(AbstractBaseModel):
    name = models.CharField(
        max_length=255, verbose_name="Customer Name", help_text="Name of the customer"
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

    def __str__(self):
        return f"{self.invoice_number}_{self.customer.name}"

    def save(self, *args, **kwargs):
        self.total_amount = sum(
            LineItem.objects.filter(invoice=self).values_list("amount", flat=True)
        )
        super().save(*args, **kwargs)


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
    )
    sgst = models.DecimalField(
        max_digits=10,
        decimal_places=BILLING_DECIMAL_PLACE_PRECISION,
        verbose_name="SGST",
        help_text="SGST of the product.",
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
    def create_line_item_for_invoice(cls, product_name, quantity, rate, invoice_id):
        quantity, rate = Decimal(str(quantity)), Decimal(str(rate))
        line_item = LineItem(
            product_name=product_name,
            quantity=quantity,
            rate=rate,
            invoice_id=invoice_id,
            hsn_code=HSN_CODE,
            customer_id=1,
        )

        net_amount = quantity * rate

        tax_amount = net_amount * GST_TAX_RATE
        line_item.sgst = tax_amount / 2
        line_item.cgst = tax_amount / 2
        line_item.amount = line_item.sgst + line_item.cgst + net_amount
        line_item.save()

        return line_item

    @classmethod
    def get_invoice_summary(cls, invoice_id):
        return cls.objects.filter(invoice_id=invoice_id).aggregate(
            total_amount=Sum("amount"),
            total_cgst_tax=Sum("cgst"),
            total_sgst_tax=Sum("sgst"),
            total_items=Count("id"),
            total_tax=Sum(F("cgst") + F("sgst")),
            amount_without_tax=Sum(F("quantity") * F("rate")),
        )
