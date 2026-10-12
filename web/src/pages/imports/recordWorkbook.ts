import type { ReadRecordWorkbook } from "@/pages/records/RecordsImport";
import { readWorkbook } from "./parse";

/** Keep numeric precision and the percent marker: an off-slab percent must never be read as a fraction. */
export const readRecordsWorkbook: ReadRecordWorkbook = async (file) => (await readWorkbook(file)).map((sheet) => ({
  name: sheet.name,
  rows: sheet.rows.map((row, r) => row.map((value, c) => {
    const display = sheet.shown?.[r]?.[c];
    return typeof value === "number" && display?.trim().endsWith("%") ? String(+(value * 100).toFixed(6)) + "%" : value;
  })),
}));
