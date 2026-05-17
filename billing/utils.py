import base64
import io
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal

import pandas as pd
import requests
from django.conf import settings
from django.db import transaction
# google.genai was the previous AI backend. The AIInvoiceProcessor below
# now uses NVIDIA NIM (OpenAI-compatible REST) so we no longer need the
# Gemini SDK at runtime. The dependency stays in pyproject.toml for now
# in case we want to A/B test extractors later, but the import is gone
# to keep cold start fast and avoid a hard requirement.

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
    """AI-powered invoice extraction via NVIDIA NIM (Llama 4 Maverick).

    Why NIM over Gemini (previous backend):
      - The NIM catalog lets us swap models without changing code — set
        NVIDIA_VISION_MODEL in settings to try a different VLM.
      - One free-tier account gives access to Llama 4, Nemotron VL,
        Gemma 4, Phi-4 multimodal, etc. — useful for A/B-ing accuracy
        on edge-case invoices.
      - Probed empirically (May 2026): Llama 4 Maverick gave the
        cleanest JSON in JSON mode; Nemotron Nano 12B v2 VL hallucinated
        extra envelope fields (`error`, `code`, `headers`) even when
        asked for `{"ok": true}`. So Maverick is the default.

    Tradeoff vs Gemini: no native response_schema, so we lean on
    OpenAI-style `response_format: json_object` plus a defensive parser
    (markdown fence stripping, outermost-brace extraction).

    Image size: NIM's chat-completions endpoint has a ~180KB payload
    limit for direct base64 image data. We downscale + recompress before
    upload so a 5MB camera shot still works.
    """

    NIM_URL = "https://integrate.api.nvidia.com/v1/chat/completions"
    DEFAULT_MODEL = "meta/llama-4-maverick-17b-128e-instruct"
    # Target raw bytes before base64 encoding (b64 adds ~33%).
    # NIM rejects payloads > ~180KB; we leave a safety margin.
    MAX_IMAGE_BYTES = 130_000
    REQUEST_TIMEOUT = 90  # seconds — vision LLMs can take 30-60s

    def __init__(self):
        self.api_key = getattr(settings, "NVIDIA_API_KEY", "") or ""
        if not self.api_key:
            # The view catches this and 400s with a clear message so the
            # user sees "configure your key" instead of a 500.
            raise AIInvoiceProcessingError(
                "NVIDIA_API_KEY not configured. Add it to your .env "
                "(free key at https://build.nvidia.com)."
            )
        self.model = getattr(
            settings, "NVIDIA_VISION_MODEL", self.DEFAULT_MODEL
        )

    # ── public API ──────────────────────────────────────────────────

    def process_invoice_image(self, image_file, business_id: int) -> dict:
        """Send an invoice image to NIM and return the parsed dict."""
        from billing.models import Customer

        customer_names = list(
            Customer.objects.filter(businesses__id=business_id).values_list(
                "name", flat=True
            )
        )

        try:
            image_bytes = image_file.read()
        except Exception as e:
            raise AIInvoiceProcessingError(f"Could not read uploaded image: {e!s}")

        mime = getattr(image_file, "content_type", "") or "image/jpeg"
        # Downscale up-front so we never exhaust NIM's payload budget on
        # large camera shots. Re-encodes to JPEG so the mime is normalised.
        if len(image_bytes) > self.MAX_IMAGE_BYTES:
            image_bytes, mime = self._downscale(image_bytes, self.MAX_IMAGE_BYTES)

        image_b64 = base64.b64encode(image_bytes).decode("ascii")

        prompt = self._build_prompt(customer_names)
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime};base64,{image_b64}"},
                        },
                    ],
                }
            ],
            "temperature": 0.0,  # extraction, not creative writing
            "top_p": 0.8,
            "max_tokens": 4096,
            "response_format": {"type": "json_object"},
        }

        try:
            response = requests.post(
                self.NIM_URL,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=self.REQUEST_TIMEOUT,
            )
        except requests.Timeout:
            raise AIInvoiceProcessingError(
                f"NIM request timed out after {self.REQUEST_TIMEOUT}s. "
                "Try a smaller image or retry."
            )
        except requests.RequestException as e:
            raise AIInvoiceProcessingError(f"NIM request failed: {e!s}")

        if response.status_code != 200:
            # NIM error shapes vary: {"detail": "..."} | {"error": {...}}
            # | {"message": "..."}. Pass through whatever we got, truncated.
            body_preview = response.text[:300] if response.text else "(empty body)"
            raise AIInvoiceProcessingError(
                f"NIM returned HTTP {response.status_code}: {body_preview}"
            )

        try:
            body = response.json()
            content = body["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError) as e:
            raise AIInvoiceProcessingError(
                f"Unexpected NIM response shape ({e!s}): {response.text[:300]}"
            )

        extracted = self._parse_json_response(content)
        return self._convert_to_dict(extracted)

    # ── helpers ─────────────────────────────────────────────────────

    @staticmethod
    def _build_prompt(customer_names: list) -> str:
        """Single prompt with schema + rules. Kept terse — Maverick follows
        instructions well and a 1000-token prompt eats free-tier credits.
        """
        if customer_names:
            names_block = ", ".join(f'"{n}"' for n in customer_names)
        else:
            names_block = "(none yet — pick the name as written on invoice)"
        return f"""You extract structured data from Indian GST invoice images.

Return ONLY a JSON object with this exact shape:
{{
  "invoice_number": string,
  "invoice_date": "YYYY-MM-DD",
  "customer_name": string,
  "customer_address": string | null,
  "customer_gst_number": string | null,
  "customer_pan_number": string | null,
  "customer_mobile_number": string | null,
  "line_items": [
    {{
      "product_name": string,
      "quantity": number,
      "rate": number,
      "hsn_code": string | null,
      "gst_tax_rate": number,
      "amount": number
    }}
  ],
  "total_amount": number | null,
  "cgst_total": number | null,
  "sgst_total": number | null,
  "igst_total": number | null
}}

Rules:
1. Extract EVERY visible line item — do not summarise or skip.
2. Convert tax percentages to decimals: 3% → 0.03, 18% → 0.18.
3. Convert dates from DD/MM/YYYY (or DD-MM-YYYY) to YYYY-MM-DD.
4. Transliterate Devanagari/Hindi names to English Roman script
   (e.g. "अमरकान्त दार्शन मुस्काना" → "Amarakant Darshan Muskana").
5. `customer_name` must match one of the existing customers when a
   reasonable match exists (case-insensitive). Allowed names:
   {names_block}.
6. `amount` for each line is the tax-inclusive line subtotal as shown
   on the invoice. If only rate × quantity is given, compute it.
7. `total_amount` = sum(line_items.amount) + cgst_total + sgst_total
   + igst_total. Set null if unsure.
8. Use null for any field genuinely absent from the invoice — do not
   guess or fabricate values."""

    @staticmethod
    def _parse_json_response(content: str) -> dict:
        """Defensive JSON parsing — even with json_object mode the model
        occasionally wraps output in ```json fences or adds chatty prose.
        Strip fences, then grab the outermost {...} block.
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
    def _downscale(image_bytes: bytes, target_bytes: int) -> tuple:
        """Resize + recompress an image so its raw bytes fit `target_bytes`.

        Returns (bytes, mime). We always emit JPEG because NIM accepts it
        universally and it compresses photos well. Quality ramps down
        until we're under the target, then we accept whatever we have.
        """
        from PIL import Image  # lazy import — only loaded on AI path

        try:
            img = Image.open(io.BytesIO(image_bytes))
        except Exception as e:
            raise AIInvoiceProcessingError(
                f"Could not decode image for downscale: {e!s}"
            )
        if img.mode != "RGB":
            img = img.convert("RGB")
        # 1568px longest side is a good balance: small enough for the
        # payload limit, large enough that fine-print HSN codes stay
        # legible.
        max_dim = 1568
        if max(img.size) > max_dim:
            ratio = max_dim / max(img.size)
            img = img.resize(
                (int(img.width * ratio), int(img.height * ratio)),
                Image.Resampling.LANCZOS,
            )
        for quality in (85, 75, 65, 55, 45, 35):
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=quality, optimize=True)
            if buf.tell() <= target_bytes:
                return buf.getvalue(), "image/jpeg"
        # Last attempt's bytes — still over budget but better than crashing.
        # NIM may reject; the view bubbles the error to the user.
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
