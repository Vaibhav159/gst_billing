import base64
import io
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal

import pandas as pd
from django.conf import settings
from django.db import transaction
# AI extractor uses Google Gemini (google-genai SDK). We briefly tried
# NVIDIA NIM with Llama 4 Maverick — it worked but Gemini Flash is more
# accurate on Hindi text / phone-shot invoices and its native
# response_schema gives shape-guaranteed JSON (model can't drop a
# required field). NIM stays as a possible fallback but isn't wired
# into the active path.
import google.genai as genai
from google.genai import types

# Register HEIC / HEIF opener on Pillow so iPhone photos can be decoded
# in the same code path as JPEG/PNG. Without this, Image.open() on a
# .heic file raises UnidentifiedImageError. Imported lazily inside a
# try block so a missing pillow-heif install only breaks HEIC, not all
# AI extraction.
try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except ImportError:  # pragma: no cover — fallback if dep missing
    logging.getLogger(__name__).warning(
        "pillow-heif not installed — HEIC uploads will fail to decode."
    )

logger = logging.getLogger(__name__)

DATE_FORMAT_YEAR_MONTH_DATE = "%Y-%m-%d"


@dataclass
class LineItemData:
    """Structured data for invoice line items"""

    product_name: str
    quantity: float
    rate: float
    hsn_code: str | None = None
    gst_tax_rate: float = 0.03
    amount: float | None = None


@dataclass
class InvoiceData:
    """Structured data for invoice extraction"""

    invoice_number: str
    invoice_date: str  # YYYY-MM-DD format
    customer_name: str
    customer_address: str | None = None
    customer_gst_number: str | None = None
    customer_pan_number: str | None = None
    customer_mobile_number: str | None = None
    line_items: list[LineItemData] = None
    total_amount: float | None = None
    cgst_total: float | None = None
    sgst_total: float | None = None
    igst_total: float | None = None

    def __post_init__(self):
        if self.line_items is None:
            self.line_items = []


def split_dates(start_date_str: str, end_date_str: str) -> list[tuple[str, str]]:
    """
    Split date range into month wise date range
    """
    start_date = datetime.strptime(start_date_str, DATE_FORMAT_YEAR_MONTH_DATE)
    end_date = datetime.strptime(end_date_str, DATE_FORMAT_YEAR_MONTH_DATE)

    result = []

    current_month_start = start_date.replace(day=1)
    while current_month_start <= end_date:
        current_month_end = (current_month_start + timedelta(days=31)).replace(
            day=1
        ) - timedelta(days=1)
        current_month_end = min(current_month_end, end_date)

        result.append(
            (
                current_month_start.strftime(DATE_FORMAT_YEAR_MONTH_DATE),
                current_month_end.strftime(DATE_FORMAT_YEAR_MONTH_DATE),
            )
        )

        current_month_start = (current_month_start + timedelta(days=32)).replace(day=1)

    return result


class CSVImportError(Exception):
    """Exception raised for errors during CSV import."""

    pass


