// @vitest-environment node
/**
 * The Tally invoice PDF printed its grand total as "¹62,739.20". Its text is
 * in the PDF's built-in Times fonts, which are WinAnsi-encoded and have no
 * rupee sign, so the PDF writer cut U+20B9 down to the byte 0xB9, and 0xB9 is
 * "¹" in WinAnsi. A real ₹ needs an embedded font that has the glyph, and an
 * embedded font carries a ToUnicode map, which is where the ₹ shows up.
 */
import { inflateSync } from "node:zlib";
import { renderToBuffer } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";
import TallyInvoicePDF from "./TallyInvoicePDF";

type Props = Parameters<typeof TallyInvoicePDF>[0];

const props = {
  invoice: {
    id: "1842", invoiceNumber: "30", invoice_date: "2026-10-07", type: "OUTWARD", customerId: "190",
    items: [{
      productId: "line:1", productName: "Silver Utensils", hsn: "711411", qty: 520.614, unit: "gms",
      rate: 117, amount: 62739.2, gstRate: 3, cgst: 0, sgst: 0, igst: 1827.36,
    }],
    totalCGST: 0, totalSGST: 0, totalIGST: 1827.36, total: 62739.2,
  },
  business: {
    id: "9", name: "MEERA ORNAMENTS", address: "12 Bazaar, Udaipur", gst_number: "08WWUFP9975S1ZN",
    state_name: "RAJASTHAN",
  },
  customer: {
    id: "190", name: "Kulkarni Jewellers", address: "8 Demo Road", gst_number: "27XTZPS7585P1ZB",
    state_name: "MAHARASHTRA",
  },
} as unknown as Props;

/** Every stream in the PDF, inflated where it was compressed. */
function streams(pdf: Buffer): string[] {
  const text = pdf.toString("latin1");
  const out: string[] = [];
  for (const m of text.matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length;
    const raw = pdf.subarray(start, text.indexOf("endstream", start));
    try {
      out.push(inflateSync(raw).toString("latin1"));
    } catch {
      out.push(raw.toString("latin1"));
    }
  }
  return out;
}

describe("TallyInvoicePDF", () => {
  it("prints the total's rupee sign in a font that has ₹", async () => {
    const pdf = await renderToBuffer(<TallyInvoicePDF {...props} />);
    const unicodeMaps = streams(pdf).filter((s) => s.includes("begincmap"));
    expect(unicodeMaps.some((map) => /<20b9>/i.test(map))).toBe(true);
  });
});
