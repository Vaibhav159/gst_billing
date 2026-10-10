import { billPdfName, fileNames, pdfName } from "./files";
import type { BillDetail } from "./types";

test("a bill's PDF is its number with / as _; a bare number takes the firm's prefix, else its name, and the year", () => {
  expect(pdfName({ invoice_number: "KGH/2026-27/31", fy: "2026-27", prefix: "KGH", firmName: "KIRAN GOLD HOUSE" })).toBe("KGH_2026-27_31.pdf");
  expect(pdfName({ invoice_number: "31", fy: "2026-27", prefix: "KGH", firmName: "KIRAN GOLD HOUSE" })).toBe("KGH_2026-27_31.pdf");
  expect(pdfName({ invoice_number: "31", fy: "2026-27", prefix: "", firmName: "KIRAN GOLD HOUSE (SANDBOX)" })).toBe("KIRAN-GOLD-HOUSE-SANDBOX_2026-27_31.pdf");
  expect(pdfName({ invoice_number: "KGH/2026-27/31", fy: "2026-27", prefix: "KGH", firmName: "" }, 2)).toBe("KGH_2026-27_31_2.pdf");
});

test("the second bill with a number gets _2, by date", () => {
  const d = { id: 412, invoice_number: "KGH/2026-27/17", invoice_date: "2026-09-12", fy: "2026-27", firm: { invoice_prefix: "KGH", name: "KIRAN GOLD HOUSE" },
    duplicates: [{ id: 388, invoice_number: "KGH/2026-27/17", invoice_date: "2026-09-10", customer_name: "Hemant Dave", status: "active" }] } as unknown as BillDetail;
  expect(billPdfName(d)).toBe("KGH_2026-27_17_2.pdf");
  const names = fileNames([
    { id: 412, invoice_number: "KGH/2026-27/17", invoice_date: "2026-09-12", fy: "2026-27", prefix: "KGH", firmName: "" },
    { id: 388, invoice_number: "KGH/2026-27/17", invoice_date: "2026-09-10", fy: "2026-27", prefix: "KGH", firmName: "" },
  ]);
  expect(names.get(388)).toEqual({ name: "KGH_2026-27_17.pdf", renamed: false });
  expect(names.get(412)).toEqual({ name: "KGH_2026-27_17_2.pdf", renamed: true });
});
