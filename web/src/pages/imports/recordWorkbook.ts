import type { ReadRecordWorkbook } from "@/pages/records/RecordsImport";
import { readWorkbook } from "./parse";

/** Keep Excel's explicit percentage meaning; identifiers and unformatted numbers stay raw. */
export const readRecordsWorkbook: ReadRecordWorkbook = async (file) => (await readWorkbook(file)).map((sheet) => ({
  name: sheet.name,
  rows: sheet.rows.map((row, r) => row.map((value, c) => {
    const display = sheet.shown?.[r]?.[c];
    return typeof value === "number" && display?.trim().endsWith("%") ? display : value;
  })),
}));
