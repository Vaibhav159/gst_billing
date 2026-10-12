import type { QueryClient } from "@tanstack/react-query";
import type { Dashboard } from "@/core/api/dashboard";
import type { BillRow, Sent } from "@/core/sales/types";

/** Changed facts stale every scope; only a screen actually showing them asks again. */
export function invalidateDashboard(qc: QueryClient): void {
  for (const queryKey of [["dashboard"], ["due-next"]]) void qc.invalidateQueries({ queryKey, refetchType: "active" });
}

/** A send changes these rows immediately, without pretending the aggregate figures were just read. */
export function putDashboardSent(qc: QueryClient, id: number, sent: Sent | null): void {
  if (!sent) return;
  // Cancellation reverts synchronously: a GET begun before the send cannot later overwrite its receipt.
  void qc.cancelQueries({ queryKey: ["dashboard"] });
  const patch = (rows: BillRow[]) => rows.map(row => row.id === id ? { ...row, sent } : row);
  for (const query of qc.getQueryCache().findAll({ queryKey: ["dashboard"] })) {
    const data = query.state.data as Dashboard | undefined;
    if (!data?.today || ![...data.today.bills, ...data.today.recent].some(row => row.id === id)) continue;
    const { dataUpdatedAt, isInvalidated } = query.state;
    qc.setQueryData<Dashboard>(query.queryKey, {
      ...data, today: { ...data.today, bills: patch(data.today.bills), recent: patch(data.today.recent) },
    }, { updatedAt: dataUpdatedAt });
    if (isInvalidated) query.invalidate();
  }
}
