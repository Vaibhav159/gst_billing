/**
 * GSTIN client-side validation — mirror of billing/gstin.py so the form can
 * react instantly (server remains the authority via /api/gstin/<gstin>/).
 */

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

export function gstinCheckDigit(first14: string): string {
  let total = 0;
  for (let i = 0; i < first14.length; i++) {
    const product = CHARS.indexOf(first14[i]) * (i % 2 ? 2 : 1);
    total += Math.floor(product / 36) + (product % 36);
  }
  return CHARS[(36 - (total % 36)) % 36];
}

export function validateGstin(raw: string): { ok: boolean; reason: string } {
  const g = (raw || "").trim().toUpperCase();
  if (g.length !== 15) return { ok: false, reason: "A GSTIN is exactly 15 characters." };
  if (!GSTIN_RE.test(g)) return { ok: false, reason: "That doesn't match the GSTIN format." };
  if (gstinCheckDigit(g.slice(0, 14)) !== g[14])
    return { ok: false, reason: "Check digit doesn't match — likely a typo." };
  return { ok: true, reason: "" };
}

export interface GstinLookup {
  gstin: string;
  valid: boolean;
  reason?: string;
  source?: "checksum" | "cache" | "provider";
  state_code?: string;
  state_name?: string;
  pan?: string;
  legal_name?: string;
  trade_name?: string;
  status?: string;
  address?: string;
  hint?: string;
}
