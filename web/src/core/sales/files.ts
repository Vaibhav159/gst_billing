// PDF file names (PROTO core/common.jsx:43-50, sales/lib.js:296-311): a bill's number with "/" as "_"; a bare number
// takes the firm's prefix (or its name) and the year; two bills that would share a name never do.
import type { BillDetail } from "./types";

export type PdfBill = { id: number; invoice_number: string; invoice_date: string; fy: string; prefix: string; firmName: string };

/** "KGH_2026-27_31.pdf"; nth: 2 for the second bill with the same number (by date), "…_2.pdf". */
export function pdfName(b: Omit<PdfBill, "id" | "invoice_date">, nth = 1): string {
  const n = b.invoice_number.trim();
  const tag = b.prefix || b.firmName.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const base = n.includes("/") ? n.replace(/\//g, "_") : `${tag}_${b.fy}_${n}`;
  return `${base}${nth > 1 ? `_${nth}` : ""}.pdf`;
}

/** A bill's own PDF name, after the other bills sharing its number in the firm and FY (BillDetail.duplicates), oldest first. */
export function billPdfName(d: BillDetail): string {
  const same = [...d.duplicates.map((x) => ({ id: x.id, day: x.invoice_date })), { id: d.id, day: d.invoice_date }]
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.id - b.id));
  return pdfName({ invoice_number: d.invoice_number, fy: d.fy, prefix: d.firm.invoice_prefix, firmName: d.firm.name }, same.findIndex((x) => x.id === d.id) + 1);
}

/** One distinct name per bill for a batch: a name two bills would share gets "_2" on the later one. */
export function fileNames(bills: PdfBill[]): Map<number, { name: string; renamed: boolean }> {
  const groups = new Map<string, PdfBill[]>();
  for (const b of bills) {
    const name = pdfName(b);
    groups.set(name, [...(groups.get(name) ?? []), b]);
  }
  const out = new Map<number, { name: string; renamed: boolean }>();
  for (const [name, list] of groups) {
    const base = name.replace(/\.pdf$/, "");
    [...list].sort((a, c) => (a.invoice_date < c.invoice_date ? -1 : a.invoice_date > c.invoice_date ? 1 : a.id - c.id))
      .forEach((b, i) => out.set(b.id, { name: i === 0 ? name : `${base}_${i + 1}.pdf`, renamed: i > 0 }));
  }
  return out;
}
