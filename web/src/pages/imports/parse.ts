import { parseCsv } from "@/core/excel/reader";
// CSV is local; Excel encoding/decoding belongs exclusively to 3D Task 1 (X-24).
export type Cell = string | number | boolean | Date | null;
export type Sheet = { name: string; rows: Cell[][]; shown?: string[][] };
export const MAX_IMPORT_FILE = 20 * 1048576;

// Reuse 3D Task 1's CSV parser too; it preserves identifiers and decimal text.
export { parseCsv } from "@/core/excel/reader";
/** Preserve the shared reader's raw values, display text and decoded calendar dates. */
export async function readXlsx(buffer: ArrayBuffer): Promise<Sheet[]> {
  const { readExcel } = await import("@/core/excel/reader");
  return readExcel(buffer);
}
export async function readWorkbook(file: Pick<File, "name" | "size" | "type" | "text" | "arrayBuffer">): Promise<Sheet[]> {
  if (file.size > MAX_IMPORT_FILE) throw new Error(`${file.name}: file too large (${(file.size / 1048576).toFixed(1)} MB). The most is 20 MB.`);
  if (/\.csv$/i.test(file.name) || /csv/i.test(file.type)) return [{ name: file.name.replace(/\.csv$/i, ""), rows: parseCsv(await file.text()) }];
  if (/\.xls$/i.test(file.name)) throw new Error(`${file.name} is in the old Excel format (.xls). In Excel, use File › Save as › Excel Workbook (.xlsx), or CSV, and choose that file.`);
  try { return await readXlsx(await file.arrayBuffer()); }
  catch { throw new Error(`${file.name} couldn't be read as an Excel workbook. If it came from Tally, export it again as Excel (.xlsx), or save it as CSV.`); }
}
