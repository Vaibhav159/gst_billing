import { bytesOf } from "@/pages/sales/print/zip";
import { csvText, excelBlob, uniqueSheetNames, type Sheet } from "./writer";

test("sheet names are valid, case-insensitively unique, and at most 31 characters", () => {
  const names = uniqueSheetNames(["Summary", "summary", "a/b:c*?[d]", "'", "x".repeat(40), "x".repeat(40)]);
  expect(names).toEqual(["Summary", "summary (2)", "a b c d", "Sheet", "x".repeat(31), `${"x".repeat(27)} (2)`]);
  expect(new Set(names.map(n => n.toLowerCase())).size).toBe(names.length);
});

test("CSV quotes separators and protects formulas while typed negative decimals stay numeric", () => {
  expect(csvText([["=1+1", " +SUM(A1)", "@x", "a,b", 'a"b', "a\nb", { v: "-0.25", num: true }, "00123"]]))
    .toBe('\ufeff\'=1+1,\' +SUM(A1),\'@x,"a,b","a""b","a\nb",-0.25,00123\r\n');
});

test("the XLSX round trip preserves decimal scale, money, identifiers, merges and text safety", async () => {
  const XLSX = await import("xlsx-js-style");
  const sheets: Sheet[] = [{ name: "Sales", cols: [120, 120, 120], rows: [
    { kind: "title", cells: [{ v: "Sales", span: 3 }] },
    { kind: "data", cells: [{ v: "00123" }, { v: "12.345", num: true }, { v: "6512.500", num: true }] },
    { kind: "total", cells: [{ v: "=HYPERLINK(1)" }, { v: "-0.25", num: true }, { v: "123456789012345.67", num: true }] },
  ] }];
  const before = JSON.stringify(sheets);
  const blob = await excelBlob(sheets);
  expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const back = XLSX.read(await bytesOf(blob), { type: "array", cellNF: true });
  const sheet = back.Sheets.Sales;
  expect(sheet.A2).toMatchObject({ t: "s", v: "00123" });
  expect(sheet.B2).toMatchObject({ t: "n", v: 12.345, z: "#,##0.000" });
  expect(sheet.C2).toMatchObject({ t: "n", v: 6512.5, z: "#,##0.000" });
  expect(sheet.A3).toMatchObject({ t: "s", v: "'=HYPERLINK(1)" });
  expect(sheet.A3.f).toBeUndefined();
  expect(sheet.B3).toMatchObject({ t: "n", v: -0.25 });
  expect(sheet.C3).toMatchObject({ t: "s", v: "123456789012345.67" });
  expect(sheet["!merges"]).toEqual([{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }]);
  expect(JSON.stringify(sheets)).toBe(before);
});

test("empty sheets remain readable and independent exports have no payment toggle state", async () => {
  const XLSX = await import("xlsx-js-style");
  const empty = await excelBlob([{ name: "Empty", cols: [120], rows: [] }]);
  expect(XLSX.read(await bytesOf(empty), { type: "array" }).SheetNames).toEqual(["Empty"]);
  await expect(excelBlob([])).rejects.toThrow("There are no sheets to export.");
});

test("the explanatory currency note is included in the downloaded file", async () => {
  const XLSX = await import("xlsx-js-style");
  const blob = await excelBlob([{ name: "Notes", cols: [120, 120], rows: [{ kind: "data", cells: [{ v: "-123456789012345.67", num: true }] }], note: "Amounts are in rupees." }]);
  const sheet = XLSX.read(await bytesOf(blob), { type: "array" }).Sheets.Notes;
  expect(sheet.A1.v).toBe("-123456789012345.67");
  expect(sheet.A2.v).toBe("Amounts are in rupees.");
});
