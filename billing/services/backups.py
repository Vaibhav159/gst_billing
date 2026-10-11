"""Streaming, credential-free v2-shaped backups, with bounded uncached reads."""

import json
from datetime import date, datetime
from importlib import import_module
from itertools import islice

from django.contrib.auth.models import User
from django.core.serializers.json import DjangoJSONEncoder
from django.db.models import Count, Q

from billing.api.serializers import (
    BusinessSerializer,
    CustomerSerializer,
    InvoiceSerializer,
    ProductSerializer,
)
from billing.cache import uncached
from billing.fy import fy_label
from billing.models import (
    AuditLog,
    BinnedInvoice,
    Business,
    Customer,
    FiledPeriod,
    Invoice,
    LineItem,
    Product,
    ShopSetting,
)
from billing.roles import can, role_of
from billing.services.bill_reads import _FY_EXPR
from billing.text import person, stamp

BATCH = 500
MEDIA_KEYS = frozenset({"source_file", "source_preview", "signature_image", "signature_image_base64"})


def fields_of(model):
    # These records are copied in full; photos/signatures and auth tables never are.
    return [f.attname for f in model._meta.concrete_fields if f.name not in MEDIA_KEYS]


def batches(queryset, fields):
    rows = queryset.values(*fields).iterator(chunk_size=BATCH)
    while batch := list(islice(rows, BATCH)):
        yield batch


def without_media(value):
    if isinstance(value, dict):
        return {key: without_media(item) for key, item in value.items() if key not in MEDIA_KEYS}
    if isinstance(value, list):
        return [without_media(item) for item in value]
    return value


def record_rows(model, serializer):
    for batch in batches(uncached(model).order_by("pk"), fields_of(model)):
        links = {}
        if model is Customer:
            through = Customer.businesses.through
            for customer_id, business_id in uncached(through).filter(customer_id__in=[r["id"] for r in batch]).values_list("customer_id", "business_id"):
                links.setdefault(customer_id, []).append(Business(pk=business_id))
        for row in batch:
            obj = model(**row)
            if model is Customer:
                obj._prefetched_objects_cache = {"businesses": links.get(obj.pk, [])}
            data = dict(serializer(obj).data)
            data.pop("signature_image_base64", None)
            yield without_media(data)


def invoice_rows():
    for batch in batches(uncached(Invoice).order_by("pk"), fields_of(Invoice)):
        firms = {row["id"]: Business(**row) for row in uncached(Business).filter(
            pk__in={r["business_id"] for r in batch}).values("id", "name", "gst_number", "state_name")}
        customers = {row["id"]: Customer(**row) for row in uncached(Customer).filter(
            pk__in={r["customer_id"] for r in batch}).values("id", "name", "gst_number", "state_name")}
        lines = {}
        for row in uncached(LineItem).filter(invoice_id__in=[r["id"] for r in batch]).order_by("pk").values(*fields_of(LineItem)).iterator(chunk_size=BATCH):
            lines.setdefault(row["invoice_id"], []).append(LineItem(**row))
        for row in batch:
            bill = Invoice(**row)
            bill.business, bill.customer = firms[bill.business_id], customers[bill.customer_id]
            bill._prefetched_objects_cache = {"lineitem_set": lines.get(bill.pk, [])}
            yield without_media(dict(InvoiceSerializer(bill).data))


def people_rows():
    fields = ("id", "username", "first_name", "last_name", "email", "is_active", "is_superuser")
    through = User.groups.through
    for batch in batches(uncached(User).order_by("pk"), fields):
        groups = {}
        for user_id, name in uncached(through).filter(user_id__in=[r["id"] for r in batch]).values_list("user_id", "group__name"):
            groups.setdefault(user_id, set()).add(name)
        for row in batch:
            user = User(**row)
            user._group_names = groups.get(user.pk, set())
            yield {**{key: row[key] for key in ("username", "first_name", "last_name", "email")},
                   "role": role_of(user), "active": row["is_active"]}


def audit_rows():
    fields = ("timestamp", "user_id", "user__username", "user__first_name", "user__last_name",
              "action", "entity", "entity_id", "entity_name", "details", "changes")
    for row in uncached(AuditLog).order_by("pk").values(*fields).iterator(chunk_size=BATCH):
        by = None if not row["user_id"] else {"id": row["user_id"], "name": (
            f"{row['user__first_name']} {row['user__last_name']}".strip() or row["user__username"])}
        yield {"at": stamp(row["timestamp"]), "by": by,
               **{key: row[key] for key in ("action", "entity", "entity_id", "entity_name", "details", "changes")}}


def filing_rows():
    try:
        module = import_module("billing.services.filing")
    except ModuleNotFoundError as error:
        if error.name != "billing.services.filing":
            raise
        return []
    return module.backup_rows()


