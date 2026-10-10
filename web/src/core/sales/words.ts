// Selling's words, said one way everywhere: how a bill was paid, cancelled bills named apart, and a change that didn't
// happen in the app's words. Plan 1C made this file with PAY, PAY_SHORT, cancelledNote, FailText and failText; plan 1B
// adds Selling's other words beside them.
// Plan 1B's (PROTO sales/lib.js, sales/parts.jsx, core/common.jsx): the list's filters, tax labels from the heads stored,
// when a bill was sent, day rows, how many bills (cancelled ones named apart, never added in), list footers, a send or an
// Undo that didn't go through, and words for the months filed, the firms, the year and who may do what.
import type { ApiProblem } from "@/core/api/errors";
import { can, ROLES, type Action } from "@/core/auth/permissions";
import perms from "@/core/auth/perms.json";
import type { Role } from "@/core/auth/role";
import { date, dateShort, daysBetween, groupIN, inr, mobileText, monthLabel, plural, todayIST, weekday } from "@/core/format";
import type { BillRow, MonthFacet, PaymentMode, Sent, Slab } from "./types";

/** How a bill was paid (PROTO core/common.jsx:33-34). "" is not recorded (bills from Tally and old imports). */
export const PAY: Record<PaymentMode, string> = { cash: "Cash", bank: "UPI / bank", credit: "Udhaar", mixed: "Part cash, part UPI", "": "Not recorded" };
export const PAY_SHORT: Record<PaymentMode, string> = { cash: "Cash", bank: "UPI", credit: "Udhaar", mixed: "Part cash", "": "Not recorded" };

export type PayFilter = "any" | "cash" | "bank" | "credit" | "mixed" | "none";
/** The Paid by filter (PROTO sales/lib.js:263), in PAY's words; "none" finds the bills where it isn't recorded. */
export const PAY_FILTER: { value: PayFilter; label: string }[] = [
  { value: "any", label: "Paid by: any" },
  ...(["cash", "bank", "credit", "mixed"] as const).map((value) => ({ value, label: PAY[value] })),
  { value: "none", label: PAY[""] },
];

export type StatusFilter = "any" | "unsent" | "credit" | "cancelled" | "check" | "itax" | "cash";
/** The Status filter (PROTO sales/lib.js:239-247). */
export const STATUS: Record<StatusFilter, string> = {
  any: "Any status", unsent: "Not sent yet", credit: "Udhaar", cancelled: "Cancelled", check: "Needs a check", itax: "Income-tax checks", cash: "Cash ≥ ₹2 lakh",
};

type Heads = { igst: number; cgst: number; sgst: number; interstate: boolean };
/**
 * The heads as stored decide the label: IGST if any was charged, CGST + SGST if they were, else the bill's direction.
 * The printed bill's HSN summary reads it too (plan 1E's print model).
 */
export const storedIgst = (b: Heads): boolean => (b.igst > 0 ? true : b.cgst + b.sgst > 0 ? false : b.interstate);

/** "3% · CGST+SGST", "IGST 3%", "3% + 0.25% · CGST+SGST" (PROTO sales/lib.js:124-129). */
export function gstLabel(b: Heads & { line_count: number; gst_percents: string[] }): string {
  if (!b.line_count) return "No items";
  const r = b.gst_percents.map((p) => `${p}%`).join(" + ");
  return storedIgst(b) ? `IGST ${r}` : `${r} · CGST+SGST`;
}

/** Half a GST percent, as CGST and SGST each carry: "3" -> "1.5%", "0.25" -> "0.125%". */
export function halfPercent(p: string): string {
  return `${Number((Number(p) / 2).toFixed(4))}%`;
}

/** A rate as stored, in rupees: "6512.500" -> "₹6,512.50", "999.995" -> "₹999.995" (a third decimal shows only when it isn't 0). */
export function rateText(rate: string): string {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(rate).trim());
  if (!m) return rate ? `₹${rate}` : "—";
  const frac = `${m[2] ?? ""}000`.slice(0, 3);
  return `₹${groupIN(Number(m[1]))}.${frac.endsWith("0") ? frac.slice(0, 2) : frac}`;
}

/** A tax row: label "CGST 1.5%", and its head and rate apart, as the printed bill sets them in two columns (plan 1E). */
export type TaxLine = { key: string; head: "CGST" | "SGST" | "IGST"; rate: string; label: string; value: number };
/** Tax heads by slab, from what is stored (PROTO sales/lib.js:131-148): [{ key, head: "CGST", rate: "1.5%", label: "CGST 1.5%", value }]. */
export function taxLines(b: Heads & { slabs: Slab[] }): TaxLine[] {
  const igstBill = storedIgst(b);
  const out: TaxLine[] = [];
  const add = (key: string, head: TaxLine["head"], rate: string, value: number) => out.push({ key, head, rate, label: `${head} ${rate}`, value });
  for (const s of b.slabs) {
    if (s.igst || (igstBill && !s.cgst && !s.sgst)) add(`i${s.gst_percent}`, "IGST", `${s.gst_percent}%`, s.igst);
    if (s.cgst || s.sgst || (!igstBill && !s.igst)) {
      add(`c${s.gst_percent}`, "CGST", halfPercent(s.gst_percent), s.cgst);
      add(`s${s.gst_percent}`, "SGST", halfPercent(s.gst_percent), s.sgst);
    }
  }
  return out;
}

const TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** "10:42" in India's time, from the server's ISO timestamp, whatever zone the device is in. "" when there's none. */
export function timeOf(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : TIME.format(d);
}
/** The day in India of a timestamp: "2026-10-08". "" when there's none. */
export function dayOf(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "" : todayIST(d);
}

/** When a bill was first sent: "at 12:09" today, "on 10 Sep at 12:09" before (PROTO core/common.jsx:65-68). */
export function sentWhen(sent: Pick<Sent, "at">, today = todayIST()): string {
  const day = dayOf(sent.at);
  return day === today ? `at ${timeOf(sent.at)}` : `on ${dateShort(day)} at ${timeOf(sent.at)}`;
}
/** A send in one line: "WhatsApp at 12:09 to +91 98290 41122 · 3 times". */
export function sentLine(sent: Sent, today = todayIST()): string {
  const how = sent.via === "share" ? "Shared from the phone" : "WhatsApp";
  return `${how} ${sentWhen(sent, today)}${sent.to ? ` to +91 ${mobileText(sent.to)}` : ""}${sent.count > 1 ? ` · ${sent.count} times` : ""}`;
}

/** "Today, 08 Oct 2026", "Yesterday, 07 Oct 2026", "Tuesday, 06 Oct 2026" (PROTO sales/lib.js:283-288). */
export function dayLabel(iso: string, today = todayIST()): string {
  const d = daysBetween(iso, today);
  if (d === 0) return `Today, ${date(iso)}`;
  if (d === 1) return `Yesterday, ${date(iso)}`;
  return `${weekday(iso)}, ${date(iso)}`;
}

/** Bills by day in list order. partial: the last day loaded, while more bills of it may be on the next page. */
export type DayGroup = { date: string; label: string; bills: BillRow[]; count: number; total: number; cancelled: number; partial: boolean };
export function dayGroups(rows: BillRow[], today: string, complete: boolean): DayGroup[] {
  const out: DayGroup[] = [];
  for (const b of rows) {
    let g = out[out.length - 1];
    if (!g || g.date !== b.invoice_date) {
      g = { date: b.invoice_date, label: dayLabel(b.invoice_date, today), bills: [], count: 0, total: 0, cancelled: 0, partial: false };
      out.push(g);
    }
    g.bills.push(b);
    if (b.status !== "cancelled") { g.count += 1; g.total += b.total_amount; } else g.cancelled += 1;
  }
  if (!complete && out.length) out[out.length - 1].partial = true;
  return out;
}

