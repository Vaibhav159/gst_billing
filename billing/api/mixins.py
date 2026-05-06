import logging
from billing.models import AuditLog

logger = logging.getLogger(__name__)

EXCLUDED_FIELDS = {"updated_at", "created_at", "id", "workspace_id"}


class AuditLogMixin:
    """
    Mixin for ModelViewSets that automatically logs create/update/delete
    operations to the AuditLog model with undo support.
    """

    audit_entity: str = ""

    def get_entity_name(self, instance) -> str:
        return str(instance)

    def _snapshot(self, instance) -> dict:
        data = {}
        for field in instance._meta.concrete_fields:
            if field.name not in EXCLUDED_FIELDS:
                value = getattr(instance, field.name)
                data[field.name] = str(value) if value is not None else None
        return data

    def _full_snapshot(self, instance) -> dict:
        """Full snapshot including all fields for undo."""
        data = {}
        for field in instance._meta.concrete_fields:
            value = getattr(instance, field.name)
            if value is not None:
                data[field.name] = str(value)
            else:
                data[field.name] = None
        return data

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
        instance = self.get_object()
        old_snapshot = self._snapshot(instance)
        full_old = self._full_snapshot(instance)
        super().perform_update(serializer)
        instance.refresh_from_db()
        new_snapshot = self._snapshot(instance)
        changes = self._compute_changes(old_snapshot, new_snapshot)
        if changes:
            changed_fields = ", ".join(changes.keys())
            details = f"Updated {changed_fields}"
            self._log(
                "updated", instance, self.request.user,
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
