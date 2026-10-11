// v2's styled cell writer, with a shared preview model and no money calculations.
export type RowKind = "title" | "band" | "sub" | "head" | "data" | "total" | "blank" | "fail";
export interface Cell { v: string | number; span?: number; num?: boolean; center?: boolean; kind?: RowKind }
export interface Row { kind: RowKind; cells: Cell[] }
export interface Sheet { name: string; cols: number[]; rows: Row[]; note?: string }

export function uniqueSheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map(name => {
    const base = name.replace(/[\\/:?*\[\]\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().replace(/^'+|'+$/g, "") || "Sheet";
    let candidate = base.slice(0, 31);
    for (let n = 2; used.has(candidate.toLowerCase()); n += 1) {
      const suffix = ` (${n})`;
      candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

const decimal = /^-?\d+(?:\.\d+)?$/;
const safeText = (text: string) => /^[\t\r\n]|^\s*[=+@-]/.test(text) ? `'${text}` : text;
const isNumber = (cell: Cell) => cell.num && decimal.test(String(cell.v));

export function csvText(rows: readonly (readonly (Cell | string | number)[])[]): string {
  const lines = rows.map(row => row.map(value => {
    const cell = typeof value === "object" ? value : { v: value, num: typeof value === "number" };
    const text = isNumber(cell) ? String(cell.v) : safeText(String(cell.v));
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(","));
  return `\ufeff${lines.join("\r\n")}\r\n`;
}

const border = Object.fromEntries(["top", "bottom", "left", "right"].map(side => [side, { style: "thin", color: { rgb: "B4C6E7" } }]));
function style(kind: RowKind, cell: Cell, even: boolean) {
  const dark = kind === "head" || kind === "band";
  return {
    font: { name: "Arial", sz: kind === "title" ? 14 : 10, bold: ["title", "head", "band", "total", "fail"].includes(kind), color: { rgb: kind === "fail" ? "9C0006" : dark ? "FFFFFF" : "1F3864" } },
    fill: { fgColor: { rgb: dark ? "1F3864" : kind === "total" ? "FFC000" : kind === "title" || kind === "sub" || even ? "DCE6F1" : "FFFFFF" } },
    alignment: { horizontal: cell.num ? "right" : cell.center || dark || kind === "title" ? "center" : "left", vertical: "center", wrapText: kind === "head" },
    border,
  };
}

/** The large XLSX package is loaded only after a person asks for the file. */
export async function excelBlob(sheets: Sheet[]): Promise<Blob> {
  if (!sheets.length) throw new Error("There are no sheets to export.");
  const XLSX = await import("xlsx-js-style");
  const book = XLSX.utils.book_new();
  const names = uniqueSheetNames(sheets.map(sheet => sheet.name));
  sheets.forEach((sheet, index) => {
    const output: import("xlsx-js-style").WorkSheet = {};
    const merges: import("xlsx-js-style").Range[] = [];
    let width = Math.max(1, sheet.cols.length);
    const rows: Row[] = sheet.note ? [...sheet.rows, { kind: "sub", cells: [{ v: sheet.note, span: width }] }] : sheet.rows;
    rows.forEach((row, r) => {
      let c = 0;
      row.cells.forEach(cell => {
        const text = String(cell.v);
        // Excel holds 15 significant digits. Keep anything more precise as text.
        const numeric = isNumber(cell) && text.replace(/^-?0*|\./g, "").length <= 15;
        const scale = text.includes(".") ? text.split(".")[1].length : 0;
        const s = style(cell.kind ?? row.kind, cell, r % 2 === 0);
        output[XLSX.utils.encode_cell({ r, c })] = { v: numeric ? Number(text) : isNumber(cell) ? text : safeText(text), t: numeric ? "n" : "s", s, ...(numeric ? { z: `#,##0${scale ? `.${"0".repeat(scale)}` : ""}` } : {}) };
        const span = cell.span ?? 1;
        if (span > 1) {
          merges.push({ s: { r, c }, e: { r, c: c + span - 1 } });
          for (let offset = 1; offset < span; offset += 1) output[XLSX.utils.encode_cell({ r, c: c + offset })] = { v: "", t: "s", s };
        }
        c += span;
      });
      width = Math.max(width, c);
    });
    output["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, rows.length - 1), c: width - 1 } });
    output["!merges"] = merges;
    output["!cols"] = sheet.cols.map(wpx => ({ wpx }));
    XLSX.utils.book_append_sheet(book, output, names[index]);
  });
  return new Blob([XLSX.write(book, { type: "array", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
