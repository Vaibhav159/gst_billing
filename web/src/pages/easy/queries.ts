// Easy's part-1 reads use the shared hooks and their cache roots (contract §3).
import { api } from "@/core/api/client";
import { searchTerm, useCustomerList, useCustomerSearch, useRecentCustomers } from "@/core/api/customers";
import { useUnfinishedBills } from "@/core/api/drafts";
import { salesParams, useSalesList, useSalesPage, type SalesQuery } from "@/core/api/sales";
import { fyOf, monthOf, todayIST } from "@/core/format";
import { mobileDigits, mobileProblem } from "@/core/ids";
import type { BillRow } from "@/core/sales/types";
import { toSalesPage } from "@/core/sales/wire";
import { useDebounced } from "@/core/useDebounced";
import { useSaleProducts } from "@/pages/sales/form/products";

const fyStart = (today: string, lastYear = false) => `${Number(fyOf(today).slice(0, 4)) - Number(lastYear)}-04-01`;

export function useEasyToday(firm: number | null, today = todayIST()) {
  return useSalesPage(firm, { start_date: today, end_date: today, ordering: "-date" }, 50);
}
export function useEasyMonth(firm: number | null, today = todayIST()) {
  return useSalesPage(firm, { month: monthOf(today) }, 1);
}
export type EasyBillFilters = { when: "today" | "month" | "year"; q?: string; lastYear?: boolean };
export function useEasyBills(firm: number | null, filters: EasyBillFilters, today = todayIST()) {
  const q = filters.q?.trim();
  const period: SalesQuery = q ? { q, start_date: fyStart(today, filters.lastYear), end_date: today }
    : filters.when === "today" ? { start_date: today, end_date: today }
    : filters.when === "month" ? { month: monthOf(today) } : { fy: fyOf(today) };
  return useSalesList(firm, { ...period, ordering: "-date" }, fyOf(today));
}
export function useEasyRecentCustomers(firm: number | null, today = todayIST()) {
  return useRecentCustomers(firm, true, { from: fyStart(today), to: today, size: 6 });
}
export function useEasyCustomerSearch(firm: number | null, q: string, today = todayIST()) {
  const term = useDebounced(searchTerm(q), 300);
  return useCustomerSearch(term, { size: 12, scope: { firmId: firm, from: fyStart(today), to: today } });
}
export function useEasyCustomers(firm: number | null, q = "", today = todayIST()) {
  return useCustomerList({ firmId: firm, from: fyStart(today), to: today, q, gst: "any", state: "", usualFirm: null, sort: "recent", pageSize: 40 });
}
export function useEasyUnfinishedBills(firm: number | null, fresh = false) {
  return useUnfinishedBills(firm !== null, { fresh, businessId: firm });
}
export const useEasyDrafts = useEasyUnfinishedBills;
export function useEasyProducts(firm: number | null) {
  return useSaleProducts(firm !== null);
}

/** Gather every page before any send changes the unsent set. 6D rechecks each bill's detail before sending it. */
export async function fetchEasyUnsent(firm: number | null, today = todayIST(), signal?: AbortSignal): Promise<BillRow[]> {
  if (firm === null) return [];
  const rows = new Map<number, BillRow>();
  for (let page = 1; ; page++) {
    const answer = toSalesPage((await api.get("sales/", {
      params: salesParams(firm, { start_date: today, end_date: today, unsent: true }, page, 50), signal,
    })).data);
    for (const row of answer.results) {
      if (row.status === "active" && !row.sent && mobileDigits(row.customer.mobile_number) && !mobileProblem(row.customer.mobile_number)) rows.set(row.id, row);
    }
    if (!answer.next) return [...rows.values()];
  }
}
