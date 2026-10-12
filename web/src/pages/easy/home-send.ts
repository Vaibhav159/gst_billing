import type { QueryClient } from "@tanstack/react-query";
import { problemOf } from "@/core/api/errors";
import { billQuery } from "@/core/api/sales";
import { mobileOf } from "@/core/sales/share";
import type { BillRow } from "@/core/sales/types";

export function isUnsent(b: BillRow, firmId: number, day: string): boolean {
  return b.business === firmId && b.invoice_date === day && b.status === "active" && !b.paper && !b.sent && Boolean(mobileOf(b.customer.mobile_number));
}

/** Every press rechecks the bill; another counter may already have sent, cancelled or deleted it. */
export async function freshUnsent(qc: QueryClient, id: number, firmId: number, day: string) {
  try {
    const result = await qc.fetchQuery({ ...billQuery(id), staleTime: 0, retry: false });
    return result.kind === "bill" && isUnsent(result.bill, firmId, day) ? result.bill : null;
  } catch (error) {
    if (problemOf(error).kind === "notfound") return null;
    throw error;
  }
}
