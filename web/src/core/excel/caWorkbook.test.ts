import * as XLSX from "xlsx-js-style";
import { bytesOf } from "@/core/files/zip";
import { workbookBlob, workbookSheets, type CaWorkbook } from "./caWorkbook";

const totals = { bills: 1, taxable: "80396.81", cgst: "1205.95", sgst: "1205.95", igst: "0.00", round_off: "0.00", value: "82808.71" };
const heads = { igst: "0.00", cgst: "451.20", sgst: "451.20" };
export function caFixture(): CaWorkbook {
  return { scope: "All firms", period: "Sep 2026", file: "GST_Report_All_firms_Sep_2026.xlsx", summary: [{ firm: "Summary", sales: totals, purchases: { ...totals, taxable: "360960.00", cgst: "451.20", sgst: "451.20", value: "361862.40" } }], firms: [{
    firm: { id: 3, name: "Summary", gst_number: "08VRHFA2322D1ZI" }, months: [{ month: "2026-09", sales: { rows: [
      [1, "KGH/2026-27/21", "2026-09-12", "Anil Gupta", "08ABCDE1234F1Z5", "Gold Ring 22K", "711319", "3", "12.345", "gms", "6512.500", "80396.81", "1205.95", "1205.95", "0.00", "0.00", "82808.71", "cash", "B2B", "08"],
    ], totals, split: [] }, purchases: { rows: [[1, "JGE/1183", "2026-09-05", "Jaipur Gem Exports", "08…", "Diamond", "710239", "0.25", "6.400", "ct", "56400.000", "360960.00", "451.20", "451.20", "0.00", "0.00", "361862.40", "bank", "2026-10", "to_claim"]], totals: { ...totals, taxable: "360960.00", cgst: "451.20", sgst: "451.20", value: "361862.40" }, split: [] } }],
    gstr1: [{ month: "2026-09", stage: "ready", sections: { b2b: [{ bill: { invoice_number: "KGH/2026-27/21", invoice_date: "2026-09-12" }, place_of_supply: "08", rates: ["3"], ...totals, total: totals.value }], b2cl: [], b2cs: [], nil: [], by_rate: [], hsn: { b2b: [], b2c: [{ hsn: "710239", description: "Diamonds", uqc: "CTM", quantity: "6.40", rate: "0.25", taxable: "360960.00", ...heads, bills: 1 }] }, docs: [{ from: "21", to: "23", total: 3, cancelled: 1, net: 2 }], docs_notes: ["A cancelled number counts once."], cancelled: [], amendments: { b2ba: 0, b2cla: 0, b2csa: 0 } } }],
    gstr3b: [{ month: "2026-09", stage: "filed", filing: { filed_on: "2026-10-08", arn: "AA0809261234567", marked_by: { name: "Owner" } }, tables: { t31a: { ...totals, total: totals.value }, t31c: { taxable: "0.00" }, t32: [], t4a5: { bills: 1, heads }, t4b1: { bills: 0, heads: { igst: "0.00", cgst: "0.00", sgst: "0.00" } }, t4c: heads, t4d2: { bills: 0, heads: { igst: "0.00", cgst: "0.00", sgst: "0.00" } }, t5: { inter: "0.00", intra: "1200.00" }, cash: { igst: "0.00", cgst: "754.75", sgst: "754.75" }, cash_paid: { igst: "0.00", cgst: "755.00", sgst: "755.00" }, carry_in: { heads: { igst: "0.00", cgst: "0.00", sgst: "0.00" }, from: "2026-08", as_filed: true }, available: heads, used: heads, carry_on: { igst: "0.00", cgst: "0.00", sgst: "0.00" }, steps: [], to_confirm: [] } }], amendments: [],
  }] };
}

