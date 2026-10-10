// The QR code on a printed bill (PROTO sales/lib.js:476-511): what it carries, read back by the QR check, and drawn as
// one path that the paper on screen (SVG) and the PDF (react-pdf's Svg) both use. Easy (part 6) prints the same code.
import QRCode from "qrcode";
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

/**
 * The code as one SVG path in a (size)-unit square that includes a two-module quiet zone: each row's dark modules as
 * rectangles, so a 29 × 29 code is about 150 short subpaths, not 440 squares. null when the text can't be encoded.
 */
export function qrPath(text: string): { size: number; d: string } | null {
  let m: { size: number; get(r: number, c: number): number };
  try {
    m = QRCode.create(text, { errorCorrectionLevel: "M" }).modules;
  } catch {
    return null;
  }
  const n = m.size;
  let d = "";
  for (let r = 0; r < n; r += 1) {
    let c = 0;
    while (c < n) {
      if (!m.get(r, c)) { c += 1; continue; }
      const start = c;
      while (c < n && m.get(r, c)) c += 1;
      d += `M${start + 2} ${r + 2}H${c + 2}V${r + 3}H${start + 2}Z`;
    }
  }
  return { size: n + 4, d };
}
