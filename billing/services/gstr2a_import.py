"""GSTR-2A `.xls`/`.xlsx` import service.

Used by both the `import_gstr2a` management command (one-off CLI imports)
and the GSTR-2A Import frontend page (ongoing user-driven imports).

Design notes:

* Only the `invoice` sheet is processed. The `note` sheet (credit/debit
  notes) is intentionally skipped — the user wanted these excluded
  because the existing app already tracks notes elsewhere via direct
  entry, and double-importing would mis-count ITC.

* Idempotency is enforced via the natural key
  `(business_id, customer_id, invoice_number, invoice_date)`. The same
  2A file can be re-imported safely — already-present invoices are
  reported as `skipped`, never duplicated.

* Suppliers are matched by GSTIN, never by name. Multi-state suppliers
  (e.g. SOLANKI JEWELLERS has both `08...` and `27...` GSTINs) are
  distinct Customer rows in the DB; matching by name would collapse
  them incorrectly. If no Customer exists for a GSTIN we auto-create
  one from the 2A row data — the GSTN portal is authoritative for
  supplier name/state, so this is safer than asking the user to
  hand-create every missing supplier first.

* Each 2A invoice becomes ONE Invoice with ONE synthetic LineItem
  carrying the totals (taxable value, IGST, CGST, SGST). The 2A
  doesn't expose per-line breakdown so we can't do better than this.
  `LineItem.amount` is the tax-inclusive total (matches the rest of
  the app — see InvoiceForm / AIInvoiceProcessor).
"""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Iterable

import pandas as pd
from django.db import transaction

from billing.constants import INVOICE_TYPE_INWARD
from billing.models import Business, Customer, Invoice, LineItem

logger = logging.getLogger(__name__)


# ── parsed-row dataclass ────────────────────────────────────────────────


@dataclass
class GSTR2ARow:
    """One row of the `invoice` sheet, normalised."""

    supplier_name: str
    supplier_gstin: str
    supplier_state: str  # the supplier's state (column "State")
    pos: str             # Place of Supply (where recipient is registered)
    invoice_number: str
    invoice_date: date
    invoice_value: Decimal   # tax-inclusive total from 2A
    taxable_value: Decimal   # pre-tax value
    igst: Decimal
    cgst: Decimal
    sgst: Decimal
    cess: Decimal
    filed_3b: bool           # "Filed" vs "Not Filed"
    reverse_charge: bool

    @property
    def total_tax(self) -> Decimal:
        return self.igst + self.cgst + self.sgst + self.cess

    @property
    def gst_tax_rate(self) -> Decimal:
        """Derive the effective GST rate as a decimal (e.g. 0.03 for 3%).

        Computed from total_tax / taxable_value. Falls back to 0 if
        taxable_value is zero (rare — exempt supplies).
        """
        if self.taxable_value > 0:
            return (self.total_tax / self.taxable_value).quantize(Decimal("0.0001"))
        return Decimal("0")


@dataclass
class FilePreview:
    """Per-file summary returned by `preview_file`."""

    filename: str
    recipient_header: str          # the row-0 string with recipient name + GSTIN
    recipient_gstin: str           # extracted from the header
    matched_business_id: int | None
    matched_business_name: str
    parsed_rows: list[GSTR2ARow]
    parse_errors: list[str] = field(default_factory=list)


@dataclass
class ImportResult:
    """Per-file outcome returned by `import_file`."""

    filename: str
    created_invoices: int = 0
    created_line_items: int = 0
    created_suppliers: int = 0
    skipped_duplicates: int = 0
    skipped_no_business: int = 0
    errors: list[str] = field(default_factory=list)
    # Detail lists for the CLI/UI to render
    created_detail: list[str] = field(default_factory=list)
    skipped_detail: list[str] = field(default_factory=list)
    not_filed_warnings: list[str] = field(default_factory=list)


# ── parsing ────────────────────────────────────────────────────────────


