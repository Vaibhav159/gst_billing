"""Bulk invoice import (audit F2).

Moved verbatim out of ``BulkInvoiceImportView.post`` — a 500-line view
method — into a service with a thin view adapter, the reconciliation.py house
style. Behaviour is unchanged; the tests that reach the endpoint are the
contract.
"""

import contextlib
import logging
from decimal import Decimal

from django.db import transaction
from rest_framework import status
from rest_framework.response import Response

from billing.api.inward_bills_service import fy_start, inward_number_key, supplier_key
from billing.constants import INVOICE_TYPE_INWARD, INVOICE_TYPE_OUTWARD, normalize_payment_mode
from billing.models import AuditLog, Business, Customer, Invoice, LineItem, Product
from billing.period_lock import locked_period_or_none
from billing.tax_rules import (
    LINE_MONEY_TOLERANCE,
    clean_gstin,
    direction_known,
    gstin_problem,
    has_gstin,
    normalize_rate,
    normalize_tax_heads,
    rate_as_percent,
    split_tax,
    state_name_from_gstin,
    to_paise,
)

logger = logging.getLogger(__name__)


def _inward_identity(business_id, supplier, number, day):
    """A purchase as find_duplicate sees it (M28), or None when it can't say."""
    key, start = inward_number_key(number), fy_start(day)
    return (business_id, supplier_key(supplier), start, key) if key and start else None





