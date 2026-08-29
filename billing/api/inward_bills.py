"""Inward Bills module API.

Register (list/detail), AI-assisted extraction (pre-fill only), and create
(verify → save + store file). All over the existing ``Invoice`` model with
``type_of_invoice='inward'``. Tax/dedup/GSTIN rules live in
``inward_bills_service`` so they stay unit-testable.
"""

import json
import logging
from types import SimpleNamespace
from decimal import Decimal

from django.core.files.base import ContentFile
from django.db import IntegrityError, transaction
from django.db.models import Q
from rest_framework import status
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.constants import INVOICE_TYPE_INWARD, normalize_payment_mode
from billing.period_lock import assert_period_unlocked
from billing.models import Business, Customer, Invoice, LineItem, InwardCapture
from billing.api.media import sign_media_path
from billing.utils import AIInvoiceProcessor

from billing.tax_rules import is_interstate

from .inward_bills_service import compute_lines, find_duplicate, gstin_matches
from .permissions import RoleBasedPermission
from .serializers import InwardBillListSerializer, InwardBillSerializer

logger = logging.getLogger(__name__)

WORKSPACE_ID = 1
_IMAGE_TYPES = {
    "image/jpeg", "image/jpg", "image/png", "image/heic", "image/heif",
    "application/octet-stream",  # some browsers send .heic as this
}
_ALLOWED_TYPES = _IMAGE_TYPES | {"application/pdf"}
_MAX_SIZE = 20 * 1024 * 1024


class InwardBillPagination(PageNumberPagination):
    page_size = 15
    page_size_query_param = "page_size"
    max_page_size = 500


def _inward_qs():
    return (
        Invoice.objects.filter(type_of_invoice=INVOICE_TYPE_INWARD)
        .select_related("business", "customer")
        .prefetch_related("lineitem_set")
        .order_by("-invoice_date", "-id")
    )


def _store_file_and_preview(invoice, source_file):
    """Attach the original file + a browser-safe JPEG preview (best-effort)."""
    if source_file is None:
        return
    invoice.source_file.save(source_file.name, source_file, save=True)
    try:
        source_file.seek(0)
        jpeg_bytes, _ = AIInvoiceProcessor._normalize_image(
            source_file.read(), source_file.content_type or "image/jpeg"
        )
        base = source_file.name.rsplit(".", 1)[0] or "preview"
        invoice.source_preview.save(f"{base}.jpg", ContentFile(jpeg_bytes), save=True)
    except Exception as e:  # PDFs and odd formats can't be PIL-opened — fine
        logger.warning("inward-bill preview skipped for invoice %s: %s", invoice.pk, e)


