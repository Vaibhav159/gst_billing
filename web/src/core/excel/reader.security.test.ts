import { bytesOf, zipFiles } from "@/core/files/zip";
import { readExcel } from "./reader";

// A vulnerable parser must never see uploads, including when the patched reader rejects a file.
vi.mock("xlsx-js-style", () => { throw new Error("The export-only parser must not load for uploads."); });
const read = vi.hoisted(() => ({ spy: undefined as undefined | ReturnType<typeof vi.fn> }));
vi.mock("xlsx", async original => {
  const XLSX = await original<typeof import("xlsx")>();
  read.spy = vi.fn(XLSX.read);
  return { ...XLSX, read: read.spy };
});

const ROW = '<row r="1"><c r="A1" t="inlineStr"><is><t>000123</t></is></c><c r="B1" t="inlineStr"><is><t>=HYPERLINK("https://example.invalid")</t></is></c><c r="C1"><f>1+1</f><v>2</v></c></row>';
const BOOK = '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Upload" sheetId="1" r:id="rId1"/></sheets></workbook>';

async function upload(workbookXml: string, rows = ROW): Promise<ArrayBuffer> {
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const files = {
    "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": workbookXml,
    "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="${ns}"><sheetData>${rows}</sheetData></worksheet>`,
  };
  return (await bytesOf(await zipFiles(Object.entries(files).map(([name, xml]) => ({ name, blob: new Blob([xml]) }))))).buffer;
}

test("uploaded XLSX uses the patched reader without loading the export-only parser", async () => {
  const [sheet] = await readExcel(await upload(BOOK));
  expect(sheet).toMatchObject({ name: "Upload", rows: [["000123", '=HYPERLINK("https://example.invalid")', 2]] });
});

test("an upload with no worksheets is rejected without falling back to the export parser", async () => {
  const xml = '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>';
  await expect(readExcel(await upload(xml))).rejects.toThrow("The workbook has no sheets.");
});

test("the row cap is applied while parsing, so rows past 100,000 are never read into memory", async () => {
  const rows = '<row r="100001"><c r="A100001"><v>1</v></c></row><row r="100002"><c r="A100002"><v>2</v></c></row>';
  await expect(readExcel(await upload(BOOK, rows))).rejects.toThrow("The workbook has too many rows or columns.");
  expect(read.spy).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ sheetRows: 100001 }));
});
