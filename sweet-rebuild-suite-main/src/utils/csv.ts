/** Escape a CSV cell value — wraps in quotes if it contains commas, quotes, or newlines */
export function csvCell(val: any): string {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Convert an array of rows to a CSV string with proper escaping */
export function toCSV(rows: any[][]): string {
  return rows.map(r => r.map(csvCell).join(",")).join("\n");
}

/** Download a CSV string as a file */
export function downloadCSV(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
