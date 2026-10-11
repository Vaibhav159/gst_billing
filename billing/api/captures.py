"""The inbox is request driven: upload, inspect, read, discard and undo."""
from datetime import timedelta
from uuid import UUID

from django.db import transaction
from django.db.models import Prefetch, Q
from django.db.models.fields.json import KeyTextTransform, KeyTransform
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.api.permissions import V3Permission
from billing.api.sales import Pages
from billing.cache import uncached
from billing.models import AuditLog, CapturePage, InwardCapture
from billing.params import date_param
from billing.roles import can, why_not
from billing.services.capture_reads import capture_queryset, capture_used, page_file
from billing.services.capture_uploads import (
    business_from,
    discard_files,
    purge_discarded,
    store_pages,
    validate_files,
    validate_request_size,
)
from billing.text import person, stamp

STOPPED = "The reading stopped before it finished."


def capture_status(capture):
    if capture.status == "converted":
        return "filled", ""
    if capture.discarded_at:
        return "discarded", ""
    if capture.read_status == "reading" and (capture.read_started_at or capture.created_at) < timezone.now() - timedelta(minutes=3):
        return "failed", STOPPED
    return capture.read_status or "ready", capture.read_error if capture.read_status == "failed" else ""


def shown(capture):
    status, problem = capture_status(capture)
    pages = [page_file(page) for page in capture.v3_pages.all()]
    if not pages and capture.image:
        from billing.media import sign_media_path
        try:
            size = capture.image.size
        except OSError:
            size = 0
        pdf = capture.image.name.lower().endswith(".pdf")
        url = sign_media_path(capture.image.name)
        pages = [{"page": 1, "kind": "pdf" if pdf else "photo", "url": url,
                  "preview_url": None if pdf or capture.image.name.lower().endswith((".heic", ".heif")) else url, "size": size}]
    purchase = capture_used(capture).detail["purchase"] if capture.status == "converted" else None
    return {"id": capture.pk, "business": capture.business_id,
            "business_name": capture.business.name if capture.business_id else "",
            "label": capture.label or f"Bill photo {capture.pk}", "hint": capture.supplier_hint, "note": capture.note,
            "captured_at": stamp(capture.created_at), "captured_by": person(capture.captured_by),
            "pages": [{key: value for key, value in page.items() if key not in ("id", "name")} for page in pages],
            "pdf": capture.pdf or any(page["kind"] == "pdf" for page in pages), "status": status, "problem": problem, "read": capture.read_data,
            "purchase": purchase, "discarded": {"at": stamp(capture.discarded_at), "by": person(capture.discarded_by)}
            if capture.discarded_at else None}


def queryset():
    return capture_queryset().prefetch_related(Prefetch("v3_pages", queryset=uncached(CapturePage).only(
        "capture_id", "position", "file", "preview", "content_type", "size", "original_name").order_by("position")))


def get_capture(pk, lock=False):
    qs = queryset()
    if lock:
        qs = qs.select_for_update(of=("self",))
    capture = qs.filter(pk=pk).first()
    if capture is None:
        raise NotFound("That photo isn't in the inbox any more.")
    return capture


def log(capture, user, action, details):
    AuditLog.objects.create(entity="capture", entity_id=capture.pk, entity_name=capture.label or f"Bill photo {capture.pk}",
                            user=user, action=action, details=details)


class CaptureSummaryPages(Pages):
    page_size = 50
    max_page_size = 50