def _to_decimal(v) -> Decimal:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return Decimal("0")
    try:
        return Decimal(str(v))
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _to_date(v) -> date | None:
    """Coerce 2A's date cell to a date.

    2A files use DD/MM/YYYY strings (sometimes DD-MM-YYYY) regardless of
    Excel's locale because the GSTN portal emits them as text. pandas
    sometimes still parses them as datetime objects when the cell type
    is set, so we handle both.
    """
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = str(v).strip()
    if not s:
        return None
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _extract_recipient_gstin(header_row_0: str) -> str:
    """Pull the 15-char GSTIN out of strings like `ANIL KUMAR LODHA (08AAGPL3375F1ZO)`."""
    import re

    m = re.search(r"\b([0-9]{2}[A-Z0-9]{13})\b", header_row_0 or "")
    return m.group(1) if m else ""


def preview_file(file_path_or_buffer, filename: str | None = None) -> FilePreview:
    """Parse one 2A file into a structured preview without touching the DB.

    `file_path_or_buffer` can be a path string or a file-like object
    (the API endpoint will pass an `InMemoryUploadedFile`).
    """
    fname = filename or (file_path_or_buffer if isinstance(file_path_or_buffer, str) else "(uploaded)")
    parse_errors: list[str] = []

    try:
        xl = pd.ExcelFile(file_path_or_buffer)
    except Exception as e:
        return FilePreview(
            filename=fname, recipient_header="", recipient_gstin="",
            matched_business_id=None, matched_business_name="",
            parsed_rows=[],
            parse_errors=[f"Could not open file: {e!s}"],
        )

    if "invoice" not in xl.sheet_names:
        return FilePreview(
            filename=fname, recipient_header="", recipient_gstin="",
            matched_business_id=None, matched_business_name="",
            parsed_rows=[],
            parse_errors=[f"Missing 'invoice' sheet. Found: {xl.sheet_names}"],
        )

    df_raw = xl.parse("invoice", header=None)
    if df_raw.shape[0] < 4:
        return FilePreview(
            filename=fname, recipient_header="", recipient_gstin="",
            matched_business_id=None, matched_business_name="",
            parsed_rows=[],
            parse_errors=["File has no data rows."],
        )

    header_row_0 = " ".join(
        str(x) for x in df_raw.iloc[0].dropna().tolist() if str(x).strip()
    )
    recipient_gstin = _extract_recipient_gstin(header_row_0)

    # Row 2 is the column headers; data starts row 3.
    headers = [str(x).strip() for x in df_raw.iloc[2].tolist()]
    df = df_raw.iloc[3:].copy()
    df.columns = headers
    df = df[df.get("Supplier Name").notna()].reset_index(drop=True)

    matched_biz = None
    if recipient_gstin:
        matched_biz = Business.objects.filter(gst_number=recipient_gstin).first()

    rows: list[GSTR2ARow] = []
    for idx, r in df.iterrows():
        try:
            inv_date = _to_date(r.get("Invoice Date"))
            if not inv_date:
                parse_errors.append(
                    f"Row {idx + 4}: unparseable invoice date {r.get('Invoice Date')!r}"
                )
                continue
            rows.append(GSTR2ARow(
                supplier_name=str(r.get("Supplier Name", "")).strip(),
                supplier_gstin=str(r.get("GSTIN", "")).strip().upper(),
                supplier_state=str(r.get("State", "")).strip().upper(),
                pos=str(r.get("POS", "")).strip().upper(),
                invoice_number=str(r.get("Invoice No", "")).strip(),
                invoice_date=inv_date,
                invoice_value=_to_decimal(r.get("Invoice Value")),
                taxable_value=_to_decimal(r.get("Taxable Value")),
                igst=_to_decimal(r.get("IGST")),
                cgst=_to_decimal(r.get("CGST")),
                sgst=_to_decimal(r.get("SGST")),
                cess=_to_decimal(r.get("CESS")),
                filed_3b=str(r.get("3B Status", "")).strip().lower() == "filed",
                reverse_charge=str(r.get("RC", "")).strip().upper() in ("YES", "Y", "TRUE"),
            ))
        except Exception as e:
            parse_errors.append(f"Row {idx + 4}: {e!s}")

    return FilePreview(
        filename=fname,
        recipient_header=header_row_0,
        recipient_gstin=recipient_gstin,
        matched_business_id=matched_biz.id if matched_biz else None,
        matched_business_name=matched_biz.name if matched_biz else "",
        parsed_rows=rows,
        parse_errors=parse_errors,
    )


