import { useQuery } from "@tanstack/react-query";
import { api } from "@/core/api/client";
import { toPaise } from "@/core/format";
import type { FirmId } from "@/core/scope";
import { lastDay } from "@/pages/reports/period";
import { slabOf } from "@/pages/sales/form/model";
import type { Reconciliation, ReportFirm, ReportHeads, ReportKind, ReportMap, ReportParty, ReportPurchase, ReportSale, ReportSplit, ReportStage, ReportTotals, TaxMonth } from "@/core/gst/reportTypes";

export type ReportQuery = { businessId: FirmId | null; from: string; to: string; split: boolean };
type WireHeads = { igst: string; cgst: string; sgst: string; total: string };
type WireAmounts = Omit<WireHeads, "total"> & { taxable: string; tax: string; value: string; round_off: string; bills: number; cancelled?: number };
type WireSplit = Omit<ReportSplit, "value" | "taxable" | "igst" | "cgst" | "sgst"> & { value: string; taxable: string; igst: string; cgst: string; sgst: string };
type WireBill<T> = Omit<T, "taxable" | "heads" | "total"> & { taxable: string; heads: WireHeads; total: string };
type WireGap = { by_date: string; by_return: string; difference: string; parts: string[] };
type WireTaxMonth = { month: string; output: WireHeads; credit: WireHeads; cash: WireHeads | null; carry_on: WireHeads | null; state: TaxMonth["state"]; gstr1_filed_on: string | null; gstr3b_filed_on: string | null };
/** Exact projection keys from plan 3B's build_report, extended by binding rulings X-11/X-37. No UI fixture masquerades as an endpoint. */
export type ReportWireMap = {
  sales: { bills: WireBill<ReportSale>[]; totals: WireAmounts; by_firm: (WireAmounts & { firm: ReportFirm })[]; split: WireSplit[] };
  purchases: { bills: WireBill<ReportPurchase>[]; totals: WireAmounts; credit_by_return: WireAmounts; gap: WireGap; split: WireSplit[] };
  tax: { firms: { firm: ReportFirm; rows: WireTaxMonth[]; totals: { output: WireHeads; credit: WireHeads; cash: WireHeads | null } }[]; gap: WireGap; cuts_month: boolean };
  hsn: { side: "sales" | "purchases"; rows: { hsn: string; description: string; uqc: string; quantity: string; rate: string; taxable: string; igst: string; cgst: string; sgst: string; bills: number }[]; totals: WireAmounts };
  months: { rows: { month: string; sales: WireAmounts; purchases: WireAmounts; sales_tax: string; credit: WireHeads; cash: WireHeads | null; stage: ReportStage | null }[]; totals: { sales: WireAmounts; purchases: WireAmounts; credit: WireHeads }; crosses_fy: boolean };
  customers: { rows: { customer: ReportParty; bills: number; total: string; udhaar: { bills: number; total: string }; last_bill: string }[]; totals: WireAmounts; walkin: WireAmounts };
  products: { rows: { name: string; hsn: string; quantity: Record<string, string>; taxable: string; bills: number }[]; totals: WireAmounts };
};
const MONEY = new Set(["taxable", "igst", "cgst", "sgst", "total", "value", "sales_tax", "credit", "cash", "udhaar_total", "sales_total", "expected", "actual", "diff"]);
function paise(value: string): number {
  const p = typeof value === "string" ? toPaise(value) : null;
  if (p === null || !Number.isSafeInteger(p)) throw new Error("The report contains an invalid amount.");
  return p;
}
/** Reconciliation's named money leaves cross once. Coverage is a count even when 3B serializes it as decimal text. */
export function decodeReport<T>(value: unknown): T {
  const decode = (v: unknown, key = "", count = false): unknown => {
    if (Array.isArray(v)) return v.map(x => decode(x));
    if (v !== null && typeof v === "object") {
      const record = v as Record<string, unknown>;
      const coverage = typeof record.id === "string" && record.id.startsWith("coverage");
      return Object.fromEntries(Object.entries(record).map(([k, x]) => [k, decode(x, k, coverage && ["expected", "actual", "diff"].includes(k))]));
    }
    if (count) { const n = Number(v); if (v === null || v === "" || !Number.isSafeInteger(n)) throw new Error("The report contains an invalid bill count."); return n; }
    if (typeof v === "string" && MONEY.has(key)) return paise(v);
    return v;
  };
  return decode(value) as T;
}
const taxHeads = (h: Omit<WireHeads, "total">) => ({ igst: paise(h.igst), cgst: paise(h.cgst), sgst: paise(h.sgst) });
const heads = (h: WireHeads): ReportHeads => ({ ...taxHeads(h), total: paise(h.total) });
const nullableHeads = (h: WireHeads | null) => h === null ? null : heads(h);
const totals = (t: WireAmounts): ReportTotals => ({ bills: t.bills, taxable: paise(t.taxable), heads: { ...taxHeads(t), total: paise(t.tax) }, total: paise(t.value), ...(t.cancelled === undefined ? {} : { cancelled: t.cancelled }) });
const split = (rows: WireSplit[]): ReportSplit[] => rows.map(r => ({ ...r, ...taxHeads(r), value: paise(r.value), taxable: paise(r.taxable) }));
const bill = <T,>(r: WireBill<T>) => ({ ...r, taxable: paise(r.taxable), heads: heads(r.heads), total: paise(r.total) });
const amounts = (r: WireAmounts) => ({ value: paise(r.value), bills: r.bills });
const adapters: { [K in ReportKind]: (wire: ReportWireMap[K], query: ReportQuery) => ReportMap[K] } = {
  sales: r => ({ bills: r.bills.map(bill<ReportSale>), totals: totals(r.totals), by_firm: r.by_firm.map(f => ({ firm: f.firm, totals: totals(f) })), split: split(r.split) }),
  purchases: r => ({ bills: r.bills.map(bill<ReportPurchase>), totals: totals(r.totals), credit_by_return: { ...taxHeads(r.credit_by_return), total: paise(r.credit_by_return.tax) }, gap: r.gap.parts, split: split(r.split) }),
  tax: (r, q) => {
    const from = `${q.from.slice(0, 7)}-01`, to = lastDay(q.to.slice(0, 7));
    return { firms: r.firms.map(f => ({ firm: f.firm, months: f.rows.map(m => ({ month: m.month, output: heads(m.output), credit: heads(m.credit), cash: nullableHeads(m.cash), carry_on: nullableHeads(m.carry_on), state: m.state, filed_on: m.gstr3b_filed_on })), totals: { output: heads(f.totals.output), credit: heads(f.totals.credit), cash: nullableHeads(f.totals.cash) } })), gap: r.gap.parts, whole_months: from !== q.from || to !== q.to ? { from, to } : null };
  },
  hsn: r => ({ rows: r.rows.map(row => {
    // 3B's percent() supplies percentages. Reuse the slab allowlist; never guess from magnitude (0.25 must mean 0.25%).
    const slab = slabOf(row.rate);
    if (!slab) throw new Error("The report contains an invalid GST rate.");
    return { hsn: row.hsn, description: row.description, uqc: row.uqc, quantity: row.quantity, rate: String(Number(slab) / 100), taxable: paise(row.taxable), heads: taxHeads(row), bills: row.bills };
  }), totals: { taxable: paise(r.totals.taxable), heads: { ...taxHeads(r.totals), total: paise(r.totals.tax) } }, bills: r.totals.bills }),
  months: (r, q) => ({ rows: r.rows.map(m => ({ month: m.month, sales: amounts(m.sales), purchases: amounts(m.purchases), sales_tax: paise(m.sales_tax), credit: paise(m.purchases.tax), cash: m.cash === null ? null : paise(m.cash.total), stage: m.stage, from: q.from > `${m.month}-01` ? q.from : `${m.month}-01`, to: q.to < lastDay(m.month) ? q.to : lastDay(m.month) })), totals: { sales: amounts(r.totals.sales), purchases: amounts(r.totals.purchases), sales_tax: paise(r.totals.sales.tax), credit: paise(r.totals.purchases.tax), cash: null }, gap: null }),
  customers: r => ({ rows: r.rows.map(row => ({ customer: row.customer, bills: row.bills, total: paise(row.total), udhaar_bills: row.udhaar.bills, udhaar_total: paise(row.udhaar.total), last_bill: row.last_bill })), sales_total: paise(r.totals.value), walk_in: { bills: r.walkin.bills, total: paise(r.walkin.value) } }),
  products: r => ({ rows: r.rows.map(row => ({ name: row.name, hsn: row.hsn, quantity: Object.entries(row.quantity).map(([unit, quantity]) => ({ unit, quantity })), taxable: paise(row.taxable), bills: row.bills })), taxable: paise(r.totals.taxable), bills: r.totals.bills }),
};
export function normalizeReport<K extends ReportKind>(kind: K, wire: ReportWireMap[K], query: ReportQuery): ReportMap[K] {
  return adapters[kind](wire, query);
}
export function reportParams(q: ReportQuery) {
  return { ...(typeof q.businessId === "number" ? { business_id: q.businessId } : {}), from: q.from, to: q.to, ...(q.split ? { split: "1" } : {}) };
}
export function useReport<K extends ReportKind>(kind: K, q: ReportQuery, side: "sales" | "purchases" = "sales", enabled = true) {
  return useQuery({ queryKey: ["reports", kind, q.businessId, q.from, q.to, q.split, kind === "hsn" ? side : null], enabled: enabled && q.businessId !== null,
    queryFn: async ({ signal }) => normalizeReport(kind, (await api.get<ReportWireMap[K]>(`reports/${kind}/`, { params: { ...reportParams(q), ...(kind === "hsn" ? { side } : {}) }, signal })).data, q),
  });
}
export function useReconciliation(businessId: number, fy: string, split: boolean) {
  return useQuery({ queryKey: ["gst", "reconciliation", businessId, fy, split], enabled: Number.isSafeInteger(businessId) && businessId > 0,
    queryFn: async ({ signal }) => decodeReport<Reconciliation>((await api.get("gst/reconciliation/", { params: { business_id: businessId, fy, ...(split ? { split: "1" } : {}) }, signal })).data),
  });
}