function addChain(data: CaWorkbook): CaWorkbook {
  // Ring ₹80,396.81 + chain ₹100; heads ₹1,207.45 each; exact bill ₹82,911.71.
  const sales = data.firms[0].months[0].sales;
  sales.rows[0][16] = "82911.71";
  sales.rows.push(["", "", "", "", "", "Chain", "711319", "3", "1.000", "gms", "100.000", "100.00", "1.50", "1.50", "0.00", "", "", "", "B2B", "08"]);
  sales.totals = { ...totals, taxable: "80496.81", cgst: "1207.45", sgst: "1207.45", value: "82911.71" };
  data.summary[0].sales = sales.totals;
  return data;
}

test("all required sheets are present and reserved names do not collide with firm names", () => {
  const data = caFixture();
  const before = JSON.stringify(data);
  const sheets = workbookSheets(data);
  expect(sheets.map(sheet => sheet.name)).toEqual(["Summary", "Summary (2)", "GSTR-1", "GSTR-3B"]);
  expect(JSON.stringify(data)).toBe(before);
  expect(JSON.stringify(sheets[0])).not.toMatch(/net total/i);
  expect(sheets[0].rows[sheets[0].rows.length - 1]?.cells.map(cell => cell.v)).toEqual(["Summary", 1, "80396.81", "1205.95", "1205.95", "0.00", "0.00", "82808.71", 1, "360960.00", "451.20", "451.20", "0.00", "0.00", "361862.40"]);
});

test("line rows keep first-row-only totals, 3 decimal rates, sub-one-percent slabs and credit months", () => {
  const data = addChain(caFixture());
  const sheet = workbookSheets(data)[1];
  const rows = sheet.rows.map(row => row.cells.map(cell => cell.v));
  expect(rows).toContainEqual(expect.arrayContaining(["Qty", "Unit", "Rate per unit", "GSTR-1 table", "Place of supply"]));
  expect(rows).toContainEqual(expect.arrayContaining(["Credit in", "Credit state"]));
  expect(rows).toContainEqual(data.firms[0].months[0].sales.rows[1]);
  expect(rows).toContainEqual(caFixture().firms[0].months[0].purchases.rows[0]);
  expect(rows.flat()).not.toContain("Qty (gm)");
});

test("GSTR sheets retain CTM, document counts, 4(B)(1), 4(D)(2), filed cash and period provenance", () => {
  const sheets = workbookSheets(caFixture());
  const values = sheets.flatMap(sheet => sheet.rows.flatMap(row => row.cells.map(cell => cell.v)));
  expect(values).toEqual(expect.arrayContaining(["CTM", "6.400", "0.25", "Table 13 · Documents issued", "A cancelled number counts once.", "Credit not allowed [4(B)(1)]", "Credit too late to claim [4(D)(2)]", "6.1 · Cash paid", "755.00", "2026-10-08", "AA0809261234567"]));
});

test("optional amendments show corrected month, before and after, destination and too-late state", () => {
  const data = caFixture();
  data.firms[0].amendments = [{ month: "2026-08", kind: "changed", invoice_number: "KGH/9", section: "b2cs", tax_diff: "3.00", before: { taxable: "100.00", cgst: "1.50", sgst: "1.50", igst: "0.00", total: "103.00" }, after: { taxable: "200.00", cgst: "3.00", sgst: "3.00", igst: "0.00", total: "206.00" }, goes_in: "October's GSTR-1 · B2CSA (3%)", too_late: true }];
  const all = workbookSheets(data); const sheet = all[all.length - 1];
  expect(sheet.name).toBe("Amendments");
  expect(sheet.rows.flatMap(row => row.cells.map(cell => cell.v))).toEqual(expect.arrayContaining(["2026-08", "100.00", "200.00", "October's GSTR-1 · B2CSA (3%)", "Too late to amend"]));
});

test("the actual workbook preserves numeric scale and never repeats a multiline bill's total", async () => {
  const data = addChain(caFixture());
  const back = XLSX.read(await bytesOf(await workbookBlob(data)), { type: "array", cellNF: true });
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(back.Sheets["Summary (2)"], { header: 1 });
  const first = rows.find(row => row[1] === "KGH/2026-27/21")!;
  expect(first.slice(7, 17)).toEqual([3, 12.345, "gms", 6512.5, 80396.81, 1205.95, 1205.95, 0, 0, 82911.71]);
  expect(rows.find(row => row[5] === "Chain")?.[16]).toBe("");
});