# ── import ─────────────────────────────────────────────────────────────


def _find_or_create_supplier(row: GSTR2ARow, dry_run: bool) -> tuple[Customer | None, bool]:
    """Return `(customer, was_created)` matching the row's GSTIN.

    GSTIN is the source of truth — name matching is unreliable for
    multi-state suppliers (SKYMART INDIA has 06/08/24 state GSTINs,
    each a distinct GST registration). But `Customer.name` has a
    UNIQUE constraint at the DB level, so when the same supplier name
    appears with a second GSTIN we have to disambiguate the name to
    create a second Customer row.

    Disambiguation strategy when name is taken by a different GSTIN:
      1. `NAME (STATE)`           e.g. "SKYMART INDIA (RAJASTHAN)"
      2. If still taken (rare): `NAME · GSTIN` (always unique)
    """
    if not row.supplier_gstin:
        return None, False
    existing = Customer.objects.filter(gst_number=row.supplier_gstin).first()
    if existing:
        return existing, False
    if dry_run:
        # Don't actually create on dry-run, but tell the caller we would have.
        # Returning None signals "would create" so the import counter is honest.
        return None, True

    base_name = (row.supplier_name or row.supplier_gstin)[:255]
    final_name = base_name
    if Customer.objects.filter(name=final_name).exists():
        # First try state suffix — human-readable.
        state = (row.supplier_state or "").strip()
        if state:
            candidate = f"{base_name} ({state})"[:255]
            if not Customer.objects.filter(name=candidate).exists():
                final_name = candidate
        # Fall back to GSTIN suffix — guaranteed unique.
        if final_name == base_name or Customer.objects.filter(name=final_name).exists():
            final_name = f"{base_name[:230]} · {row.supplier_gstin}"[:255]

    cust = Customer.objects.create(
        name=final_name,
        gst_number=row.supplier_gstin,
        state_name=row.supplier_state[:255] if row.supplier_state else "",
    )
    return cust, True


def _invoice_exists(business_id: int, customer_id: int, inv_no: str, inv_date: date) -> bool:
    """Dedup probe. Idempotency relies on this — be conservative.

    Match is exact on (business, customer, invoice_number, invoice_date).
    `invoice_number` is compared case-insensitively because GSTN
    sometimes normalises casing differently across re-downloads.
    """
    return Invoice.objects.filter(
        business_id=business_id,
        customer_id=customer_id,
        invoice_number__iexact=inv_no,
        invoice_date=inv_date,
    ).exists()


