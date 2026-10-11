import { beforeEach, describe, expect, it, vi } from "vitest";
import { readExcel, type ReadSheet } from "@/core/excel/reader";
import { parseCsv, readWorkbook, readXlsx } from "./parse";

// The exact published 3D Task 1 owns the codec. Preserve its real CSV parser in consumer tests.
vi.mock("@/core/excel/reader", async importOriginal => ({ ...await importOriginal<typeof import("@/core/excel/reader")>(), readExcel: vi.fn() }));
beforeEach(() => { vi.mocked(readExcel).mockReset(); });
const buffer = new ArrayBuffer(4);
const file = { name: "Bills.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 4, text: vi.fn(async () => "Bill,Party\n1,A"), arrayBuffer: vi.fn(async () => buffer) };

describe("CSV and shared Excel reader consumer", () => {
  it("reads BOM, quoted commas/newlines/doubled quotes and CRLF", () => {
    expect(parseCsv('\uFEFFBill,Party,Amount\r\n1,"A, B\n\"\"Gold\"\"",123\r\n')).toEqual([["Bill", "Party", "Amount"], ["1", 'A, B\n"Gold"', "123"]]);
  });
  it("detects semicolon and tab outside quoted Indian money", () => {
    expect(parseCsv('Bill;Party;Amount\n1;"A, B";"1,23,456.50"')[1]).toEqual(["1", "A, B", "1,23,456.50"]);
    expect(parseCsv('Bill\tParty\tAmount\n1\tA\t2')[1]).toEqual(["1", "A", "2"]);
  });
  it("refuses an unfinished quoted field instead of silently dropping it", () => {
    expect(() => parseCsv('Bill,Party\n1,"A')).toThrow("A quoted field isn't closed. Check the CSV file.");
  });
  it("delegates Excel bytes once and preserves sheets, sparse cells, dates, raw rates and displayed percentages", async () => {
    const sheets: ReadSheet[] = [{ name: "Purchases", rows: [[], ["Gold bullion", null, "2026-03-31", 0.0025, "A & B", 2]], shown: [[], ["Gold bullion", "", "31/03/2026", "0.25%", "A & B", "2"]] }, { name: "Other firm", rows: [["GSTIN: 08ABCDE1234F1Z0"]], shown: [["GSTIN: 08ABCDE1234F1Z0"]] }];
    vi.mocked(readExcel).mockResolvedValueOnce(sheets);
    expect(await readXlsx(buffer)).toBe(sheets);
    expect(readExcel).toHaveBeenCalledExactlyOnceWith(buffer);
  });
  it("passes through shared date-system decoding without local timezone conversion", async () => {
    // The published 3D reader tests the real 1904 bytes; its decoded day remains unchanged here.
    vi.mocked(readExcel).mockResolvedValueOnce([{ name: "1904 dates", rows: [["2030-04-01"]], shown: [["2030-04-01"]] }]);
    expect((await readWorkbook(file))[0].rows[0][0]).toBe("2030-04-01");
    expect(readExcel).toHaveBeenCalledExactlyOnceWith(buffer);
  });
  it("never substitutes another codec or retries when the shared reader rejects", async () => {
    const failure = new Error("Shared Excel reader rejected the workbook");
    vi.mocked(readExcel).mockRejectedValue(failure);
    await expect(readXlsx(buffer)).rejects.toBe(failure);
    expect(readExcel).toHaveBeenCalledTimes(1);
    await expect(readWorkbook(file)).rejects.toThrow("Bills.xlsx couldn't be read as an Excel workbook. If it came from Tally, export it again as Excel (.xlsx), or save it as CSV.");
    expect(readExcel).toHaveBeenCalledTimes(2);
  });
  it("gives exact old-format and size guidance before opening the file or loading Excel", async () => {
    const bytes = vi.fn(async () => buffer);
    await expect(readWorkbook({ ...file, name: "Bills.xls", arrayBuffer: bytes })).rejects.toThrow("Bills.xls is in the old Excel format (.xls). In Excel, use File › Save as › Excel Workbook (.xlsx), or CSV, and choose that file.");
    await expect(readWorkbook({ ...file, name: "Big.xlsx", size: 21 * 1048576, arrayBuffer: bytes })).rejects.toThrow("Big.xlsx: file too large (21.0 MB). The most is 20 MB.");
    expect(bytes).not.toHaveBeenCalled(); expect(readExcel).not.toHaveBeenCalled();
  });
  it("reads CSV locally without requesting the Excel reader", async () => {
    expect(await readWorkbook({ ...file, name: "Bills.csv", type: "text/csv" })).toEqual([{ name: "Bills", rows: [["Bill", "Party"], ["1", "A"]] }]);
    expect(readExcel).not.toHaveBeenCalled();
  });
  it.each([false, true])("imports a real compressed shared workbook with date1904=%s", async date1904 => {
    const real = await vi.importActual<typeof import("@/core/excel/reader")>("@/core/excel/reader");
    vi.mocked(readExcel).mockImplementationOnce(real.readExcel);
    const XLSX = await import("xlsx-js-style");
    const book = XLSX.utils.book_new();
    book.Workbook = { WBProps: { date1904 } };
    XLSX.utils.book_append_sheet(book, { "!ref": "A1:F2", A2: { t: "s", v: "000123" }, C2: { t: "n", v: 46112, z: "yyyy-mm-dd" }, D2: { t: "n", v: 0.0025, z: "0.00%" }, E2: { t: "n", v: 6.4, z: "0.000" }, F2: { t: "n", f: "1+1", v: 2 } }, "Register");
    const bytes = XLSX.write(book, { type: "array", bookType: "xlsx", compression: true }) as ArrayBuffer;
    const [sheet] = await readWorkbook({ ...file, size: bytes.byteLength, arrayBuffer: async () => bytes });
    expect(sheet.rows).toEqual([[], ["000123", null, date1904 ? "2030-04-01" : "2026-03-31", 0.0025, 6.4, 2]]);
    expect(sheet.shown?.[1].slice(3, 5)).toEqual(["0.25%", "6.400"]);
  });
  it("turns the real shared reader's corrupt-input refusal into actionable file words", async () => {
    const real = await vi.importActual<typeof import("@/core/excel/reader")>("@/core/excel/reader");
    vi.mocked(readExcel).mockImplementationOnce(real.readExcel);
    await expect(readWorkbook(file)).rejects.toThrow("Bills.xlsx couldn't be read as an Excel workbook. If it came from Tally, export it again as Excel (.xlsx), or save it as CSV.");
  });
});
