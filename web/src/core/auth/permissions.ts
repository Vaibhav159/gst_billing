import data from "./perms.json";
import type { Role } from "./role";

export type Action =
  | "view" | "bill.create" | "bill.edit" | "bill.delete" | "bill.cancel" | "bill.send" | "capture" | "purchase.create" | "purchase.edit"
  | "purchase.delete" | "customer.edit" | "product.edit" | "firm.edit" | "gst.file" | "gst.lock" | "gst.download" | "users.manage"
  | "settings.edit" | "backup.download" | "backup.restore" | "audit.view" | "audit.restore" | "audit.undo" | "reports.export"
  | "customer.merge" | "capture.discard" | "purchase.import" | "supplier.edit" | "rates.edit";

export const ROLES = data.roles as Record<Role, { label: string; blurb: string }>;
const PERMS = data.perms as Record<Role, "*" | string[]>;

export function can(perms: "*" | readonly string[] | null | undefined, action: Action): boolean {
  return perms === "*" || (Array.isArray(perms) && perms.includes(action));
}

const ROLE_WHO: Record<Role, string> = { owner: "the owner", accountant: "the accountant", staff: "counter staff", viewer: "view-only users" };
const ACTION_WHAT: Record<Action, string> = {
  "bill.create": "make bills", "bill.edit": "change bills", "bill.delete": "delete bills", "bill.cancel": "cancel bills", "bill.send": "send bills",
  capture: "take photos of supplier bills", "purchase.create": "add purchases", "purchase.edit": "change purchases", "purchase.delete": "delete purchases",
  "customer.edit": "add or change customers", "product.edit": "add or change products", "firm.edit": "change firm details",
  "gst.file": "mark returns filed", "gst.lock": "lock or unlock a month", "gst.download": "download returns for the portal",
  "users.manage": "manage users", "settings.edit": "change settings", "backup.download": "download backups", "backup.restore": "restore a backup",
  "audit.view": "see the Audit log", "audit.restore": "restore from the Audit log", "audit.undo": "undo changes from the Audit log", "reports.export": "export reports",
  "customer.merge": "merge customers", "capture.discard": "remove captured photos", "purchase.import": "import bills from a file", "supplier.edit": "add or change suppliers", "rates.edit": "set today's rates", view: "see this",
};

/** Why this person can't: "Only the owner and counter staff can make bills. Ask the owner if you need it." */
export function whyNot(role: Role, action: Action, what?: string): string {
  if (can(PERMS[role], action)) return "";
  const who = (Object.keys(PERMS) as Role[]).filter((r) => can(PERMS[r], action)).map((r) => ROLE_WHO[r]);
  const list = who.length > 1 ? `${who.slice(0, -1).join(", ")} and ${who[who.length - 1]}` : who[0] || "the owner";
  return `Only ${list} can ${what || ACTION_WHAT[action] || "do this"}.${role === "owner" ? "" : " Ask the owner if you need it."}`;
}
