// The last paper bill's date, per firm, for this tab (PROTO sales/lib.js:707-710): a run of bills from one day keeps it,
// and "Same as last bill" offers it. sessionStorage, so a reload keeps the run going and a new tab starts fresh.
const KEY = "gst3.paperDates";

function read(): Record<string, string> {
  try {
    const v: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch { return {}; }
}
export function rememberPaperDate(firmId: number | null, iso: string): void {
  if (firmId == null || !iso) return;
  try { sessionStorage.setItem(KEY, JSON.stringify({ ...read(), [firmId]: iso })); } catch { /* storage refused: the run keeps its date in the link */ }
}
export function lastPaperDate(firmId: number | null): string {
  return firmId == null ? "" : read()[firmId] ?? "";
}
