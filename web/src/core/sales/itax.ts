// The income-tax checks on a sale (not GST), the same rules the server runs (contract §0.2 ItaxFlag; P§2.10):
// cash at or over ₹2,00,000 (Sec 269ST), over ₹2,00,000 without the buyer's PAN (Rule 114B), a walk-in over the limit,
// and a business without an address (CGST Rule 46). A cancelled bill carries none. "Part cash, part UPI" is never
// flagged: the cash part isn't recorded.
import { inr } from "@/core/format";
import { hasGstin } from "@/core/ids";
import type { BillStatus, CustomerType, ItaxFlag, PaymentMode } from "./types";

/** ₹2,00,000 in paise: the cash limit for one bill (Sec 269ST, at or over) and the PAN threshold (Rule 114B, over). */
export const ITAX_LIMIT = 20000000;

/** What itaxFlags reads off a bill. pan: the PAN to go by (typed and PAN-shaped, or from a GSTIN that checks out: effectivePan). */
export type ItaxInput = {
  status: BillStatus; payment_mode: PaymentMode; total: number;
  customer: { name: string; type: CustomerType; pan: string; gst_number: string; address: string };
};

export function itaxFlags(b: ItaxInput): ItaxFlag[] {
  if (b.status === "cancelled") return [];
  const c = b.customer;
  const out: ItaxFlag[] = [];
  if (b.payment_mode === "cash" && b.total >= ITAX_LIMIT) {
    out.push({ kind: "cash_limit", short: "Cash ≥ ₹2 lakh", text: `${inr(b.total)} taken in cash is at or over the ₹2,00,000 limit for one bill (Income Tax Sec 269ST).` });
  }
  if (b.total > ITAX_LIMIT && c.type !== "walkin" && !c.pan.trim()) {
    out.push({ kind: "pan", short: "PAN missing", text: `A bill over ₹2,00,000 needs the buyer's PAN (Rule 114B). Add ${c.name}'s PAN.` });
  }
  if (b.total > ITAX_LIMIT && c.type === "walkin") {
    out.push({ kind: "walkin_limit", short: "Walk-in over ₹2 lakh", text: "A bill over ₹2,00,000 needs the buyer's PAN (Rule 114B). Put the bill in the buyer's name, with their PAN, not Walk-in." });
  }
  if (hasGstin(c.gst_number) && !c.address.trim()) {
    out.push({ kind: "b2b_address", short: "No address", text: "A bill to a business needs the buyer's address (CGST Rule 46). Add it on the customer." });
  }
  return out;
}
