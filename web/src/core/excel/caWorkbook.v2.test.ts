import * as XLSX from "xlsx-js-style";
import { generateReportExcel } from "./__fixtures__/v2Report";
import { mapDjangoInvoice } from "./__fixtures__/v2Adapter";
import books from "./__fixtures__/caWorkbook.books.json";
import responses from "./__fixtures__/caWorkbook.responses.json";
import { bytesOf } from "@/core/files/zip";
import { workbookBlob, type CaWorkbook } from "./caWorkbook";

const DETAIL_HEAD = [
  "S.No.", "Bill No.", "Invoice Date", "Party Name", "GST Number", "Commodity", "HSN Code", "GST Rate",
  "Qty (gm)", "Rate (₹/gm)", "Taxable Value (₹)", "CGST (₹)", "SGST (₹)", "IGST (₹)", "Round Off (₹)", "Total Invoice Value (₹)",
];
const SUMMARY_HEAD = [
  "Firm Name", "Invoices", "Taxable Value (₹)", "CGST (₹)", "SGST (₹)", "IGST (₹)", "Round Off (₹)", "Total Invoice Value (₹)",
  "Invoices", "Taxable Value (₹)", "CGST (₹)", "SGST (₹)", "IGST (₹)", "Round Off (₹)", "Total Invoice Value (₹)", "Net Total (₹)",
];
const business = { ...books.business, id: String(books.business.id) };
const customers = books.customers.map(party => ({ ...party, id: String(party.id) }));
type Case = keyof typeof responses;

/** Python's test_ca_workbook_parity verifies these are real API/builder responses
 * from caWorkbook.books.json. Neither adapter totals nor CA rows are hand-built here. */
async function both(includePayment: boolean, name: Case = "ordinary") {
  const response = responses[name];
  const invoices = response.invoices.map(mapDjangoInvoice);
  expect(invoices.every(invoice => invoice.roundedOff === undefined)).toBe(true);
  const data = structuredClone(response.workbook) as CaWorkbook;
  // The plain-download toggle only omits payment blocks; it changes no figure.
  if (!includePayment) for (const firm of data.firms) for (const month of firm.months) {
    month.sales.split = []; month.purchases.split = [];
  }
  const before = JSON.stringify(data);
  const oldBlob = generateReportExcel({ invoices, businesses: [business], customers, includePayment });
  const newBlob = await workbookBlob(data);
  expect(JSON.stringify(data)).toBe(before);
  return Promise.all([oldBlob, newBlob].map(async blob => XLSX.read(await bytesOf(blob), { type: "array", cellNF: true })));
}

function cell(sheet: XLSX.WorkSheet, row: number, column: number): XLSX.CellObject {
  return sheet[XLSX.utils.encode_cell({ r: row, c: column })] as XLSX.CellObject;
}
function prefix(sheet: XLSX.WorkSheet, row: number, width: number) {
  return Array.from({ length: width }, (_, column) => {
    const value = cell(sheet, row, column);
    return value ? { v: value.v, t: value.t, z: value.z ?? "General" } : null;
  });
}
function findRows(sheet: XLSX.WorkSheet, column: number, value: string): number[] {
  const range = XLSX.utils.decode_range(sheet["!ref"]!);
  return Array.from({ length: range.e.r + 1 }, (_, row) => row).filter(row => cell(sheet, row, column)?.v === value);
}
function detailSections(sheet: XLSX.WorkSheet, width: number) {
  return findRows(sheet, 0, "S.No.").map(header => {
    const rows = [];
    for (let row = header + 1; cell(sheet, row, 0)?.v !== "TOTAL"; row += 1) {
      if (row > XLSX.utils.decode_range(sheet["!ref"]!).e.r) throw new Error("Missing invoice section total");
      rows.push(prefix(sheet, row, width));
    }
    return { header: prefix(sheet, header, width), rows };
  });
}

test.each([false, true])("X-81 preserves the actual v2 Summary columns and figures (payment split %s)", async includePayment => {
  const [oldBook, newBook] = await both(includePayment);
  expect(newBook.SheetNames.slice(0, oldBook.SheetNames.length)).toEqual(oldBook.SheetNames);
  const oldSheet = oldBook.Sheets.Summary;
  const newSheet = newBook.Sheets.Summary;
  expect(prefix(oldSheet, 2, 16).map(value => value?.v)).toEqual(SUMMARY_HEAD);
  expect(prefix(newSheet, 2, 16)).toEqual(prefix(oldSheet, 2, 16));
  expect(prefix(newSheet, 3, 16)).toEqual(prefix(oldSheet, 3, 16));
  const oldTotal = findRows(oldSheet, 0, "GRAND TOTAL");
  const newTotal = findRows(newSheet, 0, "GRAND TOTAL");
  expect(newTotal).toHaveLength(1);
  expect(prefix(newSheet, newTotal[0], 16)).toEqual(prefix(oldSheet, oldTotal[0], 16));
});