def run_bulk_import(request):
    invoices_data = request.data.get("invoices", [])
    business_id = request.data.get("business_id")

    if not invoices_data:
        return Response(
            {"error": "No invoices provided"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    created_count = 0
    skipped_count = 0
    errors = []

    # ---------- PHASE 1: bulk lookups (one query each) ----------

    # Pre-fetch all businesses (small table, usually <10 rows)
    all_businesses = list(Business.objects.all())
    biz_by_id = {b.pk: b for b in all_businesses}
    biz_by_gstin = {b.gst_number.strip().lower(): b for b in all_businesses if has_gstin(b.gst_number)}
    biz_by_name = {(b.name or "").lower(): b for b in all_businesses}

    forced_business = None
    if business_id:
        with contextlib.suppress(TypeError, ValueError):
            forced_business = biz_by_id.get(int(business_id))

    # Build customer lookup dicts in ONE query.
    # Customer table is small (~few hundred rows); fetching all is cheaper
    # than per-row .filter() calls.
    cust_by_gst = {}
    cust_by_pan = {}
    cust_by_name = {}
    for c in Customer.objects.all().only("id", "name", "gst_number", "pan_number"):
        # Only real GSTINs are keys: "URP" on file would have claimed every
        # walk-in a sheet typed "URP" for (H12).
        if has_gstin(c.gst_number):
            cust_by_gst[clean_gstin(c.gst_number)] = c
        if c.pan_number:
            cust_by_pan[c.pan_number.upper()] = c
        if c.name:
            cust_by_name[c.name.lower()] = c

    # Product master lookup. Two-tier so case-only duplicates in the
    # master (e.g. "GOLD COIN" 3% AND "gold coin" 12%) don't silently
    # apply the wrong tax rate based on DB iteration order.
    # exact-case wins → falls back to lowercase first-seen.
    product_by_exact = {}
    product_by_ci = {}
    for p in Product.objects.all().only("id", "name", "hsn_code", "gst_tax_rate").order_by("name"):
        if not p.name:
            continue
        if p.name not in product_by_exact:
            product_by_exact[p.name] = p
        ci_key = p.name.lower()
        if ci_key not in product_by_ci:
            product_by_ci[ci_key] = p

    def lookup_product(name):
        if not name:
            return None
        return product_by_exact.get(name) or product_by_ci.get(name.lower())

    # ---------- PRE-PASS: bulk-create new customers in ONE round-trip ----------
    # Walk all invoices, identify customer names that don't exist yet, dedupe,
    # bulk_create. Avoids N serial INSERTs when many invoices reference new
    # customers (saves ~700ms on a 10-new-customer import on Neon Singapore).
    needed_new = {}  # name_lower -> {name, gst, pan}
    for inv_data in invoices_data:
        cn = (inv_data.get("customerName") or "").strip()
        cg = (inv_data.get("customerGST") or "").strip()
        if not cn or ("(PAN)" not in cg and gstin_problem(cg)):
            continue  # a mistyped GSTIN refuses the row below; no party for it
        key = cn.lower()
        # Already in cache (pre-existing)? skip
        if key in cust_by_name:
            continue
        clean_gst = ""
        clean_pan = ""
        if cg and cg not in ("-", ""):
            if "(PAN)" in cg:
                clean_pan = cg.replace("(PAN)", "").strip()
                if clean_pan.upper() in cust_by_pan:
                    continue
            else:
                clean_gst = clean_gstin(cg)
                if clean_gst in cust_by_gst:
                    continue
        needed_new[key] = {"name": cn, "gst": clean_gst, "pan": clean_pan}

    if needed_new:
        new_objs = [
            Customer(
                name=info["name"], gst_number=info["gst"],
                pan_number=info["pan"],
                state_name=state_name_from_gstin(info["gst"]) or None,
                workspace_id=1,
            ) for info in needed_new.values()
        ]
        Customer.objects.bulk_create(new_objs, batch_size=200)
        # Update caches with the freshly-created customers
        for c in new_objs:
            cust_by_name[c.name.lower()] = c
            if c.gst_number:
                cust_by_gst[c.gst_number] = c
            if c.pan_number:
                cust_by_pan[c.pan_number.upper()] = c

    # Bulk fetch existing invoices (for duplicate detection) keyed by
    # (business_id, invoice_number, invoice_date)
    wanted_inv_keys = set()
    for inv_data in invoices_data:
        inv_no = str(inv_data.get("invoiceNumber", "") or "")
        inv_date = inv_data.get("invoice_date", "") or ""
        wanted_inv_keys.add((inv_no, inv_date))
    # Dedup key includes type_of_invoice — sales bill #1 and purchase bill #1
    # are different documents, even with the same number/date/firm.
    existing_invoice_keys = set()
    if wanted_inv_keys:
        inv_no_list = list({k[0] for k in wanted_inv_keys})
        inv_date_list = list({k[1] for k in wanted_inv_keys if k[1]})
        for inv in Invoice.objects.filter(
            invoice_number__in=inv_no_list,
            invoice_date__in=inv_date_list,
        ).only("id", "invoice_number", "invoice_date", "business_id", "type_of_invoice"):
            existing_invoice_keys.add(
                (inv.business_id, str(inv.invoice_number), str(inv.invoice_date),
                 (inv.type_of_invoice or INVOICE_TYPE_OUTWARD).lower())
            )

    # Outward numbers already used in each FY (the database refuses a second
    # one, uniq_outward_number_per_business_fy). A row reusing one on another
    # date passed the duplicate check and failed the whole batch (M11).
    numbers_used = {
        (inv.business_id, inv.invoice_number, fy_start(inv.invoice_date))
        for inv in Invoice.objects.filter(
            type_of_invoice=INVOICE_TYPE_OUTWARD, invoice_number__in={k[0] for k in wanted_inv_keys if k[0]},
        ).only("business_id", "invoice_number", "invoice_date")
    }

    # Purchases already on file, by the one inward rule (M28), one query per
    # firm: "SJ-101" from the inward form is this sheet's "SJ/101". Each with
    # what it was, so a row skipped as a duplicate says which bill it matched.
    inward_seen = {}

    def inward_on_file(biz_id):
        if biz_id not in inward_seen:
            inward_seen[biz_id] = {
                ident: f"{inv.invoice_number} of {inv.invoice_date} from {inv.customer.name}"
                for inv in Invoice.objects.filter(business_id=biz_id, type_of_invoice=INVOICE_TYPE_INWARD)
                .select_related("customer").only("invoice_number", "invoice_date", "customer__name",
                                                 "customer__gst_number")
                if (ident := _inward_identity(biz_id, inv.customer, inv.invoice_number, inv.invoice_date))
            }
        return inward_seen[biz_id]

    # ---------- PHASE 2: process invoices in a single transaction ----------
    invoices_to_create = []  # [(Invoice instance, source dict for line items)]
    line_items_to_create = []
    audit_logs_to_create = []
    # Per-invoice audit metadata (pk, display name, item count). Audit logs
    # are emitted after total_amount is recomputed from line items so the
    # message reflects the persisted total, not the stale in-memory value.
    pending_invoice_audits: list[dict] = []
    new_customers_added_to_biz = []  # (customer, business) pairs

    with transaction.atomic():
        for inv_data in invoices_data:
            try:
                # Savepoint per row: on Postgres a failed statement aborts the whole
                # outer transaction, so the documented "good rows still land"
                # only ever worked on SQLite, which is what the tests use.
                with transaction.atomic():
                    firm_name = (inv_data.get("firmName") or "").strip()
                    firm_gstin = (inv_data.get("firmGSTIN") or "").strip()

                    # Resolve business from cache
                    business = forced_business
                    if not business and firm_gstin:
                        business = biz_by_gstin.get(firm_gstin.lower())
                    if not business and firm_name:
                        # icontains substitute: try exact, then any name containing
                        business = biz_by_name.get(firm_name.lower())
                        if not business:
                            for nm, b in biz_by_name.items():
                                if firm_name.lower() in nm or nm in firm_name.lower():
                                    business = b
                                    break

                    if not business:
                        errors.append(
                            f"Business not found for invoice {inv_data.get('invoiceNumber', '?')}: {firm_name} ({firm_gstin})"
                        )
                        skipped_count += 1
                        continue

                    customer_name = (inv_data.get("customerName") or "").strip()
                    customer_gst = (inv_data.get("customerGST") or "").strip()

                    if not customer_name:
                        errors.append(
                            f"No customer name for invoice {inv_data.get('invoiceNumber', '?')}"
                        )
                        skipped_count += 1
                        continue
                    # A typo isn't "no GSTIN": booked as one, a registered party
                    # turned B2C (review of H12).
                    if "(PAN)" not in customer_gst and (problem := gstin_problem(customer_gst)):
                        errors.append(f"Invoice {inv_data.get('invoiceNumber', '?')}: {problem}")
                        skipped_count += 1
                        continue

                    # Resolve customer from cache
                    customer = None
                    clean_gst = ""
                    clean_pan = ""
                    if customer_gst and customer_gst not in ("-", ""):
                        if "(PAN)" in customer_gst:
                            clean_pan = customer_gst.replace("(PAN)", "").strip()
                            customer = cust_by_pan.get(clean_pan.upper())
                        else:
                            clean_gst = clean_gstin(customer_gst)
                            customer = cust_by_gst.get(clean_gst) if clean_gst else None
                    if not customer:
                        customer = cust_by_name.get(customer_name.lower())

                    if not customer:
                        # Should not happen — pre-pass should have bulk-created
                        # everything. Defensive fallback.
                        customer = Customer.objects.create(
                            name=customer_name, gst_number=clean_gst,
                            pan_number=clean_pan,
                            state_name=state_name_from_gstin(clean_gst) or None,
                            workspace_id=1,
                        )
                        from billing.gstin import enrich_customer

                        transaction.on_commit(lambda c=customer: enrich_customer(c))  # not inside the import's transaction
                        # Update ALL lookup caches so a later row referencing the
                        # same GST/PAN under a different name resolves to this
                        # customer instead of creating a duplicate.
                        cust_by_name[customer_name.lower()] = customer
                        if clean_gst:
                            cust_by_gst[clean_gst] = customer
                        if clean_pan:
                            cust_by_pan[clean_pan.upper()] = customer

                    if business and business.pk and customer.pk:
                        # Track for M2M attach (idempotent — .add() is a no-op if exists)
                        new_customers_added_to_biz.append((customer, business))

                    # Resolve invoice type first so duplicate key includes it.
                    invoice_number = str(inv_data.get("invoiceNumber", ""))
                    invoice_date = inv_data.get("invoice_date", "")
                    inv_type = inv_data.get("type", "OUTWARD")
                    type_of_invoice = (
                        INVOICE_TYPE_INWARD
                        if inv_type == "INWARD"
                        else INVOICE_TYPE_OUTWARD
                    )

                    # Duplicate check — must match on business + bill# + date AND type
                    dup_key = (business.pk, invoice_number, str(invoice_date), type_of_invoice.lower())
                    if dup_key in existing_invoice_keys:
                        skipped_count += 1
                        continue
                    number_key = (business.pk, invoice_number, fy_start(str(invoice_date)))
                    if type_of_invoice == INVOICE_TYPE_OUTWARD and invoice_number and number_key in numbers_used:
                        errors.append(
                            f"Invoice {invoice_number}: {business.name} already used this number in the "
                            "same financial year, on another date. Renumber it in the sheet."
                        )
                        skipped_count += 1
                        continue
                    inward_ident = None
                    if type_of_invoice == INVOICE_TYPE_INWARD:
                        inward_ident = _inward_identity(business.pk, customer, invoice_number, str(invoice_date))
                        if inward_ident and (matched := inward_on_file(business.pk).get(inward_ident)):
                            # Said, not silent: a number read as another bill's
                            # would otherwise lose its credit without a trace.
                            errors.append(f"Invoice {invoice_number}: skipped, already on file as {matched}.")
                            skipped_count += 1
                            continue

                    # Filed-and-locked month: never silently mutate a filed
                    # period from a bulk sheet — surface it as a row error.
                    if locked_period_or_none(business.pk, str(invoice_date)):
                        skipped_count += 1
                        errors.append(
                            f"Invoice {invoice_number}: its month is filed & locked "
                            f"for {business.name} — unlock on the GST page to import it."
                        )
                        continue

                    # Build invoice in memory; bulk_create later
                    invoice = Invoice(
                        invoice_number=invoice_number,
                        invoice_date=invoice_date,
                        customer=customer,
                        business=business,
                        type_of_invoice=type_of_invoice,
                        total_amount=Decimal(str(inv_data.get("total", 0))),
                        payment_mode=normalize_payment_mode(inv_data.get("paymentMode")),
                        workspace_id=1,
                    )
                    invoices_to_create.append((invoice, inv_data))
                    # Mark as seen so a duplicate row in the same payload is skipped
                    existing_invoice_keys.add(dup_key)
                    if type_of_invoice == INVOICE_TYPE_OUTWARD and invoice_number:
                        numbers_used.add(number_key)
                    if inward_ident:
                        inward_on_file(business.pk)[inward_ident] = (
                            f"{invoice_number} of {invoice_date} from {customer.name}, earlier in this import")
                    created_count += 1

            except Exception as e:
                logger.error(
                    f"Error importing invoice {inv_data.get('invoiceNumber', '?')}: {e}",
                    exc_info=True,
                )
                errors.append(
                    f"Error importing invoice {inv_data.get('invoiceNumber', '?')}: {e!s}"
                )
                skipped_count += 1

        # ---------- PHASE 3: bulk writes ----------
        # Bulk-create invoices in ONE round-trip. PostgreSQL fills in PKs.
        # If bulk_create raises for one bad row (e.g. malformed date), we
        # don't want the whole batch to 500. Try the bulk path first; on
        # failure, fall back to per-row create so good rows still land
        # and bad rows surface as per-row errors.
        if invoices_to_create:
            invoice_objs = [pair[0] for pair in invoices_to_create]
            try:
                with transaction.atomic():  # savepoint, see above
                    Invoice.objects.bulk_create(invoice_objs, batch_size=200)
            except Exception as bulk_err:
                logger.warning(
                    "bulk_create failed (%s); falling back to per-row create", bulk_err
                )
                surviving = []
                for invoice, inv_data in invoices_to_create:
                    try:
                        # A savepoint each: without one, the first failure
                        # aborted the outer transaction on Postgres, and the
                        # import was a 500 with nothing saved (M11).
                        with transaction.atomic():
                            invoice.save()
                        surviving.append((invoice, inv_data))
                    except Exception as row_err:
                        errors.append(
                            f"Invoice {inv_data.get('invoiceNumber','?')}: "
                            f"could not create — {row_err}"
                        )
                        created_count -= 1
                        skipped_count += 1
                invoices_to_create = surviving
                invoice_objs = [pair[0] for pair in surviving]
            # Now invoice.pk is populated; build line items + audit logs.
            for invoice, inv_data in invoices_to_create:
                items = inv_data.get("items", [])
                is_igst = invoice.is_igst_applicable
                for item in items:
                    # Excel cells can come through as numbers (e.g. HSN "711319"
                    # parsed as int) — coerce to str before .strip() so one
                    # numeric cell can't AttributeError the whole batch.
                    product_name = str(item.get("productName") or "").strip()
                    # Resolve HSN + GST rate from Product master if not supplied.
                    # Never silently default — if the row has no GST rate AND
                    # no matching product, fail with a clear message.
                    product = lookup_product(product_name)
                    hsn_code = str(item.get("hsn") or "").strip()
                    gst_rate_raw_in = item.get("gstRate")
                    if gst_rate_raw_in in (None, "", 0, "0"):
                        if not product:
                            errors.append(
                                f"Invoice {inv_data.get('invoiceNumber','?')} item '{product_name}': "
                                f"product not found in Product list and no GST rate supplied. "
                                f"Add the product first or include a GST Rate column."
                            )
                            continue
                        # assume="fraction": this is the stored column. The
                        # slab allowlist still heals a master row written by
                        # the old heuristic, so imports stop propagating it.
                        gst_rate = normalize_rate(
                            product.gst_tax_rate, assume="fraction"
                        )
                        if not hsn_code:
                            hsn_code = product.hsn_code or ""
                    else:
                        # "gstRate" is the parser's percent field
                        # (parseInvoiceExcel.ts), so percent is the contract
                        # for anything the allowlist cannot place.
                        gst_rate = normalize_rate(
                            gst_rate_raw_in, assume="percent"
                        )
                        if not hsn_code and product:
                            hsn_code = product.hsn_code or ""

                    qty = Decimal(str(item.get("qty", 0)))
                    rate = Decimal(str(item.get("rate", 0)))
                    cgst = Decimal(str(item.get("cgst", 0)))
                    sgst = Decimal(str(item.get("sgst", 0)))
                    igst = Decimal(str(item.get("igst", 0)))
                    # User-supplied gross amount takes precedence — they may not have qty/rate
                    user_amount = Decimal(str(item.get("amount", 0)))
                    taxable_in = Decimal(str(item.get("taxable") or 0))
                    net_amount = qty * rate
                    # Quantity x rate must be the line's taxable value. A register
                    # with no Qty/Rate columns came in as 60,000 x 900 for a
                    # taxable value of 60,000, and the review screen, which shows
                    # the file's taxable, looked right (H9).
                    if net_amount > 0 and (taxable_in > 0 or user_amount > 0):
                        if taxable_in > 0:
                            expected, what = taxable_in, f"its taxable value ({taxable_in})"
                        else:
                            heads_in = cgst + sgst + igst
                            expected = user_amount - (heads_in if heads_in else user_amount * gst_rate / (1 + gst_rate))
                            what = f"its amount less tax ({to_paise(expected)})"
                        if abs(net_amount - expected) > LINE_MONEY_TOLERANCE:
                            errors.append(
                                f"Invoice {inv_data.get('invoiceNumber', '?')} item '{product_name}': "
                                f"quantity x rate ({net_amount}) is not {what}. Check the Qty and Rate columns."
                            )
                            continue
                    if net_amount == 0 and taxable_in > 0:
                        net_amount = to_paise(taxable_in)
                        qty, rate = Decimal("1"), net_amount
                    elif net_amount == 0 and user_amount > 0:
                        if cgst == 0 and sgst == 0 and igst == 0:
                            # Gross only: back the taxable value out at the
                            # row's rate. This branch used to treat the gross
                            # as the net and tax it again — Rs 309 of tax on a
                            # Rs 10,300 line that carried Rs 300.
                            net_amount = user_amount / (1 + gst_rate)
                        else:
                            net_amount = user_amount - cgst - sgst - igst
                            if net_amount < 0:
                                net_amount = user_amount / (1 + gst_rate)
                        # Stored as one unit at the taxable value. Kept as 0 x
                        # 0, the line filed Rs 0 of taxable in GSTR-1 (B2CS,
                        # HSN), the GST summary and 3B, since all of them read
                        # quantity x rate (H8). As the GSTR-2A import stores it.
                        net_amount = to_paise(net_amount)
                        qty, rate = Decimal("1"), net_amount
                    tax_amount = net_amount * gst_rate
                    heads_recomputed = False
                    if cgst == 0 and sgst == 0 and igst == 0:
                        cgst, sgst, igst = split_tax(tax_amount, is_igst)
                    elif abs((cgst + sgst + igst) - to_paise(tax_amount)) > LINE_MONEY_TOLERANCE:
                        # The file's heads aren't its own rate: a cell shown as
                        # "3%" read as 0.03% put Rs 18 of tax on Rs 60,000 of a 3%
                        # line (H10). The rate was normalised, the heads kept.
                        file_tax = cgst + sgst + igst
                        cgst, sgst, igst = split_tax(tax_amount, igst > 0)
                        heads_recomputed = True
                        errors.append(
                            f"Invoice {inv_data.get('invoiceNumber', '?')} item '{product_name}': the file's tax "
                            f"{file_tax} isn't {rate_as_percent(gst_rate)}% of {to_paise(net_amount)}; "
                            f"booked {cgst + sgst + igst}."
                        )
                    # Heads supplied by the file were taken verbatim, so a
                    # spreadsheet carrying a local split for an interstate
                    # party re-planted the exact bug fix_tax_heads repairs.
                    # Re-file them when the direction is actually known.
                    # When the customer has neither GSTIN nor state (every
                    # auto-created B2C party), the file's heads are the
                    # only signal there is and must not lose to a default.
                    if direction_known(invoice.business, invoice.customer):
                        cgst, sgst, igst = normalize_tax_heads(
                            cgst, sgst, igst, is_igst
                        )
                    amount = (
                        user_amount if user_amount > 0 and not heads_recomputed
                        else to_paise(net_amount) + cgst + sgst + igst
                    )

                    # Validate per-field DB constraints BEFORE bulk_create so
                    # a single bad row doesn't 500 the whole batch.
                    # quantity / cgst / sgst / igst are NUMERIC(10,3) → abs < 10^7
                    # rate / amount / gst_tax_rate are NUMERIC(12,3) → abs < 10^9
                    OVERFLOW_10 = Decimal("10000000")
                    OVERFLOW_12 = Decimal("1000000000")
                    bad = next(
                        (
                            (name, value)
                            for name, value, limit in (
                                ("quantity", qty, OVERFLOW_10), ("cgst", cgst, OVERFLOW_10), ("sgst", sgst, OVERFLOW_10),
                                ("igst", igst, OVERFLOW_10), ("rate", rate, OVERFLOW_12), ("amount", amount, OVERFLOW_12),
                            )
                            if abs(value) >= limit
                        ),
                        None,
                    )
                    if bad:
                        errors.append(
                            f"Invoice {inv_data.get('invoiceNumber','?')} item '{product_name}': "
                            f"{bad[0]} value {bad[1]} exceeds DB limit. "
                            f"Likely qty×rate computation error — check input."
                        )
                        continue

                    line_items_to_create.append(LineItem(
                        invoice=invoice, customer=invoice.customer,
                        product_name=product_name or "Item",
                        hsn_code=hsn_code or "",
                        gst_tax_rate=gst_rate,
                        quantity=qty, rate=rate,
                        cgst=cgst, sgst=sgst, igst=igst, amount=amount,
                        workspace_id=1,
                    ))
                # Stash the metadata we need for the audit log; the actual
                # AuditLog row is appended below after total_amount has been
                # recomputed from line items, so the logged total isn't stale.
                pending_invoice_audits.append({
                    "pk": invoice.pk,
                    "name": f"#{invoice.invoice_number} - {invoice.customer.name}",
                    "item_count": len(items),
                })

        if line_items_to_create:
            LineItem.objects.bulk_create(line_items_to_create, batch_size=200)

        # If any invoices ended up with NO line items (all their items errored
        # out during product/GST resolution), they must be removed — leaving
        # stub invoices behind would corrupt counters and confuse downstream
        # reports. (total_amount defaults to 0 so NULL isn't the failure mode.)
        empty_inv_ids: list[int] = []
        if invoices_to_create:
            from django.db.models import DecimalField, OuterRef, Subquery, Sum
            from django.db.models.functions import Coalesce
            invoice_ids = [inv.pk for inv, _ in invoices_to_create if inv.pk]
            if invoice_ids:
                # Find invoices with no line items and decrement counters
                empty_inv_ids = list(
                    Invoice.objects.filter(pk__in=invoice_ids, lineitem__isnull=True)
                    .values_list("pk", flat=True)
                )
                if empty_inv_ids:
                    # Roll back stub invoices and adjust counters
                    Invoice.objects.filter(pk__in=empty_inv_ids).delete()
                    invoice_ids = [pk for pk in invoice_ids if pk not in empty_inv_ids]
                    created_count -= len(empty_inv_ids)
                    skipped_count += len(empty_inv_ids)

                # Safety net: recompute Invoice.total_amount = SUM(line_items)
                # for the surviving invoices. bulk_create skips the post_save
                # signal that normally keeps total in sync, so we re-derive.
                if invoice_ids:
                    sub = (LineItem.objects
                           .filter(invoice=OuterRef("pk"))
                           .values("invoice")
                           .annotate(s=Sum("amount"))
                           .values("s"))
                    Invoice.objects.filter(pk__in=invoice_ids).update(
                        total_amount=Coalesce(
                            Subquery(sub, output_field=DecimalField()),
                            Decimal("0"),
                            output_field=DecimalField(),
                        )
                    )

        # Emit the deferred per-invoice audit logs now that total_amount
        # has been recomputed from line items (and dropped invoices that
        # were rolled back as empty).
        if pending_invoice_audits:
            empty_set = set(empty_inv_ids)
            surviving_pks = [a["pk"] for a in pending_invoice_audits if a["pk"] not in empty_set]
            live_totals = dict(
                Invoice.objects.filter(pk__in=surviving_pks).values_list("pk", "total_amount")
            )
            for meta in pending_invoice_audits:
                if meta["pk"] in empty_set:
                    continue
                audit_logs_to_create.append(AuditLog(
                    action="imported", entity="invoice",
                    entity_id=meta["pk"],
                    entity_name=meta["name"],
                    user=request.user if request.user and request.user.is_authenticated else None,
                    details=(
                        f"Imported from Excel ({meta['item_count']} items, "
                        f"total: {live_totals.get(meta['pk'], 0)})"
                    ),
                ))

        # Add per-row error entries to the audit log so failures are
        # visible in the UI's audit log page (not just Django logs).
        if errors:
            for err_msg in errors[:50]:  # cap to avoid runaway
                audit_logs_to_create.append(AuditLog(
                    action="imported", entity="invoice",
                    entity_id=0, entity_name="(failed row)",
                    user=request.user if request.user and request.user.is_authenticated else None,
                    details=f"Import error: {err_msg[:500]}",
                ))

        if audit_logs_to_create:
            AuditLog.objects.bulk_create(audit_logs_to_create, batch_size=200)

        # Link new customers to businesses via M2M — bulk_create the through-table
        # rows instead of N individual .add() calls (each is its own round-trip).
        if new_customers_added_to_biz:
            Through = Customer.businesses.through
            # Dedupe pairs (customer_id, business_id) — a customer might appear
            # in multiple invoices for the same business.
            seen_pairs = set()
            m2m_rows = []
            for cust, biz in new_customers_added_to_biz:
                if not cust.pk or not biz.pk:
                    continue
                key = (cust.pk, biz.pk)
                if key in seen_pairs:
                    continue
                seen_pairs.add(key)
                m2m_rows.append(Through(customer_id=cust.pk, business_id=biz.pk))
            if m2m_rows:
                Through.objects.bulk_create(m2m_rows, ignore_conflicts=True, batch_size=200)

    return Response(
        {
            "created": created_count,
            "skipped": skipped_count,
            "errors": errors[:20],
            "message": f"Successfully imported {created_count} invoices. {skipped_count} skipped.",
        },
        status=status.HTTP_201_CREATED,
    )


