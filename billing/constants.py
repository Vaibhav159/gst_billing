from decimal import Decimal

BILLING_DECIMAL_PLACE_PRECISION = 3
GST_TAX_RATE = Decimal("0.03")
HSN_CODE = 711319

# Units. LineItem.unit stays free-text so historical rows keep whatever they
# say; these choices constrain Product.default_unit and are the API's canon.
# The V2 UI keeps a mirror in sweet-rebuild-suite-main/src/utils/mockData.ts
# (itemUnits / itemUnitLabels) — change both together.
UNIT_GMS = "gms"
UNIT_CHOICES = (
    ("gms", "Grams (gms)"),
    ("g", "Grams (g)"),
    ("kg", "Kilograms (kg)"),
    ("pcs", "Pieces (pcs)"),
    ("unit", "Unit"),
    ("nos", "Numbers (nos)"),
    ("mtr", "Meters (mtr)"),
    ("ltr", "Litres (ltr)"),
    ("ml", "Millilitres (ml)"),
    ("box", "Box"),
    ("pair", "Pair"),
    ("ct", "Carat (ct)"),
    ("oz", "Ounce (oz)"),
    ("tola", "Tola"),
    ("set", "Set"),
    ("dozen", "Dozen"),
)
# Mass units only — a quantity in pcs/box/set has no gram equivalent, and
# mapping them to 1 (as the original units draft did) would silently corrupt
# any normalized weight report. ct is the metric carat; oz is the troy ounce
# and tola the standard Indian bullion tola, as used in the jewellery trade.
UNIT_TO_GRAM = {
    "gms": Decimal("1"),
    "g": Decimal("1"),
    "kg": Decimal("1000"),
    "ct": Decimal("0.2"),
    "oz": Decimal("31.1034768"),
    "tola": Decimal("11.6638038"),
}

PAGINATION_PAGE_SIZE = 15

# B2CL applies to interstate B2C invoices above this value. Was Rs 2.5 lakh
# until Notification 12/2024 dropped it to Rs 1 lakh with effect from
# 1 Nov 2024. Invoices between the two thresholds belong invoice-wise in
# B2CL, not aggregated into B2CS.
B2CL_THRESHOLD = 100000


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