class InwardBillListCreateView(APIView):
    permission_classes = [RoleBasedPermission]
    parser_classes = [MultiPartParser, FormParser]
    pagination_class = InwardBillPagination

    def get(self, request):
        qs = _inward_qs()
        business = request.query_params.get("business")
        if business:
            qs = qs.filter(business_id=business)
        date_from = request.query_params.get("date_from")
        if date_from:
            qs = qs.filter(invoice_date__gte=date_from)
        date_to = request.query_params.get("date_to")
        if date_to:
            qs = qs.filter(invoice_date__lte=date_to)
        q = request.query_params.get("q")
        if q:
            qs = qs.filter(
                Q(customer__name__icontains=q)
                | Q(customer__gst_number__icontains=q)
                | Q(invoice_number__icontains=q)
            )
        paginator = self.pagination_class()
        page = paginator.paginate_queryset(qs, request, view=self)
        ser = InwardBillListSerializer(page, many=True, context={"request": request})
        return paginator.get_paginated_response(ser.data)

    @transaction.atomic
    def post(self, request):
        business = Business.objects.filter(
            id=request.data.get("business_id") or request.data.get("business")
        ).first()
        if business is None:
            return Response({"error": "Unknown business."}, status=status.HTTP_400_BAD_REQUEST)

        invoice_number = (request.data.get("invoice_number") or "").strip()
        invoice_date = (request.data.get("invoice_date") or "").strip()
        if not invoice_number or not invoice_date:
            return Response(
                {"error": "invoice_number and invoice_date are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        supplier_gstin = (request.data.get("supplier_gstin") or "").strip().upper()
        supplier_name = (request.data.get("supplier_name") or "").strip()
        if not supplier_name and not supplier_gstin:
            return Response(
                {"error": "A supplier name or GSTIN is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            supplier = self._resolve_supplier(business, supplier_gstin, supplier_name, request.data)
        except IntegrityError:
            return Response(
                {"error": "supplier_name_conflict", "detail":
                 f"A different customer is already named '{supplier_name}'. Adjust the name."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Dup check AFTER the supplier is known, so the key is
        # (business, supplier, number) — the same bill number from two
        # different suppliers is not a duplicate.
        override = str(request.data.get("override_warnings", "")).lower() in ("true", "1")
        if find_duplicate(business, invoice_number, supplier) and not override:
            return Response(
                {"error": "duplicate", "detail":
                 f"An inward bill #{invoice_number} from {supplier.name} already exists "
                 f"for {business.name}."},
                status=status.HTTP_409_CONFLICT,
            )

        try:
            lines_in = json.loads(request.data.get("lines") or "[]")
        except (ValueError, TypeError):
            return Response({"error": "lines must be valid JSON."}, status=status.HTTP_400_BAD_REQUEST)
        if not lines_in:
            return Response({"error": "At least one line item is required."}, status=status.HTTP_400_BAD_REQUEST)

        # Shared rule with the invoice write paths. The old inline check was
        # `bool(supplier_gstin) and codes match`, so a supplier with no GSTIN
        # fell through to interstate and the whole bill was taxed IGST.
        supplier_for_rule = SimpleNamespace(
            gst_number=supplier_gstin,
            state_name=(request.data.get("supplier_state") or getattr(supplier, "state_name", "") or ""),
        )
        intra = not is_interstate(business, supplier_for_rule)
        service_lines = []
        for ln in lines_in:
            qty = Decimal(str(ln.get("quantity") or "0"))
            price = Decimal(str(ln.get("rate") or "0"))
            taxable = Decimal(str(ln["taxable"])) if ln.get("taxable") not in (None, "") else qty * price
            service_lines.append({
                "product_name": (ln.get("product_name") or "").strip(),
                "hsn_code": (ln.get("hsn_code") or "").strip(),
                "unit": (ln.get("unit") or "pcs").strip() or "pcs",
                "quantity": qty,
                "price_rate": price,
                "gst_tax_rate": Decimal(str(ln.get("gst_tax_rate") or "0.03")),
                "taxable": taxable,
                "rate": Decimal(str(ln.get("gst_tax_rate") or "0.03")),
            })
        bill_total = request.data.get("bill_total")
        bill_total = Decimal(str(bill_total)) if bill_total not in (None, "") else None
        computed, total = compute_lines(service_lines, intra=intra, bill_total=bill_total)

        assert_period_unlocked(business.id, invoice_date, "create")
        invoice = Invoice.objects.create(
            workspace_id=WORKSPACE_ID, business=business, customer=supplier,
            invoice_number=invoice_number, invoice_date=invoice_date,
            type_of_invoice=INVOICE_TYPE_INWARD, total_amount=Decimal("0"),
            payment_mode=normalize_payment_mode(request.data.get("payment_mode")),
        )
        # bulk_create skips the per-line signal; compute_lines already returned
        # the round-off-adjusted total, so store that instead of re-summing.
        LineItem.objects.bulk_create(
            [
                LineItem(
                    workspace_id=WORKSPACE_ID, customer=supplier, invoice=invoice,
                    product_name=c["product_name"], hsn_code=c["hsn_code"],
                    gst_tax_rate=c["gst_tax_rate"], quantity=c["quantity"], rate=c["price_rate"],
                    cgst=c["cgst"], sgst=c["sgst"], igst=c["igst"], amount=c["amount"], unit=c["unit"],
                )
                for c in computed
            ],
            batch_size=100,
        )
        # In-memory too: _store_file_and_preview saves the instance (file
        # field), and a stale 0 here would clobber the total just written.
        invoice.total_amount = total
        Invoice.objects.filter(pk=invoice.pk).update(total_amount=total)
        _store_file_and_preview(invoice, request.FILES.get("file"))

        # Converting a phone capture: attach its stored photo as the bill's
        # source file and retire the capture from the inbox.
        capture_id = request.data.get("capture_id")
        if capture_id:
            cap = InwardCapture.objects.filter(id=capture_id, status="new").first()
            if cap and cap.image and not request.FILES.get("file"):
                class _StoredUpload:
                    def __init__(self, f, name):
                        self._f = f
                        self.name = name.rsplit("/", 1)[-1]
                        self.content_type = "image/jpeg"
                    def read(self, *a): return self._f.read(*a)
                    def seek(self, *a): return self._f.seek(*a)
                with cap.image.open("rb") as fh:
                    _store_file_and_preview(invoice, _StoredUpload(fh, cap.image.name))
            if cap:
                cap.status = "converted"
                cap.invoice = invoice
                cap.save(update_fields=["status", "invoice", "updated_at"])
        invoice.refresh_from_db()
        return Response(
            InwardBillSerializer(invoice, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    def _resolve_supplier(self, business, gstin, name, data):
        supplier = None
        if gstin:
            supplier = Customer.objects.filter(gst_number=gstin).first()
        if supplier is None and name:
            supplier = Customer.objects.filter(name=name).first()
        if supplier is None:
            supplier = Customer.objects.create(
                workspace_id=WORKSPACE_ID, name=name or gstin,
                gst_number=gstin or None,
                pan_number=(data.get("supplier_pan") or (gstin[2:12] if len(gstin) >= 12 else "")) or None,
                address=(data.get("supplier_address") or "") or None,
                mobile_number=(data.get("supplier_mobile") or "") or None,
                state_name=(data.get("supplier_state") or "") or None,
            )
            # Registry fills whatever the bill didn't carry (address, state,
            # PAN) — empty fields only, quiet on failure.
            from billing.gstin import enrich_customer

            enrich_customer(supplier)
        if not supplier.businesses.filter(id=business.id).exists():
            supplier.businesses.add(business)
        return supplier


class InwardBillDetailView(APIView):
    permission_classes = [RoleBasedPermission]

    def get(self, request, pk):
        invoice = _inward_qs().filter(pk=pk).first()
        if invoice is None:
            return Response({"error": "Inward bill not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(InwardBillSerializer(invoice, context={"request": request}).data)


class InwardBillExtractView(APIView):
    """AI pre-fill only — never writes to the DB."""

    permission_classes = [RoleBasedPermission]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        file = request.FILES.get("file") or request.FILES.get("image")
        capture_id = request.data.get("capture_id")
        if file is None and capture_id:
            cap = InwardCapture.objects.filter(id=capture_id).first()
            if cap is None or not cap.image:
                return Response({"error": "Capture not found."}, status=status.HTTP_404_NOT_FOUND)
            from django.core.files.uploadedfile import SimpleUploadedFile
            with cap.image.open("rb") as fh:
                file = SimpleUploadedFile(
                    cap.image.name.rsplit("/", 1)[-1], fh.read(), content_type="image/jpeg")
        if file is None:
            return Response({"error": "No file provided."}, status=status.HTTP_400_BAD_REQUEST)
        if file.content_type not in _ALLOWED_TYPES:
            return Response(
                {"error": f"Unsupported file type '{file.content_type}'. Upload PDF, JPEG, PNG, or HEIC."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if file.size > _MAX_SIZE:
            return Response({"error": "File too large. Maximum size is 20MB."},
                            status=status.HTTP_400_BAD_REQUEST)

        business = Business.objects.filter(id=request.data.get("business_id")).first()

        blank = {
            "supplier": {"name": "", "gstin": "", "address": "", "pan": "", "mobile": ""},
            "invoice_number": "", "invoice_date": "", "line_items": [],
            "tax_type": "cgst_sgst",
            "warnings": {"gstin_mismatch": False, "duplicate": False, "extraction_failed": True},
        }
        # PDF / AI extraction only runs on images; PDFs fall back to manual entry
        # (the file is still stored + viewable on create).
        if file.content_type not in _IMAGE_TYPES:
            return Response(blank)

        try:
            data = AIInvoiceProcessor().process_invoice_image(
                file, business_id=(business.id if business else None)
            )
        except Exception as e:
            logger.warning("inward-bill extraction failed: %s", e)
            return Response(blank)

        buyer_gstin = (data.get("buyer_gst_number") or data.get("customer_gst_number") or "").strip().upper()
        seller_gstin = (data.get("seller_gst_number") or "").strip().upper()
        seller_name = data.get("seller_name") or ""
        # On an inward bill our firm is the buyer; the supplier is the seller.
        # If the model only filled the "Bill To" customer_* block, fall back to it.
        if not seller_gstin and not seller_name:
            seller_gstin = (data.get("customer_gst_number") or "").strip().upper()
            seller_name = data.get("customer_name") or ""

        firm_gstin = business.gst_number if business else ""
        # Same rule as create(), so the preview and the saved bill agree.
        intra = bool(business) and not is_interstate(
            business, SimpleNamespace(gst_number=seller_gstin, state_name="")
        )
        invoice_number = data.get("invoice_number") or ""

        return Response({
            "supplier": {
                "name": seller_name, "gstin": seller_gstin,
                "address": "", "pan": (seller_gstin[2:12] if len(seller_gstin) >= 12 else ""),
                "mobile": "",
            },
            "invoice_number": invoice_number,
            "invoice_date": data.get("invoice_date") or "",
            "line_items": data.get("line_items") or [],
            "tax_type": "cgst_sgst" if intra else "igst",
            "warnings": {
                # Only flag a mismatch when the AI actually read a buyer GSTIN
                # that differs from the firm's — not when it simply failed to
                # extract one (empty), which would false-positive on clean bills.
                "gstin_mismatch": bool(business) and bool(buyer_gstin)
                and not gstin_matches(buyer_gstin, firm_gstin),
                "duplicate": bool(business and invoice_number
                                  and find_duplicate(business, invoice_number)),
                "extraction_failed": False,
            },
        })


class InwardCaptureListCreateView(APIView):
    """The capture inbox: snap now, sort later."""

    permission_classes = [RoleBasedPermission]
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):
        qs = InwardCapture.objects.select_related("business").order_by("-created_at")
        status_f = request.query_params.get("status", "new")
        if status_f and status_f != "all":
            qs = qs.filter(status=status_f)
        rows = [
            {
                "id": c.id,
                "status": c.status,
                "business": c.business_id,
                "business_name": c.business.name if c.business_id else "",
                "supplier_hint": c.supplier_hint,
                "note": c.note,
                "image_url": sign_media_path(c.image.name) if c.image else "",
                "invoice": c.invoice_id,
                "created_at": c.created_at.isoformat(),
            }
            for c in qs[:100]
        ]
        return Response({"results": rows, "count": qs.count()})

    def post(self, request):
        image = request.FILES.get("image") or request.FILES.get("file")
        if image is None:
            return Response({"error": "No image provided."}, status=status.HTTP_400_BAD_REQUEST)
        business = None
        biz_id = request.data.get("business_id")
        if biz_id:
            business = Business.objects.filter(id=biz_id).first()
        cap = InwardCapture.objects.create(
            workspace_id=WORKSPACE_ID,
            business=business,
            supplier_hint=(request.data.get("supplier_hint") or "").strip()[:255],
            note=(request.data.get("note") or "").strip()[:255],
        )
        cap.image.save(image.name, image, save=True)
        return Response({"id": cap.id, "status": cap.status}, status=status.HTTP_201_CREATED)


class InwardCaptureDetailView(APIView):
    permission_classes = [RoleBasedPermission]

    def get(self, request, pk):
        c = InwardCapture.objects.filter(pk=pk).select_related("business").first()
        if c is None:
            return Response({"error": "Capture not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response({
            "id": c.id, "status": c.status, "business": c.business_id,
            "business_name": c.business.name if c.business_id else "",
            "supplier_hint": c.supplier_hint, "note": c.note,
            "image_url": sign_media_path(c.image.name) if c.image else "",
            "invoice": c.invoice_id, "created_at": c.created_at.isoformat(),
        })

    def delete(self, request, pk):
        c = InwardCapture.objects.filter(pk=pk).first()
        if c is None:
            return Response({"error": "Capture not found."}, status=status.HTTP_404_NOT_FOUND)
        if c.image:
            c.image.delete(save=False)
        c.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
