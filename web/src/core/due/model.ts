import { daysBetween } from "@/core/format";
import type { DueItem, DueKind } from "@/core/dashboard/types";
export const VERB: Record<DueKind, string> = { blocker: "Fix", file_gstr1: "File", pay_3b: "Open", open_blocker: "Fix", credit: "Claim", captures: "Fill in", unsent: "Send", drafts: "Finish", review: "Check", itax: "Check", gaps: "Enter" };
export const COUNT_WORD: Partial<Record<DueKind, string>> = { captures: "waiting", unsent: "not sent", drafts: "unfinished", review: "to check", itax: "to check" };
export const PILL = { neg: "bg-neg-tint text-neg border-neg-line", brand: "bg-brand-tint text-brand border-brand-line", muted: "bg-raised text-fg2 border-line" };
export function chipWhen(today: string, iso: string): string {
  const n = daysBetween(today, iso);
  return n > 1 ? `${n} days` : n === 1 ? "tomorrow" : n === 0 ? "today" : `${-n} ${n === -1 ? "day" : "days"} late`;
}
export function dueTone(item: DueItem, today: string): keyof typeof PILL {
  if (!item.due) return item.kind === "drafts" ? "muted" : "brand";
  const n = daysBetween(today, item.due); return n <= 3 ? "neg" : n <= 15 ? "brand" : "muted";
}
export function dueLink(item: DueItem): string {
  const params = (pairs: Record<string, string | number | null>) => new URLSearchParams(Object.entries(pairs).filter(([, v]) => v !== null).map(([k, v]) => [k, String(v)])).toString();
  const month = params({ firm: item.firm, month: item.month });
  switch (item.kind) {
    case "blocker": return `/gst?${month}&fix=1`;
    case "file_gstr1": case "pay_3b": case "open_blocker": return `/gst?${month}`;
    case "gaps": return `/sales/paper?${month}`;
    case "credit": return `/gst?${params({ tab: "credit", firm: item.firm })}`;
    case "itax": return `/sales?${params({ status: "itax", from: item.from, to: item.to })}`;
    case "captures": return "/purchases/inbox";
    case "unsent": return "/sales?when=today&status=unsent";
    case "drafts": return `/sales/new?${params({ draft: item.draft_id })}`;
    case "review": return "/purchases?status=check";
  }
}
