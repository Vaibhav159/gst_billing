"""Return attachments and the small server record of handing a file to the CA."""

import hashlib
import json

from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.db.models import F, Q
from rest_framework.exceptions import NotFound, ValidationError

from billing.cache import uncached
from billing.models import AuditLog, BinnedInvoice, FilingMonth, FilingRecord, Invoice, ReturnDownload
from billing.text import person, stamp


def fingerprint(body):
    canonical = json.dumps(body, cls=DjangoJSONEncoder, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(canonical.encode()).hexdigest()


def file_name(business, month, kind="gstr1"):
    if kind == "bundle":
        return f"GST_{business.name.split()[0].title()}_{month:%m%Y}_for_CA.zip"
    prefix = "GSTR1" if kind in ("gstr1", "gstr1_filed", "amend") else kind.upper()
    tail = "_amendments" if kind == "amend" else ""
    return f"{prefix}_{business.gst_number}_{month:%m%Y}{tail}.json"


def via_input(data):
    via = data.get("via", "download")
    if via not in ("download", "share"):
        raise ValidationError({"via": ["Choose download or share."]})
    return via


@transaction.atomic
def record_download(business, month, kind, user, via, body):
    row = ReturnDownload.objects.create(business=business, year=month.year, month=month.month,
                                        kind=kind, by=user, via=via, fingerprint=fingerprint(body))
    AuditLog.objects.create(entity="gst_file", entity_id=row.pk, entity_name=file_name(business, month, kind),
                            user=user, action="sent" if via == "share" else "downloaded",
                            details=f"{business.name} · {month:%B %Y} · {kind.upper()}")
    return row


def download_state(business, month, body):
    row = uncached(ReturnDownload).filter(business_id=business.pk, year=month.year, month=month.month,
                                         kind="gstr1").select_related("by").only(
        "id", "fingerprint", "via", "at", "by_id", "by__id", "by__username", "by__first_name", "by__last_name"
    ).order_by("-at", "-id").first()
    if row is None:
        return None
    ids = Invoice.objects.sales().filter(business_id=business.pk, invoice_date__year=month.year,
                                        invoice_date__month=month.month).values_list("id", flat=True)
    binned = uncached(BinnedInvoice).filter(business_id=business.pk, invoice_date__year=month.year,
                                           invoice_date__month=month.month).values_list("original_id", flat=True)
    changed = uncached(AuditLog).filter(entity="invoice", timestamp__gt=row.at).filter(
        Q(entity_id__in=ids) | Q(entity_id__in=binned)
    ).exclude(action__in=("printed", "exported", "sent")).select_related("user").only(
        "entity_id", "entity_name", "action", "timestamp", "user_id", "user__id", "user__first_name",
        "user__last_name", "user__username").order_by("-timestamp", "-id")[:10]
    numbers = dict(Invoice.objects.sales().filter(id__in=[item.entity_id for item in changed]).values_list("id", "invoice_number"))
    missing = [item.entity_id for item in changed if item.entity_id not in numbers]
    numbers.update(uncached(BinnedInvoice).filter(original_id__in=missing).values_list("original_id", "invoice_number"))
    return {"by": person(row.by), "at": stamp(row.at), "via": row.via,
            "stale": row.fingerprint != fingerprint(body),
            "changed": [{"id": item.entity_id, "invoice_number": numbers.get(item.entity_id, item.entity_name), "action": item.action,
                         "at": stamp(item.timestamp), "by": (person(item.user) or {}).get("name", "")}
                        for item in changed]}


def filed_snapshot(business, month, *, sections=False):
    key = "figures__sections" if sections else "file"
    row = uncached(FilingRecord).filter(business_id=business.pk, year=month.year, month=month.month,
        kind__in=("gstr1", "gstr1a") if sections else ("gstr1",)).annotate(
            content=F(key)).values("content").order_by("kind").last()
    if row is None:
        row = uncached(FilingMonth).filter(business_id=business.pk, year=month.year, month=month.month,
            legacy_frozen_at__isnull=False).annotate(content=F("legacy_snapshot__gstr1__" + key)).values("content").first()
    if row is None:
        raise NotFound(f"{month:%B %Y}'s GSTR-1 isn't on record.")
    return row["content"]