test.each([false, true])("X-81 keeps v2's detail prefix, all item figures and cell formats (payment split %s)", async includePayment => {
  const [oldBook, newBook] = await both(includePayment);
  const width = includePayment ? 17 : 16;
  const oldSections = detailSections(oldBook.Sheets[business.name], width);
  const newSections = detailSections(newBook.Sheets[business.name], width);
  expect(oldSections).toHaveLength(2);
  expect(oldSections.map(value => value.rows.length)).toEqual([5, 2]);
  const expected = [...DETAIL_HEAD, ...(includePayment ? ["Payment"] : [])];
  for (const value of oldSections) expect(value.header.map(entry => entry?.v)).toEqual(expected);
  expect(newSections).toEqual(oldSections);
});

test.each([false, true])("X-81 preserves v2's section and period totals and omits empty months/sides (payment split %s)", async includePayment => {
  const [oldBook, newBook] = await both(includePayment);
  const oldSheet = oldBook.Sheets[business.name];
  const newSheet = newBook.Sheets[business.name];
  const oldTotals = findRows(oldSheet, 0, "TOTAL");
  const newTotals = findRows(newSheet, 0, "TOTAL");
  expect(newTotals).toHaveLength(2);
  expect(newTotals.map(row => prefix(newSheet, row, 16))).toEqual(oldTotals.map(row => prefix(oldSheet, row, 16)));
  for (const label of [
    "Outward Supply", "Inward Supply", "Month: Sep 2026", "Month: Oct 2026",
    "PERIOD SUMMARY (Sep 2026 to Oct 2026)", "Supply Type",
    "Outward Supply (4 invoices)", "Inward Supply (2 invoices)", "GRAND TOTAL",
  ]) {
    const oldRows = findRows(oldSheet, 0, label);
    const newRows = findRows(newSheet, 0, label);
    expect(oldRows, label).toHaveLength(1);
    expect(newRows, label).toHaveLength(1);
    expect(prefix(newSheet, newRows[0], 16), label).toEqual(prefix(oldSheet, oldRows[0], 16));
  }
  expect(findRows(newSheet, 0, "Month: Aug 2026")).toEqual([]);
  expect(findRows(newSheet, 0, "Month: Nov 2026")).toEqual([]);
  const saleRows = detailSections(newSheet, 16)[0].rows;
  expect(saleRows.map(row => row[1]?.v)).toEqual(["9", "12", "", "DRIFT", "10"]);
  expect(saleRows.map(row => row[0]?.v)).toEqual([1, 2, "", 3, 4]);
});

test("X-81 preserves the optional v2 payment split's first six columns, values and number formats", async () => {
  const [oldBook, newBook] = await both(true);
  const oldSheet = oldBook.Sheets[business.name];
  const newSheet = newBook.Sheets[business.name];
  const oldBlocks = findRows(oldSheet, 0, "PAYMENT SPLIT (cash / bank)");
  const newBlocks = findRows(newSheet, 0, "PAYMENT SPLIT (cash / bank)");
  expect(oldBlocks).toHaveLength(2);
  expect(newBlocks).toHaveLength(2);
  const counts = [3, 1];
  for (const [index, oldRow] of oldBlocks.entries()) {
    const newRow = newBlocks[index];
    expect(prefix(oldSheet, oldRow + 1, 6).map(value => value?.v))
      .toEqual(["MODE", "INVOICES", "GROSS (₹)", "TAXABLE (₹)", "GST (₹)", "SHARE %"]);
    for (let offset = 1; offset <= counts[index] + 1; offset += 1) {
      expect(prefix(newSheet, newRow + offset, 6)).toEqual(prefix(oldSheet, oldRow + offset, 6));
    }
    const shares = Array.from({ length: counts[index] }, (_, row) => Number(cell(newSheet, newRow + row + 2, 5).v));
    expect(shares.reduce((sum, value) => sum + Math.round(value * 10000), 0)).toBe(1000000);
  }
  expect([2, 3, 4].map(offset => cell(newSheet, newBlocks[0] + offset, 0).v)).toEqual(["Cash", "(not set)", "Bank"]);
  const [, plainBook] = await both(false);
  expect(findRows(plainBook.Sheets[business.name], 0, "PAYMENT SPLIT (cash / bank)")).toEqual([]);
});