test("an empty period still produces Summary and both return sheets", () => {
  const data = caFixture(); data.summary = []; data.firms = [];
  expect(workbookSheets(data).map(sheet => sheet.name)).toEqual(["Summary", "GSTR-1", "GSTR-3B"]);
});

test("late estimates use the nested contract shape and unlocked books are marked To file", () => {
  const data = caFixture();
  const month = data.firms[0].gstr3b[0]; month.stage = "unlocked";
  month.tables.late = { gstr1: { days: 3, per_day: "50.00", fee: "150.00", cap: "5000.00", capped: false }, gstr3b: { days: 0, per_day: "50.00", fee: "0.00", cap: "5000.00", capped: false }, interest: "0.00", interest_on: "1509.50", interest_from: "2026-10-21", total: "150.00" };
  const values = workbookSheets(data)[3].rows.flatMap(row => row.cells.map(cell => cell.v));
  expect(values).toEqual(expect.arrayContaining(["Summary · 2026-09 · To file", "150.00", "5000.00", "2026-10-21", "Owner"]));
});

test("GSTR-3B has statutory zero tables and preserves cash paid as a total with unknown heads", () => {
  const data = caFixture();
  data.firms[0].gstr3b[0].tables.cash_paid = { igst: null, cgst: null, sgst: null, total: "1510.00" };
  const sheet = workbookSheets(data)[3];
  const rows = sheet.rows.map(row => row.cells.map(cell => cell.v));
  for (const label of ["3.1(b) · Zero-rated", "3.1(d) · Reverse charge", "3.1(e) · Non-GST", "3.1.1 · E-commerce supplies"]) {
    expect(rows).toContainEqual([label, "0.00", "0.00", "0.00", "0.00", 0, "0.00"]);
  }
  expect(rows.find(row => row[0] === "6.1 · Cash paid")).toEqual(["6.1 · Cash paid", "", "", "", "1510.00", "", "", ""]);
  expect(sheet.note).toBe("Amounts are in rupees. Figures come from the server; filed returns keep their recorded figures.");
});

test("payment split is response-driven and never leaks into the next workbook", () => {
  const data = caFixture();
  data.firms[0].months[0].sales.split = [{ mode: "cash", bills: 1, value: "82808.71", taxable: "80396.81", igst: "0.00", cgst: "1205.95", sgst: "1205.95", share: "100.0000" }];
  expect(workbookSheets(data)[1].rows.map(row => row.cells.map(cell => cell.v))).toContainEqual(["cash", 1, "82808.71", "80396.81", "0.00", "1205.95", "1205.95", "100.0000"]);
  expect(workbookSheets(caFixture())[1].rows.flatMap(row => row.cells.map(cell => cell.v))).not.toContain("PAYMENT SPLIT (cash / bank)");
});

test("X38 preserves server NIL placement and HSN words, and pre-ledger purchases have no invented credit month", () => {
  const data = caFixture();
  const sale = data.firms[0].months[0].sales.rows[0]; sale[7] = "0"; sale[18] = "NIL";
  const purchase = data.firms[0].months[0].purchases.rows[0]; purchase[2] = "2024-03-31"; purchase[18] = ""; purchase[19] = "outside";
  data.firms[0].gstr1[0].sections.hsn = { b2b: [{ hsn: "711319", description: "The server's period description", uqc: "GMS", quantity: "12.35", rate: "0", taxable: "80396.81", igst: "0.00", cgst: "0.00", sgst: "0.00", bills: 1 }], b2c: [] };
  const sheets = workbookSheets(data);
  expect(sheets[1].rows.map(row => row.cells.map(cell => cell.v))).toContainEqual(sale);
  expect(sheets[1].rows.map(row => row.cells.map(cell => cell.v))).toContainEqual(purchase);
  expect(sheets[2].rows.flatMap(row => row.cells.map(cell => cell.v))).toContain("The server's period description");
});


