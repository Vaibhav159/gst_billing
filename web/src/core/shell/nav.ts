// Where the shells go. Desktop: every section in the top bar (overflow under More).
// Phone Expert: five bottom tabs. Phone Easy: the same five slots with big labels.
import { Building2, Camera, DatabaseBackup, History, Home, MoreHorizontal, Package, ReceiptText, Settings as SettingsIcon, ShieldCheck, Users, type LucideIcon } from "lucide-react";
import type { Action } from "@/core/auth/permissions";

/** A page in the top bar or under More. need: the permission that shows it (none: everyone who can look). */
export type NavItem = { label: string; to: string; section: string; icon?: LucideIcon; need?: Action };
export type TabItem = { label: string; to: string; tab: string; icon: LucideIcon };

export const DESKTOP_NAV: NavItem[] = [
  { label: "Dashboard", to: "/", section: "dashboard" },
  { label: "Sales", to: "/sales", section: "sales" },
  { label: "Purchases", to: "/purchases", section: "purchases" },
  { label: "Customers", to: "/customers", section: "customers" },
  { label: "GST", to: "/gst", section: "gst" },
  { label: "Reports", to: "/reports", section: "reports" },
];
export const MORE_NAV: NavItem[] = [
  { label: "Products", to: "/products", section: "products", icon: Package },
  { label: "Firms", to: "/firms", section: "firms", icon: Building2 },
  { label: "Users and roles", to: "/users", section: "users", icon: ShieldCheck, need: "users.manage" },
  { label: "Backup and restore", to: "/backup", section: "backup", icon: DatabaseBackup, need: "backup.download" },
  { label: "Audit log", to: "/audit", section: "audit", icon: History, need: "audit.view" },
  { label: "Settings", to: "/settings", section: "settings", icon: SettingsIcon, need: "settings.edit" },
];
export const EXPERT_TABS: TabItem[] = [
  { label: "Home", to: "/", tab: "home", icon: Home },
  { label: "Bills", to: "/sales", tab: "bills", icon: ReceiptText },
  { label: "Capture", to: "/capture", tab: "capture", icon: Camera },
  { label: "Customers", to: "/customers", tab: "customers", icon: Users },
  { label: "More", to: "/more", tab: "more", icon: MoreHorizontal },
];
// Same slots as Expert, so the tab under the thumb means the same thing in both modes.
export const EASY_TABS: TabItem[] = [
  { label: "Home", to: "/e", tab: "home", icon: Home },
  { label: "Bills", to: "/e/bills", tab: "bills", icon: ReceiptText },
  { label: "Capture", to: "/e/capture", tab: "capture", icon: Camera },
  { label: "Customers", to: "/e/customers", tab: "customers", icon: Users },
  { label: "More", to: "/e/more", tab: "more", icon: MoreHorizontal },
];

/**
 * The section a path belongs to, as the prototype's routes name it (PROTO/pages/<area>/index.js):
 * the QR scanner and v2's bill-number links are Sales, suppliers are Purchases, /import has none.
 */
const SECTION_OF: Record<string, string> = {
  "": "dashboard", sales: "sales", scan: "sales", billing: "sales", purchases: "purchases", suppliers: "purchases", capture: "capture",
  customers: "customers", gst: "gst", reports: "reports", products: "products", firms: "firms", users: "users", backup: "backup",
  audit: "audit", settings: "settings", profile: "profile", setup: "setup", more: "more",
};
export function sectionOf(pathname: string): string {
  return SECTION_OF[pathname.split("/")[1] ?? ""] ?? "";
}

/**
 * The phone tab a path sits under (the prototype's route `tab`, else its section's): Easy's by its own pages,
 * Expert's by section, with capturing a supplier's bill under Capture. Anything else is under More.
 */
const SECTION_TAB: Record<string, string> = { dashboard: "home", sales: "bills", capture: "capture", customers: "customers" };
const EASY_TAB: Record<string, string> = {
  "": "home", new: "home", gst: "home", bills: "bills", bill: "bills", saved: "bills", capture: "capture", customers: "customers", more: "more", profile: "more",
};
export function tabOf(pathname: string): string {
  const [, first = "", second = ""] = pathname.split("/");
  if (first === "e") return EASY_TAB[second] ?? "more";
  if (first === "purchases" && (second === "capture" || second === "inbox")) return "capture";
  return SECTION_TAB[sectionOf(pathname)] ?? "more";
}

/** Modifier key names as this keyboard shows them. */
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
export const MOD = MAC ? "⌘" : "Ctrl";
export const ALT = MAC ? "⌥" : "Alt";