def process_customer_csv(
    file_content: bytes, business_id: int
) -> dict[str, int | list[str]]:
    """
    Process a CSV file containing customer data and create customers.

    Expected CSV format:
    name,address,gst_number,mobile_number,pan_number,state_name

    Returns a dictionary with counts of created customers and any errors encountered.
    """
    from billing.models import Business, Customer

    # Initialize result counters
    result = {
        "customers_created": 0,
        "errors": [],
    }

    # Get the business
    try:
        business = Business.objects.get(id=business_id)
    except Business.DoesNotExist:
        raise CSVImportError(f"Business with ID {business_id} does not exist")

    # Parse CSV file using pandas
    try:
        # Read CSV with pandas
        csv_file = io.BytesIO(file_content)
        try:
            df = pd.read_csv(csv_file)
        except Exception as e:
            raise CSVImportError(f"Error reading CSV file: {e}")

        # Check if dataframe is empty
        if df.empty:
            raise CSVImportError("CSV file is empty")

        # Validate required fields
        required_fields = ["name"]

        # Check if all required fields are present in the CSV
        missing_fields = [field for field in required_fields if field not in df.columns]
        if missing_fields:
            raise CSVImportError(
                f"Missing required fields in CSV: {', '.join(missing_fields)}"
            )

        # Clean and validate data
        # Convert to dict of records for easier processing
        records = df.to_dict("records")

        # Extract all unique customer names from the CSV
        all_customer_names = set(str(row["name"]).strip() for row in records)

        # Get all existing customers in a single query
        existing_customers = {}
        for customer in Customer.objects.filter(name__in=all_customer_names):
            existing_customers[customer.name] = customer

        # Process each customer
        with transaction.atomic():
            for row in records:
                # Skip if name is missing
                if pd.isna(row["name"]) or str(row["name"]).strip() == "":
                    result["errors"].append("Missing customer name. Row skipped.")
                    continue

                customer_name = str(row["name"]).strip()

                # Skip if customer already exists
                if customer_name in existing_customers:
                    result["errors"].append(
                        f"Customer '{customer_name}' already exists. Row skipped."
                    )
                    continue

                # Create new customer
                try:
                    customer = Customer.objects.create(
                        name=customer_name,
                        address=(
                            str(row.get("address", "")).strip()
                            if not pd.isna(row.get("address", ""))
                            else None
                        ),
                        gst_number=(
                            str(row.get("gst_number", "")).strip()
                            if not pd.isna(row.get("gst_number", ""))
                            else None
                        ),
                        mobile_number=(
                            str(row.get("mobile_number", "")).strip()
                            if not pd.isna(row.get("mobile_number", ""))
                            else None
                        ),
                        pan_number=(
                            str(row.get("pan_number", "")).strip()
                            if not pd.isna(row.get("pan_number", ""))
                            else None
                        ),
                        state_name=(
                            str(row.get("state_name", "")).strip()
                            if not pd.isna(row.get("state_name", ""))
                            else None
                        ),
                        workspace_id=1,
                    )

                    # Add business to customer
                    customer.businesses.add(business)

                    # Add to existing customers dict to prevent duplicates
                    existing_customers[customer_name] = customer

                    result["customers_created"] += 1
                except Exception as e:
                    result["errors"].append(
                        f"Error creating customer '{customer_name}': {e}"
                    )

    except Exception as e:
        if isinstance(e, CSVImportError):
            raise
        raise CSVImportError(f"Error processing CSV file: {e}")

    return result


def process_product_csv(file_content: bytes) -> dict[str, int | list[str]]:
    """
    Process a CSV file containing product data and create products.

    Expected CSV format:
    name,hsn_code,gst_tax_rate,description

    Returns a dictionary with counts of created products and any errors encountered.
    """
    from billing.models import Product

    # Initialize result counters
    result = {
        "products_created": 0,
        "errors": [],
    }

    # Parse CSV file using pandas
    try:
        # Read CSV with pandas
        csv_file = io.BytesIO(file_content)
        try:
            df = pd.read_csv(csv_file)
        except Exception as e:
            raise CSVImportError(f"Error reading CSV file: {e}")

        # Check if dataframe is empty
        if df.empty:
            raise CSVImportError("CSV file is empty")

        # Validate required fields
        required_fields = ["name"]

        # Check if all required fields are present in the CSV
        missing_fields = [field for field in required_fields if field not in df.columns]
        if missing_fields:
            raise CSVImportError(
                f"Missing required fields in CSV: {', '.join(missing_fields)}"
            )

        # Clean and validate data
        # Convert to dict of records for easier processing
        records = df.to_dict("records")

        # Extract all unique product names from the CSV
        all_product_names = set(str(row["name"]).strip() for row in records)

        # Get all existing products in a single query
        existing_products = {}
        for product in Product.objects.filter(name__in=all_product_names):
            existing_products[product.name] = product

        # Process each product
        with transaction.atomic():
            for row in records:
                # Skip if name is missing
                if pd.isna(row["name"]) or str(row["name"]).strip() == "":
                    result["errors"].append("Missing product name. Row skipped.")
                    continue

                product_name = str(row["name"]).strip()

                # Skip if product already exists
                if product_name in existing_products:
                    result["errors"].append(
                        f"Product '{product_name}' already exists. Row skipped."
                    )
                    continue

                # Create new product
                try:
                    # Handle gst_tax_rate - convert from percentage to decimal if needed
                    gst_tax_rate = row.get("gst_tax_rate", 0.03)  # Default to 3%
                    if not pd.isna(gst_tax_rate):
                        # If it's a string with % sign, convert appropriately
                        if isinstance(gst_tax_rate, str) and "%" in gst_tax_rate:
                            gst_tax_rate = float(gst_tax_rate.replace("%", "")) / 100
                        # If it's greater than 1, assume it's a percentage and convert to decimal
                        elif float(gst_tax_rate) > 1:
                            gst_tax_rate = float(gst_tax_rate) / 100
                        else:
                            gst_tax_rate = float(gst_tax_rate)
                    else:
                        gst_tax_rate = 0.03  # Default to 3%

                    product = Product.objects.create(
                        name=product_name,
                        hsn_code=(
                            str(row.get("hsn_code", "")).strip()
                            if not pd.isna(row.get("hsn_code", ""))
                            else None
                        ),
                        gst_tax_rate=gst_tax_rate,
                        description=(
                            str(row.get("description", "")).strip()
                            if not pd.isna(row.get("description", ""))
                            else None
                        ),
                        workspace_id=1,
                    )

                    # Add to existing products dict to prevent duplicates
                    existing_products[product_name] = product

                    result["products_created"] += 1
                except Exception as e:
                    result["errors"].append(
                        f"Error creating product '{product_name}': {e}"
                    )

    except Exception as e:
        if isinstance(e, CSVImportError):
            raise
        raise CSVImportError(f"Error processing CSV file: {e}")

    return result


