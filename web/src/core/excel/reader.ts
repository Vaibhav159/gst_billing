export type ReadCell = string | number | boolean | null;
export interface ReadSheet { name: string; rows: ReadCell[][]; shown: string[][] }

/** CSV keeps all cells as text, including leading zeros and decimal scale. */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  const counts = new Map([[",", 0], [";", 0], ["\t", 0]]);
  let quote = false; let lines = 0;
  for (let i = 0; i < input.length && lines < 12; i += 1) {
    const c = input[i];
    if (c === '"') { if (quote && input[i + 1] === '"') i += 1; else quote = !quote; }
    else if (!quote && counts.has(c)) counts.set(c, counts.get(c)! + 1);
    else if (!quote && c === "\n") lines += 1;
  }
  const delimiter = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = []; let row: string[] = []; let cell = ""; quote = false;
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    if (quote) { if (c === '"') { if (input[i + 1] === '"') { cell += '"'; i += 1; } else quote = false; } else cell += c; }
    else if (c === '"' && cell === "") quote = true;
    else if (c === delimiter) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && input[i + 1] === "\n") i += 1; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (quote) throw new Error("A quoted field isn't closed. Check the CSV file.");
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

/** Raw values and their display text stay separate; formulas use their cached value and are never evaluated. */
export async function readExcel(data: ArrayBuffer): Promise<ReadSheet[]> {
  const bytes = new Uint8Array(data);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) throw new Error("This isn't an Excel workbook (.xlsx).");
  // Uploads use patched SheetJS; xlsx-js-style is reserved for app-generated exports (P3-12).
  const XLSX = await import("xlsx");
  // sheetRows stops parsing one row past the cap, so a huge sheet is refused without being read whole.
  const book = XLSX.read(data, { type: "array", cellNF: true, cellText: true, cellDates: false, sheetRows: 100001 });
  if (!book.SheetNames.length) throw new Error("The workbook has no sheets.");
  const date1904 = !!book.Workbook?.WBProps?.date1904;
  return book.SheetNames.map(name => {
    const rows: ReadCell[][] = []; const shown: string[][] = [];
    for (const [address, cell] of Object.entries(book.Sheets[name])) {
      if (!/^[A-Z]+[1-9]\d*$/.test(address)) continue;
      const { r, c } = XLSX.utils.decode_cell(address);
      if (r >= 100000 || c >= 16384) throw new Error("The workbook has too many rows or columns.");
      const value = cell as import("xlsx").CellObject;
      // Error cells (#N/A, #DIV/0!) hold a numeric code in v; it must never pass as a quantity or rate.
      let raw: ReadCell = value.t === "e" ? null : typeof value.v === "string" || typeof value.v === "number" || typeof value.v === "boolean" ? value.v : null;
      if (value.t === "n" && typeof raw === "number" && XLSX.SSF.is_date(value.z ?? "")) {
        const day = XLSX.SSF.parse_date_code(raw, { date1904 }) as { y: number; m: number; d: number } | null;
        if (!day) throw new Error("An Excel date couldn't be read.");
        raw = `${day.y}-${String(day.m).padStart(2, "0")}-${String(day.d).padStart(2, "0")}`;
      }
      rows[r] ??= []; shown[r] ??= [];
      rows[r][c] = raw;
      shown[r][c] = value.w ?? (raw === null ? "" : String(raw));
    }
    for (let r = 0; r < rows.length; r += 1) {
      rows[r] ??= []; shown[r] ??= [];
      for (let c = 0; c < rows[r].length; c += 1) { rows[r][c] ??= null; shown[r][c] ??= ""; }
    }
    return { name, rows, shown };
  });
}
