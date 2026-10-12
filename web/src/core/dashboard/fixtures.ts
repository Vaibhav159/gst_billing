import { FIRM, wireRow } from "@/core/sales/fixtures";
export const wireFigures = () => ({ count: 1, total: "87083.21", taxable: "84546.81", tax: "2536.40" });
export function wireDashboard() {
  return {
    today: { date: "2026-10-08", count: 1, total: "87083.21", by_payment: [{ mode: "cash", total: "87083.21" }], bills: [wireRow()], more: 0, recent: [] as Record<string, unknown>[] },
    fy: "2026-27", current: true,
    month: { kind: "so_far", month: "2026-10", from: "2026-10-01", to: "2026-10-08", sales: wireFigures(), purchases: wireFigures() },
    last30: { from: "2026-09-09", to: "2026-10-08", sales: { ...wireFigures(), count: 30 }, purchases: wireFigures() },
    year: { from: "2026-04-01", to: "2026-10-08", months: [{ month: "2026-04", sales: wireFigures(), purchases: { ...wireFigures(), total: "100000.00" } }], sales: wireFigures(), purchases: wireFigures() },
    returns_year: null as null | { firm: typeof FIRM; months_filed: number; last_gstr3b_filed_on: string | null; cash_paid: string }[],
    changes: [{ id: 9120, at: "2026-10-08T10:44:02+05:30", by: { id: 2, name: "Rakesh Soni" }, words: { text: "Sent", target: "KGH/2026-27/31", after: "" }, details: "To Anil Gupta on WhatsApp" }] as Record<string, unknown>[] | null,
  };
}
export function wireDue() {
  return { today: "2026-10-08", items: [{ kind: "pay_3b", due: "2026-10-20", count: 1, title: "Pay ₹98,410.00 GSTR-3B tax in cash", detail: "September · Kiran ₹98,410.00", firm: 3, month: "2026-09", draft_id: null, from: null, to: null, badge: null }],
    returns: { month: "2026-09", gstr1_due: "2026-10-11", gstr3b_due: "2026-10-20", firms: [{ firm: FIRM, stage: "blocked", blockers: 1, purchases_to_check: 0, output: "131510.40", cash: "98410.00", credit_used: "33100.40", carry_on: "0.00", gstr1: null, gstr3b: null }] } };
}
export function wireRates() {
  const board = { id: 41, on: "2026-10-08", set_at: "2026-10-08T10:05:12+05:30", set_by: { id: 1, name: "Kailash Mehta" }, quoted: { "gold-22K": "65125.01" }, per_gram: { "gold-22K": "6512.501" } };
  return { today: "2026-10-08", rows: [{ key: "gold-22K", label: "Gold 22K", sub: "916", per: 10, per_label: "10 g" }], latest: board, previous: null, set_today: true, in_force: board };
}
