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
  const rich = qc.getQueryState<DueData>(dueNextKeys.one(firm, true));
  const slim = qc.getQueryState<DueData>(dueNextKeys.one(firm, false));
  const now = Date.now();
  const richUsable = rich?.data !== undefined && !rich.isInvalidated && now - rich.dataUpdatedAt < 60_000;
  const slimUsable = slim?.data !== undefined && !slim.isInvalidated && now - slim.dataUpdatedAt < 60_000;
  // Prefer the newest usable answer. Without a usable plain answer, join a
  // pending rich request; merely observing an older answer gives it no priority.
  const reuseRich = enabled && !withReturns && Boolean(
    (richUsable && (!slimUsable || rich.dataUpdatedAt >= slim.dataUpdatedAt)) ||
    (rich?.fetchStatus === "fetching" && !slimUsable));
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
