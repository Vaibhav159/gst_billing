import { hasGstin } from "./gstin";

/**
 * The tax warnings the invoice form shows for a sales bill. Each one only warns: Save always stays available, because
 * the bill may already be written in the paper book and is only being entered.
 *
 * - GST Rule 46(f): an invoice to a buyer without a GSTIN with a taxable value of ₹50,000 or more must carry the
 *   buyer's name and address.
 * - Income Tax Sec 269ST: ₹2,00,000 or more may not be taken in cash from one person.
 * - Income Tax Rule 114B: a sale above ₹2,00,000 needs the buyer's PAN. A GSTIN carries the PAN inside it.
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
  customer?: { name?: string | null; gst_number?: string | null; address?: string | null; pan_number?: string | null } | null;
}

// The names a shop gives one general customer for counter sales. Such a record holds no buyer's own name or address.
const COUNTER_NAME = /^(cash( sales?| customer)?|walk-?in( customer)?|counter( sales?| customer)?|customer|retail( customer)?)$/i;

export function isCounterCustomer(name?: string | null): boolean {
  return COUNTER_NAME.test((name || "").trim().replace(/\s+/g, " ").replace(/^walk in\b/i, "walk-in"));
}

export function taxWarnings(input: TaxWarningInput): TaxWarning[] {
  const c = input.customer;
  if ((input.type || "").toUpperCase() !== "OUTWARD" || !c) return [];
  const registered = hasGstin(c.gst_number);
  const counter = isCounterCustomer(c.name);
  const name = (c.name || "").trim() || "this customer";
  // undefined means the form holds only a stub of this customer (no address or PAN loaded): unknown, not blank.
  const blank = (v: string | null | undefined) => v !== undefined && !(v || "").trim();
  const warnings: TaxWarning[] = [];

  if (!registered && input.subtotal >= BUYER_ADDRESS_LIMIT && (counter || blank(c.address))) {
    warnings.push({
      key: "buyer_address",
      title: "The buyer's name and address",
      text: counter
        ? "A bill of ₹50,000 or more to a buyer without a GSTIN must show the buyer's own name and address (GST Rule 46(f)). "
          + "Pick or add the buyer's own customer record."
        : "A bill of ₹50,000 or more to a buyer without a GSTIN must show the buyer's name and address (GST Rule 46(f)). "
          + `Add the address for ${name} in Customers.`,
    });
  }
  if (input.paymentMode === "cash" && input.total >= CASH_LIMIT) {
    warnings.push({
      key: "cash_2_lakh",
      title: "Cash of ₹2,00,000 or more",
      text: "Income Tax doesn't allow taking ₹2,00,000 or more in cash from one buyer (Sec 269ST), and the penalty equals "
        + "the cash taken. Take part of it by bank or UPI, and set Payment to Mixed.",
    });
  }
  if (input.total > PAN_LIMIT && !registered && (blank(c.pan_number) || (counter && c.pan_number === undefined))) {
    warnings.push({
      key: "pan",
      title: "The buyer's PAN",
      text: counter
        ? "A sale above ₹2,00,000 needs the buyer's PAN (Income Tax Rule 114B). Pick or add the buyer's own customer record with their PAN."
        : `A sale above ₹2,00,000 needs the buyer's PAN (Income Tax Rule 114B). Add the PAN for ${name} in Customers.`,
    });
  }
  return warnings;
}
