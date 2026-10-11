import logging

from django.db import transaction
from django.db.models import Exists, JSONField, OuterRef, ProtectedError
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response

from billing.models import AuditLog, BinnedInvoice, Business, Customer, SaleDraft, SavedDraft

logger = logging.getLogger(__name__)

# Left out of an edit's `changes` (the snapshot Undo reads keeps them). firm_snapshot is JSON: v2's Audit log
# page renders each change as a React child, which a JSON object crashes, and a firm change says it already.
EXCLUDED_FIELDS = {"updated_at", "created_at", "id", "workspace_id", "firm_snapshot"}


def snapshot_of(instance) -> dict:
    """Every concrete field as the audit log keeps it, for undo.

    Text, except a JSON field, which stays JSON: as str() a firm snapshot became
    "{'name': ...}", and an undo wrote that string back into the field (S§0.4).
    A foreign key is its id (business_id), never its __str__, so undo can restore it.
    """
    data = {}
    for field in instance._meta.concrete_fields:
        if field.is_relation and field.many_to_one:
            value = getattr(instance, field.attname, None)
        else:
            value = getattr(instance, field.name, None)
        if value is None or isinstance(field, JSONField):
            data[field.name] = value
        else:
            data[field.name] = str(value)
    return data


def links_of(instance) -> dict:
    """Many-to-many links (a customer's firms) kept beside a delete's snapshot, so a restore brings them back."""
    links = {field.name: sorted(getattr(instance, field.name).values_list("pk", flat=True))
             for field in instance._meta.many_to_many}
    return {"_links": links} if links else {}


def mark_undone(entry, user, log, via=None):
    """Spend an audit entry's Undo: v2's undo and v3's restore each mark it, so neither runs twice (H7).

    The marker lives in the snapshot, which the browser never sees, under a key no model field has,
    so the restore loops skip it; `log` is the row the undo wrote. v3's restore adds `via` ("bin" or
    "audit_log"), so a later refusal can say what brought the bill back; v2's marker has no such key.
    """
    marker = {"at": timezone.localtime().isoformat(), "by": getattr(user, "pk", None), "log": log.pk}
    if via:
        marker["via"] = via
    entry.snapshot = {**(entry.snapshot or {}), "_undo": marker}
    entry.save(update_fields=["snapshot"])


class AuditLogMixin:
    """
    Mixin for ModelViewSets that automatically logs create/update/delete
    operations to the AuditLog model with undo support.
    """

    audit_entity: str = ""

    def get_entity_name(self, instance) -> str:
        return str(instance)

    def _snapshot(self, instance) -> dict:
        return {k: v for k, v in snapshot_of(instance).items() if k not in EXCLUDED_FIELDS}

    def _full_snapshot(self, instance) -> dict:
        """Full snapshot including all fields for undo."""
        return snapshot_of(instance)

    def _compute_changes(self, old_snapshot: dict, new_snapshot: dict) -> dict:
        changes = {}
        for key in old_snapshot:
            old_val = old_snapshot.get(key)
            new_val = new_snapshot.get(key)
            if old_val != new_val:
                changes[key] = {"old": old_val, "new": new_val}
        return changes

    def _log(self, action, instance, user, changes=None, details="", snapshot=None):
        try:
            # Its own savepoint: inside a write's transaction (v2's PATCH and PUT run in one, Ruling 1A-26), a row
            # the database refuses would otherwise abort the write it only records.
            with transaction.atomic():
                AuditLog.objects.create(
                    action=action,
                    entity=self.audit_entity,
                    entity_id=instance.pk,
                    entity_name=self.get_entity_name(instance),
                    user=user if user and user.is_authenticated else None,
                    details=details,
                    changes=changes,
                    snapshot=snapshot,
                )
        except Exception:
            logger.exception("Failed to write audit log entry")

    def perform_create(self, serializer):
        super().perform_create(serializer)
        instance = serializer.instance
        self._log("created", instance, self.request.user,
                  snapshot=self._full_snapshot(instance))

    def perform_update(self, serializer):
        # serializer.instance is already loaded by the viewset (one DB hit).
        # Snapshot it BEFORE save (still has old values), then save, then snapshot
        # again (serializer.save() updates instance in-place).
        # Saves: 1 redundant get_object() + 1 refresh_from_db() vs the old impl.
        instance = serializer.instance
        old_snapshot = self._snapshot(instance)
        full_old = self._full_snapshot(instance)
        super().perform_update(serializer)
        # serializer.instance is mutated in place by save() — read fresh values directly
        new_snapshot = self._snapshot(serializer.instance)
        changes = self._compute_changes(old_snapshot, new_snapshot)
        if changes:
            changed_fields = ", ".join(changes.keys())
            details = f"Updated {changed_fields}"
            self._log(
                "updated", serializer.instance, self.request.user,
                changes=changes, details=details, snapshot=full_old,
            )

    def perform_destroy(self, instance):
        entity_name = self.get_entity_name(instance)
        entity_id = instance.pk
        full_snapshot = {**self._full_snapshot(instance), **links_of(instance)}
        user = self.request.user
        super().perform_destroy(instance)
        try:
            with transaction.atomic():
                AuditLog.objects.create(
                    action="deleted",
                    entity=self.audit_entity,
                    entity_id=entity_id,
                    entity_name=entity_name,
                    user=user if user and user.is_authenticated else None,
                    details=f"Deleted {self.audit_entity}: {entity_name}",
                    snapshot=full_snapshot,
                )
        except Exception:
            logger.exception("Failed to write audit log entry for delete")


