import { date, inr, monthLabel, plural } from "@/core/format";
import { waLink } from "@/core/sales/share";

import type { BillRef, Month } from "@/core/gst/types";

// The shared 3C reader has already converted every amount to paise.
export type MonthForEasy = Pick<Month, "business" | "month" | "stage" | "due" | "record" | "checks" | "gstr3b">;
export const OPENING_WORDS = "The opening credit isn't typed yet, so the credit carried in may be too low.";
export function easyGst(row: MonthForEasy) {
  return {
    business: row.business, month: row.month, stage: row.stage, due: row.due,
    filed: { gstr1: row.record?.gstr1?.filed_on ?? null, gstr3b: row.record?.gstr3b?.filed_on ?? null },
    legacy: row.record?.legacy ?? false,
    blockers: (row.checks?.blockers ?? []).map(({ text, bills, ...rest }) => ({ ...rest, words: text,
      bills: bills.filter((bill): bill is BillRef => "invoice_number" in bill).map(({ total_amount, ...bill }) => ({ ...bill, total: total_amount ?? null })) })),
    output: row.gstr3b?.output.total ?? null, cash: row.gstr3b?.cash.total ?? null,
    credit: row.gstr3b?.carry_on.total ?? null, openingMissing: row.gstr3b?.opening_missing ?? false,
  };
}
export type EasyGst = ReturnType<typeof easyGst>;
export function groupBlockers(blockers: EasyGst["blockers"]) {
  const groups = new Map<string, { key: string; kind: string; words: string[]; bills: EasyGst["blockers"][number]["bills"]; more: number }>();
  for (const blocker of blockers) {
    const key = blocker.kind === "duplicate" ? `${blocker.kind}:${blocker.words}` : blocker.kind;
    const group = groups.get(key) ?? { key, kind: blocker.kind, words: [], bills: [], more: 0 };
    if (!group.words.includes(blocker.words)) group.words.push(blocker.words);
    for (const bill of blocker.bills) if (!group.bills.some((found) => found.id === bill.id)) group.bills.push(bill);
    group.more += blocker.more_bills;
    groups.set(key, group);
  }
  return [...groups.values()];
}
export type GstSoFar = { month: string; tax: number; bills: number };
export function gstShareText(firm: string, previous: EasyGst, current: GstSoFar) {
  return [firm,
    `${monthLabel(previous.month, { long: true })}: Tax in this month's GSTR-3B ${inr(previous.output)}; left to pay in cash ${inr(previous.cash)}.`,
    `GSTR-1 due ${date(previous.due.gstr1)}; GSTR-3B due ${date(previous.due.gstr3b)}.`,
    `${monthLabel(current.month, { long: true })} so far: GST on sales ${inr(current.tax)} · ${plural(current.bills, "bill")}.`,
    ...(previous.openingMissing ? [OPENING_WORDS] : []),
  ].join("\n");
}
export async function shareGst(text: string, platform: {
  share?: (data: ShareData) => Promise<void>;
  open: (url: string, target: string) => object | null;
}): Promise<"shared" | "opened" | "cancelled"> {
  if (platform.share) {
    try { await platform.share({ text }); return "shared"; }
    catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      throw new Error("The share sheet couldn't open. Try again.");
    }
  }
  const tab = platform.open(waLink("", text), "_blank");
  if (!tab) throw new Error("The browser stopped WhatsApp from opening. Allow pop-ups, then try again.");
  if ("opener" in tab) tab.opener = null;
  return "opened";
}
