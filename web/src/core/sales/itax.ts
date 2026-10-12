// The income-tax and buyer-detail checks on a sale, the same rules the server runs (contract §0.2 ItaxFlag; P§2.10):
// cash at or over ₹2,00,000 (Sec 269ST), over ₹2,00,000 without the buyer's PAN (Rule 114B), a walk-in over the limit,
// and missing buyer details (CGST Rule 46). A cancelled bill carries none. "Part cash, part UPI" has no cash-limit
// flag: the cash part isn't recorded.
import { inr, possessive } from "@/core/format";
import { hasGstin } from "@/core/ids";
import type { BillStatus, CustomerType, ItaxFlag, ItaxKind, PaymentMode } from "./types";

/** ₹2,00,000 in paise: the cash limit for one bill (Sec 269ST, at or over) and the PAN threshold (Rule 114B, over). */
export const ITAX_LIMIT = 20000000;
/** ₹50,000 in paise: an unregistered buyer's name and address are needed at or over this taxable value (Rule 46(f)). */
export const B2C_ADDRESS_LIMIT = 5000000;

/** What itaxFlags reads off a bill. pan: the PAN to go by (typed and PAN-shaped, or from a GSTIN that checks out: effectivePan). */
export type ItaxInput = {
  status: BillStatus; payment_mode: PaymentMode; total: number; taxable: number;
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
  if (!hasGstin(c.gst_number) && b.taxable >= B2C_ADDRESS_LIMIT && (c.type === "walkin" || !c.address.trim())) {
    out.push({ kind: "b2c_address", short: "Name and address needed", text: c.type === "walkin"
      ? "A bill of ₹50,000 or more to a buyer without a GSTIN needs the buyer's name and address (CGST Rule 46(f)). Put the bill in the buyer's name, with their address, not Walk-in."
      : `A bill of ₹50,000 or more to a buyer without a GSTIN needs the buyer's address (CGST Rule 46(f)). Add ${possessive(c.name)} address.` });
  }
  return out;
}

/** Read the server's flags on bills and statements; leave out kinds this app doesn't know yet. */
export function readItaxFlags(raw: unknown): ItaxFlag[] {
  const kinds: ItaxKind[] = ["cash_limit", "pan", "walkin_limit", "b2b_address", "b2c_address"];
  const text = (v: unknown): string => v == null ? "" : String(v);
  return (Array.isArray(raw) ? raw : []).filter((f) => f && kinds.includes(f.kind))
    .map((f) => ({ kind: f.kind, short: text(f.short), text: text(f.text) }));
}