test("P3-15 keeps April's combined portal HSN rows and May's buyer split without rounding detail quantities", async () => {
  const data = caFixture();
  const may = data.firms[0].gstr1[0]; may.month = "2025-05";
  data.firms[0].gstr1.unshift({ ...may, month: "2025-04", sections: { ...may.sections, hsn: {
    data: [{ hsn: "711319", description: "Jewellery, gold or silver", uqc: "GMS", quantity: "512.35", rate: "3", taxable: "80396.81", igst: "0.00", cgst: "1205.95", sgst: "1205.95", bills: 1 }], b2b: [], b2c: [],
  } } });
  const before = JSON.stringify(data);
  const sheet = workbookSheets(data)[2];
  const rows = sheet.rows.map(row => row.cells.map(cell => cell.v));
  const april = rows.findIndex(row => row[0] === "Summary · 2025-04 · ready");
  const mayStart = rows.findIndex(row => row[0] === "Summary · 2025-05 · ready");
  expect(rows.slice(april, mayStart).flat()).toContain("HSN · all buyers");
  expect(rows.slice(april, mayStart).flat()).not.toContain("HSN B2B");
  expect(rows.slice(april, mayStart).flat()).not.toContain("HSN B2C");
  expect(rows.slice(mayStart).flat()).toEqual(expect.arrayContaining(["HSN B2B", "HSN B2C", "CTM", "6.40"]));
  expect(rows.find(row => row[0] === "711319")?.slice(0, 5)).toEqual(["711319", "Jewellery, gold or silver", "GMS", "512.35", "3"]);
  const back = XLSX.read(await bytesOf(await workbookBlob(data)), { type: "array", cellNF: true });
  const hsnQuantity = Object.values(back.Sheets["GSTR-1"]).find(cell => cell?.v === 512.35);
  expect(hsnQuantity).toMatchObject({ t: "n", v: 512.35, z: "#,##0.00" });
  const detailQuantity = Object.values(back.Sheets["Summary (2)"]).find(cell => cell?.v === 12.345);
  expect(detailQuantity).toMatchObject({ t: "n", v: 12.345, z: "#,##0.000" });
  expect(JSON.stringify(data)).toBe(before);
});

test("P3-15 labels live interest beside its figure while keeping recorded filing interest separate", async () => {
  const data = caFixture();
  const month = data.firms[0].gstr3b[0]; month.stage = "unlocked";
  month.filing = { ...month.filing, interest: "9.99" };
  month.tables.interest_note = "worked out to today; check on the portal";
  month.tables.late = { gstr1: { days: 0, fee: "0.00" }, gstr3b: { days: 1, fee: "50.00" }, interest: "12.34", interest_on: "1509.50", interest_from: "2026-10-21", total: "62.34" };
  const sheet = workbookSheets(data)[3];
  const rows = sheet.rows.map(row => row.cells.map(cell => cell.v));
  const filingHeader = rows.findIndex(row => row[0] === "Filed on");
  expect(rows[filingHeader]).toContain("Interest");
  expect(rows[filingHeader + 1]).toContain("9.99");
  const estimate = rows.findIndex(row => row[0] === "Late fee and interest · estimate");
  expect(rows[estimate + 1]).toEqual(["Interest", "Interest on", "Interest from", "Total", "Interest note"]);
  expect(rows[estimate + 2]).toEqual(["12.34", "1509.50", "2026-10-21", "62.34", "worked out to today; check on the portal"]);
  expect(sheet.note).toBe("Amounts are in rupees. Figures come from the server; filed returns keep their recorded figures.");
  const back = XLSX.read(await bytesOf(await workbookBlob(data)), { type: "array" });
  const downloaded = XLSX.utils.sheet_to_json<(string | number)[]>(back.Sheets["GSTR-3B"], { header: 1 });
  expect(downloaded).toContainEqual([12.34, 1509.5, "2026-10-21", 62.34, "worked out to today; check on the portal"]);
  expect(downloaded[filingHeader + 1]).toContain(9.99);
});