def counts():
    invoices = uncached(Invoice).aggregate(
        sales=Count("id", filter=Q(type_of_invoice="outward", status="active")),
        cancelled=Count("id", filter=Q(type_of_invoice="outward", status="cancelled")),
        purchases=Count("id", filter=Q(type_of_invoice="inward")))
    suppliers = uncached(Customer).filter(is_supplier=True).count() if "is_supplier" in fields_of(Customer) else 0
    return dict(firms=uncached(Business).count(), customers=uncached(Customer).count(), suppliers=suppliers,
                products=uncached(Product).count(), **invoices, people=uncached(User).count(),
                audit=uncached(AuditLog).count(), bin=uncached(BinnedInvoice).live().count())


def size_words(size):
    return f"{size / 1048576:.1f} MB" if size >= 1048576 else f"{max(1, (size + 1023) // 1024)} KB"


def full_backups():
    return uncached(AuditLog).filter(entity="backup", action="exported", entity_name="Full backup")


def summary(user):
    total = counts()
    years = uncached(Invoice).annotate(fy=_FY_EXPR).values("fy").annotate(
        sales=Count("id", filter=Q(type_of_invoice="outward", status="active")),
        cancelled=Count("id", filter=Q(type_of_invoice="outward", status="cancelled")),
        purchases=Count("id", filter=Q(type_of_invoice="inward"))).order_by("fy")
    recent = []
    if can(user, "audit.view"):
        for row in full_backups().order_by("-timestamp", "-pk").values(
                "id", "timestamp", "user_id", "user__username", "user__first_name", "user__last_name", "details")[:5]:
            parts = row["details"].split(" · ")
            by = None if row["user_id"] is None else {"id": row["user_id"], "name": (
                f"{row['user__first_name']} {row['user__last_name']}".strip() or row["user__username"])}
            recent.append(dict(audit_id=row["id"], at=stamp(row["timestamp"]), by=by,
                               file=parts[-2] if len(parts) >= 2 else "", size=parts[-1]))
    last = full_backups().order_by("-timestamp", "-pk").values_list("timestamp", flat=True).first()
    # ponytail: conservative row-count estimate; exact bytes are recorded when a download completes.
    estimate = 1024 + sum(total[key] * per for key, per in (
        ("firms", 1500), ("customers", 700), ("products", 400), ("sales", 3000),
        ("cancelled", 3000), ("purchases", 3000), ("people", 200), ("audit", 800), ("bin", 3000)))
    return dict(counts=total, years=[{**row, "fy": fy_label(row["fy"])} for row in years],
                recent=recent, last_backup_at=stamp(last), estimated_size=size_words(estimate))


def json_value(value):
    if isinstance(value, datetime):
        return stamp(value)
    if isinstance(value, date):
        return value.isoformat()
    return DjangoJSONEncoder().default(value)


def _array(rows):
    yield "["
    for index, row in enumerate(rows):
        if index:
            yield ","
        yield json.dumps(without_media(row), default=json_value, ensure_ascii=False, separators=(",", ":"))
    yield "]"


def full_stream(user, made, filename):
    total = counts()
    header = dict(app="gst-billing", version="5.0", made=stamp(made), by=person(user)["name"],
                  exportedAt=stamp(made), counts=total)
    setting = uncached(ShopSetting).filter(pk=1).values(*fields_of(ShopSetting)).first()
    if setting is None:
        default = ShopSetting(pk=1)
        setting = {key: getattr(default, key) for key in fields_of(ShopSetting)}
    def content():
        yield json.dumps(header, ensure_ascii=False, separators=(",", ":"))[:-1]
        for key, rows in (
            ("businesses", record_rows(Business, BusinessSerializer)),
            ("customers", record_rows(Customer, CustomerSerializer)),
            ("products", record_rows(Product, ProductSerializer)), ("invoices", invoice_rows())):
            yield f',"{key}":'
            yield from _array(rows)
        yield ',"v3":{"bin":'
        yield from _array(uncached(BinnedInvoice).live().order_by("pk").values(
            "original_id", "kind", "reason", "deleted_at", "deleted_by", "data").iterator(chunk_size=BATCH))
        yield ',"shop_settings":' + json.dumps(setting, default=json_value, ensure_ascii=False, separators=(",", ":"))
        yield ',"people":'
        yield from _array(people_rows())
        yield ',"filed_periods":'
        yield from _array(uncached(FiledPeriod).order_by("pk").values("business", "year", "month").iterator(chunk_size=BATCH))
        yield ',"filing":'
        yield json.dumps(filing_rows(), default=json_value, ensure_ascii=False, separators=(",", ":"))
        yield ',"audit_log":'
        yield from _array(audit_rows())
        yield "}}"
    size = 0
    for chunk in content():
        data = chunk.encode("utf-8")
        size += len(data)
        yield data
    AuditLog.objects.create(action="exported", entity="backup", entity_id=0, entity_name="Full backup", user=user,
        details=f"All years · {total['firms']} firms · {total['sales']} sales bills (and {total['cancelled']} cancelled) "
                f"and {total['purchases']} purchase bills · {filename} · {size_words(size)}")
