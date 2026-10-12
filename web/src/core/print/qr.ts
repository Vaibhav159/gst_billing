// The QR code on a printed bill (PROTO sales/lib.js:476-511): what it carries, and that text read back by the QR check.
// Easy (part 6) prints the same code. The drawing is qrPath.ts: the encoder it needs comes only with the paper and the
// PDF, so the QR check (and the bills list it sits in) never brings it into the app's first download (Ruling 1B-4).
import { paiseToDecimal, toPaise } from "@/core/format";

/** What a bill's QR code carries: number | the firm's GSTIN | date | the total printed, exact to the paisa (Ruling 1B-12). */
export function qrPayload(b: { invoice_number: string; invoice_date: string; total_amount: number; firm: { gst_number: string } }): string {
  return `${b.invoice_number}|${b.firm.gst_number}|${b.invoice_date}|${paiseToDecimal(b.total_amount)}`;
}

/** A scanned code read back. gstin: "" from a firm without one; firm: a firm's name, when an old code named it instead of its GSTIN; total in paise. */
export type QrText = { number: string; gstin: string; firm: string; date: string; total: number | null };

/**
 * What a scanned code says: this app's "number|GSTIN|date|total", or the JSON some older bills carry (v2's bulk PDFs
 * printed { inv, biz, total }, with the firm's name and no date). null when it's neither.
 */
export function parseQr(text: string): QrText | null {
  const t = String(text ?? "").trim();
  if (!t) return null;
  if (t.startsWith("{")) {
    try {
      const j = JSON.parse(t) as Record<string, unknown>;
      const s = (...keys: string[]) => String(keys.map((k) => j[k]).find((v) => v != null && v !== "") ?? "").trim();
      const number = s("invoice_number", "number", "inv");
      const gstin = s("gstin", "seller_gstin", "gst").toUpperCase();
      const firm = s("biz", "firm");
      const date = s("date", "invoice_date", "dt");
      if (!number || (!gstin && !firm)) return null;
      return { number, gstin, firm, date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "", total: toPaise(s("total", "amt")) };
    } catch {
      return null;
    }
  }
  const parts = t.split("|").map((x) => x.trim());
  // a firm without a GSTIN prints an empty field: number||date|total
  if (parts.length < 4 || !parts[0] || !/^\d{4}-\d{2}-\d{2}$/.test(parts[2])) return null;
  const total = toPaise(parts[3]);
  if (total == null) return null;
  return { number: parts[0], gstin: parts[1].toUpperCase(), firm: "", date: parts[2], total };
}
