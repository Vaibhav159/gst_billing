import { describe, expect, it } from "vitest";
import { fieldOf, readSheet, sheetFirm, sheetKindHint } from "./columns";
import { addPatch, checkBill, groupBills, withEdits, importUnit } from "./model";
import type { Sheet } from "./parse";

const sheet: Sheet = { name: "KGH", rows: [
  ["KIRAN GOLD HOUSE"], ["GSTIN: 08ABCDE1234F1Z0"], ["Outward Supply"],
  ["Bill No.", "Date", "Party", "GSTIN", "Item", "HSN", "GST rate", "Quantity", "Rate", "Taxable Value", "CGST", "SGST", "Total"],
  ["1", "31/03/2026", "A", "08ABCDE1234F1Z0", "Gold", "7108", 3, 2, "450.125", 900.25, 13.51, 13.50, 927.26],
  ["", "", "", "", "Silver", "7106", "0%", 1, 100, 100, 0, 0, 100],
  ["TOTAL", "", "", "", "", "", "", "", "", 1000.25], ["Inward Supply"],
  ["Bill No.", "Date", "Supplier", "GSTIN", "Item", "HSN", "GST rate", "Quantity", "Rate", "Taxable Value", "CGST", "SGST", "Total"],
  ["1", "01/04/2026", "B", "08ABCDE1234F1Z0", "Gold", "7108", "3%", 1, 100, 100, 1.50, 1.50, 103],
  ["2", "02/04/2026", "C", "", "Scrap", "7112", 0, 1, 20, 20, 0, 0, 20],
] };
const parsed = () => groupBills(readSheet(sheet), "purchase");
const context = { firmId: 3, today: "2026-10-11", canSale: true, canPurchase: true };

