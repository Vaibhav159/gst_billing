// @vitest-environment node
// The statement PDF's words, read back from a real PDF that makeStatementPdf made. Under Node, react-pdf's Node build
// writes it into Node's own Blob, so its bytes read back as written (under jsdom, pdfkit's browser build garbles the
// compressed streams, which is why statementPdf.test.tsx reads only the plain parts). Each page's content is inflated
// with zlib and its text read: Helvetica's strings are hex codes in Windows-1252, so every word comes back as drawn,
// in drawing order. Only the ₹, drawn in its own one-glyph font, doesn't.
import { inflateSync } from "node:zlib";
import type { StatementBill } from "@/core/api/customers";
import type { StatementPdfData } from "./statementDoc";
import { makeStatementPdf } from "./statementPdf";

const WIN = new TextDecoder("windows-1252");
/** The PDF's text: each page's runs joined as they're drawn. */
async function drawn(blob: Blob): Promise<string> {
  const buf = Buffer.from(await blob.arrayBuffer());
  const pages: string[] = [];
  for (const m of buf.toString("latin1").matchAll(/\/Length (\d+)[^>]*>>\s*stream\r?\n/g)) {
    const start = m.index + m[0].length;
    let body: string;
    try { body = inflateSync(buf.subarray(start, start + Number(m[1]))).toString("latin1"); } catch { continue; }
    if (!/\bBT\b/.test(body)) continue; // a font, not a page
    pages.push([...body.matchAll(/\[([^\]]*)\]\s*TJ/g)].map((tj) => [...tj[1].matchAll(/<([0-9a-f]*)>/gi)].map((h) => WIN.decode(Buffer.from(h[1], "hex"))).join("")).join(""));
  }
  return pages.join("\n");
}
/** The head: what's drawn before the register's note. */
const head = (text: string) => text.slice(0, text.indexOf("A register of bills"));
const times = (text: string, words: string) => text.split(words).length - 1;

const bill = (id: number, paid: StatementBill["paid"], paise: number): StatementBill => ({
  id, business: 3, business_name: "KIRAN GOLD HOUSE", invoice_number: `KGH/2026-27/${id}`, invoice_date: "2026-09-10", payment_mode: paid === "udhaar" ? "credit" : "cash",
  taxable: paise, tax: 0, total_amount: paise, status: paid === "cancelled" ? "cancelled" : "active", cancel_reason: "", paid, itax: [],
});
/** Anil Gupta's statement as the page hands it over: ₹87,083.21 and ₹12,345.67 paid at billing, ₹20,000.00 on udhaar, and a cancelled ₹3,000.00. */
function data(pan: string, periodLabel: string): StatementPdfData {
  return {
    customer: { name: "Anil Gupta", mobile: "98290 41122", gstin: "", pan, address: "15 Demo Road, Udaipur, Rajasthan" },
    periodLabel, periodRange: "1 Apr to 8 Oct 2026", scope: "KIRAN GOLD HOUSE", made: "08 Oct 2026",
    statement: {
      customer: { id: 7, name: "Anil Gupta", type: "person", mobile_number: "9829041122", gst_number: "", pan, city: "Udaipur", state_name: "RAJASTHAN" },
      start_date: "2026-04-01", end_date: "2026-10-08", business: 3,
      bills: [bill(17, "billing", 8708321), bill(18, "billing", 1234567), bill(19, "udhaar", 2000000), bill(20, "cancelled", 300000)],
      totals: { bills: 3, billed: 11942888, taxable: 11942888, tax: 0, cancelled: 1, paid_at_billing: { bills: 2, total: 9942888 }, udhaar: { bills: 1, total: 2000000 }, not_recorded: { bills: 0, total: 0 } },
      months: [],
    },
  };
}

test("the PAN beside the mobile, amounts to the paisa, and the cancelled bill named as not counted", async () => {
  const text = await drawn(await makeStatementPdf(data("ABCDE1234F", "FY 2026-27")));
  expect(text).toContain("Mobile 98290 41122 · PAN ABCDE1234F");
  expect(text).toContain("Billed · 3 bills · 1 cancelled bill not counted");
  expect(text).toContain("87,083.21"); // a bill's row
  expect(text).toContain("1,19,428.88"); // what was billed
}, 30_000);

test("no PAN: none is named; own dates: the range is the period's name, so the head prints it once", async () => {
  const text = await drawn(await makeStatementPdf(data("", "1 Apr to 8 Oct 2026")));
  expect(text).toContain("Mobile 98290 41122");
  expect(text).not.toContain("PAN");
  expect(times(head(text), "1 Apr to 8 Oct 2026")).toBe(1);
}, 30_000);


test("a GSTIN placeholder on file prints No GSTIN, never GSTIN URP", async () => {
  const d = data("", "FY 2026-27");
  d.customer.gstin = "URP";
  const text = await drawn(await makeStatementPdf(d));
  expect(text).toContain("No GSTIN");
  expect(text).not.toContain("GSTIN URP");
}, 30_000);
