import csv
import io
from datetime import datetime, timedelta
from decimal import Decimal

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


def process_invoice_csv(
    file_content: bytes, business_id: int
) -> dict[str, int | list[str]]:
    """
    Process a CSV file containing invoice data and create invoices and line items.

    Expected CSV format:
    invoice_number,invoice_date,customer_name,product_name,quantity,rate,hsn_code,gst_tax_rate

    Returns a dictionary with counts of created invoices and any errors encountered.
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

    # Parse CSV file
    try:
        csv_file = io.StringIO(file_content.decode("utf-8"))
        reader = csv.DictReader(csv_file)

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
        if not all(field in reader.fieldnames for field in required_fields):
            missing_fields = [
                field for field in required_fields if field not in reader.fieldnames
            ]
            raise CSVImportError(
                f"Missing required fields in CSV: {', '.join(missing_fields)}"
            )

        # Group rows by invoice number to handle multiple line items per invoice
        invoice_data = {}
        for row in reader:
            invoice_number = row["invoice_number"]
            if invoice_number not in invoice_data:
                invoice_data[invoice_number] = {
                    "invoice_info": {
                        "invoice_number": invoice_number,
                        "invoice_date": row["invoice_date"],
                        "customer_name": row["customer_name"],
                    },
                    "line_items": [],
                }

            # Add line item data
            line_item = {
                "product_name": row["product_name"],
                "quantity": row["quantity"],
                "rate": row["rate"],
                "hsn_code": row.get("hsn_code", None),  # Optional field
                "gst_tax_rate": row.get("gst_tax_rate", None),  # Optional field
            }
            invoice_data[invoice_number]["line_items"].append(line_item)

        # Check for duplicate invoice numbers from Invoice model
        existing_invoice_numbers = set(
            Invoice.objects.filter(business=business)
            .filter(invoice_number__in=invoice_data.keys())
            .values_list("invoice_number", flat=True)
        )

        if existing_invoice_numbers:
            result["errors"].append(
                f"Duplicate invoice numbers found: {', '.join(existing_invoice_numbers)}"
            )

        # Remove duplicate invoice numbers from invoice_data
        invoice_data = {
            k: v for k, v in invoice_data.items() if k not in existing_invoice_numbers
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

                # Get or create customer
                customer_name = invoice_info["customer_name"]
                customer, created = Customer.objects.get_or_create(
                    name=customer_name, defaults={"name": customer_name}
                )

                # Add business to customer if not already associated
                if business not in customer.businesses.all():
                    customer.businesses.add(business)

                # Create invoice
                invoice = Invoice.objects.create(
                    business=business,
                    customer=customer,
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