test("X-81 appends the original unit and precise rate without converting carats or changing multiline blanks", async () => {
  const [, newBook] = await both(true);
  const sheet = newBook.Sheets[business.name];
  const header = findRows(sheet, 0, "S.No.")[0];
  expect(prefix(sheet, header, 19).map(value => value?.v)).toEqual([...DETAIL_HEAD, "Payment", "Unit", "Rate per unit"]);
  const diamond = findRows(sheet, 5, "Diamond")[0];
  expect(cell(sheet, diamond, 7)).toMatchObject({ t: "s", v: "0.25%" });
  expect(cell(sheet, diamond, 8)).toMatchObject({ t: "n", v: 6.4, z: "#,##0.000" });
  expect(cell(sheet, diamond, 9)).toMatchObject({ t: "n", v: 56400.12, z: "#,##0.00" });
  expect(cell(sheet, diamond, 17)).toMatchObject({ t: "s", v: "ct" });
  expect(cell(sheet, diamond, 18)).toMatchObject({ t: "n", v: 56400.123, z: "#,##0.000" });
  const silver = findRows(sheet, 5, "Silver")[0];
  // The original three-decimal rate is retained after the legacy rounded rate.
  expect(cell(sheet, silver, 18)).toMatchObject({ t: "n", v: 1.005, z: "#,##0.000" });
  const chain = findRows(sheet, 5, "Chain")[0];
  for (const column of [0, 1, 2, 3, 4, 14, 15, 16]) expect(cell(sheet, chain, column)?.v).toBe("");
  expect(cell(sheet, chain, 17)?.v).toBe("pcs");
  const empty = findRows(sheet, 1, "10")[0];
  expect([5, 6, 7].map(column => cell(sheet, empty, column)?.v)).toEqual(["", "", ""]);
  expect(cell(sheet, empty, 8)).toMatchObject({ t: "n", v: 0, z: "#,##0.000" });
  expect(cell(sheet, empty, 9)).toMatchObject({ t: "n", v: 0, z: "#,##0.00" });
});

test("X-84 keeps Round Off zero and itemless bills taxable through both real transformations", async () => {
  const [oldBook, newBook] = await both(true);
  for (const book of [oldBook, newBook]) {
    const sheet = book.Sheets[business.name];
    for (const [number, taxable, value] of [["10", 100, 100], ["P/empty", 75, 75], ["DRIFT", 100, 103.01]] as const) {
      const row = findRows(sheet, 1, number)[0];
      expect([10, 14, 15].map(column => cell(sheet, row, column).v)).toEqual([taxable, 0, value]);
    }
    for (const row of findRows(sheet, 0, "TOTAL")) expect(cell(sheet, row, 14).v).toBe(0);
    expect([6, 13].map(column => cell(book.Sheets.Summary, 3, column).v)).toEqual([0, 0]);
  }
});

test.each([
  ["ties", ["Credit", "Bank", "Cash"]],
  ["collation", ["Bank", "Credit", "Cash"]],
] as const)("X-84 assigns equal-value mode order and percentage remainder in v2's natural bill order (%s)", async (name, modes) => {
  const [oldBook, newBook] = await both(true, name);
  const oldSheet = oldBook.Sheets[business.name], newSheet = newBook.Sheets[business.name];
  expect(detailSections(newSheet, 17)).toEqual(detailSections(oldSheet, 17));
  const oldStart = findRows(oldSheet, 0, "PAYMENT SPLIT (cash / bank)")[0];
  const newStart = findRows(newSheet, 0, "PAYMENT SPLIT (cash / bank)")[0];
  const oldRows = [2, 3, 4].map(offset => prefix(oldSheet, oldStart + offset, 6));
  const newRows = [2, 3, 4].map(offset => prefix(newSheet, newStart + offset, 6));
  expect(newRows).toEqual(oldRows);
  expect(newRows.map(row => [row[0]?.v, row[5]?.v])).toEqual(modes.map((mode, index) => [mode, index === 2 ? 33.3334 : 33.3333]));
});

const withValues = (row: ReturnType<typeof prefix>, values: Record<number, string | number>) =>
  row.map((cell, column) => cell && column in values ? { ...cell, v: values[column] } : cell);

