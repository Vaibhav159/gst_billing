import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderApp } from "@/test/render";
import { saveFile } from "@/core/print/files";
import { excelBlob } from "@/core/excel/writer";
import { readExcel } from "@/core/excel/reader";
import { bytesOf } from "@/core/files/zip";
import { readSheet } from "./columns";
import { groupBills } from "./model";
import { ImportTemplate, templateRows, templateXlsx, TEMPLATE_RULES } from "./Template";
vi.mock("@/core/print/files", () => ({ saveFile: vi.fn() }));
// Mock the exact published writer for failure/consumer checks; the last test uses the real codec.
vi.mock("@/core/excel/writer", async importOriginal => ({ ...await importOriginal<typeof import("@/core/excel/writer")>(), excelBlob: vi.fn() }));
const firms = [{ id: 3, name: "Kiran Gold House", gst_number: "08ABCDE1234F1Z0" }, { id: 2, name: "Meera Ornaments", gst_number: "08ABCDE1234F1Z0" }];
const sharedOutput = new Blob(["3D-owned writer test double"], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
beforeEach(() => { vi.mocked(excelBlob).mockReset().mockResolvedValue(sharedOutput); vi.mocked(saveFile).mockClear(); });
afterEach(() => vi.useRealTimers());
it("keeps the template rows readable, with firm identity and sections and no making column", () => {
  const rows = templateRows(firms[0], true, "2026-10-08");
  const bills = groupBills(readSheet({ name: "Template", rows }), "purchase");
  expect(rows[1]).toEqual(["GSTIN: 08ABCDE1234F1Z0"]); expect(JSON.stringify(rows)).not.toMatch(/making/i);
  expect(bills.map(b => b.kind)).toEqual(["sale", "purchase"]); expect(bills[0].lines).toHaveLength(2);
  expect(JSON.stringify(templateRows(firms[0], false))).not.toContain("Inward Supply");
});
it("exports no unused CSV builder", async () => {
  expect("templateCsv" in await import("./Template")).toBe(false);
});
it("keeps the Instructions tab reachable with no firms and labels the preview as its tab's panel", () => {
  renderApp(<ImportTemplate open onClose={() => {}} firms={[]} />);
  const tab = screen.getByRole("tab", { name: "Instructions" });
  expect(tab).toHaveAttribute("tabindex", "0"); expect(tab).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tabpanel", { name: "Instructions" })).toHaveTextContent("One sheet per firm.");
});
it("passes every firm and Instructions to the shared writer and returns its exact Blob", async () => {
  expect(await templateXlsx(firms, true, "2026-10-08")).toBe(sharedOutput);
  expect(excelBlob).toHaveBeenCalledTimes(1);
  const sheets = vi.mocked(excelBlob).mock.calls[0][0];
  expect(sheets.map(sheet => ({ name: sheet.name, rows: sheet.rows.map(row => row.cells.map(cell => cell.v)) }))).toEqual([...firms.map(firm => ({ name: firm.name, rows: templateRows(firm, true, "2026-10-08") })), { name: "Instructions", rows: [["Instructions"], ...TEMPLATE_RULES.map(rule => [rule])] }]);
  expect(sheets[0].rows[5].cells.slice(7, 11)).toEqual([{ v: "3%" }, { v: "1.000" }, { v: "100.00" }, { v: "100.00" }]);
  expect(sheets[0].rows[0].kind).toBe("title"); expect(sheets[0].rows[4].kind).toBe("head");
  expect(saveFile).not.toHaveBeenCalled();
});
it("omits purchase sections from every firm when the option is off", async () => {
  await templateXlsx(firms, false, "2026-10-08");
  expect(excelBlob).toHaveBeenCalledTimes(1);
  const sheets = vi.mocked(excelBlob).mock.calls[0][0];
  firms.forEach((firm, index) => expect(sheets[index].rows.map(row => row.cells.map(cell => cell.v))).toEqual(templateRows(firm, false, "2026-10-08")));
});
it("passes formula-like and Unicode firm titles as literal text for the shared writer", async () => {
  const names = ["Instructions", "A/B", "A:B", "किरण & Sons <Gold> \"A\"", "=SUM(1,2)"];
  await templateXlsx(names.map((name, id) => ({ ...firms[0], id, name })), true, "2026-10-08");
  const sheets = vi.mocked(excelBlob).mock.calls[0][0];
  names.forEach((name, index) => expect(sheets[index].rows[0].cells).toEqual([{ v: name.toUpperCase() }]));
  expect(new Set(sheets.map(sheet => sheet.name.toLowerCase())).size).toBe(sheets.length);
  expect(sheets[0].name).toBe("Instructions (2)");
  expect(sheets[sheets.length - 1].name).toBe("Instructions");
});
it("shows tabs and instructions and downloads the shared workbook with the exact name", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); const close = vi.fn(); renderApp(<ImportTemplate open onClose={close} firms={firms} />);
  vi.setSystemTime(Date.now() + 400);
  fireEvent.click(screen.getByRole("tab", { name: "Meera Ornaments" }));
  expect(screen.getByRole("region", { name: "Sheet Meera Ornaments" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Instructions" }));
  expect(screen.getByText(/The file's tax figures aren't kept/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Download Bills import template.xlsx" }));
  await waitFor(() => expect(saveFile).toHaveBeenCalledExactlyOnceWith(sharedOutput, "Bills import template.xlsx"));
  expect(vi.mocked(excelBlob).mock.calls[0][0].map(sheet => sheet.name)).toEqual(["Kiran Gold House", "Meera Ornaments", "Instructions"]);
  expect(close).toHaveBeenCalledOnce();
});
it("keeps the preview open and downloads nothing when the shared writer fails", async () => {
  vi.mocked(excelBlob).mockRejectedValueOnce(new Error("Shared Excel writer failed"));
  vi.useFakeTimers({ toFake: ["Date"] }); const close = vi.fn(); renderApp(<ImportTemplate open onClose={close} firms={firms} />);
  vi.setSystemTime(Date.now() + 400);
  fireEvent.click(screen.getByRole("button", { name: "Download Bills import template.xlsx" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("The template couldn't be downloaded. Try again.");
  expect(saveFile).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled(); expect(excelBlob).toHaveBeenCalledTimes(1);
});

it("round-trips the real 3D workbook through its shared reader with all firms and import fields", async () => {
  const real = await vi.importActual<typeof import("@/core/excel/writer")>("@/core/excel/writer");
  vi.mocked(excelBlob).mockImplementationOnce(real.excelBlob);
  const sheets = await readExcel((await bytesOf(await templateXlsx(firms, true, "2026-10-08"))).buffer);
  expect(sheets.map(sheet => sheet.name)).toEqual([...firms.map(firm => firm.name), "Instructions"]);
  firms.forEach((firm, index) => {
    expect(sheets[index].rows).toEqual(templateRows(firm, true, "2026-10-08"));
    const bills = groupBills(readSheet(sheets[index]), "purchase");
    expect(bills.map(bill => bill.kind)).toEqual(["sale", "purchase"]);
    expect(bills[0].lines[0]).toMatchObject({ qty: "1.000", price: "100.00", slab: "3%", taxable: 10000 });
    expect(bills[0].lines).toHaveLength(2);
  });
  expect(readSheet(sheets[sheets.length - 1]).rows).toHaveLength(0);
});
