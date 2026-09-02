/**
 * Where a supply is taxed. Mirrors billing/tax_rules.py on the server so the
 * preview a user sees and the row that gets written agree.
 */

/** Two-digit GST state code, or "" when the GSTIN is missing/too short. */
export function stateCode(gstin?: string | null): string {
  const g = (gstin || "").trim();
  return g.length >= 2 ? g.slice(0, 2) : "";
}

/**
 * True when both parties are in the same state (CGST + SGST).
 *
 * GSTIN state codes decide it when both sides have one. State names are the
 * fallback for unregistered parties. When neither is known we assume local —
 * defaulting to inter-state meant a blank capture form opened on "IGST" and an
 * unregistered local supplier's bill was taxed that way unless someone noticed.
 */
export function isIntraState(
  partyGstin?: string | null,
  firmGstin?: string | null,
  partyState?: string | null,
  firmState?: string | null,
): boolean {
  const a = stateCode(partyGstin);
  const b = stateCode(firmGstin);
  if (a && b) return a === b;

  const ps = (partyState || "").trim().toUpperCase();
  const fs = (firmState || "").trim().toUpperCase();
  if (ps && fs) return ps === fs;

  return true;
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
  "34": "Puducherry", "35": "Andaman & Nicobar Islands", "36": "Telangana",
  "37": "Andhra Pradesh", "38": "Ladakh",
};

/**
 * A party's state name and two-digit code. GSTIN prefix first; otherwise the
 * name is looked up in the table — the Tally template used to return an empty
 * code for every unregistered buyer, which is precisely the B2C case where a
 * printed place of supply is legally required (CGST Rule 46).
 */
export function stateInfo(gstin: string | null | undefined, stateName: string | null | undefined): { name: string; code: string } {
  const g = (gstin || "").trim();
  if (g.length >= 2 && STATE_CODES[g.slice(0, 2)]) {
    const code = g.slice(0, 2);
    return { name: STATE_CODES[code] || (stateName || ""), code };
  }
  const wanted = (stateName || "").trim().toUpperCase();
  const hit = wanted ? Object.entries(STATE_CODES).find(([, n]) => n.toUpperCase() === wanted) : undefined;
  return { name: stateName || "", code: hit ? hit[0] : "" };
}
