import type { BillRow, PaymentMode, Person } from "@/core/sales/types";
export type Figures = { count: number; total: number; taxable: number; tax: number };
export type WindowFigures = { from: string; to: string; sales: Figures; purchases: Figures };
export type DashboardFirm = { id: number; name: string; gst_number: string };
export type Change = { id: number; at: string; by: Person; title: string; detail: string };
export type DashboardData = {
  today: { date: string; count: number; total: number; by_payment: { mode: PaymentMode; total: number }[]; bills: BillRow[]; more: number; recent: BillRow[] };
  fy: string; current: boolean;
  month: WindowFigures & { kind: "so_far" | "last_of_fy"; month: string };
  last30: WindowFigures | null;
  year: { from: string; to: string; months: { month: string; sales: Pick<Figures, "count" | "total" | "tax">; purchases: Pick<Figures, "count" | "total" | "tax"> }[]; sales: Pick<Figures, "count" | "total">; purchases: Pick<Figures, "count" | "total"> };
  returns_year: { firm: DashboardFirm; months_filed: number; last_gstr3b_filed_on: string | null; cash_paid: number }[] | null;
  changes: Change[] | null;
};
export type DueKind = "blocker" | "file_gstr1" | "pay_3b" | "gaps" | "open_blocker" | "credit" | "itax" | "captures" | "unsent" | "drafts" | "review";
export type DueItem = { kind: DueKind; due: string | null; count: number; title: string; detail: string; firm: number | null; month: string | null; draft_id: string | null; from: string | null; to: string | null; badge: "home_dot" | null };
export type Filing = { filed_on: string; arn: string; cash_paid: number | null; by: Person };
export type ReturnFirm = { firm: DashboardFirm; stage: "ready" | "blocked" | "gstr1" | "filed" | "unlocked"; blockers: number; purchases_to_check: number; output: number; cash: number; credit_used: number; carry_on: number; gstr1: Filing | null; gstr3b: Filing | null };
export type ReturnsData = { month: string; gstr1_due: string; gstr3b_due: string; firms: ReturnFirm[] };
export type DueData = { today: string; items: DueItem[]; returns: ReturnsData | null };
export type RateRow = { key: string; label: string; sub: string; per: number; per_label: string };
// Quotes are paise; per_gram deliberately stays decimal text at three places for the shared slip check.
export type Board = { id: number; on: string; set_at: string; set_by: Person; quoted: Record<string, number>; per_gram: Record<string, string> };
export type RatesData = { today: string; rows: RateRow[]; latest: Board | null; previous: Board | null; set_today: boolean; in_force?: Board | null };
