import { useState } from "react";
import { Download } from "lucide-react";
import { todayIST } from "@/core/format";
import { saveFile } from "@/core/print/files";
import { Button, Checkbox, Dialog, Tabs, cn } from "@/core/ui";
import type { ImportFirm } from "./columns";
import type { Sheet as ExcelSheet } from "@/core/excel/writer";
export const TEMPLATE_RULES = [
  "One sheet per firm. The GSTIN row on top says whose bills they are; a sheet without one is matched by its name, or you pick the firm.",
  "“Outward Supply” starts the sales; “Inward Supply” starts the purchases. Both can be on one sheet.",
  "Rows with the same bill number are one bill. On a bill's second and later items, leave Bill No., date and party blank.",
  "Qty and Rate are optional: a row with only Taxable Value is kept as one amount. The file's tax figures aren't kept: GST is worked out from the slab.",
  "GST Rate as 3, 3% or 0.03. The rates are 0, 0.1, 0.25, 1, 1.5, 3, 5, 12, 18, 28 and 40%.",
  "No GSTIN (blank, URP or NA) means an unregistered party: no GST on a purchase from them, and no credit.",
  "Payment: Cash, UPI, NEFT, RTGS, cheque or card (all bank), Udhaar or credit. Blank is Not recorded.",
  "Dates day first: 08-10-2026, 08/10/2026 or 8-Oct-2026. Total rows are skipped.",
  "Replace the example rows with your own bills before importing.",
];
const HEAD = ["S.No.", "Bill No.", "Invoice Date", "Party Name", "GST Number", "Commodity", "HSN Code", "GST Rate", "Qty", "Rate", "Taxable Value", "CGST", "SGST", "IGST", "Total Invoice Value", "Payment"];
export function templateRows(firm: ImportFirm, purchases = true, day = todayIST()): string[][] {
  const rows = [[firm.name.toUpperCase()], [`GSTIN: ${firm.gst_number}`], [], ["Outward Supply"], HEAD,
    ["1", "EXAMPLE-1", day, "Example customer", "", "Gold chain 22K", "7113", "3%", "1.000", "100.00", "100.00", "", "", "", "", "Cash"],
    ["", "", "", "", "", "Gold earrings 22K", "7113", "3%", "1.000", "50.00", "50.00", "", "", "", "", ""]];
  if (purchases) rows.push([], ["Inward Supply"], HEAD, ["1", "SUPPLIER-1", day, "Example unregistered supplier", "", "Old jewellery", "7113", "0%", "1.000", "100.00", "100.00", "", "", "", "", "Cash"]);
  return rows;
}
export function templateCsv(firm: ImportFirm, purchases = true, day = todayIST()): string {
  const cell = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value).replace(/"/g, '""')}"`;
  return `\ufeff${templateRows(firm, purchases, day).map(row => row.map(cell).join(",")).join("\r\n")}\r\n`;
}
/** Data projection only: 3D Task 1 owns Excel encoding, text safety and sheet naming. */
export async function templateXlsx(firms: ImportFirm[], purchases = true, day = todayIST()): Promise<Blob> {
  const { excelBlob, uniqueSheetNames } = await import("@/core/excel/writer");
  // Reserve the final Instructions sheet even when a firm has that name.
  const names = uniqueSheetNames(["Instructions", ...firms.map(firm => firm.name)]).slice(1);
  const sheets: ExcelSheet[] = firms.map((firm, index) => ({ name: names[index], cols: HEAD.map((_, i) => i === 3 || i === 5 ? 200 : 120), rows: templateRows(firm, purchases, day).map((row, i) => ({
    kind: i === 0 ? "title" : i === 1 ? "sub" : !row.length ? "blank" : row.length === 1 && /supply/i.test(row[0]) ? "band" : row[0] === "S.No." ? "head" : "data",
    cells: row.map(v => ({ v })),
  })) }));
  sheets.push({ name: "Instructions", cols: [720], rows: [{ kind: "title", cells: [{ v: "Instructions" }] }, ...TEMPLATE_RULES.map(rule => ({ kind: "data" as const, cells: [{ v: rule }] }))] });
  return excelBlob(sheets);
}
/** The prototype's sheet preview; 3D's shared writer creates the downloaded workbook. */
export function ImportTemplate({ open, onClose, firms }: { open: boolean; onClose(): void; firms: ImportFirm[] }) {
  const [buy, setBuy] = useState(true), [sheet, setSheet] = useState("0"), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const current = firms[Number(sheet)] ?? firms[0];
  const rows = current ? templateRows(current, buy) : [], letters = HEAD.map((_, i) => String.fromCharCode(65 + i));
  const tabs = [...firms.map((firm, i) => ({ value: String(i), label: firm.name })), { value: "rules", label: "Instructions" }];
  async function download() {
    setBusy(true); setError("");
    try { saveFile(await templateXlsx(firms, buy), "Bills import template.xlsx"); onClose(); }
    catch { setError("The template couldn't be downloaded. Try again."); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onClose={onClose} size="xl" title="The import template" description="A sheet for each of your firms with its GSTIN, sales and purchase sections, and the instructions." footer={<><Button onClick={onClose}>Close</Button><Button variant="primary" icon={Download} disabled={!firms.length} loading={busy} onClick={() => void download()}>Download Bills import template.xlsx</Button></>}>
    <div className="flex flex-col gap-3">{error ? <p role="alert" className="text-neg">{error}</p> : null}<div className="flex flex-wrap items-end justify-between gap-3"><Tabs label="Template sheets" value={sheet} onChange={setSheet} idBase="tpl" tabs={tabs} className="flex-1 min-w-[300px]" /><Checkbox label="Include the purchase (Inward) sections" checked={buy} onChange={setBuy} className="mb-2" /></div>
      {sheet === "rules" ? <ol className="flex flex-col gap-2 list-decimal pl-5 text-fg2">{TEMPLATE_RULES.map(rule => <li key={rule}>{rule}</li>)}</ol> : current ? <div className="scroll-x rounded-ctl border border-line" role="region" aria-label={`Sheet ${current.name}`} tabIndex={0}><table className="text-xs border-collapse min-w-full"><thead><tr><th className="sticky left-0 bg-raised border-b border-r border-rule w-9" aria-label="Row" />{letters.map(letter => <th key={letter} scope="col" className="bg-raised border-b border-r border-rule px-2 py-1 font-medium text-muted">{letter}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}><th scope="row" className="sticky left-0 bg-raised border-b border-r border-rule px-2 py-1 font-medium text-muted tnum text-right">{i + 1}</th>{letters.map((letter, column) => <td key={letter} className={cn("border-b border-r border-rule px-2 py-1 whitespace-nowrap", row[0] === "S.No." && "font-semibold bg-field", row.length === 1 && /supply/i.test(row[0]) && "font-semibold text-brand", i === 0 && column === 0 && "font-semibold")}>{row[column] ?? ""}</td>)}</tr>)}</tbody></table></div> : <p>Add a firm before downloading a template.</p>}
    </div>
  </Dialog>;
}
