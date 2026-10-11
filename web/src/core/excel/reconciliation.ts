import { date, monthLabel, paiseToDecimal } from "@/core/format";
import type { Reconciliation, ReconFigures, ReconTax } from "@/core/gst/reportTypes";
import { PAY } from "@/core/sales/words";
import type { Cell, Row, Sheet } from "./writer";

const measures = ["taxable", "igst", "cgst", "sgst"] as const;
const money = (value: number | null | undefined): Cell => value == null ? { v: "" } : { v: paiseToDecimal(value), num: true };
const figures = (value: ReconFigures | null) => measures.map(k => money(value?.[k]));
const taxes = (value: ReconTax | null) => (["igst", "cgst", "sgst"] as const).map(k => money(value?.[k]));
const unavailable = (stage: string) => stage === "filed" || stage === "gstr1" || stage === "unlocked" ? "As-filed figures unavailable" : stage === "future" ? "Not started" : "not filed";
export function reconciliationSheet(r: Reconciliation, firm: { name: string; gstin: string }, split: boolean): Sheet {
  const cols = [190, 200, ...Array.from({ length: 16 }, () => 104)];
  const rows: Row[] = [{ kind: "title", cells: [{ v: `SALES RECONCILIATION · FY ${r.fy} · ${firm.name.toUpperCase()} · ${firm.gstin}`, span: cols.length }] }, { kind: "blank", cells: [] },
    { kind: "band", cells: [{ v: "BOOKS AGAINST THE RETURNS AS FILED", span: 2 }, { v: "BOOKS", span: 4 }, { v: "GSTR-1 AS FILED", span: 4 }, { v: "GSTR-3B AS FILED", span: 3 }, { v: "BOOKS − FILED", span: 4 }] },
    { kind: "head", cells: ["Period", "Return", ...["Books", "GSTR-1"].flatMap(source => measures.map(m => `${source} ${m} (₹)`)), ...["IGST", "CGST", "SGST"].map(m => `GSTR-3B ${m} (₹)`), ...measures.map(m => `Books − filed ${m} (₹)`), "Amended in"].map(v => ({ v })) }];
  for (const x of r.filed) rows.push({ kind: x.differs ? "fail" : "data", cells: [{ v: monthLabel(x.month) }, { v: x.gstr1 ? "GSTR-1 as filed" : unavailable(x.stage) }, ...figures(x.books), ...figures(x.gstr1), ...taxes(x.gstr3b), ...figures(x.diff), { v: x.amended_in ?? "" }] });
  for (const p of r.periods) rows.push({ kind: "total", cells: [{ v: `${p.label}${p.so_far ? ` · ${date(p.so_far.from)} to ${date(p.so_far.to)}` : ""}` }, { v: `${p.filed_months} months filed` }, ...figures(p.books), ...figures(p.filed_months ? p.gstr1 : null), ...taxes(r.filed.some(x => p.months.includes(x.month) && x.gstr3b) ? p.gstr3b : null), ...figures(p.filed_months ? p.diff : null)] });
  rows.push({ kind: "blank", cells: [] }, { kind: "band", cells: [{ v: "THE BOOKS BY BUYER CLASS · NIL SUPPLIES INCLUDED", span: cols.length }] }, { kind: "head", cells: [{ v: "Period" }, { v: "Bills" }, ...["All sales", "B2B", "B2CL", "B2C"].flatMap(s => measures.map(m => ({ v: `${s} ${m} (₹)` })))] });
  for (const section of r.sections) {
    const p = r.periods.find(p => p.key === section.key);
    rows.push({ kind: section.key === "fy" ? "total" : "data", cells: [{ v: p?.label ?? section.key }, { v: section.all.bills }, ...[section.all, section.b2b, section.b2cl, section.b2c].flatMap(figures)] });
  }
  if (split) {
    rows.push({ kind: "blank", cells: [] }, { kind: "band", cells: [{ v: "PAYMENT SPLIT (cash / bank)", span: 8 }] }, { kind: "head", cells: ["Mode", "Bills", "Bill value (₹)", "Taxable value (₹)", "IGST (₹)", "CGST (₹)", "SGST (₹)", "Share %"].map(v => ({ v })) });
    for (const x of r.split) rows.push({ kind: "data", cells: [{ v: PAY[(x.mode ?? "") as keyof typeof PAY] ?? x.mode ?? "Not recorded" }, { v: x.bills }, ...[x.value, x.taxable, x.igst, x.cgst, x.sgst].map(money), { v: x.share, num: true }] });
  }
  rows.push({ kind: "blank", cells: [] }, { kind: "band", cells: [{ v: "ARITHMETIC CHECKS (THE BOOKS AGAINST THEMSELVES)", span: 7 }] }, { kind: "head", cells: ["Check", "Period", "Expected (₹, or bills for coverage)", "Actual (₹, or bills for coverage)", "Difference (₹, or bills for coverage)", "Status"].map((v, i) => ({ v, span: i === 0 ? 2 : 1 })) });
  const order = { fail: 0, rounding: 1, pass: 2 };
  for (const c of [...r.checks].sort((a, b) => order[a.status] - order[b.status])) rows.push({ kind: c.status === "fail" ? "fail" : "data", cells: [{ v: c.label, span: 2 }, { v: c.period }, ...[c.expected, c.actual, c.diff].map(value => c.id.startsWith("coverage") ? { v: value } : money(value)), { v: c.status.toUpperCase(), center: true }] });
  return { name: `Reconciliation ${r.fy}`, cols, rows, note: "Rate checks allow one paisa per line, with a minimum of ₹1; other money checks allow ₹1. GSTR-2B (what suppliers filed) isn't matched here yet." };
}