/** A day row: "2 bills · ₹1,18,640.25 · 1 cancelled" (PROTO sales/lib.js:605-607). */
export function dayCount(g: { count: number; total: number; cancelled: number }): string {
  return `${plural(g.count, "bill")} · ${inr(g.total)}${g.cancelled ? ` · ${g.cancelled} cancelled` : ""}`;
}
/** "a, b and c" */
export function andList(items: string[]): string {
  const xs = items.filter(Boolean);
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/** "1 cancelled bill also listed" (how: "not counted"…), or "" when there are none (PROTO sales/lib.js:608-611). */
export function cancelledNote(n: number, how = "also listed"): string {
  return n ? `${plural(n, "cancelled bill")} ${how}` : "";
}
/** "2 bills and 1 cancelled bill", for what acts on both (a selection, a batch). */
export function billsAnd(bills: { status: string }[]): string {
  const x = bills.filter((b) => b.status === "cancelled").length;
  const a = bills.length - x;
  return andList([a ? plural(a, "bill") : "", x ? plural(x, "cancelled bill") : ""]) || "No bills";
}

/**
 * The line under a list and what its button adds (PROTO sales/lib.js:627-643), from the whole filtered set's counts
 * (counted: the summary's bills; notCounted: the cancelled ones also listed) and the rows on screen.
 */
export function listFooter(counted: number, notCounted: number, visible: { status: string }[], { cancelledOnly = false, newest = true, step = false } = {}): { text: string; more: string | null; rest: "bills" | "cancelled" | null } {
  const counts = (b: { status: string }) => cancelledOnly || b.status !== "cancelled";
  const unit = cancelledOnly ? "cancelled bill" : "bill";
  const shown = visible.filter(counts).length;
  const xShown = visible.length - shown;
  let text: string;
  if (!counted) text = xShown ? `${plural(xShown, "cancelled bill")}, listed but not counted` : "";
  else if (shown >= counted) text = counted === 1 ? `Showing 1 ${unit}` : `Showing all ${plural(counted, unit)}`;
  else text = `Showing ${newest ? "the newest " : ""}${shown} of ${plural(counted, unit)}`;
  if (counted && xShown) text += ` · ${cancelledNote(xShown)}`;
  let more: string | null = null;
  if (shown < counted) more = step ? `Show more · ${plural(counted - shown, unit)} left` : `Show all ${plural(counted, unit)}`;
  else if (xShown < notCounted) more = notCounted - xShown === 1 ? "Show the cancelled bill too" : `Show the ${notCounted - xShown} cancelled bills too`;
  return { text, more, rest: shown < counted ? "bills" : xShown < notCounted ? "cancelled" : null };
}

/** A reason someone typed; old records stored "No reason given" when nobody did (PROTO sales/lib.js:699-702). */
export function realReason(text: string | null | undefined): string {
  const t = String(text ?? "").trim();
  return t && !/^no reason( was)? given\.?$/i.test(t) ? t : "";
}

/** A save (or another change) that didn't happen, in words: what happened, and what to do. */
export type FailText = { title: string; body: string };
/** (PROTO sales/parts.jsx:43-50) verb: "saved", "cancelled", "deleted", "restored"… Only a save says that what was typed is still there. */
export function failText(p: ApiProblem, verb = "saved"): FailText {
  const typed = verb === "saved" ? " What you typed is still here." : "";
  if (p.kind === "offline") return { title: `Not ${verb}: you're offline`, body: `Nothing was changed.${typed} Try again when the internet is back.` };
  if (p.kind === "unreachable" || p.kind === "server") return { title: `Not ${verb}: the app couldn't get through`, body: `Nothing was changed.${typed} Try again in a minute.` };
  return { title: `Not ${verb}`, body: p.message };
}
/** A send that didn't go through (PROTO sales/parts.jsx:166-170); a refusal says the server's words. */
export function sendFailure(p: ApiProblem): { tone: "neg"; title: string; body: string } {
  if (p.kind === "offline") return { tone: "neg", title: "Not sent: you're offline", body: "Nothing was marked as sent. Send it when the internet is back." };
  if (p.kind === "unreachable" || p.kind === "server") return { tone: "neg", title: "The bill wasn't sent", body: "Nothing was marked as sent. Try again in a minute." };
  return { tone: "neg", title: "The bill wasn't sent", body: p.message };
}
/** An Undo of a delete that didn't happen, from a toast (PROTO sales/parts.jsx:172-175); a refusal says the server's words. */
export function restoreFailure(p: ApiProblem, what = "The bill", many = false): { tone: "neg"; title: string; body: string } {
  if (p.kind === "conflict" || p.kind === "forbidden") return { tone: "neg", title: "Not restored", body: p.message };
  const off = p.kind === "offline";
  return { tone: "neg", title: off ? "Not restored: you're offline" : "Not restored",
    body: `${what} ${many ? "stay" : "stays"} deleted. Restore ${many ? "them" : "it"} from the Audit log ${off ? "when you're back online" : "in a minute"}.` };
}

/** Why a bill in a closed month can't change (PROTO core/common.jsx:158-163; part 3 adds "GSTR-1 filed"). */
export const LOCKED_REASON = "This bill's month is filed and locked. Unlock the month in GST returns first (owner only).";

/** "April to August" for the months filed for the firm or firms in view; "every month"; "" (PROTO sales/lib.js:103-110). */
export function filedRangeText(months: MonthFacet[]): string {
  const locked = months.filter((m) => m.locked).map((m) => m.month);
  if (!locked.length) return "";
  if (locked.length === 12) return "every month";
  const a = monthLabel(locked[0], { long: true, year: false });
  const b = monthLabel(locked[locked.length - 1], { long: true, year: false });
  return locked.length === 1 ? a : `${a} to ${b}`;
}

const NUMBER_WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
/** "all three firms" (the prototype's words for every firm in view), "both firms", "the firm". */
export function firmsWord(n: number): string {
  if (n <= 1) return "the firm";
  if (n === 2) return "both firms";
  return n <= 10 ? `all ${NUMBER_WORDS[n]} firms` : `all ${n} firms`;
}
/** "FY 2025-26 (1 Apr 2025 to 31 Mar 2026)" (PROTO sales/lib.js:18). */
export function fyLabel(fy: string): string {
  const y = Number(fy.slice(0, 4));
  return `FY ${fy} (1 Apr ${y} to 31 Mar ${y + 1})`;
}
/**
 * Who may make or change bills, in words: "the owner and counter staff" (PROTO SalesList.jsx:273). Only these two
 * actions: for one the accountant or a viewer may do, this would say "accountant" and "view only" where whyNot says
 * "the accountant" and "view-only users".
 */
export function whoCan(action: Extract<Action, "bill.create" | "bill.edit">): string {
  const all = perms.perms as Record<Role, "*" | string[]>;
  return andList((Object.keys(all) as Role[]).filter((r) => can(all[r], action)).map((r) => (r === "owner" ? "the owner" : ROLES[r].label.toLowerCase())));
}
