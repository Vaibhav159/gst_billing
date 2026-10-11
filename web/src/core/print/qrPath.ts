// The QR code on a printed bill drawn as one path that the paper on screen (SVG) and the PDF (react-pdf's Svg) both use.
// Its own module: the encoder comes with the paper and the PDF only, never with the QR check in the app's first download
// (Ruling 1B-4). What the code carries, and reading it back, are qr.ts.
import QRCode from "qrcode";

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
