import type { AuditAction, AuditEntity, AuditLogEntry } from "@/utils/mockData";

const STORE_KEY = "gst_audit_log";
const MAX_ENTRIES = 100;

export function logAudit(
  action: AuditAction,
  entity: AuditEntity,
  entityId: string,
  entityName: string,
  user: string = "Admin",
  details?: string,
) {
  const entry: AuditLogEntry = {
    id: crypto.randomUUID(),
    action,
    entity,
    entityId,
    entityName,
    user,
    details,
    timestamp: new Date().toISOString(),
  };

  let log: AuditLogEntry[] = [];
  try {
    log = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
  } catch { /* start fresh */ }

  log = [entry, ...log].slice(0, MAX_ENTRIES);
  localStorage.setItem(STORE_KEY, JSON.stringify(log));
}
