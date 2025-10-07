from decimal import Decimal

BILLING_DECIMAL_PLACE_PRECISION = 3
GST_TAX_RATE = Decimal("0.03")
HSN_CODE = 711319

# Unit support: base/default unit is gram (gm). Add more units here as needed.
UNIT_GM = "gm"
UNIT_KG = "kg"
UNIT_PCS = "pcs"

UNIT_CHOICES = (
    (UNIT_GM, "Gram (g)"),
    (UNIT_KG, "Kilogram (kg)"),
    (UNIT_PCS, "Units (pcs)"),
)

# Human-friendly suffixes used in CSV/export/display.
UNIT_LABEL = {
    UNIT_GM: " gm",
    UNIT_KG: " kg",
    UNIT_PCS: " pcs",
}

UNIT_RATE_LABEL = {
    UNIT_GM: " / g",
    UNIT_KG: " / kg",
    UNIT_PCS: " / pc",
}

# Conversion factors to grams (useful later if we need to normalize quantities).
UNIT_TO_GRAM = {
    UNIT_GM: Decimal("1"),
    UNIT_KG: Decimal("1000"),
    UNIT_PCS: Decimal("1"),
}

PAGINATION_PAGE_SIZE = 15

INVOICE_TYPE_INWARD = "inward"
INVOICE_TYPE_OUTWARD = "outward"

INVOICE_TYPE_CHOICES = (
    (INVOICE_TYPE_OUTWARD, "Outward"),
    (INVOICE_TYPE_INWARD, "Inward"),
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

# GST CODE for all the states in India with their respective state codes
GST_CODE = {
    "01": "JAMMU AND KASHMIR",
    "02": "HIMACHAL PRADESH",
    "03": "PUNJAB",
    "04": "CHANDIGARH",
    "05": "UTTARAKHAND",
    "06": "HARYANA",
    "07": "DELHI",
    "08": "RAJASTHAN",
    "09": "UTTAR PRADESH",
    "10": "BIHAR",
    "11": "SIKKIM",
    "12": "ARUNACHAL PRADESH",
    "13": "NAGALAND",
    "14": "MANIPUR",
    "15": "MIZORAM",
    "16": "TRIPURA",
    "17": "MEGHALAYA",
    "18": "ASSAM",
    "19": "WEST BENGAL",
    "20": "JHARKHAND",
    "21": "ODISHA",
    "22": "CHHATTISGARH",
    "23": "MADHYA PRADESH",
    "24": "GUJARAT",
    "25": "DAMAN AND DIU",
    "26": "DADRA AND NAGAR HAVELI",
    "27": "MAHARASHTRA",
    "29": "KARNATAKA",
    "30": "GOA",
    "31": "LAKSHADWEEP",
    "32": "KERALA",
    "33": "TAMIL NADU",
    "34": "PUDUCHERRY",
    "35": "ANDAMAN AND NICOBAR ISLANDS",
    "36": "TELANGANA",
    "37": "ANDHRA PRADESH",
    "38": "LADAKH",
    "97": "OTHER TERRITORY",
    "99": "CENTRE JURISDICTION",
}

STATE_CHOICES = [(state, state) for state in GST_CODE.values()]
