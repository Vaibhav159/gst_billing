import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FirmId } from "@/core/scope";
import type { DueData } from "@/core/dashboard/types";
import { toDashboard, toDueNext, toRates } from "@/core/dashboard/wire";
import { dueNextKeys } from "@/core/due/keys";
import { api } from "./client";
export type { Board, Change, DashboardData, DueData, DueItem, DueKind, Figures, Filing, RateRow, RatesData, ReturnFirm, ReturnsData, WindowFigures } from "@/core/dashboard/types";
export const dashboardKeys = { all: ["dashboard"] as const, figures: (firm: FirmId | null, fy: string) => ["dashboard", "figures", firm, fy] as const };
export { dueNextKeys };
export const ratesKeys = { all: ["rates"] as const, board: (date?: string) => ["rates", date ?? null] as const };
const freshness = { staleTime: 60_000, refetchOnMount: true, refetchOnWindowFocus: false } as const;
const firmParams = (firm: FirmId | null) => typeof firm === "number" ? { business_id: firm } : {};
export function useDashboard(firm: FirmId | null, fy: string) {
  return useQuery({ queryKey: dashboardKeys.figures(firm, fy), ...freshness,
    queryFn: firm === null ? skipToken : async ({ signal }) => toDashboard((await api.get("dashboard/", { params: { ...firmParams(firm), fy }, signal })).data) });
}
export function useDueNext(firm: FirmId | null, withReturns = false, enabled = true) {
  const qc = useQueryClient();
  const richQuery = firm === null ? undefined : qc.getQueryCache().find({ queryKey: dueNextKeys.one(firm, true), exact: true });
  const rich = qc.getQueryState<DueData>(dueNextKeys.one(firm, true));
  const slim = qc.getQueryState<DueData>(dueNextKeys.one(firm, false));
  // Share an active/in-flight rich request, or a newer fresh rich answer. This
  // also handles an old slim key left behind by an earlier Easy Home visit.
  const reuseRich = enabled && !withReturns && Boolean(richQuery?.isActive() || rich?.fetchStatus === "fetching" ||
    (rich?.data !== undefined && !rich.isInvalidated && rich.dataUpdatedAt >= (slim?.dataUpdatedAt ?? 0) && Date.now() - rich.dataUpdatedAt < 60_000));
  const wantsReturns = withReturns || reuseRich;
  return useQuery({ queryKey: dueNextKeys.one(firm, wantsReturns), ...freshness, enabled: enabled && firm !== null,
    initialData: () => !wantsReturns && !rich?.isInvalidated ? rich?.data : undefined,
    initialDataUpdatedAt: () => rich?.dataUpdatedAt,
    queryFn: firm === null ? skipToken : async ({ signal }) => toDueNext((await api.get("due-next/", { params: { ...firmParams(firm), ...(wantsReturns ? { returns: 1 } : {}) }, signal })).data) });
}
export function useRates(date?: string, enabled = true) {
  return useQuery({ queryKey: ratesKeys.board(date), ...freshness, enabled,
    queryFn: async ({ signal }) => toRates((await api.get("rates/", { params: date ? { date } : {}, signal })).data) });
}
export type { DashboardData as Dashboard, DueData as DueNext } from "@/core/dashboard/types";
