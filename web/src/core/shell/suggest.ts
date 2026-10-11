// Search's words that open a list already filtered (PROTO core/shell.jsx:399-438): "udhaar sep" is September's bills on
// udhaar, "kiran gstr1" Kiran's returns, "new anil" a new bill for Anil Gupta. A month is the latest of that name that
// isn't after today (Ruling 1B-23): "mar" in October 2026 is March 2026, and the list then moves the year picker to that
// month's FY itself. And how bills found by a search are ranked.
import { Landmark, Plus, ReceiptText, ShoppingBag, type LucideIcon } from "lucide-react";
import { addMonths, monthLabel } from "@/core/format";
import { counterOf, sameNumber } from "@/core/sales/numbers";
import type { Firm } from "@/core/scope";

export type Suggestion = { group: "Go straight to"; label: string; icon: LucideIcon; to: string };

// a month is its name or the start of it, from three letters ("sep", "sept", "september"); a word that only starts like
// one is a name ("Mayank", "Janki", "Junaid"), so Enter still opens that customer rather than a month's bills
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const PAY_WORDS: [RegExp, "credit" | "cash" | "bank" | "mixed"][] = [[/^(udhaar|udhar|credit)$/, "credit"], [/^cash$/, "cash"], [/^(upi|bank)$/, "bank"], [/^(part|mixed)$/, "mixed"]];
const PAY_LABEL = { credit: "udhaar", cash: "cash", bank: "UPI", mixed: "part cash" };
const GST_WORD = /^(gst|gstr|gstr1|gstr-1|gstr3b|gstr-3b|return|returns|filing)$/;

/** The customer's name in "new anil" or "bill anil" (two characters or more), or null. */
export function newBillFor(text: string): string | null {
  const m = /^(new|bill)\s+(.{2,})$/i.exec(text.trim());
  return m ? m[2].trim() : null;
}

/** customers: what the server found for newBillFor's name, for "New bill for …". */
export function suggestions(text: string, { firms, today, canCreate, customers = [] }: { firms: Firm[]; today: string; canCreate: boolean; customers?: { id: number; name: string }[] }): Suggestion[] {
  const t = text.trim().toLowerCase();
  const out: Suggestion[] = [];
  const words = t.split(/\s+/).filter(Boolean);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  let ym: string | null = null;
  let pay: (typeof PAY_WORDS)[number][1] | null = null;
  let firm: Firm | null = null;
  for (const w of words) {
    const mi = MONTH_NAMES.findIndex((m) => w.length >= 3 && m.startsWith(w));
    if (mi >= 0) ym = `${mi + 1 <= month ? year : year - 1}-${String(mi + 1).padStart(2, "0")}`;
    for (const [rx, v] of PAY_WORDS) if (rx.test(w)) pay = v;
    const f = firms.find((x) => x.short.toLowerCase() === w || x.name.toLowerCase().split(" ")[0] === w);
    if (f) firm = f;
  }
  const qs = (o: Record<string, string | number | null | undefined>) => Object.entries(o).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}=${v}`).join("&");
  if (words.some((w) => GST_WORD.test(w))) {
    const m = ym ?? addMonths(today.slice(0, 7), -1);
    for (const f of firm ? [firm] : firms) out.push({ group: "Go straight to", label: `GST returns · ${f.name} · ${monthLabel(m)}`, icon: Landmark, to: `/gst?firm=${f.id}&month=${m}` });
  } else if (ym || pay) {
    const bits = [ym ? monthLabel(ym, { long: true }) : null, pay ? `paid by ${PAY_LABEL[pay]}` : null, firm ? firm.name : null].filter(Boolean).join(" · ");
    out.push({ group: "Go straight to", label: `Sales bills · ${bits}`, icon: ReceiptText, to: `/sales?${qs({ month: ym, paid: pay, firm: firm?.id })}` });
    if (ym && !pay) out.push({ group: "Go straight to", label: `Purchase bills · ${bits}`, icon: ShoppingBag, to: `/purchases?${qs({ month: ym, firm: firm?.id })}` });
  }
  const name = newBillFor(text)?.toLowerCase();
  const c = name && canCreate ? customers.find((x) => x.name.toLowerCase().includes(name)) : undefined;
  if (c) out.push({ group: "Go straight to", label: `New bill for ${c.name}`, icon: Plus, to: `/sales/new?customer=${c.id}` });
  return out;
}

/** An exact stored number, then a bare counter ("31" finds KGH/2026-27/31), then other matches. */
export function billNumberRank(number: string, term: string): 0 | 1 | 2 {
  const t = term.trim();
  const n = /^\d+$/.test(t) ? Number(t) : null;
  return sameNumber(number, t) ? 0 : n !== null && counterOf(number) === n ? 1 : 2;
}

/** Bills a search found: the exact number or counter first, then the newest (PROTO core/shell.jsx:488-490). */
export function rankBills<T extends { id: number; invoice_number: string; invoice_date: string }>(bills: T[], term: string): T[] {
  return [...bills].sort((a, b) => billNumberRank(a.invoice_number, term) - billNumberRank(b.invoice_number, term) || (a.invoice_date === b.invoice_date ? b.id - a.id : a.invoice_date < b.invoice_date ? 1 : -1));
}
