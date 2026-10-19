import { hasGstin } from "./gstin";

/**
 * The tax warnings the invoice form shows for a sales bill. Each one only warns: Save always stays available, because
 * the bill may already be written in the paper book and is only being entered.
 *
 * - GST, CGST Rule 46(f): an invoice to a buyer without a GSTIN with a taxable value of ₹50,000 or more must carry the
 *   buyer's name and address, with the State. A missing State warns too: the printed bill then has no buyer State.
 * - Income Tax's cash limit (Sec 269ST of the 1961 Act): ₹2,00,000 or more in cash may not be received for one bill,
 *   or from one person in a day. The penalty equals the cash received.
 * - Income Tax's PAN rule (Rule 114B of the 1962 Rules): a sale above ₹2,00,000 needs the buyer's PAN, or a signed Form
 *   60 from a buyer who has none. A GSTIN carries the PAN inside it.
 *
 * The Income-tax Act, 2025 replaced the 1961 Act from 1 April 2026 and renumbered its sections, so the words the
 * owner reads name each rule without the old numbers.
 */
export const BUYER_ADDRESS_LIMIT = 50_000;
export const CASH_LIMIT = 200_000;
export const PAN_LIMIT = 200_000;

export type TaxWarningKey = "buyer_address" | "cash_2_lakh" | "pan";

export interface TaxWarning {
  key: TaxWarningKey;
  title: string;
  text: string;
}

export interface TaxWarningInput {
  /** "OUTWARD" (a sale) or "INWARD" (a purchase): only sales are checked. */
  type: string;
  /** The bill's taxable value, in rupees. */
  subtotal: number;
  /** The bill's total, in rupees. */
  total: number;
  /** "", "bank", "cash", "credit" or "mixed". */
  paymentMode: string;
  /** An undefined address, PAN or State: the form holds only a stub of this customer, so it's unknown, not blank. */
  customer?: {
    name?: string | null; gst_number?: string | null; address?: string | null; pan_number?: string | null; state_name?: string | null;
  } | null;
}

// The names a shop gives one general customer for counter sales. Such a record holds no buyer's own name, address
// or PAN, so the rules treat it as having none.
const COUNTER_NAME = new RegExp(
  "^(cash( (sales?|customers?|a/c|account|party|buyer))?|walk-?in( (customers?|buyer|party))?|counter( (sales?|customers?))?"
  + "|customers?|retail( (sales?|customers?))?|general( (sales?|customers?))?)$",
  "i",
);

// What people type for "no address": NA, N/A, N.A., nil, none, or only dashes and dots.
const PLACEHOLDER = /^(n\.?\s*\/?\s*a\.?|nil|none|[-.\s]+)$/i;

export function isCounterCustomer(name?: string | null): boolean {
  return COUNTER_NAME.test((name || "").trim().replace(/\s+/g, " ").replace(/^walk in\b/i, "walk-in"));
}

function missing(value: string | null | undefined): boolean {
  if (value === undefined) return false;
  const v = (value || "").trim();
  return !v || PLACEHOLDER.test(v);
}

export function taxWarnings(input: TaxWarningInput): TaxWarning[] {
  const c = input.customer;
  if ((input.type || "").toUpperCase() !== "OUTWARD" || !c) return [];
  const registered = hasGstin(c.gst_number);
  const counter = isCounterCustomer(c.name);
  const name = (c.name || "").trim() || "this customer";
  const warnings: TaxWarning[] = [];

  if (!registered && input.subtotal >= BUYER_ADDRESS_LIMIT && (counter || missing(c.address) || missing(c.state_name))) {
    warnings.push({
      key: "buyer_address",
      title: "The buyer's name and address",
      text: counter
        ? "A bill to a buyer without a GSTIN, with a taxable value of ₹50,000 or more, must show the buyer's own name, "
          + "address and State (GST Rule 46(f)). Pick or add the buyer's own customer record."
        : "A bill to a buyer without a GSTIN, with a taxable value of ₹50,000 or more, must show the buyer's name, "
          + `address and State (GST Rule 46(f)). Save the bill, then add the address and State for ${name} in Customers.`,
    });
  }
  if (input.paymentMode === "cash" && input.total >= CASH_LIMIT) {
    warnings.push({
      key: "cash_2_lakh",
      title: "Cash of ₹2,00,000 or more",
      text: "Income Tax doesn't allow receiving ₹2,00,000 or more in cash for one bill, or from one buyer in a day, and "
        + "the penalty equals the cash received. Keep the cash part below ₹2,00,000 and take the rest by bank or UPI. "
        + "Set Payment to Mixed only if the buyer paid that way.",
    });
  }
  if (input.total > PAN_LIMIT && !registered && (counter || missing(c.pan_number))) {
    warnings.push({
      key: "pan",
      title: "The buyer's PAN",
      text: "A sale above ₹2,00,000 needs the buyer's PAN for Income Tax, or a signed Form 60 if they have none. "
        + (counter
          ? "Pick or add the buyer's own customer record, with their PAN or Form 60."
          : `Save the bill, then add the PAN for ${name} in Customers.`),
    });
  }
  return warnings;
}
