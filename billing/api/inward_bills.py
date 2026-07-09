"""Inward Bills module API.

Register (list/detail), AI-assisted extraction (pre-fill only), and create
(verify → save + store file). All over the existing ``Invoice`` model with
``type_of_invoice='inward'``. Tax/dedup/GSTIN rules live in
``inward_bills_service`` so they stay unit-testable.
"""

import json
import logging
from decimal import Decimal

from django.core.files.base import ContentFile
from django.db import IntegrityError, transaction
from django.db.models import Q
from rest_framework import status
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.constants import INVOICE_TYPE_INWARD
from billing.models import Business, Customer, Invoice, LineItem
from billing.utils import AIInvoiceProcessor

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

        override = str(request.data.get("override_warnings", "")).lower() in ("true", "1")
        if find_duplicate(business, invoice_number) and not override:
            return Response(
                {"error": "duplicate", "detail":
                 f"An inward bill #{invoice_number} already exists for {business.name}."},
                status=status.HTTP_409_CONFLICT,
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

        try:
            lines_in = json.loads(request.data.get("lines") or "[]")
        except (ValueError, TypeError):
            return Response({"error": "lines must be valid JSON."}, status=status.HTTP_400_BAD_REQUEST)
        if not lines_in:
            return Response({"error": "At least one line item is required."}, status=status.HTTP_400_BAD_REQUEST)

        intra = bool(supplier_gstin) and supplier_gstin[:2] == (business.gst_number or "")[:2]
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
        computed, _total = compute_lines(service_lines, intra=intra, bill_total=bill_total)

        invoice = Invoice.objects.create(
            workspace_id=WORKSPACE_ID, business=business, customer=supplier,
            invoice_number=invoice_number, invoice_date=invoice_date,
            type_of_invoice=INVOICE_TYPE_INWARD, total_amount=Decimal("0"),
        )
        for c in computed:
            LineItem.objects.create(
                workspace_id=WORKSPACE_ID, customer=supplier, invoice=invoice,
                product_name=c["product_name"], hsn_code=c["hsn_code"],
                gst_tax_rate=c["gst_tax_rate"], quantity=c["quantity"], rate=c["price_rate"],
                cgst=c["cgst"], sgst=c["sgst"], igst=c["igst"], amount=c["amount"], unit=c["unit"],
            )
        _store_file_and_preview(invoice, request.FILES.get("file"))
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
        intra = bool(seller_gstin) and bool(firm_gstin) and seller_gstin[:2] == firm_gstin[:2]
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
