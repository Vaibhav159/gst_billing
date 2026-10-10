// Small helpers the customer screens share (PROTO pages/records/data.js and shared.jsx). What other plans use as well has
// its home in core: PAY, PAY_SHORT, cancelledNote and failText in @/core/sales/words, useDebounced in @/core/useDebounced.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useCustomer, useCustomerSearch, type Customer, type CustomerRow } from "@/core/api/customers";
import { problemOf } from "@/core/api/errors";
import { mobileText, plural, rangeLabel, todayIST } from "@/core/format";
import { checkGstin, GST_STATES, mobileDigits, stateCodeOf, stateTitle } from "@/core/ids";
import type { Firm, FirmId } from "@/core/scope";
import { useDebounced } from "@/core/useDebounced";
import { useView } from "@/core/view";

/** The financial year picked in the top bar, so far: { from, to, label: "FY 2026-27", range: "1 Apr to 8 Oct 2026" }. */
export function fyPeriod(fy: string, today = todayIST()): { from: string; to: string; label: string; range: string } {
  const y = Number(fy.slice(0, 4));
  const from = `${y}-04-01`;
  const end = `${y + 1}-03-31`;
  const to = today < end ? today : end;
  return { from, to, label: `FY ${fy}`, range: rangeLabel(from, to < from ? from : to) };
}
/** "All firms", or the firm's name (short: its short name). */
export function scopeName(firms: Firm[], firmId: FirmId | null, short = false): string {
  const f = typeof firmId === "number" ? firms.find((x) => x.id === firmId) : undefined;
  return f ? (short ? f.short : f.name) : "All firms";
}
/** A state name in the GST table's spelling ("JAMMU & KASHMIR" -> "JAMMU AND KASHMIR"), as the state picker and a GSTIN name it; one the table doesn't have, upper-cased. */
export function tableState(name: string | null | undefined): string {
  const code = stateCodeOf(name);
  return code ? GST_STATES[code] : (name ?? "").trim().toUpperCase();
}
/** The state bills start from: the firm picked, else the first firm (server state names, "RAJASTHAN"). */
export function homeState(firms: Firm[], firmId: FirmId | null): string {
  const f = (typeof firmId === "number" ? firms.find((x) => x.id === firmId) : undefined) ?? firms[0];
  return tableState(f?.state);
}
export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
/** "14 bills and 1 cancelled". */
export function billsWithCancelled(active: number, cancelled: number): string {
  return `${plural(active, "bill")}${cancelled ? ` and ${cancelled} cancelled` : ""}`;
}
/** "98290 41122 · GSTIN 08AB… · Udaipur, Rajasthan", or the walk-in's line (PROTO sales/lib.js customerLine). */
export function customerLine(c: Pick<Customer, "type" | "mobile_number" | "gst_number" | "city" | "state_name">): string {
  if (c.type === "walkin") return "Counter sale · no name or GSTIN on the bill";
  return [mobileText(c.mobile_number) || "No phone", c.gst_number ? `GSTIN ${c.gst_number}` : "No GSTIN", `${c.city || "City not set"}${c.state_name ? `, ${stateTitle(c.state_name)}` : ""}`].join(" · ");
}

/**
 * The customer a route's :id names. id: null with no :id (a new customer), or one that can't be a customer's, which is
 * never asked for. missing: the address names no customer on file (that id, or the server's 404).
 */
export function useRouteCustomer() {
  const { id } = useParams();
  const n = Number(id);
  const cid = Number.isInteger(n) && n > 0 ? n : null;
  const one = useCustomer(cid);
  return { id: cid, one, missing: id !== undefined && (cid === null || (one.isError && problemOf(one.error).kind === "notfound")) };
}

/**
 * Customers already on file with this phone or GSTIN, other than `except` (the one being edited): one search each,
 * once typing pauses, for a whole number (10 digits) or a whole GSTIN (valid, or failing only its check character).
 */
export function useOnFile(phone: string, gstin: string, except?: number): { samePhone: CustomerRow | null; sameGstin: CustomerRow | null } {
  const digits = mobileDigits(phone);
  const phoneTerm = useDebounced(digits.length === 10 ? digits : "");
  const phoneHits = useCustomerSearch(phoneTerm, { size: 5 });
  const g = checkGstin(gstin).status;
  const gTerm = useDebounced(g === "valid" || g === "check" ? gstin : "");
  const gHits = useCustomerSearch(gTerm, { size: 5 });
  const other = (c: CustomerRow) => c.id !== except;
  return {
    samePhone: phoneTerm && phoneTerm === digits ? (phoneHits.data ?? []).find((c) => other(c) && mobileDigits(c.mobile_number) === digits) ?? null : null,
    sameGstin: gTerm && gTerm === gstin ? (gHits.data ?? []).find((c) => other(c) && c.gst_number === gstin) ?? null : null,
  };
}

/* A saved record flashes where it lands: first in the list, or its own page (PROTO shared.jsx:85-95). */
const recent: Record<string, { id: number; t: number }> = {};
export function markSaved(kind: string, id: number) { recent[kind] = { id, t: Date.now() }; }
/**
 * The id saved in the last 8 seconds, read once per visit. It's forgotten in an effect, not while rendering: React's
 * StrictMode renders a page twice, and a second read would find nothing.
 */
export function useJustSaved(kind: string): number | null {
  const [id] = useState(() => {
    const r = recent[kind];
    return r && Date.now() - r.t < 8000 ? r.id : null;
  });
  useEffect(() => { if (id !== null && recent[kind]?.id === id) delete recent[kind]; }, [id, kind]);
  return id;
}

/** Ctrl S (⌘ S) runs `fn` on a desktop. */
export function useCtrlS(fn: () => void) {
  const { isDesktop } = useView();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!isDesktop) return undefined;
    const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); ref.current(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [isDesktop]);
}
/** Spread on Save buttons: a press doesn't blur the field first, so an error appearing under it can't move the button mid-click. */
export const keepFocus = { onMouseDown: (e: { preventDefault(): void }) => e.preventDefault() };

/** Back to the page before this one in the tab, else to `path` (a link opened straight). */
export function useBack(path: string): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    if (((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0) navigate(-1);
    else navigate(path, { replace: true });
  }, [navigate, path]);
}
/**
 * A `?return=` address that stays in this app ("/sales/new"), or null. A browser drops tabs and line breaks from an
 * address and reads \ as /, so "/\t/x.com" and "/\x.com" would leave the app as surely as "//x.com".
 */
export function safeReturn(v: string | null): string | null {
  const path = (v ?? "").replace(/[\t\n\r]/g, "");
  return path.startsWith("/") && !/^\/[/\\]/.test(path) ? path : null;
}

/** Hands a file to the person: the browser downloads it as `name`. */
export function downloadFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