def import_file(
    file_path_or_buffer,
    *,
    dry_run: bool = False,
    filename: str | None = None,
) -> ImportResult:
    """Parse + import one 2A file. Idempotent — safe to re-run."""
    preview = preview_file(file_path_or_buffer, filename=filename)
    fname = preview.filename
    result = ImportResult(filename=fname)
    result.errors.extend(preview.parse_errors)

    if preview.matched_business_id is None:
        result.skipped_no_business = len(preview.parsed_rows)
        result.errors.append(
            f"No Business found for recipient GSTIN '{preview.recipient_gstin}' "
            f"(extracted from header: '{preview.recipient_header[:80]}'). "
            "Create the business first and re-run."
        )
        return result

    business_id = preview.matched_business_id

    # All-or-nothing per file. `transaction.atomic()` creates a real
    # transaction (or a savepoint if we're already in one); on exception
    # it rolls back so a mid-file IntegrityError doesn't leak partial
    # invoices. Dry-run uses set_rollback(True) so we exercise the
    # full DB code path (lookups, dedup probes) but commit nothing.
    # NOTE: the previous version called transaction.savepoint() WITHOUT
    # an outer atomic() — under Django's default autocommit mode that
    # makes the savepoint a no-op and partial commits leaked through.
    # Counters track committed work — reset on rollback so the report
    # doesn't claim "created 5" when the txn reverted them.
    pre_counters = (
        result.created_invoices, result.created_line_items,
        result.created_suppliers, result.skipped_duplicates,
    )
    try:
      with transaction.atomic():
        for row in preview.parsed_rows:
            cust, was_created = _find_or_create_supplier(row, dry_run=dry_run)
            if dry_run and was_created:
                # Count phantom creation for the preview report
                result.created_suppliers += 1
                # We don't have a customer to dedup against; assume new invoice
                # would be created. This slightly over-counts if the SAME
                # missing supplier appears twice in the same file — acceptable
                # for a preview.
                result.created_invoices += 1
                result.created_detail.append(
                    f"  WOULD CREATE supplier '{row.supplier_name}' ({row.supplier_gstin}) + invoice {row.invoice_number} {row.invoice_date} ₹{row.invoice_value}"
                )
                if not row.filed_3b:
                    result.not_filed_warnings.append(
                        f"  ! 3B-not-filed: {row.invoice_number} from {row.supplier_name} ₹{row.invoice_value}"
                    )
                continue
            if cust is None:
                # Should only happen if supplier_gstin is empty
                result.errors.append(
                    f"Row for {row.supplier_name!r} has no GSTIN — skipped."
                )
                continue
            if was_created:
                result.created_suppliers += 1
            if _invoice_exists(business_id, cust.id, row.invoice_number, row.invoice_date):
                result.skipped_duplicates += 1
                result.skipped_detail.append(
                    f"  DUP {row.invoice_number} from {cust.name} ({row.invoice_date}) ₹{row.invoice_value}"
                )
                continue

            if dry_run:
                result.created_invoices += 1
                result.created_detail.append(
                    f"  WOULD CREATE invoice {row.invoice_number} from {cust.name} ({row.invoice_date}) ₹{row.invoice_value}"
                )
                if not row.filed_3b:
                    result.not_filed_warnings.append(
                        f"  ! 3B-not-filed: {row.invoice_number} from {cust.name} ₹{row.invoice_value}"
                    )
                continue

            # Real write — invoice + one synthetic line item
            invoice = Invoice.objects.create(
                business_id=business_id,
                customer=cust,
                invoice_number=row.invoice_number,
                invoice_date=row.invoice_date,
                type_of_invoice=INVOICE_TYPE_INWARD,
                # total_amount is recomputed via LineItem signal on save,
                # but set initial value so it's right even if signals are
                # disabled in a future refactor.
                total_amount=row.invoice_value,
            )
            LineItem.objects.create(
                invoice=invoice,
                customer=cust,
                product_name=f"GSTR-2A import · {row.supplier_name[:80]}",
                hsn_code="",  # 2A doesn't expose per-line HSN
                gst_tax_rate=row.gst_tax_rate,
                quantity=Decimal("1"),
                rate=row.taxable_value,
                cgst=row.cgst,
                sgst=row.sgst,
                igst=row.igst,
                amount=row.invoice_value,  # tax-inclusive (matches app contract)
                unit="lot",
            )
            result.created_invoices += 1
            result.created_line_items += 1
            result.created_detail.append(
                f"  + {row.invoice_number} from {cust.name} ({row.invoice_date}) ₹{row.invoice_value}"
            )
            if not row.filed_3b:
                result.not_filed_warnings.append(
                    f"  ! 3B-not-filed: {row.invoice_number} from {cust.name} ₹{row.invoice_value}"
                )

        if dry_run:
            # Inside the atomic() block — mark for rollback on exit.
            transaction.set_rollback(True)
    except Exception as e:
        # atomic() already rolled back. Restore counters so we don't
        # claim work that no longer exists in the DB. created_detail
        # is left intact (it's documentary — shows what was attempted).
        (result.created_invoices, result.created_line_items,
         result.created_suppliers, result.skipped_duplicates) = pre_counters
        result.errors.append(f"Transaction rolled back (file reverted): {e!s}")
        logger.exception("GSTR-2A import failed for %s", fname)

    return result


def import_files(
    paths_or_buffers: Iterable, *, dry_run: bool = False
) -> list[ImportResult]:
    """Convenience for batching multiple files in one call."""
    return [import_file(p, dry_run=dry_run) for p in paths_or_buffers]
