"""Capture projections and the purchase's signed files, shared by both surfaces."""
from pathlib import PurePosixPath

from django.db import transaction
from django.db.models import Exists, OuterRef
from rest_framework.exceptions import APIException, ValidationError

from billing.cache import uncached
from billing.media import sign_media_path
from billing.models import CapturePage, InwardCapture
from billing.text import money, person, stamp


class CaptureUsed(APIException):
    status_code = 409


def capture_used(capture):
    bill = capture.invoice
    ref = None if bill is None else {
        "id": bill.pk, "invoice_number": bill.invoice_number, "invoice_date": bill.invoice_date.isoformat(),
        "supplier_name": bill.customer.name, "total_amount": money(bill.total_amount), "business_name": bill.business.name,
    }
    detail = f"This photo was filled in already, as {bill.invoice_number}." if bill else "This photo was filled in already."
    error = CaptureUsed()
    error.detail = {"detail": detail, "code": "capture_used", "purchase": ref}
    return error


def capture_queryset():
    return uncached(InwardCapture).select_related("business", "captured_by", "discarded_by",
                                                  "invoice__business", "invoice__customer").only(
        "id", "business_id", "business__name", "image", "supplier_hint", "note", "status", "invoice_id",
        "read_status", "read_data", "read_error", "read_started_at", "read_at", "captured_by_id",
        "captured_by__id", "captured_by__first_name", "captured_by__last_name", "captured_by__username",
        "label", "pdf", "pages", "discarded_at", "discarded_by_id", "discarded_by__id",
        "discarded_by__first_name", "discarded_by__last_name", "discarded_by__username", "created_at",
        "client_id", "invoice__invoice_number", "invoice__invoice_date", "invoice__total_amount",
        "invoice__business_id", "invoice__business__name", "invoice__customer_id", "invoice__customer__name",
    )


def capture_summary(capture):
    read = capture.read_data if isinstance(capture.read_data, dict) else {}
    irn = read.get("irn", "")
    return {"id": capture.pk, "captured_at": stamp(capture.created_at), "captured_by": person(capture.captured_by),
            "pages": capture.pages, "note": capture.note, "hint": capture.supplier_hint, "pdf": capture.pdf,
            "irn": irn if isinstance(irn, str) else ""}


def page_file(page):
    return {"id": f"p{page.position}", "kind": "pdf" if page.content_type == "application/pdf" else "photo",
            "name": (page.original_name or PurePosixPath(page.file.name).name), "url": sign_media_path(page.file.name),
            "preview_url": sign_media_path(page.preview.name) if page.preview else None,
            "page": page.position, "size": page.size}


def purchase_files(invoice):
    files = []
    if invoice.source_file:
        try:
            size = invoice.source_file.size
        except OSError:
            size = 0
        files.append({"id": "src", "kind": "pdf" if invoice.source_file.name.lower().endswith(".pdf") else "photo",
                      "name": PurePosixPath(invoice.source_file.name).name,
                      "url": sign_media_path(invoice.source_file.name),
                      "preview_url": sign_media_path(invoice.source_preview.name) if invoice.source_preview else None,
                      "page": 1, "size": size})
    pages = uncached(CapturePage).filter(capture__invoice_id=invoice.pk).only(
        "position", "file", "preview", "content_type", "size", "original_name").order_by("position")
    files += [page_file(page) for page in pages]
    legacy = uncached(InwardCapture).filter(invoice_id=invoice.pk).exclude(image="").annotate(
        has_pages=Exists(uncached(CapturePage).filter(capture_id=OuterRef("pk"))))
    for capture in legacy.filter(has_pages=False).only("image"):
        try:
            size = capture.image.size
        except OSError:
            size = 0
        name = PurePosixPath(capture.image.name).name
        pdf = name.lower().endswith(".pdf")
        url = sign_media_path(capture.image.name)
        files.append({"id": "p1", "kind": "pdf" if pdf else "photo", "name": name, "url": url,
                      "preview_url": None if pdf or name.lower().endswith((".heic", ".heif")) else url,
                      "page": 1, "size": size})
    return files


@transaction.atomic
def consume_capture(capture_id, invoice):
    capture = capture_queryset().select_for_update(of=("self",)).filter(pk=capture_id).first()
    if capture is None or capture.discarded_at:
        raise ValidationError({"capture": ["That photo isn't in the inbox any more."]})
    if capture.status == "converted":
        raise capture_used(capture)
    capture.status, capture.invoice = "converted", invoice
    capture.save(update_fields=["status", "invoice"])
    return capture
