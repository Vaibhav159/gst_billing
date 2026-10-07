/**
 * Where a supply is taxed. Mirrors billing/tax_rules.py on the server so the
 * preview a user sees and the row that gets written agree.
 */

import { hasGstin } from "./gstin";

/**
 * Two-digit GST state code, or "" when there is no GSTIN. A placeholder ("NA",
 * "URP") is none: its first two letters read as a state made a local walk-in
 * inter-state (H12). Mirrors the GSTIN half of tax_rules.state_code.
 */
export function stateCode(gstin?: string | null): string {
  return hasGstin(gstin) ? (gstin || "").trim().slice(0, 2) : "";
}

/**
 * One spelling per state name: upper-case, "&" read as "AND", whitespace
 * collapsed. Mirrors tax_rules.normalize_state_name.
 */
export function normalizeStateName(name?: string | null): string {
  return (name || "").toUpperCase().replace(/&/g, " AND ").split(/\s+/).filter(Boolean).join(" ");
}

/**
 * A party's two-digit state code: its GSTIN's, else its state name's, else "".
 * Mirrors tax_rules.state_code, side by side, so the preview and the stored
 * heads agree (M16).
 */
export function stateCodeOf(gstin?: string | null, stateName?: string | null): string {
  return stateCode(gstin) || CODE_BY_NAME[normalizeStateName(stateName)] || "";
}

/**
 * True when both parties are in the same state (CGST + SGST).
 *
 * Each side resolves to a state code the way the server does — GSTIN first,
 * then state name — and the codes are compared. Comparing raw names whenever
 * either GSTIN was missing disagreed with the server for a firm with a GSTIN
 * and a stale state name, a party with a GSTIN and no state, and
 * "JAMMU & KASHMIR" against "JAMMU AND KASHMIR" (M16). When either side is
 * unknown we assume local: defaulting to inter-state meant a blank capture form
 * opened on "IGST" and an unregistered local supplier's bill was taxed that way.
 * src/test/fixtures/tax-placement.json holds the cases both sides must agree on.
 */
export function isIntraState(
  partyGstin?: string | null,
  firmGstin?: string | null,
  partyState?: string | null,
  firmState?: string | null,
): boolean {
  const a = stateCodeOf(partyGstin, partyState);
  const b = stateCodeOf(firmGstin, firmState);
  return a && b ? a === b : true;
}


/**
 * Which tax rows a printed document should show. Keyed off the heads actually
 * stored on the lines — is_igst_applicable is a prediction from party data,
 * and when a row was written under the other head the two disagree; printing
 * from the prediction showed "IGST 0.00" beside a total that includes CGST/SGST.
 * InvoiceDetail already does this; the PDF/print paths did not.
 */
export function storedShowsIGST(inv: {
  isIGST?: boolean;
  items?: Array<{ cgst?: number; sgst?: number; igst?: number }>;
}): boolean {
  const items = inv.items ?? [];
  const storedIGST = items.some((it) => Number(it.igst) > 0);
  const storedSplit = items.some((it) => Number(it.cgst) > 0 || Number(it.sgst) > 0);
  return storedIGST || (!storedSplit && !!inv.isIGST);
}


/** GST state codes -> names. Single copy; the templates all read this one. */
export const STATE_CODES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan",
  "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh",
  "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura",
  "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand",
  "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "25": "Daman & Diu", "26": "Dadra & Nagar Haveli", "27": "Maharashtra",
  "29": "Karnataka", "30": "Goa", "32": "Kerala", "33": "Tamil Nadu",
  "31": "Lakshadweep", "34": "Puducherry", "35": "Andaman & Nicobar Islands", "36": "Telangana",
  "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory", "99": "Centre Jurisdiction",
};

const CODE_BY_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_CODES).map(([code, name]) => [normalizeStateName(name), code]),
);

/**
 * A party's state name and two-digit code. GSTIN prefix first; otherwise the
 * name is looked up in the table — the Tally template used to return an empty
 * code for every unregistered buyer, which is precisely the B2C case where a
 * printed place of supply is legally required (CGST Rule 46).
 */
export function stateInfo(gstin: string | null | undefined, stateName: string | null | undefined): { name: string; code: string } {
  const fromGstin = stateCode(gstin);
  if (fromGstin && STATE_CODES[fromGstin]) return { name: STATE_CODES[fromGstin], code: fromGstin };
  return { name: stateName || "", code: stateCodeOf("", stateName) };
}
