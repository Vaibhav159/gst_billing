import logging

from django.db.models import JSONField, ProtectedError
from rest_framework import status
from rest_framework.response import Response

from billing.models import AuditLog

logger = logging.getLogger(__name__)

EXCLUDED_FIELDS = {"updated_at", "created_at", "id", "workspace_id"}


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
        full_snapshot = self._full_snapshot(instance)
        user = self.request.user
        super().perform_destroy(instance)
        try:
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


class ProtectedDeleteMixin:
    """Turn a PROTECT refusal into a 409 the UI can explain, not a 500."""

    def destroy(self, request, *args, **kwargs):
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError as e:
            # Invoices, and since H6 invoice lines: count the invoices either way.
            n = len({getattr(o, "invoice_id", o.pk) for o in e.protected_objects})
            if all(hasattr(o, "invoice_id") for o in e.protected_objects):
                # Only lines: their invoices belong to someone else now.
                message = (f"Cannot delete: lines on {n} invoice(s) of other parties still name this record. "
                           "An administrator re-points them with manage.py fix_line_customers.")
            else:
                message = f"Cannot delete: {n} invoice(s) still reference this record. Reassign or delete them first."
            return Response({"error": message, "protected": n}, status=status.HTTP_409_CONFLICT)
