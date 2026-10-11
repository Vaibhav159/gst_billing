import { csvCell } from "@/core/csv";
// The customers list as a CSV file: what the list shows, every matching customer, not just the rows loaded.
import type { CustomerRow } from "@/core/api/customers";
import { paiseToDecimal } from "@/core/format";
import { stateTitle } from "@/core/ids";
import type { Firm } from "@/core/scope";

const TYPE_LABEL = { walkin: "Walk-in", person: "Person", business: "Business" } as const;

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
  return `\ufeff${[head, ...lines].map((l) => l.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
