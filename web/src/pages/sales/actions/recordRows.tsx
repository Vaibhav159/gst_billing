import { date } from "@/core/format";
import type { BillDetail, BillRow } from "@/core/sales/types";
import { dayOf, timeOf } from "@/core/sales/words";
import { Money, type DLRow } from "@/core/ui";

/** Who entered a paper bill, or made a counter bill. */
export function madeByRow(b: Pick<BillDetail, "paper" | "created_at" | "history">, paperNote = false): DLRow {
  const maker = b.history.created_by?.name ?? "Someone";
  return b.paper ? ["Typed in by", `${maker} on ${date(dayOf(b.created_at))}${paperNote ? " · from the paper book" : ""}`]
    : ["Made by", `${maker} · ${timeOf(b.created_at)}`];
}

/** What a confirmation names (PROTO sales/parts.jsx:403-411; part 0 carry: ConfirmDialog's record as rows). */
export function recordRows(b: Pick<BillRow, "business_name" | "invoice_number" | "invoice_date" | "total_amount"> & { customer: { name: string } }): DLRow[] {
  return [
    ["Firm", b.business_name],
    ["Bill no.", <span key="n" className="tnum">{b.invoice_number}</span>],
    ["Date", date(b.invoice_date)],
    ["Customer", b.customer.name],
    ["Total", <Money key="t" value={b.total_amount} strong />],
  ];
}
