// The shell imports only the slim list reader; editing and detail code stay in Records chunks.
import { queryOptions } from "@tanstack/react-query";
import { api } from "./client";
import { toPaise } from "@/core/format";
import type { FirmFigures, FirmParams, FirmRow } from "./firms";

export type WireFigures = Omit<FirmFigures, "sales" | "purchases"> & { sales: Omit<FirmFigures["sales"], "total" | "tax"> & { total: string; tax: string }; purchases: Omit<FirmFigures["purchases"], "total" | "tax"> & { total: string; tax: string } };
type WireRow = Omit<FirmRow, "figures"> & { figures?: WireFigures };
export const figures = (f: WireFigures): FirmFigures => ({ ...f, sales: { ...f.sales, total: toPaise(f.sales.total) ?? 0, tax: toPaise(f.sales.tax) ?? 0 }, purchases: { ...f.purchases, total: toPaise(f.purchases.total) ?? 0, tax: toPaise(f.purchases.tax) ?? 0 } });
export function toFirmRow(raw: unknown): FirmRow { const f = raw as WireRow; return { ...f, figures: f.figures ? figures(f.figures) : undefined }; }

export const firmKeys = { all: ["firms"] as const, list: (params: FirmParams) => ["firms", "list", params] as const, one: (id: number | null, fy: string) => ["firms", "one", id, fy] as const };
export function firmListQuery(params: FirmParams = {}) {
  return queryOptions({ queryKey: firmKeys.list(params), staleTime: Object.keys(params).length ? 30_000 : Infinity,
    queryFn: async ({ signal }) => { const d = (await api.get<{ results: unknown[] } | unknown[]>("firms/", { params, signal })).data; return (Array.isArray(d) ? d : d.results).map(toFirmRow); },
  });
}
