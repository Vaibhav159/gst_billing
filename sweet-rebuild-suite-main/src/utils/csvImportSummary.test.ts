import { describe, expect, it } from "vitest";
import { csvImportSummary } from "./csvImportSummary";

// Review of M27: the CSV import screen ignored the server's answer and said
// "Import Successful" whatever it was, so "removed and reported" never
// reached anyone.
describe("the CSV import's toast says what the server did", () => {
  it("counts what was created", () => {
    expect(csvImportSummary({ invoices_created: 2, line_items_created: 5, errors: [] }, "invoices.csv")).toEqual({
      ok: true, title: "Import done", description: "invoices.csv: 2 invoices, 5 line items imported.",
    });
  });

  it("says what was refused, and is not a success when nothing came in", () => {
    const s = csvImportSummary({ customers_created: 0, errors: ["Customer 'A': 08ABC isn't a GSTIN.", "x", "y", "z"] }, "c.csv");
    expect(s.ok).toBe(false);
    expect(s.title).toBe("Nothing imported");
    expect(s.description).toContain("08ABC isn't a GSTIN");
    expect(s.description).toContain("and 1 more");
  });

  it("is a partial import when some rows came in and some didn't", () => {
    const s = csvImportSummary({ products_created: 3, errors: ["Row 4: no name"] }, "p.csv");
    expect(s).toMatchObject({ ok: false, title: "Imported with problems" });
    expect(s.description).toContain("3 products");
  });
});
