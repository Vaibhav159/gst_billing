import { date } from "@/core/format";
import type { BillRow } from "@/core/sales/types";
import { Money, type DLRow } from "@/core/ui";

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
