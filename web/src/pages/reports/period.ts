import { useState } from "react";
import { date, fyOf, lastDayOfMonth as lastDay, monthLabel, todayIST } from "@/core/format";
import { useAuth } from "@/core/auth/AuthProvider";
import { readStored, writeStored } from "@/core/storage";

export const EARLIEST_REPORT_DAY = "2022-04-01";
export type PeriodRange = { from: string; to: string };
export type PeriodPreset = "month" | "last" | "quarter" | "fy" | "q1" | "q2" | "q3" | "q4" | "custom";
export type SavedPeriod = { p: PeriodPreset; from?: string; to?: string };
export type ReportPeriod = PeriodRange & { p: PeriodPreset };
export const reportPeriodKey = (id: number) => `gst3.reports.period.${id}`;
const pad = (v: number) => String(v).padStart(2, "0");
const monthAt = (y: number, offset: number) => `${y + Math.floor(offset / 12)}-${pad(offset % 12 + 1)}`;
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number(s.slice(5, 7)) >= 1 && Number(s.slice(5, 7)) <= 12 && Number(s.slice(8)) >= 1 && s <= lastDay(s.slice(0, 7));
export function rangeProblems(from: string, to: string, today = todayIST()): Partial<Record<keyof PeriodRange, string>> {
  const errors: Partial<Record<keyof PeriodRange, string>> = {};
  for (const [key, value, ordinal] of [["from", from, "first"], ["to", to, "last"]] as const) {
    if (!isDay(value)) errors[key] = `Pick the ${ordinal} day of the range.`;
    else if (value < EARLIEST_REPORT_DAY) errors[key] = "The app goes back to 01 Apr 2022. Pick that day or later.";
    else if (value > today) errors[key] = `That's after today. Pick ${date(today)} or earlier.`;
  }
  if (!errors.from && !errors.to && from > to) errors.to = `The range ends before it starts (${date(from)}). Pick a later end date.`;
  return errors;
}
export function periodChoices(fy: string, today = todayIST()): { value: PeriodPreset; label: string }[] {
  return fy === fyOf(today)
    ? [{ value: "month", label: "This month so far" }, { value: "last", label: "Last month" }, { value: "quarter", label: "This quarter" }, { value: "fy", label: "FY so far" }, { value: "custom", label: "Custom range" }]
    : [{ value: "fy", label: "Full year" }, { value: "q1", label: "Apr to Jun" }, { value: "q2", label: "Jul to Sep" }, { value: "q3", label: "Oct to Dec" }, { value: "q4", label: "Jan to Mar" }, { value: "custom", label: "Custom range" }];
}
export function periodRange(fy: string, p: PeriodPreset, today = todayIST()): PeriodRange {
  const y = Number(fy.slice(0, 4));
  if (/^q[1-4]$/.test(p)) { const start = 3 + (Number(p[1]) - 1) * 3; return { from: `${monthAt(y, start)}-01`, to: lastDay(monthAt(y, start + 2)) }; }
  if (fy !== fyOf(today)) return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
  const ym = today.slice(0, 7), m = Number(today.slice(5, 7)), cy = Number(today.slice(0, 4));
  if (p === "month") return { from: `${ym}-01`, to: today };
  if (p === "last") { const month = m === 1 ? `${cy - 1}-12` : `${cy}-${pad(m - 1)}`; return { from: `${month}-01`, to: lastDay(month) }; }
  if (p === "quarter") return { from: `${cy}-${pad(1 + Math.floor((m - 1) / 3) * 3)}-01`, to: today };
  return { from: `${y}-04-01`, to: today };
}
export function resolvePeriod(saved: unknown, kind: string | null, fy: string, today = todayIST()): ReportPeriod {
  const fallback = kind === "months" || fy !== fyOf(today) ? "fy" : "last";
  const v = saved as Partial<SavedPeriod> | null;
  if (v?.p === "custom" && typeof v.from === "string" && typeof v.to === "string" && !Object.keys(rangeProblems(v.from, v.to, today)).length) return { p: "custom", from: v.from, to: v.to };
  const p = v?.p && v.p !== "custom" && periodChoices(fy, today).some(x => x.value === v.p) ? v.p : fallback;
  return { p, ...periodRange(fy, p, today) };
}
export function periodLabel({ from, to }: PeriodRange): string {
  if (from.endsWith("-01") && to === lastDay(from.slice(0, 7))) return monthLabel(from.slice(0, 7));
  const fy = fyOf(from);
  if (from === `${fy.slice(0, 4)}-04-01` && to === `${Number(fy.slice(0, 4)) + 1}-03-31`) return `FY ${fy}`;
  return `${date(from)} to ${date(to)}`;
}
export function useReportPeriod(kind: string | null, fy: string) {
  const { me } = useAuth();
  const key = reportPeriodKey(me?.id ?? 0);
  const read = () => { try { return JSON.parse(readStored(key) ?? "null") as unknown; } catch { return null; } };
  const [stored, setStored] = useState<{ key: string; value: unknown }>(() => ({ key, value: read() }));
  if (stored.key !== key) setStored({ key, value: read() });
  const period = resolvePeriod(stored.key === key ? stored.value : read(), kind, fy);
  const set = (value: SavedPeriod) => { setStored({ key, value }); writeStored(key, JSON.stringify(value)); };
  return { ...period, set, carry: () => set(period) };
}
export function useSplitPreference(): [boolean, (value: boolean) => void] {
  const [value, update] = useState(() => readStored("gst3.report.split") === "1");
  return [value, next => { update(next); writeStored("gst3.report.split", next ? "1" : "0"); }];
}
