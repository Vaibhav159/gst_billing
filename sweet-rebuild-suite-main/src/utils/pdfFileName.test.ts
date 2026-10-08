/**
 * PDF file names (UX2). Every PDF was saved as "<invoice number>.pdf", and
 * invoice #1 exists in all three firms and in every year: a ZIP of #1 from
 * three firms held a single 1.pdf while the toast said "3 PDFs downloaded".
 */
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";

vi.mock("@react-pdf/renderer", () => ({
  pdf: (element: { props: { invoice: { invoiceNumber: string; businessId: string } } }) => ({
    toBlob: async () => {
      if (element.props.invoice.businessId === "broken") throw new Error("render failed");
      return new Blob([`%PDF ${element.props.invoice.businessId}/${element.props.invoice.invoiceNumber}`]);
    },
  }),
}));
vi.mock("@/components/TallyInvoicePDF", () => ({ default: () => null }));
vi.mock("qrcode", () => ({ default: { toDataURL: async () => "data:image/png;base64," } }));

import { generateBulkPDFZip } from "./generateBulkPDF";
import { fyOf, invoicePdfName, uniqueNames, zipPdfs, zipResultToast } from "./pdfFileName";

const firms = [
  { id: "12", name: "AARAV JEWELLERS (SANDBOX)", invoice_prefix: "" },
  { id: "13", name: "MEERA ORNAMENTS (SANDBOX)", invoice_prefix: "" },
  { id: "14", name: "KIRAN GOLD HOUSE (SANDBOX)", invoice_prefix: "" },
];
const invoiceOne = (businessId: string, businessName: string) => ({
  id: `inv-${businessId}`, invoiceNumber: "1", invoice_date: "2026-04-01", businessId, businessName, customerId: "7",
  total: 103, items: [],
}) as any;
const numberOnes = firms.map((f) => invoiceOne(f.id, f.name));

const filesIn = async (zip: Blob) => Object.keys((await JSZip.loadAsync(zip)).files).sort();

describe("invoicePdfName — firm, financial year and number (UX2)", () => {
  it("gives #1 of three firms three different names", () => {
    const names = numberOnes.map((inv, i) => invoicePdfName(inv, firms[i]));
    expect(names).toEqual([
      "AARAV-JEWELLERS-SANDBOX_2026-27_1.pdf",
      "MEERA-ORNAMENTS-SANDBOX_2026-27_1.pdf",
      "KIRAN-GOLD-HOUSE-SANDBOX_2026-27_1.pdf",
    ]);
  });

  it("tells #30 of one year from #30 of the next", () => {
    const firm = { name: "LODHA JEWELLERS" };
    expect(invoicePdfName({ invoiceNumber: "30", invoice_date: "2026-03-31" }, firm)).toBe("LODHA-JEWELLERS_2025-26_30.pdf");
    expect(invoicePdfName({ invoiceNumber: "30", invoice_date: "2026-04-01" }, firm)).toBe("LODHA-JEWELLERS_2026-27_30.pdf");
  });

  it("uses the firm's invoice prefix when it has one, and doesn't repeat what the number already says", () => {
    const firm = { name: "SHREE GANESH JEWELLERS", invoice_prefix: "SGJ" };
    expect(invoicePdfName({ invoiceNumber: "108", invoice_date: "2026-05-01" }, firm)).toBe("SGJ_2026-27_108.pdf");
    expect(invoicePdfName({ invoiceNumber: "SGJ/2026-27/108", invoice_date: "2026-05-01" }, firm)).toBe("SGJ-2026-27-108.pdf");
  });

  it("falls back to the invoice's own firm name, and is safe on every file system", () => {
    expect(invoicePdfName({ invoiceNumber: 'A/B:C*1?"<>|', invoice_date: "2026-05-01", businessName: "M/S. SHREE: LODHA" }))
      .toBe("M-S.-SHREE-LODHA_2026-27_A-B-C-1.pdf");
  });

  it("keeps a Devanagari firm name whole, its vowel signs and viramas included (M1)", () => {
    // Matras and the virama are combining marks: dropping them made
    // "लोढ़ा ज्वेलर्स" into "ल-ढ-ज-व-लर-स".
    const name = "लोढ़ा ज्वेलर्स";
    expect(invoicePdfName({ invoiceNumber: "30", invoice_date: "2026-05-01" }, { name }))
      .toBe(`${name.replace(" ", "-")}_2026-27_30.pdf`);
  });

  it("reads the financial year off the date string, April to March", () => {
    expect([fyOf("2026-04-01"), fyOf("2027-03-31"), fyOf("2025-12-31"), fyOf("")]).toEqual(["2026-27", "2026-27", "2025-26", ""]);
  });
});

describe("a ZIP never drops a PDF under another's name (UX2)", () => {
  it("suffixes a clash, ignoring case as Windows and macOS do", () => {
    const unique = uniqueNames();
    expect(["A_1.pdf", "a_1.pdf", "A_1.pdf", "B.pdf"].map(unique)).toEqual(["A_1.pdf", "a_1-2.pdf", "A_1-3.pdf", "B.pdf"]);
  });

  it("writes every file and counts what it wrote", async () => {
    // Two suppliers' bills can both be numbered 1 in the same firm and year.
    const same = invoicePdfName(invoiceOne("12", firms[0].name), firms[0]);
    const { zip, written } = await zipPdfs([same, same, "other.pdf"].map((name) => ({ name, blob: new Blob(["%PDF"]) })));
    expect(written).toBe(3);
    expect(await filesIn(zip)).toEqual(["AARAV-JEWELLERS-SANDBOX_2026-27_1-2.pdf", "AARAV-JEWELLERS-SANDBOX_2026-27_1.pdf", "other.pdf"]);
  });

  it("the toast says how many PDFs the ZIP holds, and is an error when it holds fewer than were picked", () => {
    expect(zipResultToast(3, 3)).toEqual({ title: "Download Complete", description: "3 PDFs downloaded as ZIP." });
    expect(zipResultToast(2, 3, ["7"])).toEqual({ title: "Some PDFs are missing",
      description: "The ZIP holds 2 of 3 PDFs; couldn't make #7.", variant: "destructive" });
  });
});

describe("generateBulkPDFZip — the customer page's Download All (UX2)", () => {
  it("zips #1 of three firms as three files and reports three", async () => {
    const result = await generateBulkPDFZip(numberOnes, firms, []);
    expect(result.written).toBe(3);
    expect(result.failed).toEqual([]);
    expect(await filesIn(result.blob)).toEqual([
      "AARAV-JEWELLERS-SANDBOX_2026-27_1.pdf",
      "KIRAN-GOLD-HOUSE-SANDBOX_2026-27_1.pdf",
      "MEERA-ORNAMENTS-SANDBOX_2026-27_1.pdf",
    ]);
  });

  it("names a PDF it could not make instead of counting it", async () => {
    const result = await generateBulkPDFZip([...numberOnes, invoiceOne("broken", "BROKEN FIRM")], firms, []);
    expect(result.written).toBe(3);
    expect(result.failed).toEqual(["1"]);
  });
});