def process_invoice_csv(
    file_content: bytes, business_id: int
) -> dict[str, int | list[str]]:
    """
    Process a CSV file containing invoice data and create invoices and line items.

    Expected CSV format:
    invoice_number,invoice_date,customer_name,product_name,quantity,rate,hsn_code,gst_tax_rate

    Returns a dictionary with counts of created invoices and any errors encountered.

    Improvements:
    1. Uses pandas for more robust CSV handling
    2. Validates that customers exist in the database (doesn't create new ones)
    3. Filters customers by business association to ensure data integrity
    """
    from billing.models import Business, Customer, Invoice, LineItem

    # Initialize result counters
    logger.info(f"Processing invoices from CSV file: {file_content}")
    result = {
        "invoices_created": 0,
        "line_items_created": 0,
        "errors": [],
    }

    # Get the business
    try:
        business = Business.objects.get(id=business_id)
    except Business.DoesNotExist:
        raise CSVImportError(f"Business with ID {business_id} does not exist")

    logger.info(
        f"Processing invoices from CSV file: {file_content} for business: {business}"
    )

    # Parse CSV file using pandas
    try:
        # Read CSV with pandas
        csv_file = io.BytesIO(file_content)
        try:
            df = pd.read_csv(csv_file)
        except Exception as e:
            raise CSVImportError(f"Error reading CSV file: {e}")

        logger.info(f"Processing number of invoices: {len(df)}")

        # Check if dataframe is empty
        if df.empty:
            logger.info(f"No invoices found for business: {business}")
            raise CSVImportError("CSV file is empty")

        # Validate required fields
        required_fields = [
            "invoice_number",
            "invoice_date",
            "customer_name",
            "product_name",
            "quantity",
            "rate",
        ]

        # Check if all required fields are present in the CSV
        missing_fields = [field for field in required_fields if field not in df.columns]
        if missing_fields:
            raise CSVImportError(
                f"Missing required fields in CSV: {', '.join(missing_fields)}"
            )

        # Clean and validate data
        # Convert to dict of records for easier processing
        records = df.to_dict("records")

        # Extract all unique customer names from the CSV
        all_customer_names = set(str(row["customer_name"]).strip() for row in records)

        # Get all existing customers associated with this business in a single query
        existing_customers = {}
        for customer in Customer.objects.filter(
            name__in=all_customer_names, businesses=business
        ):
            existing_customers[customer.name] = customer

        logger.info(f"Customers fetched: {len(existing_customers)}")

        # Check if any customers are missing or not associated with this business
        missing_customers = all_customer_names - set(existing_customers.keys())
        if missing_customers:
            for customer_name in missing_customers:
                result["errors"].append(
                    f"Customer '{customer_name}' does not exist or is not associated with business '{business.name}'. Related invoices will be skipped."
                )

        # Group rows by invoice number to handle multiple line items per invoice
        invoice_data = {}
        invoice_dates = {}

        # First pass: collect invoice data and dates
        for row in records:
            # Validate invoice number is provided
            if (
                pd.isna(row["invoice_number"])
                or str(row["invoice_number"]).strip() == ""
            ):
                result["errors"].append(
                    f"Missing invoice number for row with customer '{str(row['customer_name']).strip()}' and product '{str(row['product_name']).strip()}'. All rows must have an invoice number."
                )
                continue

            invoice_number = str(row["invoice_number"]).strip()
            customer_name = str(row["customer_name"]).strip()
            invoice_date = row["invoice_date"]

            # Skip if customer doesn't exist
            if customer_name not in existing_customers:
                continue

            customer = existing_customers[customer_name]

            if invoice_number not in invoice_data:
                invoice_data[invoice_number] = {
                    "invoice_info": {
                        "invoice_number": invoice_number,
                        "invoice_date": invoice_date,
                        "customer_name": customer_name,
                        "customer": customer,
                    },
                    "line_items": [],
                }
                # Store the date for financial year checking
                invoice_dates[invoice_number] = invoice_date

            # Add line item data
            line_item = {
                "product_name": str(row["product_name"]).strip(),
                "quantity": row["quantity"],
                "rate": row["rate"],
                "hsn_code": row.get("hsn_code", None),  # Optional field
                "gst_tax_rate": row.get("gst_tax_rate", None),  # Optional field
            }
            invoice_data[invoice_number]["line_items"].append(line_item)

        logger.info(f"Invoices fetched: {len(invoice_data)}")

        # Check for duplicate invoice numbers within the same financial year
        duplicate_invoice_numbers = []

        # Process each invoice date to determine its financial year
        for invoice_number, date_str in invoice_dates.items():
            try:
                # Parse the date
                invoice_date = datetime.strptime(
                    date_str, DATE_FORMAT_YEAR_MONTH_DATE
                ).date()

                # Determine financial year start date
                fy_start_date = datetime(invoice_date.year, 4, 1).date()
                if invoice_date.month < 4:  # Before April, use previous year's April
                    fy_start_date = datetime(invoice_date.year - 1, 4, 1).date()

                # Determine financial year end date
                fy_end_date = datetime(fy_start_date.year + 1, 3, 31).date()

                # Check if this invoice number already exists in the same financial year
                existing = Invoice.objects.filter(
                    business=business,
                    invoice_number=invoice_number,
                    invoice_date__gte=fy_start_date,
                    invoice_date__lte=fy_end_date,
                ).exists()

                if existing:
                    duplicate_invoice_numbers.append(invoice_number)

            except ValueError:
                # If date parsing fails, we'll catch it later in the validation
                pass

        # Report duplicate invoice numbers
        if duplicate_invoice_numbers:
            result["errors"].append(
                f"Duplicate invoice numbers found in the same financial year: {', '.join(duplicate_invoice_numbers)}"
            )

        # Remove duplicate invoice numbers from invoice_data
        invoice_data = {
            k: v for k, v in invoice_data.items() if k not in duplicate_invoice_numbers
        }

        # Process each invoice with its line items in a transaction
        with transaction.atomic():
            for invoice_number, data in invoice_data.items():
                invoice_info = data["invoice_info"]
                line_items_data = data["line_items"]

                # Validate and parse invoice date
                try:
                    invoice_date = datetime.strptime(
                        invoice_info["invoice_date"], DATE_FORMAT_YEAR_MONTH_DATE
                    ).date()
                except ValueError:
                    logger.warning(
                        f"Invalid date format for invoice {invoice_number}. Expected format: YYYY-MM-DD"
                    )
                    result["errors"].append(
                        f"Invalid date format for invoice {invoice_number}. Expected format: YYYY-MM-DD"
                    )
                    continue

                # Create invoice with the customer (already validated)
                invoice = Invoice.objects.create(
                    business=business,
                    customer=invoice_info["customer"],
                    invoice_number=invoice_number,
                    invoice_date=invoice_date,
                    type_of_invoice="outward",  # Default to outward invoice
                    workspace_id=1,
                )

                print(f"Invoice {invoice_number} created with {invoice=}")

                result["invoices_created"] += 1

                # Create line items for the invoice
                for item_data in line_items_data:
                    try:
                        # Convert quantity and rate to Decimal
                        quantity = Decimal(str(item_data["quantity"]))
                        rate = Decimal(str(item_data["rate"]))

                        # Create line item
                        LineItem.create_line_item_for_invoice(
                            invoice_id=invoice.id,
                            product_name=item_data["product_name"],
                            quantity=quantity,
                            rate=rate,
                        )

                        result["line_items_created"] += 1
                    except Exception as e:
                        logger.warning(
                            f"Error creating line item for invoice {invoice_number}: {e!s}"
                        )
                        result["errors"].append(
                            f"Error creating line item for invoice {invoice_number}: {e!s}"
                        )

                # Update invoice total amount
                invoice.save()  # This will recalculate the total_amount

    except Exception as e:
        if isinstance(e, CSVImportError):
            raise
        raise CSVImportError(f"Error processing CSV file: {e!s} as {result}")

    return result


