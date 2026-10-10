// The customers list as a CSV file: what the list shows, every matching customer, not just the rows loaded.
import type { CustomerRow } from "@/core/api/customers";
import { paiseToDecimal } from "@/core/format";
import { stateTitle } from "@/core/ids";
import type { Firm } from "@/core/scope";

const TYPE_LABEL = { walkin: "Walk-in", person: "Person", business: "Business" } as const;

/**
 * One cell. Text that starts as a formula would (=, +, - or @, or a tab or carriage return) gets a ' in front, so a
 * spreadsheet shows it as text and never runs it: a customer named "=HYPERLINK(…)" stays a name. Then it's quoted when it
 * holds a comma, a quote or a line break. (Money here is never negative, so no figure turns into text.)
 */
function cell(v: string | number): string {
  const s = typeof v === "number" ? String(v) : /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/**
 * The CSV text, with a byte-order mark so Excel reads the ₹ in the headings. figuresLabel names the figures' period, and
 * the firm when the caller has one: "FY 2026-27 · KIRAN GOLD HOUSE".
 */
export function customersCsv(rows: CustomerRow[], firms: Firm[], figuresLabel: string): string {
  const head = ["Name", "Mobile", "Email", "GSTIN", "PAN", "Type", "Address", "City", "State", "Usual firms", `Sales ${figuresLabel} (₹)`, "Bills", "Billed on udhaar (₹)", "Udhaar bills", "Last bill", "Last bill date"];
  const lines = rows.map((r) => [
    r.name, r.mobile_number, r.email, r.gst_number, r.pan, TYPE_LABEL[r.type], r.address, r.city, stateTitle(r.state_name),
    firms.filter((f) => r.businesses.includes(f.id)).map((f) => f.name).join("; "),
    paiseToDecimal(r.figures?.total ?? 0), r.figures?.bills ?? 0, paiseToDecimal(r.figures?.udhaar_total ?? 0), r.figures?.udhaar_bills ?? 0,
    r.figures?.last_bill?.invoice_number ?? "", r.figures?.last_bill?.invoice_date ?? "",
  ]);
  return `﻿${[head, ...lines].map((l) => l.map(cell).join(",")).join("\r\n")}\r\n`;
}
