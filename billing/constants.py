from decimal import Decimal

BILLING_DECIMAL_PLACE_PRECISION = 3
GST_TAX_RATE = Decimal("0.03")
HSN_CODE = 711319

PAGINATION_PAGE_SIZE = 15

INVOICE_TYPE_INWARD = "inward"
INVOICE_TYPE_OUTWARD = "outward"

INVOICE_TYPE_CHOICES = (
    (INVOICE_TYPE_INWARD, "Inward"),
    (INVOICE_TYPE_OUTWARD, "Outward"),
)

DOWNLOAD_SHEET_FIELD_NAMES = [
    "S.No.",
    "Bill No.",
    "Invoice Date",
    "Party Name",
    "GST Number",
    "Commodity",
    "HSN Code",
    "GST Rate",
    "Quantity",
    "Rate",
    "Taxable Value",
    "CGST",
    "SGST",
    "IGST",
    "Total Invoice Value",
]