describe("register layouts and editable bill checks", () => {
  it("recognises amount columns, not half tax-rate columns", () => {
    expect(fieldOf("CGST rate (%)")).toBeNull(); expect(fieldOf("CGST (₹)")).toBe("cgst"); expect(fieldOf("GST rate (%)")).toBe("slab");
  });
  it("splits sections, keeps continuations and drops totals without leaking GSTIN", () => {
    const read = readSheet(sheet), bills = parsed();
    expect(read.tables).toHaveLength(2); expect(read.rows).toHaveLength(4); expect(bills).toHaveLength(3);
    expect(bills[0].kind).toBe("sale"); expect(bills[0].rows).toEqual([5, 6]); expect(bills[0].lines[0].price).toBe("450.125");
    expect(bills[1].kind).toBe("purchase"); expect(bills[2].gstin).toBe("");
  });
  it("changes a mapping and honours firm GSTIN over name", () => {
    const read = readSheet(sheet, { 4: { 8: "taxable", 9: "price" } });
    expect(read.rows[0].price).toBe("900.25"); expect(read.tables[0].columns.find(c => c.i === 8)?.sure).toBe("you");
    expect(sheetFirm([{ id: 3, name: "KIRAN GOLD HOUSE", gst_number: "OTHER" }], read).firm).toBeNull();
    expect(sheetFirm([{ id: 3, name: "Other", gst_number: read.gstin }], read).firm?.id).toBe(3);
    expect(sheetKindHint(readSheet({ name: "Supplier register", rows: sheet.rows.slice(8) }))).toBe("purchase");
  });
  it("ignores summary sheets and prevents continuation across section boundaries", () => {
    expect(readSheet({ ...sheet, name: "Summary" }).summary).toBe(true);
    expect(readSheet({ name: "Bills", rows: [sheet.rows[3], sheet.rows[5]] }).rows).toHaveLength(0);
  });
  it("groups purchases by party and financial year; contradictory dates require a fix", () => {
    const original = parsed()[1];
    const conflict = { ...original, dates: new Set(["01/04/2026", "02/04/2026"]) };
    expect(checkBill(conflict, context).problems.some(p => p.field === "invoice_date")).toBe(true);
  });
  it("uses server rounding and keeps 3-decimal rate text", () => {
    const result = checkBill(parsed()[0], context);
    expect(result.state).toBe("ready"); expect(result.invoiceDate).toBe("2026-03-31"); expect(result.lines[0]).toMatchObject({ rate: "450.125" }); expect(result.totals.total).toBe(102726);
  });
  it("requires firm, valid actual calendar date, explicit slab and no taxed purchase without GSTIN", () => {
    const bill = parsed()[1];
    expect(checkBill(bill, { ...context, firmId: null }).state).toBe("firm");
    expect(checkBill({ ...bill, date: "31/02/2026" }, context).state).toBe("fix");
    expect(checkBill({ ...bill, gstin: "" }, context).problems[0].detail).toContain("the supplier has no GSTIN");
    const noRate = withEdits(bill, { lines: { 0: { slab: "" } } });
    expect(checkBill(noRate, context).problems[0].detail).toBe("Choose the slab printed on the bill (0% if it charges no GST).");
    expect(checkBill({ ...bill, date: "" }, context).state).toBe("fix");
  });
  it("reads formatted diamond fractions as 0.25%, keeps explicit zero and rejects unsupported fractions", () => {
    const bill = parsed()[1];
    const diamond = withEdits(bill, { lines: { 0: { slab: 0.0025, slabShown: "0.25%", cgst: 0, sgst: 0, total: 0 } } });
    expect(checkBill(diamond, context).lines[0].gst_percent).toBe("0.25");
    expect(checkBill(parsed()[2], context).lines[0].gst_percent).toBe("0");
  });
  it("reads bare stored fractions by the slab allowlist and never magnifies diamond or one-percent slabs", () => {
    const bill = parsed()[1];
    for (const [raw, expected] of [["0.03", "3"], ["0.28", "28"], ["0.0025", "0.25"], ["0.25", "0.25"], ["1", "1"], ["0.01", "1"], ["0.00001", ""], ["3oops", ""]]) {
      const edited = withEdits(bill, { lines: { 0: { slab: raw, slabShown: "", cgst: 0, sgst: 0, total: 0 } } });
      expect(checkBill(edited, context).lines[0].gst_percent).toBe(expected);
    }
  });
  it("keeps taxable-only lines as amount_only and refuses contradictory file tax with an exact fix", () => {
    const bill = parsed()[1];
    const amount = withEdits(bill, { lines: { 0: { qty: "", price: "" } } });
    expect(checkBill(amount, context).lines[0]).toMatchObject({ amount_only: true, taxable: "100.00" });
    const wrong = withEdits(bill, { lines: { 0: { cgst: 200, sgst: 200 } } });
    const checked = checkBill(wrong, context);
    expect(checked.state).toBe("fix"); expect(checked.problems.find(p => p.field === "lines.0.tax")?.fix?.label).toBe("Use 3% of the taxable value");
    const fixed = withEdits(wrong, addPatch({}, checked.problems.find(p => p.fix)?.fix?.patch ?? {}));
    expect(checkBill(fixed, context).state).toBe("ready");
  });
  it("flags a ten-times usual rate as To check, leaving it unticked", () => {
    const bill = parsed()[1]; const result = checkBill(bill, { ...context, usualRates: { "Gold|gms": 1000 } });
    expect(result.state).toBe("check"); expect(result.selected).toBe(false); expect(result.warnings[0].detail).toContain("10 times");
  });
  it("keeps accountant sales unavailable and retains immutable edits", () => {
    expect(checkBill(parsed()[0], { ...context, canSale: false }).state).toBe("role");
    const bill = parsed()[1], edited = withEdits(bill, addPatch({}, { line: 0, item: "Bullion" }));
    expect(edited.lines[0].item).toBe("Bullion"); expect(bill.lines[0].item).toBe("Gold");
  });
  it("warns when printed totals differ and fixes milligrams without changing taxable value", () => {
    const bill = withEdits(parsed()[1], { lines: { 0: { qty: "12500000", price: "0.12", unit: "g", taxable: 150000000, cgst: 0, sgst: 0, total: 1 } } });
    const checked = checkBill(bill, context), fix = checked.problems.find(p => p.field === "lines.0.quantity")?.fix;
    expect(fix?.label).toBe("Use 12,500.000 g at ₹120.00/g");
    const corrected = checkBill(withEdits(bill, addPatch({}, fix?.patch)), context);
    expect(corrected.state).toBe("ready"); expect(corrected.totals.taxable).toBe(150000000);
    expect(corrected.notes.some(n => n.includes("the lines are what's saved"))).toBe(true);
  });
  it("checks quantities on amount-only rows and keeps payment conflicts until edited", () => {
    const bill = withEdits(parsed()[1], { lines: { 0: { qty: "-2", price: "" } } });
    expect(checkBill(bill, context).problems.some(p => p.field === "lines.0.quantity")).toBe(true);
    const conflict = { ...parsed()[1], payments: new Set(["cash", "bank"]) };
    expect(checkBill(conflict, context).problems.some(p => p.field === "payment_mode")).toBe(true);
    expect(checkBill(withEdits(conflict, { payment: "bank" }), context).state).toBe("ready");
  });
  it("blocks file making charges instead of silently changing the server's line maths", () => {
    const bill = withEdits(parsed()[1], { lines: { 0: { making: 200 } } });
    expect(checkBill(bill, context).problems.some(p => p.detail.includes("making charges"))).toBe(true);
  });
});

it("maps portal carats CTM to ct without treating CMS centimetres as carats", () => {
  expect(importUnit("CTM")).toBe("ct"); expect(importUnit("CMS")).toBe("cms");
});
it("sums half-up rounded paise for two 0.025 lines", () => {
  const first = withEdits(parsed()[1], { lines: { 0: { qty: "1", price: "0.025", slab: "0", slabShown: "", taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 } } });
  const result = checkBill({ ...first, lines: [first.lines[0], first.lines[0]] }, context);
  expect(result.totals.taxable).toBe(6); expect(result.totals.total).toBe(6);
});
