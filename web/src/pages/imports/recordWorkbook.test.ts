import { expect, test } from "vitest";
import { checkRecordRows } from "@/core/api/recordsImport";
import { serve } from "@/test/server";
import { bytesOf, zipFiles } from "@/pages/sales/print/zip";
import { readWorkbook } from "./parse";
import { readRecordsWorkbook } from "./recordWorkbook";

async function percentageWorkbook(slab?: number) {
  const parts: Record<string, string> = {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Products" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    "xl/styles.xml": '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="10"/></cellXfs></styleSheet>',
    "xl/worksheets/sheet1.xml": '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="2"><c r="A2" s="1"><v>0.1</v></c><c r="B2" s="1"><v>0.0025</v></c><c r="C2"><v>9829041122</v></c><c r="D2"><v>0.03</v></c></row></sheetData></worksheet>',
  };
  if (slab !== undefined) {
    parts["xl/styles.xml"] = parts["xl/styles.xml"].replace('numFmtId="10"', 'numFmtId="9"');
    parts["xl/worksheets/sheet1.xml"] = `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" s="1"><v>${slab / 100}</v></c></row></sheetData></worksheet>`;
  }
  const archive = await zipFiles(Object.entries(parts).map(([name, xml]) => ({ name, blob: new Blob([xml]) })));
  const bytes = await bytesOf(archive);
  const file = new File([bytes], "Products.xlsx");
  Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
  return file;
}

test("2D CSV decoding retains quoted text, mobile digits and source row positions", async () => {
  const text = 'Name,Mobile\n"A, B",09829041122\n\nC,9829041123';
  const file = new File([text], "Customers.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", { value: async () => text });
  expect(await readRecordsWorkbook(file)).toEqual([{ name: "Customers", rows: [["Name", "Mobile"], ["A, B", "09829041122"], [""], ["C", "9829041123"]] }]);
});

test("2D percentage displays reach the GST allowlist; raw 0.1 displayed as 10% is refused", async () => {
  serve({ "GET catalog/": { results: [], next: null } });
  const file = await percentageWorkbook();
  const [raw] = await readWorkbook(file);
  expect(raw.rows[1]).toEqual([0.1, 0.0025, 9829041122, 0.03]);
  const [adapted] = await readRecordsWorkbook(file);
  expect(adapted.rows[0]).toEqual([]);
  expect(adapted.rows[1]).toEqual(["10%", "0.25%", 9829041122, 0.03]);
  const checked = await checkRecordRows("products", [
    { name: "Wrong slab", hsn_code: "7113", gst_percent: String(adapted.rows[1][0]) },
    { name: "Diamond", hsn_code: "7102", gst_percent: String(adapted.rows[1][1]) },
    { name: "Unformatted fraction", hsn_code: "7113", gst_percent: String(adapted.rows[1][3]) },
  ]);
  expect(checked.map((row) => row.state)).toEqual(["fix", "ready", "ready"]);
  expect(checked[0].note).toContain("Choose one of the GST rates:");
  expect(checked[1].note).toContain("0.25%");
  expect(checked[2].note).toContain("3%");
});


test.each([0, 0.1, 0.25, 1, 1.5, 3, 5, 12, 18, 28, 40])("a whole-percent display retains the exact numeric %s%% slab", async (slab) => {
  serve({ "GET catalog/": { results: [], next: null } });
  const [sheet] = await readRecordsWorkbook(await percentageWorkbook(slab));
  expect(sheet.rows[0][0]).toBe(`${slab}%`);
  const [row] = await checkRecordRows("products", [{ name: "Test product", hsn_code: "7113", gst_percent: String(sheet.rows[0][0]) }]);
  expect(row.state).toBe("ready");
  expect(row.note).toContain(`${slab}%`);
});


test.each([0.03, 0.01, 0.001])("an explicit off-slab %s%% never becomes an allowed fractional rate", async (percent) => {
  serve({ "GET catalog/": { results: [], next: null } });
  const [sheet] = await readRecordsWorkbook(await percentageWorkbook(percent));
  const [row] = await checkRecordRows("products", [{ name: "Off-slab product", hsn_code: "7113", gst_percent: String(sheet.rows[0][0]) }]);
  expect(row.state).toBe("fix");
  expect(row.note).toContain("Choose one of the GST rates:");
});
