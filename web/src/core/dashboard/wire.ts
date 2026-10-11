import { toPaise } from "@/core/format";
import { toBillRow, toPerson } from "@/core/sales/wire";
import type { Board, Change, DashboardData, DashboardFirm, DueData, DueItem, Figures, Filing, RateRow, RatesData, ReturnFirm, WindowFigures } from "./types";
// The server owns the sums and words; this boundary only adapts JSON and money units.
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" ? v as Record<string, unknown> : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const text = (v: unknown): string => v == null ? "" : String(v);
const num = (v: unknown): number => Number.isFinite(Number(v)) ? Number(v) : 0;
const money = (v: unknown): number => toPaise(text(v)) ?? 0;
const firm = (v: unknown): DashboardFirm => { const w = obj(v); return { id: num(w.id), name: text(w.name), gst_number: text(w.gst_number) }; };
function figures(v: unknown): Figures { const w = obj(v); return { count: num(w.count), total: money(w.total), taxable: money(w.taxable), tax: money(w.tax) }; }
function windowFigures(v: unknown): WindowFigures { const w = obj(v); return { from: text(w.from), to: text(w.to), sales: figures(w.sales), purchases: figures(w.purchases) }; }
/** 4E AuditEntry's words/details win over part 5's illustrative title/detail keys. */
export function toChange(v: unknown): Change {
  const w = obj(v), words = obj(w.words);
  return { id: num(w.id), at: text(w.at), by: toPerson(w.by), title: [words.text, words.target, words.after].map(text).filter(Boolean).join(" "), detail: text(w.details) };
}
export function toDashboard(v: unknown): DashboardData {
  const w = obj(v), today = obj(w.today), month = obj(w.month), year = obj(w.year);
  return {
    today: { date: text(today.date), count: num(today.count), total: money(today.total), more: num(today.more), bills: list(today.bills).map(toBillRow), recent: list(today.recent).map(toBillRow),
      by_payment: list(today.by_payment).map(v => { const p = obj(v); const mode = p.mode === "cash" || p.mode === "bank" || p.mode === "mixed" || p.mode === "credit" ? p.mode : ""; return { mode, total: money(p.total) }; }) },
    fy: text(w.fy), current: Boolean(w.current), month: { ...windowFigures(month), month: text(month.month), kind: month.kind === "last_of_fy" ? "last_of_fy" : "so_far" }, last30: w.last30 == null ? null : windowFigures(w.last30),
    year: { from: text(year.from), to: text(year.to), months: list(year.months).map(v => { const m = obj(v); return { month: text(m.month), sales: figures(m.sales), purchases: figures(m.purchases) }; }), sales: figures(year.sales), purchases: figures(year.purchases) },
    returns_year: w.returns_year == null ? null : list(w.returns_year).map(v => { const r = obj(v); return { firm: firm(r.firm), months_filed: num(r.months_filed), last_gstr3b_filed_on: r.last_gstr3b_filed_on == null ? null : text(r.last_gstr3b_filed_on), cash_paid: money(r.cash_paid) }; }),
    changes: w.changes == null ? null : list(w.changes).map(toChange),
  };
}
function filing(v: unknown): Filing | null {
  if (v == null) return null;
  const w = obj(v); return { filed_on: text(w.filed_on), arn: text(w.arn), cash_paid: w.cash_paid == null ? null : money(w.cash_paid), by: toPerson(w.by) };
}
export function toDueNext(v: unknown): DueData {
  const w = obj(v), returns = obj(w.returns);
  return { today: text(w.today), items: list(w.items) as DueItem[], returns: w.returns == null ? null : {
    month: text(returns.month), gstr1_due: text(returns.gstr1_due), gstr3b_due: text(returns.gstr3b_due),
    firms: list(returns.firms).map(v => { const r = obj(v); return { firm: firm(r.firm), stage: r.stage as ReturnFirm["stage"], blockers: num(r.blockers), purchases_to_check: num(r.purchases_to_check), output: money(r.output), cash: money(r.cash), credit_used: money(r.credit_used), carry_on: money(r.carry_on), gstr1: filing(r.gstr1), gstr3b: filing(r.gstr3b) }; }),
  } };
}
export function toBoard(v: unknown): Board | null {
  if (v == null) return null;
  const w = obj(v); return { id: num(w.id), on: text(w.on), set_at: text(w.set_at), set_by: toPerson(w.set_by), quoted: Object.fromEntries(Object.entries(obj(w.quoted)).map(([k, v]) => [k, money(v)])), per_gram: Object.fromEntries(Object.entries(obj(w.per_gram)).map(([k, v]) => [k, text(v)])) };
}
export function toRates(v: unknown): RatesData {
  const w = obj(v); return { today: text(w.today), rows: list(w.rows) as RateRow[], latest: toBoard(w.latest), previous: toBoard(w.previous), set_today: Boolean(w.set_today), ...("in_force" in w ? { in_force: toBoard(w.in_force) } : {}) };
}
