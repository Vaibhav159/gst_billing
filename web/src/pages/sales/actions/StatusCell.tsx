import type { ReactElement } from "react";
import { AlertTriangle, Ban, Lock, Wallet } from "lucide-react";
import { date, dateShort } from "@/core/format";
import type { BillDetail, BillRow } from "@/core/sales/types";
import { LOCKED_REASON } from "@/core/sales/words";
import { Badge } from "@/core/ui";

/** What stops a bill going into GSTR-1 as it is, in words; "" when nothing does (PROTO sales/parts.jsx:315-321). */
export function dataProblem(b: Pick<BillRow, "status" | "checks">): string {
  if (b.status === "cancelled") return "";
  if (b.checks.includes("no_lines")) return "No items on this bill";
  if (b.checks.includes("no_hsn")) return "A line has no HSN code";
  if (b.checks.includes("heads_mismatch") || b.checks.includes("tax_mismatch")) return "Its tax needs a look";
  return "";
}

/** Udhaar is a way of being paid, not a warning: a neutral chip (copper is for purchases). */
export function UdhaarChip() {
  return <span className="inline-flex items-center gap-1 h-6 px-2 rounded-full border border-line text-xs font-medium text-fg2 whitespace-nowrap"><Wallet size={12} aria-hidden="true" />Udhaar</span>;
}

export function TaxTypeBadge({ bill }: { bill: Pick<BillRow, "interstate"> }) {
  return <Badge tone="sale">{bill.interstate ? "Sale · inter-state · IGST" : "Sale · local · CGST + SGST"}</Badge>;
}

/**
 * A bill's status in a list or on its page, `max` badges at most (PROTO sales/parts.jsx:327-344): cancelled; its number
 * used twice ("Same no. as 10 Sep" where the other bill is known: its own page); needs a check; the income-tax checks as
 * a quiet Check with the reasons on hover; filed; udhaar where the row doesn't already say it.
 */
export function StatusCell({ bill, hideUdhaar = false, max = 2 }: { bill: BillRow | BillDetail; hideUdhaar?: boolean; max?: number }) {
  if (bill.status === "cancelled") return <Badge tone="neg" icon={Ban}>Cancelled</Badge>;
  const out: ReactElement[] = [];
  if (bill.checks.includes("duplicate")) {
    const other = "duplicates" in bill ? bill.duplicates[0] : undefined;
    out.push(
      <Badge key="d" tone="neg" icon={AlertTriangle} title={other ? `${bill.invoice_number} is also on the bill of ${date(other.invoice_date)}` : undefined}>
        {other ? `Same no. as ${dateShort(other.invoice_date)}` : "Number used twice"}
      </Badge>,
    );
  }
  const prob = dataProblem(bill);
  if (prob) out.push(<Badge key="p" tone="neg" icon={AlertTriangle} title={prob}>Needs a check</Badge>);
  if (bill.itax.length) {
    out.push(
      <Badge key="c" tone="muted" icon={AlertTriangle} title={bill.itax.map((f) => f.text).join(" ")}>
        <span className="sr-only">Income-tax </span>Check<span className="sr-only">: {bill.itax.map((f) => f.short).join(", ")}</span>
      </Badge>,
    );
  }
  if (bill.locked) out.push(<Badge key="l" tone="file" icon={Lock} title={LOCKED_REASON}>Filed</Badge>);
  if (bill.payment_mode === "credit" && !hideUdhaar) out.push(<UdhaarChip key="u" />);
  if (!out.length) return null;
  return <span className="inline-flex flex-wrap items-center gap-1.5">{out.slice(0, max)}</span>;
}
