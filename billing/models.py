from django.db import models

from billing.constants import BILLING_DECIMAL_PLACE_PRECISION


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
    )
    gst_number = models.CharField(
        max_length=255,
        verbose_name="GST Number",
        help_text="GST Number of the customer.",
    )
    business = models.ForeignKey(
        Business,
        on_delete=models.CASCADE,
        verbose_name="Business",
        help_text="Business of the customer.",
    )
    pan_number = models.CharField(
        max_length=255,
        verbose_name="PAN Number",
        help_text="PAN Number of the customer.",
        blank=True,
        null=True,
    )
    mobile_number = models.CharField(
        max_length=255,
        verbose_name="Mobile Number",
        help_text="Mobile Number of the customer.",
        blank=True,
        null=True,
    )

    def __str__(self):
        return self.name


class LineItem(AbstractBaseModel):
    customer = models.ForeignKey(
        Customer,
        on_delete=models.CASCADE,
        verbose_name="Customer",
        help_text="Customer of the line item.",
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
    line_items = models.ManyToManyField(
        LineItem,
        blank=True,
        verbose_name="Line Items",
        help_text="Line Items of the invoice.",
    )
    total_amount = models.DecimalField(
        max_digits=12,
        decimal_places=BILLING_DECIMAL_PLACE_PRECISION,
        default=0,
        verbose_name="Total Amount",
        help_text="Total Amount of the invoice.",
    )

    def __str__(self):
        return f"{self.invoice_number}_{self.customer.name}"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        self.total_amount = sum([item.amount for item in self.line_items.all()])
        super().save(*args, **kwargs)
