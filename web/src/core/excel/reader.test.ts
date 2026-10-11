import * as XLSX from "xlsx-js-style";
import { bytesOf } from "@/core/files/zip";
import { excelBlob } from "./writer";
import { parseCsv, readExcel } from "./reader";

test("the real writer and reader retain identifier text and three-decimal display alongside numeric values", async () => {
  const blob = await excelBlob([{ name: "Purchases", cols: [120, 120, 120, 120], rows: [
    { kind: "data", cells: [{ v: "000123" }, { v: "6.400", num: true }, { v: "56400.000", num: true }, { v: "0.25", num: true }] },
  ] }]);
  const [sheet] = await readExcel((await bytesOf(blob)).buffer);
  expect(sheet.name).toBe("Purchases");
  expect(sheet.rows).toEqual([["000123", 6.4, 56400, 0.25]]);
  expect(sheet.shown).toEqual([["000123", "6.400", "56,400.000", "0.25"]]);
});

function workbook(date1904 = false) {
  const book = XLSX.utils.book_new();
  book.Workbook = { WBProps: { date1904 } };
  const sheet: XLSX.WorkSheet = { "!ref": "A1:F2", A2: { t: "s", v: "Gold bullion" }, C2: { t: "n", v: 46112, z: "yyyy-mm-dd" }, D2: { t: "n", v: 0.0025, z: "0.00%" }, E2: { t: "s", v: "0012" }, F2: { t: "n", f: "1+1", v: 2 } };
  XLSX.utils.book_append_sheet(book, sheet, "Import");
  return XLSX.write(book, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer;
}

test("compressed Excel keeps sparse coordinates, percentages and cached formulas without evaluating them", async () => {
  const [sheet] = await readExcel(workbook());
  expect(sheet.rows).toEqual([[], ["Gold bullion", null, "2026-03-31", 0.0025, "0012", 2]]);
  expect(sheet.shown[1][3]).toBe("0.25%");
});

test("the 1904 date system is converted as a calendar day without a timezone shift", async () => {
  expect((await readExcel(workbook(true)))[0].rows[1][2]).toBe("2030-04-01");
});

test("CSV preserves text identifiers and decimal scale through quoted commas, newlines, escaped quotes and BOM", () => {
  expect(parseCsv('\ufeffBill,Party,Qty,Rate\r\n000123,"A, B\n""Gold""",6.400,56400.000\r\n'))
    .toEqual([["Bill", "Party", "Qty", "Rate"], ["000123", 'A, B\n"Gold"', "6.400", "56400.000"]]);
  expect(parseCsv('Bill;Amount\n000123;"1,23,456.50"')[1]).toEqual(["000123", "1,23,456.50"]);
  expect(parseCsv('Bill\tQty\n000123\t6.400')[1]).toEqual(["000123", "6.400"]);
});

test("an unfinished CSV quote and a non-workbook buffer are refused rather than silently imported", async () => {
  expect(() => parseCsv('Bill,Party\n1,"A')).toThrow("A quoted field isn't closed. Check the CSV file.");
  await expect(readExcel(new ArrayBuffer(2))).rejects.toThrow("This isn't an Excel workbook (.xlsx).");
});

test("Excel error cells read as empty values, never as their numeric error codes", async () => {
  const book = XLSX.utils.book_new();
  // SheetJS stores #N/A as code 42 and #DIV/0! as code 7 in v.
  XLSX.utils.book_append_sheet(book, { "!ref": "A1:C1", A1: { t: "e", v: 42, w: "#N/A" }, B1: { t: "e", v: 7, w: "#DIV/0!" }, C1: { t: "n", v: 5 } }, "Import");
  const [sheet] = await readExcel(XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
  expect(sheet.rows).toEqual([[null, null, 5]]);
  expect(sheet.shown).toEqual([["#N/A", "#DIV/0!", "5"]]);
});
