import io
from datetime import datetime, timedelta
from decimal import Decimal

import pandas as pd
from django.db import transaction

DATE_FORMAT_YEAR_MONTH_DATE = "%Y-%m-%d"


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
    """
    from billing.models import Business, Customer, Invoice, LineItem

    # Initialize result counters
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

        # Get all existing customers in a single query
        existing_customers = {}
        for customer in Customer.objects.filter(name__in=all_customer_names):
            existing_customers[customer.name] = customer

        # Check if any customers are missing
        missing_customers = all_customer_names - set(existing_customers.keys())
        if missing_customers:
            for customer_name in missing_customers:
                result["errors"].append(
                    f"Customer '{customer_name}' does not exist in the database. Related invoices will be skipped."
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
                )

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
                        result["errors"].append(
                            f"Error creating line item for invoice {invoice_number}: {e!s}"
                        )

                # Update invoice total amount
                invoice.save()  # This will recalculate the total_amount

    except Exception as e:
        if isinstance(e, CSVImportError):
            raise
        raise CSVImportError(f"Error processing CSV file: {e!s}")

    return result