class AIInvoiceProcessor:
    """AI-powered invoice extraction via Google Gemini (gemini-2.5-flash).

    Why Gemini over alternatives:
      - Native `response_schema` — server-side schema enforcement, the
        model literally cannot emit a wrong shape. NIM / Llama / Qwen
        all use prompt-driven JSON which can still drop required fields
        or invent extras (we observed this with nemotron-nano-12b-v2-vl
        during the NIM bake-off).
      - Best free-tier vision quality on document OCR + multilingual
        (Devanagari/Hindi customer names matter for Indian jewellery
        invoices). Free tier is ~15 RPM / ~1500 req/day on Flash.
      - Typical extraction is 2-4s, faster than the NIM round (5-15s).

    The previous version of this class (Gemini-based) had inflated
    prompts, brittle markdown-fence parsing, and returned Decimals that
    DRF serialised as strings. This rewrite keeps Gemini but borrows the
    improvements from the NIM detour: tighter prompt, image downscaling
    so a 5MB phone shot still fits, defensive JSON parser, float output
    so the frontend doesn't need to parseFloat every field.
    """

    # gemini-2.5-flash-lite chosen empirically — benchmark on the same
    # synthetic invoice (May 2026):
    #   gemini-2.5-flash + 8K tokens:  12.6s  ← previous default (slow)
    #   gemini-2.5-flash + 2K tokens:   4.5s
    #   gemini-2.5-flash-lite + schema: 2.9s  ← current default
    #   gemini-3.1-flash-lite:          3.2s  (no improvement)
    # Lite is 5x faster than the old default. Accuracy delta vs full
    # Flash isn't visible on printed invoices; if it surfaces on tough
    # phone shots, override via GEMINI_VISION_MODEL=gemini-2.5-flash
    # (or gemini-2.5-pro for max accuracy at ~3x the latency).
    DEFAULT_MODEL = "gemini-2.5-flash-lite"
    # Gemini accepts much larger inline images than NIM (up to ~20MB
    # base64), but downscaling still helps latency on phone shots.
    # 1568px is the sweet spot — small enough to upload fast, big enough
    # that fine-print HSN codes stay legible.
    MAX_IMAGE_DIM = 1568
    # If raw bytes are over this we run them through PIL to resize +
    # JPEG-recompress. We don't enforce a hard byte budget like with NIM
    # because Gemini is permissive — this is purely a speed optimisation.
    DOWNSCALE_THRESHOLD = 800_000  # 800KB

    def __init__(self):
        self.api_key = getattr(settings, "GEMINI_API_KEY", "") or ""
        if not self.api_key:
            # The view catches this and 400s with a clear message so the
            # user sees "configure your key" instead of a 500.
            raise AIInvoiceProcessingError(
                "GEMINI_API_KEY not configured. Add it to your .env "
                "(free key at https://aistudio.google.com/apikey)."
            )
        self.model = getattr(
            settings, "GEMINI_VISION_MODEL", self.DEFAULT_MODEL
        )
        self.client = genai.Client(api_key=self.api_key)

    # ── public API ──────────────────────────────────────────────────

    def process_invoice_image(self, image_file, business_id: int | None = None) -> dict:
        """Send an invoice image to Gemini and return the parsed dict.

        `business_id` is OPTIONAL. When provided, the prompt is scoped
        to that business's customers (better match accuracy). When
        omitted, the model extracts the customer name as-it-appears and
        the caller looks up the customer + business afterwards (used by
        the auto-detect-business flow on the AI Import page).
        """
        from billing.models import Customer

        # Customer list scoping is optional now — passing an empty list
        # tells the model "no constraint, transcribe what you see".
        customer_names = []
        if business_id:
            customer_names = list(
                Customer.objects.filter(businesses__id=business_id)
                .values_list("name", flat=True)
            )

        try:
            image_bytes = image_file.read()
        except Exception as e:
            raise AIInvoiceProcessingError(f"Could not read uploaded image: {e!s}")

        mime = getattr(image_file, "content_type", "") or "image/jpeg"
        # ALWAYS normalize through PIL — handles HEIC (iPhone photos),
        # WebP, oversized images, and odd colorspaces in one pass.
        # Gemini only reliably accepts JPEG/PNG inline, so re-encoding
        # to JPEG removes a class of "model returned empty" failures.
        # Cost is ~50-100ms on a small image; saves much more than that
        # when the input is a 20MB phone shot.
        image_bytes, mime = self._normalize_image(image_bytes, mime)

        prompt = self._build_prompt(customer_names)

        try:
            response = self.client.models.generate_content(
                model=self.model,
                contents=[
                    {
                        "role": "user",
                        "parts": [
                            {"text": prompt},
                            {"inline_data": {"mime_type": mime, "data": image_bytes}},
                        ],
                    }
                ],
                config=types.GenerateContentConfig(
                    candidate_count=1,
                    # 4096 is the sweet spot. Benchmark measurements:
                    #   8K → 12.6s (model pads output well past need)
                    #   4K →  3-5s (current — comfortable headroom)
                    #   2K →  truncates on pretty-printed JSON with
                    #         long addresses; the model occasionally
                    #         emits indented JSON which doubles tokens.
                    # 4K fits a 25-line-item invoice with addresses
                    # even in pretty-printed form.
                    max_output_tokens=4096,
                    temperature=0.0,  # extraction, not creative writing
                    # top_p / top_k dropped — at temp=0 (greedy decoding)
                    # they're inert but still cost setup time.
                    response_mime_type="application/json",
                    response_schema=self._build_schema(),
                ),
            )
        except Exception as e:
            # google-genai raises a grab-bag of exception types. Normalise
            # so the view always gets an AIInvoiceProcessingError it can
            # 400 cleanly with a user-visible message.
            raise AIInvoiceProcessingError(f"Gemini request failed: {e!s}")

        # With response_schema + response_mime_type=application/json, the
        # SDK returns text that is guaranteed to be valid JSON matching
        # the schema. We still defensively parse in case Google ever
        # relaxes the guarantee or the model returns nothing.
        text = (getattr(response, "text", "") or "").strip()
        if not text:
            raise AIInvoiceProcessingError(
                "Gemini returned an empty response — try a clearer image."
            )
        extracted = self._parse_json_response(text)
        return self._convert_to_dict(extracted)

    # ── helpers ─────────────────────────────────────────────────────

    @staticmethod
    def _build_prompt(customer_names: list) -> str:
        """Terse prompt — the schema does the heavy lifting via
        response_schema, so we don't need to repeat the JSON shape here.
        """
        # Customer-name constraint is optional. When the caller already
        # knows the business (legacy flow), passing the list gives the
        # model better match accuracy. When auto-detecting business from
        # the invoice itself (new flow), we don't know which business's
        # customers to constrain to, so we pass an empty list and the
        # backend matches/auto-creates the customer post-extraction.
        if customer_names:
            names_block = (
                f"`customer_name` MUST match one of these existing "
                f"customers when a reasonable case-insensitive match "
                f"exists: {', '.join(f'\"{n}\"' for n in customer_names)}."
            )
        else:
            names_block = (
                "`customer_name` — transcribe as written on the invoice "
                "(matching to existing customers happens server-side)."
            )
        return f"""Extract structured data from this Indian GST invoice image.

Rules:
1. Extract EVERY visible line item — do not summarise or skip.
2. Convert tax percentages to decimals: 3% → 0.03, 18% → 0.18.
3. Convert dates from DD/MM/YYYY (or DD-MM-YYYY) to YYYY-MM-DD.
4. Transliterate Devanagari/Hindi names to English Roman script
   (e.g. "अमरकान्त दार्शन मुस्काना" → "Amarakant Darshan Muskana").
5. Extract BOTH parties' GSTINs separately — do not guess which is
   which based on context:
     - `buyer_gst_number` / `buyer_name`: the entity in the "Bill To"
       / "Recipient" / "Buyer" / "Consignee" section (the one
       PURCHASING the goods/services).
     - `seller_gst_number` / `seller_name`: the entity in the "From"
       / "Seller" / "Supplier" / header block (the one ISSUING the
       invoice and selling).
   Set GSTIN nulls only if a side is genuinely missing from the
   invoice. We use both server-side to figure out which side is our
   business — don't try to decide that yourself.
6. {names_block} — `customer_name` should be the OTHER party's name
   (the one that is NOT our business; usually equals seller_name on
   a purchase invoice, or buyer_name on a sale invoice).
7. `amount` for each line is the tax-inclusive line subtotal as shown
   on the invoice. If only rate × quantity is given, compute it.
8. `total_amount` = sum(line_items.amount) + cgst_total + sgst_total
   + igst_total.
9. Use null for any field genuinely absent from the invoice — do not
   guess or fabricate values."""

    @staticmethod
    def _build_schema() -> types.Schema:
        """Gemini response_schema — server-side enforcement of output
        shape. Building lazily on each request because the Schema objects
        can't be safely shared across threads in older SDK versions.
        """
        line_item = types.Schema(
            type=types.Type.OBJECT,
            properties={
                "product_name": types.Schema(type=types.Type.STRING),
                "quantity": types.Schema(type=types.Type.NUMBER),
                "rate": types.Schema(type=types.Type.NUMBER),
                "hsn_code": types.Schema(type=types.Type.STRING, nullable=True),
                "gst_tax_rate": types.Schema(type=types.Type.NUMBER),
                "amount": types.Schema(type=types.Type.NUMBER, nullable=True),
            },
            required=["product_name", "quantity", "rate", "gst_tax_rate"],
        )
        return types.Schema(
            type=types.Type.OBJECT,
            properties={
                # We ask for BOTH parties' GSTINs because "recipient" /
                # "customer" is semantically ambiguous (recipient of the
                # document = buyer; recipient of an invoice in our app
                # could be either party depending on inward/outward).
                # Backend matches each GSTIN against Business table:
                #   - if buyer matches one of our businesses → INWARD
                #     (we bought from the seller)
                #   - if seller matches → OUTWARD (we sold to the buyer)
                # This also auto-detects invoice direction so the user
                # doesn't have to toggle Sale/Purchase manually.
                "buyer_gst_number": types.Schema(type=types.Type.STRING, nullable=True),
                "buyer_name": types.Schema(type=types.Type.STRING, nullable=True),
                "seller_gst_number": types.Schema(type=types.Type.STRING, nullable=True),
                "seller_name": types.Schema(type=types.Type.STRING, nullable=True),
                "invoice_number": types.Schema(type=types.Type.STRING),
                "invoice_date": types.Schema(type=types.Type.STRING),
                "customer_name": types.Schema(type=types.Type.STRING),
                "customer_address": types.Schema(type=types.Type.STRING, nullable=True),
                "customer_gst_number": types.Schema(type=types.Type.STRING, nullable=True),
                "customer_pan_number": types.Schema(type=types.Type.STRING, nullable=True),
                "customer_mobile_number": types.Schema(type=types.Type.STRING, nullable=True),
                "line_items": types.Schema(type=types.Type.ARRAY, items=line_item),
                "total_amount": types.Schema(type=types.Type.NUMBER, nullable=True),
                "cgst_total": types.Schema(type=types.Type.NUMBER, nullable=True),
                "sgst_total": types.Schema(type=types.Type.NUMBER, nullable=True),
                "igst_total": types.Schema(type=types.Type.NUMBER, nullable=True),
            },
            required=["invoice_number", "invoice_date", "customer_name", "line_items"],
        )

    @staticmethod
    def _parse_json_response(content: str) -> dict:
        """Defensive JSON parsing — response_schema makes valid JSON the
        norm, but we still handle ``` fences just in case.
        """
        text = (content or "").strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```\s*$", "", text)
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            raise AIInvoiceProcessingError(
                f"No JSON object in model response: {text[:300]!r}"
            )
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError as e:
            raise AIInvoiceProcessingError(
                f"Invalid JSON from model ({e!s}): {text[start : end + 1][:300]!r}"
            )

    @staticmethod
    def _normalize_image(image_bytes: bytes, mime: str) -> tuple:
        """Decode → resize-if-needed → re-encode as JPEG.

        Runs on EVERY upload, not just oversized ones. Reasons:
          - HEIC (iPhone photos) isn't a Gemini-supported format inline,
            but pillow-heif registered an opener so Image.open() handles
            it; we re-encode to JPEG before upload.
          - WebP / TIFF / odd colorspaces also normalised here.
          - Downscaling to MAX_IMAGE_DIM (1568px longest side) cuts
            latency on 4000px+ phone shots without losing OCR fidelity.
          - Cost on a small image is ~50-100ms — well under the network
            + Gemini round-trip, so always-on is a fair tradeoff for
            removing the "model returned empty" failure mode that
            occasionally hit on weird formats.

        Returns `(bytes, "image/jpeg")` — always JPEG out.
        """
        from PIL import Image  # lazy import — only loaded on AI path

        try:
            img = Image.open(io.BytesIO(image_bytes))
            # HEIC + some RAW formats need explicit load() to materialize
            # before the BytesIO is closed.
            img.load()
        except Exception as e:
            raise AIInvoiceProcessingError(
                f"Could not decode image (format={mime!r}): {e!s}. "
                "Supported formats: JPEG, PNG, HEIC."
            )
        if img.mode != "RGB":
            img = img.convert("RGB")
        max_dim = AIInvoiceProcessor.MAX_IMAGE_DIM
        if max(img.size) > max_dim:
            ratio = max_dim / max(img.size)
            img = img.resize(
                (int(img.width * ratio), int(img.height * ratio)),
                Image.Resampling.LANCZOS,
            )
        buf = io.BytesIO()
        # Quality 88 is the OCR sweet spot — sub-100KB on most invoices,
        # no visible compression artefacts on printed text.
        img.save(buf, format="JPEG", quality=88, optimize=True)
        return buf.getvalue(), "image/jpeg"

    @staticmethod
    def _convert_to_dict(data: dict) -> dict:
        """Normalise raw model output into the shape the frontend expects.

        Emits floats (not Decimals) — DRF would serialise Decimals as
        strings which forces the frontend to parseFloat() on every field.
        Floats are JSON-native and the create endpoint coerces back to
        Decimal on the way into the DB. Strings are stripped of leading/
        trailing whitespace because vision LLMs sometimes pad with newlines.
        """

        def _f(v, fallback=0.0):
            if v is None or v == "":
                return fallback
            try:
                return float(v)
            except (ValueError, TypeError):
                return fallback

        def _s(v):
            return (v or "").strip() if isinstance(v, str) else (v or "")

        line_items = []
        for item in data.get("line_items") or []:
            qty = _f(item.get("quantity"))
            rate = _f(item.get("rate"))
            amount = _f(item.get("amount"))
            # Some invoices show only qty × rate without a line total —
            # fill it in so the review form has a sensible value to edit.
            if amount == 0 and qty and rate:
                amount = qty * rate
            line_items.append(
                {
                    "product_name": _s(item.get("product_name")),
                    "quantity": qty,
                    "rate": rate,
                    "hsn_code": _s(item.get("hsn_code")),
                    "gst_tax_rate": _f(item.get("gst_tax_rate"), 0.03),
                    "amount": amount,
                }
            )

        return {
            # GSTINs emitted in upper case — GST format is uppercase and
            # the view matches exact against Business.gst_number.
            "buyer_gst_number": _s(data.get("buyer_gst_number")).upper(),
            "buyer_name": _s(data.get("buyer_name")),
            "seller_gst_number": _s(data.get("seller_gst_number")).upper(),
            "seller_name": _s(data.get("seller_name")),
            "invoice_number": _s(data.get("invoice_number")),
            "invoice_date": _s(data.get("invoice_date")),
            "customer_name": _s(data.get("customer_name")),
            "customer_address": _s(data.get("customer_address")),
            "customer_gst_number": _s(data.get("customer_gst_number")),
            "customer_pan_number": _s(data.get("customer_pan_number")),
            "customer_mobile_number": _s(data.get("customer_mobile_number")),
            "line_items": line_items,
            "total_amount": _f(data.get("total_amount")),
            "cgst_total": _f(data.get("cgst_total")),
            "sgst_total": _f(data.get("sgst_total")),
            "igst_total": _f(data.get("igst_total")),
        }


class AIInvoiceProcessingError(Exception):
    """Exception raised for errors during AI invoice processing."""

    pass