class CapturesView(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"POST": "capture"}
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):
        business = business_from(request.query_params.get("business_id"))
        selected = request.query_params.get("status", "waiting")
        if selected not in ("waiting", "filled", "discarded", "all"):
            raise ValidationError({"status": ["Choose Waiting, Filled in, Set aside or All."]})
        summary = request.query_params.get("summary", "0")
        if summary not in ("0", "1"):
            raise ValidationError({"summary": ["Choose 0 or 1 for summary."]})
        day = date_param(request.query_params, "day")
        scope = queryset().order_by("-created_at", "-pk")
        if day:
            scope = scope.filter(created_at__date=day)
        if business:
            scope = scope.filter(Q(business=business) | Q(business__isnull=True))
        waiting = scope.filter(status="new", discarded_at__isnull=True)
        if selected == "waiting":
            scope = waiting
        elif selected == "filled":
            scope = scope.filter(status="converted")
        elif selected == "discarded":
            scope = scope.filter(discarded_at__isnull=False, status="new")
        if summary == "1":
            rows = scope.select_related(None).prefetch_related(None).select_related("captured_by").only(
                "id", "status", "read_status", "read_started_at", "read_error", "discarded_at", "created_at",
                "pages", "captured_by_id", "captured_by__id", "captured_by__first_name",
                "captured_by__last_name", "captured_by__username").annotate(
                    read_supplier=KeyTextTransform("name", KeyTransform("supplier", "read_data")),
                    read_number=KeyTextTransform("invoice_number", "read_data"),
                    read_total=KeyTextTransform("printed_total", "read_data"))
            results = []
            paginator = CaptureSummaryPages()
            for row in paginator.paginate_queryset(rows, request, view=self):
                state, problem = capture_status(row)
                results.append({"id": row.pk, "status": state,
                    "supplier": row.read_supplier or "",
                    "number": row.read_number or "",
                    "total": None if row.read_total in (None, "null") else row.read_total,
                    "problem": problem, "pages": row.pages, "who": person(row.captured_by), "when": stamp(row.created_at)})
            return paginator.get_paginated_response(results)
        counts = {"reading": 0, "ready": 0, "failed": 0, "no_firm": 0}
        for row in waiting.only("read_status", "read_started_at", "business_id", "created_at").select_related(None).prefetch_related(None):
            state = "failed" if row.read_status == "reading" and (row.read_started_at or row.created_at) < timezone.now() - timedelta(minutes=3) else row.read_status or "ready"
            counts[state] += 1
            counts["no_firm"] += row.business_id is None
        results = [shown(row) for row in scope[:100]]
        return Response({"results": results, "count": scope.count(), "counts": counts})

    def post(self, request):
        try:
            client_id = UUID(str(request.data["client_id"])) if request.data.get("client_id") else None
        except ValueError:
            raise ValidationError({"client_id": ["Send the upload id as a UUID."]}) from None
        if client_id:
            # A repeat returns the first capture even if its body would no longer pass (X-60).
            earlier = uncached(InwardCapture).filter(captured_by=request.user, client_id=client_id).values_list("pk", flat=True).first()
            if earlier:
                return Response(shown(get_capture(earlier)), status=200)
        validate_request_size(request)
        files = validate_files(request.FILES.getlist("files"))
        business = business_from(request.data.get("business_id"))
        values = {}
        for key, maximum in [("hint", 120), ("note", 255), ("label", 120)]:
            value = request.data.get(key, "")
            if not isinstance(value, str) or len(value.strip()) > maximum or "\x00" in value:
                raise ValidationError({key: [f"Keep the {key} to {maximum} characters."]})
            values[key] = value.strip()
        written = []
        try:
            with transaction.atomic():
                purge_discarded()
                values = dict(workspace_id=1, business=business, captured_by=request.user,
                    label=values["label"], supplier_hint=values["hint"], note=values["note"],
                    read_status="reading", pages=len(files), pdf=any(file.content_type == "application/pdf" for file in files))
                if client_id:
                    uploader = values.pop("captured_by")
                    capture, created = uncached(InwardCapture).get_or_create(
                        captured_by=uploader, client_id=client_id, defaults=values)
                    if not created:
                        return Response(shown(get_capture(capture.pk)), status=200)
                else:
                    capture = InwardCapture.objects.create(**values)
                store_pages(capture, files, written)
                log(capture, request.user, "captured", f'{business.name if business else "Firm to be decided"} · {len(files)} page(s)')
        except Exception:
            discard_files(written)
            raise
        return Response(shown(get_capture(capture.pk)), status=201)


