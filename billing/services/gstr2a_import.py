"""GSTR-2A `.xls`/`.xlsx` import service.

Used by both the `import_gstr2a` management command (one-off CLI imports)
and the GSTR-2A Import frontend page (ongoing user-driven imports).

Design notes:

* Both `invoice` and `note` sheets are parsed. The `note` sheet drives
  credit-note netting: for each credit note we try to find a matching
  invoice (same supplier_gstin + same tax-inclusive value) and mark
  that invoice as "fully cancelled" — it's then skipped on import.
  Partial credit notes (no exact value match) are not auto-applied to
  avoid silently mutating invoice amounts; they're surfaced in the
  ImportResult so the user can handle them manually.

  Background: the v1 of this service imported the invoice sheet
  raw and ignored the note sheet entirely. On a real-world FY25-26
  import of 67 invoices we discovered 17 of them had been fully
  credit-noted by the supplier (Amazon/Flipkart returns + a returned
  SKYMART batch). The user's reconciled "net invoices" spreadsheet
  had the correct 50-invoice count; the v1 import had to be manually
  cleaned up. Auto-netting fixes this going forward.

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
class GSTR2ANote:
    """One row of the `note` sheet — a credit or debit note from a supplier."""

    supplier_name: str
    supplier_gstin: str
    note_number: str
    note_date: date | None
    note_type: str           # "Credit" or "Debit"
    note_value: Decimal      # tax-inclusive
    taxable_value: Decimal
    igst: Decimal
    cgst: Decimal
    sgst: Decimal


@dataclass
class FilePreview:
    """Per-file summary returned by `preview_file`."""

    filename: str
    recipient_header: str          # the row-0 string with recipient name + GSTIN
    recipient_gstin: str           # extracted from the header
    matched_business_id: int | None
    matched_business_name: str
    parsed_rows: list[GSTR2ARow]
    parsed_notes: list[GSTR2ANote] = field(default_factory=list)
    # invoice keys (supplier_gstin, invoice_number, invoice_date) that were
    # fully cancelled by a matching credit note — these are skipped on import
    cancelled_invoice_keys: set = field(default_factory=set)
    # credit notes that had no matching invoice — flagged for the user
    partial_notes: list[GSTR2ANote] = field(default_factory=list)
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
    # Invoices skipped because a matching credit note fully cancelled them.
    skipped_credit_noted: int = 0
    errors: list[str] = field(default_factory=list)
    # Detail lists for the CLI/UI to render
    created_detail: list[str] = field(default_factory=list)
    skipped_detail: list[str] = field(default_factory=list)
    not_filed_warnings: list[str] = field(default_factory=list)
    # Credit notes with no full invoice match — user should review.
    # Each entry: "CN <num> from <supplier> ₹<value> (-₹<itc>)"
    partial_credit_notes: list[str] = field(default_factory=list)


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


def _match_credit_notes(
    invoices: list[GSTR2ARow], notes: list[GSTR2ANote]
) -> tuple[set, list[GSTR2ANote]]:
    """Pair each credit note with an invoice it fully cancels.

    Matching key is `(supplier_gstin, tax_inclusive_value)` — a credit
    note fully cancels an invoice when both numbers line up to the
    paisa. Pairing is greedy and one-to-one: a CN that finds a match
    consumes that invoice from the candidate pool, so two CNs at the
    same value won't both claim the same invoice.

    Why tax_inclusive value (not invoice number): the 2A export does
    NOT populate the `Invoice No`/`Invoice Date` columns on note rows
    reliably — they're often blank because the GSTN portal doesn't
    require them. Tax-inclusive value at the paisa-level is unique
    enough in practice (jewellery invoices are rarely round numbers).

    Returns `(cancelled_keys, partial_notes)`. `cancelled_keys` is a
    set of `(supplier_gstin, invoice_number, invoice_date)` tuples
    that should be skipped on import. `partial_notes` is the CNs we
    couldn't pair — surfaced to the user for manual handling.
    """
    cancelled_keys: set = set()
    used_invoice_keys: set = set()
    partials: list[GSTR2ANote] = []
    for note in notes:
        # Only Credit notes reduce ITC. Debit notes add to it (rare in
        # GSTR-2A — usually appear in 2B for the recipient's own debit
        # notes, not the supplier's). Treat debits as partial for now.
        if (note.note_type or "").strip().lower() != "credit":
            partials.append(note)
            continue
        match_inv = None
        for inv in invoices:
            inv_key = (inv.supplier_gstin, inv.invoice_number, inv.invoice_date)
            if inv_key in used_invoice_keys:
                continue
            if (
                inv.supplier_gstin == note.supplier_gstin
                and abs(inv.invoice_value - note.note_value) < Decimal("0.01")
            ):
                match_inv = inv_key
                break
        if match_inv:
            cancelled_keys.add(match_inv)
            used_invoice_keys.add(match_inv)
        else:
            partials.append(note)
    return cancelled_keys, partials


def _parse_note_sheet(xl: pd.ExcelFile) -> list[GSTR2ANote]:
    """Best-effort parse of the `note` sheet. Returns [] if missing
    or empty — credit-note netting just becomes a no-op."""
    if "note" not in xl.sheet_names:
        return []
    try:
        df_raw = xl.parse("note", header=None)
    except Exception:
        return []
    if df_raw.shape[0] < 4:
        return []
    headers = [str(x).strip() for x in df_raw.iloc[2].tolist()]
    df = df_raw.iloc[3:].copy()
    df.columns = headers
    # Drop rows where Supplier Name is null (header artefacts / blank rows)
    if "Supplier Name" not in df.columns:
        return []
    df = df[df["Supplier Name"].notna()].reset_index(drop=True)
    notes: list[GSTR2ANote] = []
    for _, r in df.iterrows():
        try:
            notes.append(GSTR2ANote(
                supplier_name=str(r.get("Supplier Name", "")).strip(),
                supplier_gstin=str(r.get("GSTIN", "")).strip().upper(),
                note_number=str(r.get("Note No", "")).strip(),
                note_date=_to_date(r.get("Note Date")),
                note_type=str(r.get("Note Type", "")).strip(),
                note_value=_to_decimal(r.get("Note Value")),
                taxable_value=_to_decimal(r.get("Taxable Value")),
                igst=_to_decimal(r.get("IGST")),
                cgst=_to_decimal(r.get("CGST")),
                sgst=_to_decimal(r.get("SGST")),
            ))
        except Exception:
            # Don't fail the whole import for one malformed note row.
            continue
    return notes


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

    # Parse the note sheet and net it against invoices. Fully-matched
    # credit notes cancel out their invoices (skipped on import).
    # Unmatched / partial CNs are reported but not auto-applied.
    notes = _parse_note_sheet(xl)
    cancelled_keys, partials = _match_credit_notes(rows, notes)

    return FilePreview(
        filename=fname,
        recipient_header=header_row_0,
        recipient_gstin=recipient_gstin,
        matched_business_id=matched_biz.id if matched_biz else None,
        matched_business_name=matched_biz.name if matched_biz else "",
        parsed_rows=rows,
        parsed_notes=notes,
        cancelled_invoice_keys=cancelled_keys,
        partial_notes=partials,
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
    # Surface partial credit notes regardless of dry-run/live — these
    # are informational, the import doesn't act on them either way.
    for n in preview.partial_notes:
        result.partial_credit_notes.append(
            f"  ~ partial CN {n.note_number} from {n.supplier_name} "
            f"₹{n.note_value} (-₹{n.cgst + n.sgst + n.igst} ITC)"
        )

    try:
      with transaction.atomic():
        for row in preview.parsed_rows:
            # Skip rows that a credit note fully cancelled. This is the
            # main behaviour change from v1 — previously these slipped
            # through as phantom invoices and had to be manually deleted.
            row_key = (row.supplier_gstin, row.invoice_number, row.invoice_date)
            if row_key in preview.cancelled_invoice_keys:
                result.skipped_credit_noted += 1
                result.skipped_detail.append(
                    f"  CN-cancelled {row.invoice_number} from {row.supplier_name} "
                    f"({row.invoice_date}) ₹{row.invoice_value}"
                )
                continue

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
