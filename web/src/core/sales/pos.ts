// Where a sale is taxed and how GSTR-1 files it: the buyer's type, the place of supply, IGST or CGST + SGST, and
// GSTR-1's table. These mirror the server's rules (the contract's `type` and `segment`), and the server stays the source
// of truth: the screens use them for what's being typed, before the server has said. The ids themselves (GSTIN, PAN,
// mobile) and the GST state table are plan 1C's, in @/core/ids.
import { inr } from "@/core/format";
import { checkGstin, GST_STATES, hasGstin, stateCodeOf, stateOptions, stateTitle } from "@/core/ids";
import type { CustomerType, Segment } from "./types";

/** walkin, person or business: the stored type, else business with a GSTIN and person without (the server's `type`). */
export function effectiveType(stored: string | null | undefined, gstin: string | null | undefined): CustomerType {
  if (stored === "walkin" || stored === "person" || stored === "business") return stored;
  return hasGstin(gstin) ? "business" : "person";
}

/** A state code as people read it: "08" -> "Rajasthan"; a code the table doesn't have -> "Unknown state". */
export function stateNameOf(code: string | null | undefined): string {
  const name = code ? GST_STATES[code] : undefined;
  return name ? stateTitle(name) : "Unknown state";
}

/** The place-of-supply picker: 1C's state picker (each state as "Rajasthan (08)", by name, the firm's state first), valued by code. */
export function posOptions(home = "08"): { value: string; label: string }[] {
  return stateOptions(GST_STATES[home]).map((o) => ({ value: stateCodeOf(o.value), label: o.label }));
}

type PosCustomer = { type: CustomerType; gst_number: string; state_code: string };

/**
 * A registered buyer's state as the server reads it (billing/tax_rules.py state_code): their GSTIN's first two digits,
 * whatever state is stored on them. Only for a buyer with a GSTIN (hasGstin).
 */
const gstinState = (gstin: string): string => gstin.trim().slice(0, 2);

/**
 * Where goods sold at the counter are handed over (IGST Act s.10(1)): the firm's state for a walk-in or a buyer without
 * a GSTIN, wherever they live; a registered buyer's own state otherwise, from their GSTIN (PROTO sales/lib.js:165-168).
 * The bill form starts from this and always sends it, since the server's own null means "the customer's state".
 */
export function autoPos(firmState: string, customer: PosCustomer | null): string {
  if (!customer || customer.type === "walkin" || !hasGstin(customer.gst_number)) return firmState;
  return gstinState(customer.gst_number);
}

/** Inter-state (IGST) when the place of supply isn't the firm's own state; never without the firm's state (the server's supply_interstate). */
export function isInterState(firmState: string, pos: string): boolean {
  return Boolean(firmState) && Boolean(pos) && firmState !== pos;
}

/** The tax type in words (PROTO sales/lib.js:170-180). */
export function taxType(firmState: string, pos: string, customer: PosCustomer | null): { inter: boolean; short: string; why: string } {
  const inter = isInterState(firmState, pos);
  const here = stateNameOf(firmState);
  if (!inter) {
    const registered = Boolean(customer && hasGstin(customer.gst_number));
    const why = !customer || customer.type === "walkin" || !registered ? `sold at the counter in ${here}`
      : gstinState(customer.gst_number) !== firmState ? `handed over at the counter in ${here}` : `both in ${here}`;
    return { inter, short: "Local sale · CGST + SGST", why };
  }
  return { inter, short: "Inter-state · IGST", why: `delivered to ${stateNameOf(pos)}` };
}

/** B2CL: an inter-state sale to a buyer without a GSTIN over ₹1,00,000 is reported bill by bill (billing/constants.py B2CL_THRESHOLD). */
export const B2CL_LIMIT = 10000000;

/** GSTR-1's table: B2B for any GSTIN, one failing its check digit too (design decision 3); B2CL for an inter-state sale over ₹1,00,000 without one; else B2CS. */
export function segmentOf(gstin: string | null | undefined, interstate: boolean, totalPaise: number): Segment {
  if (hasGstin(gstin)) return "b2b";
  return interstate && totalPaise > B2CL_LIMIT ? "b2cl" : "b2cs";
}

/** GSTR-1's tables in words (PROTO sales/lib.js:206-210); "valid" leaves the B2B line, since a failing GSTIN stays B2B. */
export const SEGMENTS: Record<Segment, { label: string; long: string }> = {
  b2b: { label: "B2B", long: "B2B: buyers with a GSTIN, reported bill by bill" },
  b2cl: { label: "B2CL", long: `B2CL: inter-state sales (delivered outside the firm's state) to buyers without a GSTIN, bill value over ${inr(B2CL_LIMIT)}, reported bill by bill` },
  b2cs: { label: "B2C", long: "B2C: everything else, summarised by state and rate" },
};

/**
 * What a bill says about its buyer's GSTIN when it doesn't check out (1C's checkGstin; words from PROTO core/gst.js:89-91),
 * or "". It names the GSTR-1 table the bill files in, as segmentOf and the server do (Ruling 1B-11): a GSTIN failing only
 * its check character stays B2B (design decision 3); one the server doesn't count as a GSTIN at all (short, over-long, not
 * starting with two digits) files as B2C until someone fixes it.
 */
export function gstinNote(raw: string | null | undefined): string {
  const g = checkGstin(raw);
  if (g.status === "check") return "Its last character doesn't match, so you may have mistyped one character. The bill still files as B2B; check the GSTIN on the customer.";
  if (g.status !== "invalid" && g.status !== "short") return "";
  return hasGstin(raw) ? `${g.problem} The bill still files as B2B; fix the GSTIN on the customer.` : `${g.problem} The bill files as B2C until you fix the GSTIN on the customer.`;
}
