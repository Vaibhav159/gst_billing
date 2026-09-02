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
