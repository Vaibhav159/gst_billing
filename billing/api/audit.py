"""Paged audit rows and owner-only actions; list queries never select a snapshot."""
import csv
from io import StringIO

from django.db.models import CharField, Exists, OuterRef, Q
from django.db.models.functions import Cast
from django.http import StreamingHttpResponse
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.cache import uncached
from billing.models import AuditLog, BinnedInvoice, Invoice
from billing.params import date_param, id_param, text_param
from billing.services.audit import GROUPS, KIND_ENTITIES, act, entry_row, read_entries
from billing.text import person

from .permissions import V3Permission
from .sales import Pages

KINDS = ("sales", "purchases", "records", "filing", "admin", "backup")


def kind_filter(kind):
    purchases = Q(entity__in=[entity for entity, match in KIND_ENTITIES.items() if match == "purchases"]) | Q(entity="invoice") & (
        Q(is_purchase=True) | Q(was_purchase=True) | Q(entity_name__startswith="Purchase ") | Q(action__in=("checked", "credit_set")))
    if kind == "purchases":
        return purchases
    if kind == "sales":
        return Q(entity="invoice") & ~purchases
    if kind == "records":
        return ~Q(entity__in=["invoice", *(entity for entity, match in KIND_ENTITIES.items() if match != "records")])
    return Q(entity__in=[entity for entity, match in KIND_ENTITIES.items() if match == kind])


def filtered(params, with_kind=True):
    rows = read_entries().annotate(
        is_purchase=Exists(uncached(Invoice).filter(pk=OuterRef("entity_id"), type_of_invoice="inward")),
        was_purchase=Exists(BinnedInvoice.objects.filter(original_id=OuterRef("entity_id"), type_of_invoice="inward")),
    )
    kind, group = text_param(params, "kind"), text_param(params, "group")
    if kind and kind not in KINDS:
        raise ValidationError({"kind": ["Pick a kind of change from the list."]})
    if group and group not in set(GROUPS.values()):
        raise ValidationError({"group": ["Pick a kind of change from the list."]})
    if kind and with_kind:
        rows = rows.filter(kind_filter(kind))
    if group:
        rows = rows.filter(action__in=[action for action, match in GROUPS.items() if match == group])
    if params.get("by"):
        if params["by"] == "none":
            rows = rows.filter(user_id=None)
        else:
            pk = id_param(params, "by", "Pick a person from the list.")
            if not AuditLog.objects.filter(user_id=pk).exists():
                raise ValidationError({"by": ["Pick a person from the list."]})
            rows = rows.filter(user_id=pk)
    if params.get("entity"):
        rows = rows.filter(entity=text_param(params, "entity"))
    pk = id_param(params, "entity_id", "Pick a record from the list.")
    if pk is not None:
        rows = rows.filter(entity_id=pk)
    q = text_param(params, "q")[:100]
    if q:
        rows = rows.annotate(change_text=Cast("changes", CharField())).filter(Q(entity_name__icontains=q) | Q(details__icontains=q) | Q(change_text__icontains=q))
    start, end = date_param(params, "start_date"), date_param(params, "end_date")
    if start and end and start > end:
        raise ValidationError({"end_date": ["The start date is after the end date."]})
    if start:
        rows = rows.filter(timestamp__date__gte=start)
    if end:
        rows = rows.filter(timestamp__date__lte=end)
    return rows


class AuditPages(Pages):
    page_size = 30
    max_page_size = 100


class AuditView(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"GET": "audit.view", "HEAD": "audit.view"}

    def get(self, request):
        rows = filtered(request.query_params)
        pages = AuditPages()
        page = pages.paginate_queryset(rows, request, view=self)
        response = pages.get_paginated_response([entry_row(entry) for entry in page])
        response.data["total"] = AuditLog.objects.count()
        if request.query_params.get("counts") == "1":
            scope = filtered(request.query_params, with_kind=False)
            response.data["counts"] = {"all": scope.count(), **{kind: scope.filter(kind_filter(kind)).count() for kind in KINDS}}
            people = AuditLog.objects.order_by().values("user_id", "user__first_name", "user__last_name", "user__username").distinct()
            response.data["people"] = [{"id": row["user_id"], "name": (" ".join(filter(None, [row["user__first_name"], row["user__last_name"]])) or row["user__username"]) if row["user_id"] else "Someone no longer here"} for row in people]
        return response


class AuditActionView(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"POST": "audit.undo"}

    def post(self, request, pk, action):
        return Response(act(pk, action, request.user))


def safe_cell(value):
    text = str(value or "")
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else text


class AuditExportView(APIView):
    permission_classes = [V3Permission]
    v3_actions = {"GET": "audit.view", "HEAD": "audit.view"}

    def get(self, request):
        rows = filtered(request.query_params)
        total = rows.count()
        # Capture IDs before logging the completed export, so this download never includes itself.
        upper = AuditLog.objects.order_by("-pk").values_list("pk", flat=True).first() or 0

        def chunks():
            yield "\ufeff"
            output = StringIO()
            writer = csv.writer(output)
            writer.writerow(["Date", "Time", "Person", "What", "Record", "Details", "Changes"])
            yield output.getvalue()
            for entry in rows.filter(pk__lte=upper).iterator(chunk_size=500):
                row = entry_row(entry, actions=False)
                at = timezone.localtime(entry.timestamp)
                words = " ".join(filter(None, row["words"].values()))
                changes = "; ".join(f"{change['field']}: {change['from']} → {change['to']}" for change in row["changes"])
                output.seek(0)
                output.truncate(0)
                writer.writerow([safe_cell(value) for value in [at.date().isoformat(), at.strftime("%H:%M:%S"), (person(entry.user) or {}).get("name", "Someone no longer here"), words, entry.entity_name, entry.details, changes]])
                yield output.getvalue()
            AuditLog.objects.create(user=request.user, action="exported", entity="backup", entity_id=0, entity_name="Audit log", details=f"Audit log · {total:,} entries")

        response = StreamingHttpResponse(chunks(), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="Audit-log_{timezone.localdate().isoformat()}.csv"'
        return response
