"""Validate and save each bill's files; media deletion follows transaction commit."""
from datetime import timedelta
from decimal import Decimal
from io import BytesIO
from pathlib import PurePosixPath

from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone
from PIL import Image
from rest_framework.exceptions import ValidationError

from billing.cache import uncached
from billing.models import Business, CapturePage, InwardCapture
from billing.utils import AIInvoiceProcessor

FILE_WORDS = "Choose a photo (JPEG, PNG or HEIC) or a PDF."
MIMES = {"image/jpeg", "image/jpg", "image/png", "image/heic", "image/heif", "application/pdf"}


def check_total_size(total, field="files"):
    if total > 24 * 1024 * 1024:
        size = format((Decimal(total) / (1024 * 1024)).quantize(Decimal("0.1")), "f").rstrip("0").rstrip(".")
        raise ValidationError({field: [f"These pages come to {size} MB. One bill can send at most 24 MB; take fewer or smaller pages."]})


def validate_request_size(request, field="files"):
    # The server's length includes multipart boundaries and non-file fields.
    try:
        length = int(request.META.get("CONTENT_LENGTH") or 0)
    except (TypeError, ValueError):
        length = 0
    check_total_size(length, field)


def validate_files(files, field="files"):
    if not files:
        raise ValidationError({field: [FILE_WORDS]})
    if len(files) > 8:
        raise ValidationError({field: ["A bill can have at most 8 pages here."]})
    total = sum(file.size for file in files)
    check_total_size(total, field)
    for file in files:
        if file.size > 20 * 1024 * 1024:
            size = format((Decimal(file.size) / (1024 * 1024)).quantize(Decimal("0.1")), "f").rstrip("0").rstrip(".")
            raise ValidationError({field: [f"{file.name} is {size} MB. The most is 20 MB."]})
        mime = file.content_type
        if mime == "application/octet-stream" and file.name.lower().endswith((".heic", ".heif")):
            mime = "image/heic"
        if mime not in MIMES:
            raise ValidationError({field: [FILE_WORDS]})
        data = file.read()
        file.seek(0)
        try:
            if mime == "application/pdf":
                if not data.startswith(b"%PDF-"):
                    raise ValueError("not a PDF")
            else:
                with Image.open(BytesIO(data)) as image:
                    formats = {"JPEG": "image/jpeg", "PNG": "image/png", "HEIF": "image/heif", "HEIC": "image/heic"}
                    if image.format not in formats:
                        raise ValueError("unsupported image")
                    mime = formats[image.format]
                    image.verify()
        except (OSError, ValueError, SyntaxError, Image.DecompressionBombError):
            raise ValidationError({field: [FILE_WORDS]}) from None
        suffixes = {"image/jpeg": (".jpg", ".jpeg"), "image/jpg": (".jpg", ".jpeg"),
                    "image/png": (".png",), "image/heic": (".heic", ".heif"),
                    "image/heif": (".heic", ".heif"), "application/pdf": (".pdf",)}
        file._bill_original_name = file.name
        if PurePosixPath(file.name).suffix.lower() not in suffixes[mime]:
            file.name = PurePosixPath(file.name).stem + suffixes[mime][0]
        file.content_type = mime
    return files


def business_from(raw):
    if raw in (None, ""):
        return None
    try:
        number = int(str(raw))
        business = uncached(Business).only("id", "name", "gst_number").filter(pk=number).first() if number > 0 else None
    except (TypeError, ValueError, OverflowError):
        business = None
    if business is None:
        raise ValidationError({"business_id": ["Pick a firm from the list."]})
    return business


def discard_files(files):
    for storage, name in set(files):
        if name:
            storage.delete(name)


def purge_discarded():
    old = uncached(InwardCapture).filter(discarded_at__lt=timezone.now() - timedelta(days=30)).only("id", "image")
    ids, files = [], []
    for capture in old:
        ids.append(capture.pk)
        files.append((capture.image.storage, capture.image.name))
    for page in uncached(CapturePage).filter(capture_id__in=ids).only("file", "preview"):
        files += [(page.file.storage, page.file.name), (page.preview.storage, page.preview.name)]
    uncached(InwardCapture).filter(pk__in=ids).delete()
    transaction.on_commit(lambda: discard_files(files))


def store_pages(capture, files, written):
    for position, file in enumerate(files, 1):
        page = CapturePage(capture=capture, position=position, content_type=file.content_type, size=file.size, original_name=getattr(file, "_bill_original_name", file.name))
        page.file.save(file.name, file, save=False)
        written.append((page.file.storage, page.file.name))
        if file.content_type != "application/pdf":
            file.seek(0)
            content, _ = AIInvoiceProcessor._normalize_image(file.read(), file.content_type)
            page.preview.save(f'{file.name.rsplit(".", 1)[0]}.jpg', ContentFile(content), save=False)
            written.append((page.preview.storage, page.preview.name))
        page.save()
        if position == 1:
            capture.image.name = page.file.name
    capture.save(update_fields=["image"])