test.each([false, true])("X-84 exception one: only cancelled sales leave the register and its totals (payment split %s)", async includePayment => {
  const [oldBook, newBook] = await both(includePayment, "cancelled");
  const oldSheet = oldBook.Sheets[business.name], newSheet = newBook.Sheets[business.name];
  const width = includePayment ? 17 : 16;
  const oldRows = detailSections(oldSheet, width)[0], newRows = detailSections(newSheet, width)[0];
  expect(oldRows.rows.map(row => row[1]?.v)).toEqual(["LIVE", "VOID"]);
  expect(newRows).toEqual({ header: oldRows.header, rows: [oldRows.rows[0]] });
  const summary = prefix(oldBook.Sheets.Summary, 3, 16);
  expect(summary.map(cell => cell?.v)).toEqual([business.name, 2, 300, 4.5, 4.5, 0, 0, 309, 0, 0, 0, 0, 0, 0, 0, 309]);
  expect(prefix(newBook.Sheets.Summary, 3, 16)).toEqual(withValues(summary, { 1: 1, 2: 100, 3: 1.5, 4: 1.5, 7: 103, 15: 103 }));
  expect(prefix(newBook.Sheets.Summary, 4, 16)).toEqual(withValues(prefix(oldBook.Sheets.Summary, 4, 16), { 1: 1, 2: 100, 3: 1.5, 4: 1.5, 7: 103, 15: 103 }));
  for (const label of ["TOTAL", "GRAND TOTAL"]) {
    const before = prefix(oldSheet, findRows(oldSheet, 0, label)[0], 16);
    expect(prefix(newSheet, findRows(newSheet, 0, label)[0], 16)).toEqual(withValues(before, { 10: 100, 11: 1.5, 12: 1.5, 15: 103 }));
  }
  const period = prefix(oldSheet, findRows(oldSheet, 0, "Outward Supply (2 invoices)")[0], 16);
  expect(prefix(newSheet, findRows(newSheet, 0, "Outward Supply (1 invoices)")[0], 16))
    .toEqual(withValues(period, { 0: "Outward Supply (1 invoices)", 10: 100, 11: 1.5, 12: 1.5, 15: 103 }));
  if (includePayment) {
    const before = prefix(oldSheet, findRows(oldSheet, 0, "PAYMENT SPLIT (cash / bank)")[0] + 2, 6);
    expect(before.map(cell => cell?.v)).toEqual(["Cash", 2, 309, 300, 9, 100]);
    expect(prefix(newSheet, findRows(newSheet, 0, "PAYMENT SPLIT (cash / bank)")[0] + 2, 6))
      .toEqual(withValues(before, { 1: 1, 2: 103, 3: 100, 4: 3 }));
  }
});

test("X-84 exception two: old three-decimal lines round per line to the paisa, with no other changed figures", async () => {
  const [oldBook, newBook] = await both(true, "paise");
  const oldSheet = oldBook.Sheets[business.name], newSheet = newBook.Sheets[business.name];
  // Both item rows already display rounded paise; v2 totals unrounded lines before rounding.
  expect(detailSections(newSheet, 17)).toEqual(detailSections(oldSheet, 17));
  for (const row of [3, 4]) {
    const before = prefix(oldBook.Sheets.Summary, row, 16);
    expect([2, 3, 4].map(column => before[column]?.v)).toEqual([2.05, 0.05, 0.05]);
    expect(prefix(newBook.Sheets.Summary, row, 16)).toEqual(withValues(before, { 2: 2.06, 3: 0.06, 4: 0.06 }));
  }
  for (const label of ["TOTAL", "Outward Supply (2 invoices)", "GRAND TOTAL"]) {
    const before = prefix(oldSheet, findRows(oldSheet, 0, label)[0], 16);
    expect([10, 11, 12].map(column => before[column]?.v)).toEqual([2.05, 0.05, 0.05]);
    expect(prefix(newSheet, findRows(newSheet, 0, label)[0], 16)).toEqual(withValues(before, { 10: 2.06, 11: 0.06, 12: 0.06 }));
  }
  const oldStart = findRows(oldSheet, 0, "PAYMENT SPLIT (cash / bank)")[0];
  const newStart = findRows(newSheet, 0, "PAYMENT SPLIT (cash / bank)")[0];
  const bank = prefix(oldSheet, oldStart + 2, 6), cash = prefix(oldSheet, oldStart + 3, 6);
  expect([bank[4]?.v, cash[3]?.v]).toEqual([0.10, 0.05]);
  expect(prefix(newSheet, newStart + 2, 6)).toEqual(withValues(bank, { 4: 0.12 }));
  expect(prefix(newSheet, newStart + 3, 6)).toEqual(withValues(cash, { 3: 0.06 }));
});
