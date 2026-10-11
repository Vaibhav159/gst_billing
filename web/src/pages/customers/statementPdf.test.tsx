// The statement PDF is checked two ways. Real files, written by react-pdf through the same makeStatementPdf the page uses:
// under jsdom their compressed streams don't read back byte for byte, so those checks look at the PDF's plain-text parts
// (the header, the fonts and the pages). And the document's element tree, expanded as react-pdf expands it, for where each
// ₹ prints and in which font.
import type { Statement } from "@/core/api/customers";
import { expand, flat, pdfText, rupeeTexts, type PdfNode } from "@/core/print/testing";
import { StatementDocument, type StatementPdfData } from "./statementDoc";
import { statementFileName } from "./statementFiles";
import { makeStatementPdf } from "./statementPdf";

const bill = (id: number, paid: Statement["bills"][number]["paid"]) => ({
  id, business: 3, business_name: "KIRAN GOLD HOUSE", invoice_number: `KGH/2026-27/${id}`, invoice_date: "2026-09-10", payment_mode: paid === "udhaar" ? "credit" as const : "cash" as const,
  taxable: 100000, tax: 3000, total_amount: 103000, status: paid === "cancelled" ? "cancelled" as const : "active" as const, cancel_reason: "", paid, itax: [],
});
function data(bills: Statement["bills"]): StatementPdfData {
  return {
    customer: { name: "Anil Gupta", mobile: "98290 41122", gstin: "", pan: "", address: "15 Demo Road, Udaipur" },
    periodLabel: "September 2026", periodRange: "1 to 30 Sep 2026", scope: "All firms", made: "08 Oct 2026",
    statement: {
      customer: { id: 7, name: "Anil Gupta", type: "person", mobile_number: "9829041122", gst_number: "", pan: "", city: "Udaipur", state_name: "RAJASTHAN" },
      start_date: "2026-09-01", end_date: "2026-09-30", business: null, bills,
      totals: { bills: 2, billed: 206000, taxable: 200000, tax: 6000, cancelled: 1, paid_at_billing: { bills: 1, total: 103000 }, udhaar: { bills: 1, total: 103000 }, not_recorded: { bills: 0, total: 0 } },
      months: [],
    },
  };
}

test("the statement is an A4 PDF whose ₹ prints in the one-glyph Tinos font (Helvetica has no ₹)", async () => {
  const blob = await makeStatementPdf(data([bill(17, "billing"), bill(18, "udhaar"), bill(19, "cancelled")]));
  expect(blob.type).toBe("application/pdf");
  const pdf = await pdfText(blob);
  expect(pdf.startsWith("%PDF-")).toBe(true);
  expect(pdf).toMatch(/\/BaseFont \/[A-Z]{6}\+Tinos-Bold/);
  expect(pdf).toMatch(/\/MediaBox \[0 0 595\.28\d* 841\.89\d*\]/); // A4
}, 30_000);

test("a long statement runs on to more pages", async () => {
  const pdf = await pdfText(await makeStatementPdf(data(Array.from({ length: 80 }, (_, i) => bill(100 + i, "billing")))));
  expect(pdf.match(/\/Type \/Page\b/g)!.length).toBeGreaterThan(1);
}, 30_000);

test("a ₹ typed in the customer's name or address prints in the RupeeSign font wherever it prints, as the totals' ₹ does (Ruling 1E-5)", () => {
  const d = data([]);
  const doc = expand(<StatementDocument data={{ ...d, customer: { ...d.customer, name: "₹ Gupta Jewellers", address: "Shop 4, ₹ Market, Udaipur" } }} />)[0] as PdfNode;
  // the name at the top, in the line saying there are no bills and in the foot of each page; the address; the three totals; "Amount (₹)"
  expect(rupeeTexts(doc).map((t) => [t.children, flat(t.props.style).fontFamily])).toEqual(Array.from({ length: 8 }, () => [["₹"], "RupeeSign"]));
});

test("a ₹ in a firm's name prints in the bill's RupeeSign font: the header's scope and every row, including cancelled bills", () => {
  const d = data([
    { ...bill(17, "billing"), business_name: "₹ Gold House" },
    { ...bill(18, "udhaar"), business_name: "₹ Silver House" },
    { ...bill(19, "cancelled"), business_name: "₹ Gems" },
  ]);
  const doc = expand(<StatementDocument data={{ ...d, scope: "₹ Gold House" }} />)[0] as PdfNode;
  // the scope in the header and footer; three firm names; three totals; "Amount (₹)"
  expect(rupeeTexts(doc).map((t) => [t.children, flat(t.props.style).fontFamily])).toEqual(Array.from({ length: 9 }, () => [["₹"], "RupeeSign"]));
});

test("the file is named after the customer and the period", () => {
  expect(statementFileName("Anil Gupta", "FY 2026-27")).toBe("Anil-Gupta_statement_FY-2026-27.pdf");
  expect(statementFileName("M/s Shree Gems & Co.", "September 2026")).toBe("M-s-Shree-Gems-Co_statement_September-2026.pdf");
  expect(statementFileName("Anil Gupta", "1 to 5 Oct 2026", { from: "2026-10-01", to: "2026-10-05" })).toBe("Anil-Gupta_statement_2026-10-01_to_2026-10-05.pdf");
});