class CaptureDetailView(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"DELETE": "view", "POST": "view"}

    def get(self, request, pk):
        return Response(shown(get_capture(pk)))

    def authorize(self, request, capture):
        if can(request.user, "capture.discard") or (can(request.user, "capture") and capture.captured_by_id == request.user.pk):
            return
        name = (person(capture.captured_by) or {"name": "Someone else"})["name"]
        detail = f"{name} took this photo. Only the owner can remove someone else's photo. Ask the owner if you need it."
        if not can(request.user, "capture"):
            detail = why_not(request.user, "capture.discard")
        raise PermissionDenied({"detail": detail, "needs": "capture.discard"})

    @transaction.atomic
    def delete(self, request, pk):
        capture = get_capture(pk, lock=True)
        self.authorize(request, capture)
        if capture.status == "converted":
            raise capture_used(capture)
        if capture.discarded_at is None:
            capture.discarded_at, capture.discarded_by = timezone.now(), request.user
            capture.save(update_fields=["discarded_at", "discarded_by"])
            log(capture, request.user, "discarded", "Photo removed from the inbox")
        return Response(shown(capture))

    @transaction.atomic
    def restore(self, request, pk):
        capture = get_capture(pk, lock=True)
        self.authorize(request, capture)
        if capture.status == "converted":
            raise capture_used(capture)
        if capture.discarded_at is not None:
            capture.discarded_at, capture.discarded_by = None, None
            capture.save(update_fields=["discarded_at", "discarded_by"])
            log(capture, request.user, "restored", "Photo put back in the inbox")
        return Response(shown(capture))


class CaptureRestoreView(CaptureDetailView):
    http_method_names = ["post", "options"]
    post = CaptureDetailView.restore


class CaptureReadView(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"POST": "capture"}

    def post(self, request, pk):
        from contextlib import ExitStack

        from django.core.files.uploadedfile import UploadedFile

        from billing.services.ai_reader import ReadFailed, run_read
        with transaction.atomic():
            capture = get_capture(pk, lock=True)
            if capture.status == "converted":
                raise capture_used(capture)
            if capture.discarded_at:
                raise NotFound("That photo isn't in the inbox any more.")
            if capture.read_status == "reading" and capture.read_started_at and capture.read_started_at >= timezone.now() - timedelta(minutes=3):
                return Response(shown(capture))
            if capture.read_data is not None and capture.read_status == "ready":
                return Response(shown(capture))
            token = timezone.now()
            capture.read_status, capture.read_started_at, capture.read_error = "reading", token, ""
            capture.save(update_fields=["read_status", "read_started_at", "read_error"])
        data, problem = None, ""
        try:
            with ExitStack() as stack:
                files = [UploadedFile(stack.enter_context(page.file.open("rb")), name=page.original_name or page.file.name.rsplit("/", 1)[-1],
                                      content_type=page.content_type, size=page.size) for page in capture.v3_pages.all()]
                if not files and capture.image:
                    import mimetypes
                    files = [UploadedFile(stack.enter_context(capture.image.open("rb")), name=capture.image.name.rsplit("/", 1)[-1],
                              content_type=mimetypes.guess_type(capture.image.name)[0] or "image/jpeg", size=capture.image.size)]
                data = run_read(files, request.user, "capture", capture.business, capture=capture)
        except ReadFailed as exc:
            problem = str(exc)
        except OSError:
            problem = "The reader couldn't be reached just now."
        with transaction.atomic():
            current = get_capture(pk, lock=True)
            if current.read_started_at == token:
                current.read_status, current.read_error = ("failed", problem) if problem else ("ready", "")
                if data is not None:
                    current.read_data, current.read_at = data, timezone.now()
                current.save(update_fields=["read_status", "read_error", "read_data", "read_at"])
        return Response(shown(current))
