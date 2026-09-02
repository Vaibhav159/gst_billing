"""Invoice creation from AI-extracted data (audit F2).

Moved verbatim out of ``AIInvoiceCreateView.post`` into a service with a thin
view adapter. Behaviour is unchanged.
"""

import json
import logging
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from billing.constants import INVOICE_TYPE_INWARD, INVOICE_TYPE_OUTWARD
from billing.models import Business, Customer, Invoice, LineItem
from billing.period_lock import assert_period_unlocked
from billing.services.line_items import build_line_items
from billing.utils import AIInvoiceProcessor

logger = logging.getLogger(__name__)


def create_from_ai(request):
    """Create an invoice from AI-extracted data.

    Three latent bugs in the previous version were fixed here:
      1. `Customer.objects.get(name=...)` raised DoesNotExist (→ 500)
         when the AI returned a name that wasn't an exact match.
         Case-insensitive lookup scoped to the chosen business now,
         with a clear 400 + customer_name in the response so the
         frontend can prompt the user to create them first.
      2. `type_of_invoice` was hardcoded OUTWARD. Now respects the
         `type_of_invoice` field in the request body (defaulting to
         OUTWARD), so purchase invoices can be imported too.
      3. The `customer_data` dict was built but never used — the
         extracted address/GST/PAN/mobile from OCR was silently
         dropped. Now we backfill empty customer fields from
         extracted data (never overwrite curated values; OCR can
         misread a GSTIN).
    """
    try:
        for field in ("business_id", "invoice_data"):
            if field not in request.data:
                return Response(
                    {"error": f"Missing required field: {field}"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        business_id = request.data["business_id"]
        # When the request comes in as multipart (AI Import sends
        # the source image alongside), nested JSON fields arrive
        # as strings. Parse on the way in so the rest of the view
        # is agnostic to wire format.
        invoice_data = request.data["invoice_data"]
        if isinstance(invoice_data, str):
            try:
                invoice_data = json.loads(invoice_data)
            except json.JSONDecodeError as e:
                return Response(
                    {"error": f"invoice_data is not valid JSON: {e!s}"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        # Optional source image — kept as audit trail of what the
        # AI actually saw. Saved to invoice.source_file after the
        # Invoice row is created (need invoice.pk first for the
        # upload path).
        source_file = request.FILES.get("source_file")
        type_of_invoice = (
            request.data.get("type_of_invoice") or INVOICE_TYPE_OUTWARD
        )
        if type_of_invoice not in (INVOICE_TYPE_OUTWARD, INVOICE_TYPE_INWARD):
            return Response(
                {"error": "type_of_invoice must be 'outward' or 'inward'"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Inter-firm: both parties on the bill are our businesses.
        # The primary invoice (business_id/type above — the seller's
        # OUTWARD) is created as usual; then an INWARD mirror is
        # written for the buyer firm so the purchase/ITC side lands
        # from the same upload. Values arrive as strings when the
        # request is multipart.
        inter_firm = str(request.data.get("inter_firm", "")).lower() in ("true", "1")
        inter_firm_buyer_id = request.data.get("inter_firm_buyer_business_id") or None

        try:
            business = Business.objects.get(id=business_id)
        except Business.DoesNotExist:
            return Response(
                {"error": "Business not found"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        extracted_name = (invoice_data.get("customer_name") or "").strip()
        if not extracted_name:
            return Response(
                {"error": "Customer name missing in extracted data."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Match strategy (in priority order):
        #   1. GSTIN exact match (most reliable — uniquely identifies
        #      the supplier even if the name varies).
        #   2. Name case-insensitive match scoped to this business.
        #   3. Auto-create if extracted GSTIN is present — matches
        #      the GSTR-2A import behaviour, lower friction than
        #      forcing the user to bounce out and create manually.
        #      Name conflicts are disambiguated with state/GSTIN
        #      suffix (mirror of GSTR-2A's logic).
        extracted_gstin = (invoice_data.get("customer_gst_number") or "").strip().upper()
        customer = None
        if extracted_gstin:
            customer = Customer.objects.filter(gst_number=extracted_gstin).first()
        if not customer:
            customer = (
                Customer.objects.filter(
                    businesses__id=business_id, name__iexact=extracted_name
                ).first()
            )
        if not customer:
            if not extracted_gstin:
                # No GSTIN to auto-create with — surface a clear error
                # so the user creates the customer manually with the
                # right details. Better than guessing.
                return Response(
                    {
                        "error": (
                            f"Customer '{extracted_name}' not found for this "
                            "business and no GSTIN was extracted to auto-create. "
                            "Add the customer manually first."
                        ),
                        "customer_name": extracted_name,
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # Auto-create with disambiguated name if needed.
            extracted_state = (invoice_data.get("customer_state_name") or "").strip()
            final_name = extracted_name[:255]
            if Customer.objects.filter(name=final_name).exists():
                if extracted_state:
                    candidate = f"{final_name} ({extracted_state})"[:255]
                    if not Customer.objects.filter(name=candidate).exists():
                        final_name = candidate
                if Customer.objects.filter(name=final_name).exists():
                    final_name = f"{extracted_name[:230]} · {extracted_gstin}"[:255]
            customer = Customer.objects.create(
                name=final_name,
                gst_number=extracted_gstin,
                address=(invoice_data.get("customer_address") or "").strip(),
                pan_number=(invoice_data.get("customer_pan_number") or "").strip(),
                mobile_number=(invoice_data.get("customer_mobile_number") or "").strip(),
                state_name=extracted_state[:255] if extracted_state else "",
            )
            # OCR fills first; the registry completes what it missed.
            from billing.gstin import enrich_customer

            transaction.on_commit(lambda c=customer: enrich_customer(c))  # AI create is atomic; enrich after commit

        # Backfill empty customer fields — never overwrite curated
        # data because OCR can misread a GSTIN/PAN by a digit.
        dirty = False
        for db_field, extracted_key in (
            ("address", "customer_address"),
            ("gst_number", "customer_gst_number"),
            ("pan_number", "customer_pan_number"),
            ("mobile_number", "customer_mobile_number"),
        ):
            val = (invoice_data.get(extracted_key) or "").strip()
            if val and not getattr(customer, db_field, ""):
                setattr(customer, db_field, val)
                dirty = True
        if dirty:
            customer.save()

        # Dedup check — same natural key as GSTR-2A import: a given
        # (business, customer, invoice_number, invoice_date) tuple
        # uniquely identifies a real-world invoice. Re-uploading
        # the same image through AI Import should NOT create a
        # second DB row. Returns the existing invoice instead so
        # the frontend can still link to it.
        inv_number = invoice_data.get("invoice_number", "") or ""
        inv_date = (
            invoice_data.get("invoice_date") or timezone.localdate()
        )
        # Inter-firm mirror helper — creates (or finds) the INWARD
        # entry for the buyer firm, copying lines from the primary
        # invoice. Used on both the fresh-create path AND the
        # primary-duplicate path, so re-uploading a bill whose
        # outward already exists still completes a missing inward
        # mirror instead of silently skipping it.
        def ensure_inward_mirror(primary_invoice):
            if not (inter_firm and inter_firm_buyer_id):
                return None, False
            buyer_business = Business.objects.filter(id=inter_firm_buyer_id).first()
            if buyer_business is None:
                logger.warning("inter_firm buyer business %s not found", inter_firm_buyer_id)
                return None, False
            supplier_cust = None
            if business.gst_number:
                supplier_cust = Customer.objects.filter(
                    gst_number=business.gst_number
                ).first()
            if supplier_cust is None:
                supplier_cust = Customer.objects.filter(
                    name__iexact=business.name
                ).first()
            if supplier_cust is None:
                supplier_cust = Customer.objects.create(
                    name=business.name[:255],
                    gst_number=business.gst_number or "",
                    state_name=(getattr(business, "state_name", "") or "RAJASTHAN")[:255],
                    workspace_id=1,
                )
            mirror_existing = Invoice.objects.filter(
                business=buyer_business,
                invoice_number__iexact=inv_number,
                invoice_date=inv_date,
                type_of_invoice=INVOICE_TYPE_INWARD,
            ).first()
            if mirror_existing is not None:
                return mirror_existing.id, True
            assert_period_unlocked(buyer_business.id, inv_date, "create")
            mirror = Invoice.objects.create(
                customer=supplier_cust,
                business=buyer_business,
                invoice_number=inv_number,
                invoice_date=inv_date,
                type_of_invoice=INVOICE_TYPE_INWARD,
                total_amount=primary_invoice.total_amount,
            )
            # bulk_create: the per-line signal would re-sum the mirror
            # once per copied line; the total is set explicitly below.
            LineItem.objects.bulk_create(
                [
                    LineItem(
                        customer=supplier_cust,
                        invoice=mirror,
                        product_name=li.product_name,
                        hsn_code=li.hsn_code,
                        gst_tax_rate=li.gst_tax_rate,
                        quantity=li.quantity,
                        rate=li.rate,
                        amount=li.amount,
                        cgst=li.cgst,
                        sgst=li.sgst,
                        igst=li.igst,
                    )
                    for li in LineItem.objects.filter(invoice=primary_invoice)
                ],
                batch_size=100,
            )
            mirror.total_amount = primary_invoice.total_amount
            mirror.save()
            # Audit image on the mirror too — same physical document.
            if source_file is not None:
                try:
                    source_file.seek(0)
                    mirror.source_file.save(
                        source_file.name, source_file, save=True
                    )
                    if primary_invoice.source_preview:
                        from django.core.files.base import ContentFile
                        with primary_invoice.source_preview.open("rb") as pf:
                            mirror.source_preview.save(
                                primary_invoice.source_preview.name.rsplit("/", 1)[-1],
                                ContentFile(pf.read()),
                                save=True,
                            )
                except Exception as e:
                    logger.warning(
                        "Could not copy source image to mirror %s: %s",
                        mirror.pk, e,
                    )
            return mirror.id, False

        existing = (
            Invoice.objects.filter(
                business_id=business_id,
                customer_id=customer.id,
                invoice_number__iexact=inv_number,
                invoice_date=inv_date,
            ).first()
        )
        if existing is not None:
            # Primary already exists — still ensure the inter-firm
            # inward mirror is present (completes half-done pairs).
            inward_invoice_id, inward_duplicate = ensure_inward_mirror(existing)
            return Response(
                {
                    "success": True,
                    "invoice_id": existing.id,
                    "invoice_number": existing.invoice_number,
                    "customer_name": customer.name,
                    "line_items_created": 0,
                    "total_amount": existing.total_amount,
                    "duplicate": True,
                    "inward_invoice_id": inward_invoice_id,
                    "inward_duplicate": inward_duplicate,
                    "message": (
                        f"Invoice {inv_number} from {customer.name} on "
                        f"{inv_date} already exists — skipped duplicate."
                    ),
                }
            )

        assert_period_unlocked(business.id, inv_date, "create")
        invoice = Invoice.objects.create(
            customer=customer,
            business=business,
            invoice_number=inv_number,
            invoice_date=inv_date,
            type_of_invoice=type_of_invoice,
            total_amount=invoice_data.get("total_amount", 0) or 0,
        )

        # Persist the source image as audit trail. Done AFTER
        # Invoice.objects.create() because FileField.save() with
        # save=True triggers another model save — keeps the upload
        # path deterministic regardless of pre-save signals.
        #
        # Also generate a JPEG preview alongside the original.
        # Chrome/Firefox can't render HEIC inline so without this
        # the InvoiceDetail page shows a broken-image fallback.
        # _normalize_image is the same path AIInvoiceProcessor
        # uses to prep images for Gemini (PIL + pillow-heif decode
        # → JPEG q=88), so we get a browser-safe preview for free.
        # Preview generation is best-effort — if it fails the
        # original is still there and downloadable.
        if source_file is not None:
            invoice.source_file.save(source_file.name, source_file, save=True)
            try:
                source_file.seek(0)
                original_bytes = source_file.read()
                jpeg_bytes, _ = AIInvoiceProcessor._normalize_image(
                    original_bytes,
                    source_file.content_type or "image/jpeg",
                )
                from django.core.files.base import ContentFile
                base = source_file.name.rsplit(".", 1)[0] or "preview"
                invoice.source_preview.save(
                    f"{base}.jpg", ContentFile(jpeg_bytes), save=True
                )
            except Exception as e:
                logger.warning(
                    "Could not generate preview for invoice %s: %s",
                    invoice.pk, e,
                )

        # Compute per-line tax breakdown. Previous version created
        # LineItems with cgst/sgst/igst all defaulting to 0 — the
        # invoice showed up in the UI with Total Tax: ₹0 even
        # when the AI correctly extracted gst_tax_rate=0.03.
        # User flagged this on a SOLANKI inward invoice.
        #
        # Also recompute `amount` from qty * rate * (1 + gst_rate)
        # because the AI sometimes returns the PRE-tax subtotal in
        # the supposedly-tax-inclusive `amount` slot. Recomputing
        # ensures Invoice.total_amount = sum(LineItem.amount) =
        # actual tax-inclusive total, internally consistent.
        new_lis, running_total = build_line_items(
            invoice, invoice_data.get("line_items", []) or [], source="ai", default_rate=Decimal("0.03"),
        )
        # bulk_create skips the per-line resync signal (which would re-sum
        # the invoice once per line); the total is the running sum of the
        # recomputed amounts, so no post-hoc SELECT is needed either.
        LineItem.objects.bulk_create(new_lis, batch_size=100)
        line_items_created = len(new_lis)

        # `amount` is the tax-inclusive line subtotal (matches
        # InvoiceForm's contract), so its sum is the true total even if
        # the AI's `total_amount` was off.
        invoice.total_amount = running_total
        invoice.save()

        # Inter-firm: also write the INWARD mirror for the buyer firm
        # (no-op unless inter_firm was requested).
        inward_invoice_id, inward_duplicate = ensure_inward_mirror(invoice)

        return Response(
            {
                "success": True,
                "invoice_id": invoice.id,
                "invoice_number": invoice.invoice_number,
                "customer_name": customer.name,
                "line_items_created": line_items_created,
                "total_amount": invoice.total_amount,
                # Inter-firm mirror info (null when not inter-firm)
                "inward_invoice_id": inward_invoice_id,
                "inward_duplicate": inward_duplicate,
                "message": "Invoice created successfully",
            }
        )

    except Exception as e:
        transaction.set_rollback(True)  # error Responses don't raise, so roll back explicitly
        # Full traceback to logs (with exc_info) — that's where the
        # actual exception type, line, and stack live for debugging.
        # The user sees a generic message; surfacing raw Python
        # errors like "name 'json' is not defined" is bad UX and a
        # mild info leak (tells anyone hitting the API what
        # libraries/functions are in play). The exception class
        # name is included as a small hint without the message
        # body so the user can mention it when reporting bugs.
        logger.error(
            "Error creating invoice from AI data: %s", e, exc_info=True
        )
        return Response(
            {
                "error": (
                    "Could not create invoice due to an internal error. "
                    f"(Reference: {type(e).__name__}) "
                    "Check the server logs or try again."
                ),
            },
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