def protected_delete_response(error):
    """Keep the same v2 refusal for API deletes and Undo."""
    # Bills in the bin still need their customer and firm for a restore: say so (Task 3 review, M1).
    binned = sum(isinstance(o, BinnedInvoice) for o in error.protected_objects)
    # So does a firm's unfinished bill (v3's drafts), which is no invoice: it's finished or discarded first.
    drafts = sum(isinstance(o, SaleDraft) for o in error.protected_objects)
    rest = [o for o in error.protected_objects if not isinstance(o, BinnedInvoice | SaleDraft)]
    # Invoices, and since H6 invoice lines: count the invoices either way.
    n = len({getattr(o, "invoice_id", o.pk) for o in rest})
    if not rest and not binned:
        message = (f"Cannot delete: {drafts} unfinished bill(s) still name this firm. "
                   "Finish or discard them first.")
    elif not rest:
        message = (f"Cannot delete: {binned} bill(s) in the bin still reference this record. "
                   "Restore and reassign them first.")
    elif all(hasattr(o, "invoice_id") for o in rest):
        # Only lines: their invoices belong to someone else now.
        message = (f"Cannot delete: lines on {n} invoice(s) of other parties still name this record. "
                   "An administrator re-points them with manage.py fix_line_customers.")
    else:
        message = f"Cannot delete: {n} invoice(s) still reference this record. Reassign or delete them first."
    if rest and binned:
        message += f" {binned} bill(s) in the bin reference it too."
    if drafts and (rest or binned):
        message += f" {drafts} unfinished bill(s) name it too."
    return Response({"error": message, "protected": n + binned + drafts}, status=status.HTTP_409_CONFLICT)


def settled_party_rows(instance):
    """Rows whose saved/restored records no longer depend on this customer or firm."""
    key = {Customer: "customer", Business: "business"}.get(type(instance))
    if key:
        yield BinnedInvoice.objects.settled().filter(**{key: instance})
    if key == "business":
        yield SaleDraft.objects.filter(business=instance).filter(
            Exists(SavedDraft.objects.filter(pk=OuterRef("pk"))))


def drop_settled_party_rows(instance):
    # Call inside the delete's transaction: a real protection refusal must keep these rows too.
    for rows in settled_party_rows(instance):
        rows.delete()


class ProtectedDeleteMixin:
    """Turn a PROTECT refusal into a 409 the UI can explain, not a 500."""

    def destroy(self, request, *args, **kwargs):
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError as e:
            return protected_delete_response(e)

    def perform_destroy(self, instance):
        with transaction.atomic():
            drop_settled_party_rows(instance)
            super().perform_destroy(instance)
