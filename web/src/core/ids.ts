// The ids a customer carries (GSTIN, PAN, mobile number, email) checked in plain words, and the GST state table the
// GSTIN leans on. One copy for the customer screens, the bill form and Easy. The GSTIN check mirrors billing/gstin.py
// (and v2's src/utils/gstin.ts), the PAN pattern the server's customer PAN check, the states billing/constants.py.

/** GST state codes and the names the server keeps in a customer's state_name (billing/constants.py GST_CODE). */
export const GST_STATES: Readonly<Record<string, string>> = {
  "01": "JAMMU AND KASHMIR", "02": "HIMACHAL PRADESH", "03": "PUNJAB", "04": "CHANDIGARH", "05": "UTTARAKHAND", "06": "HARYANA",
  "07": "DELHI", "08": "RAJASTHAN", "09": "UTTAR PRADESH", "10": "BIHAR", "11": "SIKKIM", "12": "ARUNACHAL PRADESH", "13": "NAGALAND",
  "14": "MANIPUR", "15": "MIZORAM", "16": "TRIPURA", "17": "MEGHALAYA", "18": "ASSAM", "19": "WEST BENGAL", "20": "JHARKHAND",
  "21": "ODISHA", "22": "CHHATTISGARH", "23": "MADHYA PRADESH", "24": "GUJARAT", "25": "DAMAN AND DIU", "26": "DADRA AND NAGAR HAVELI",
  "27": "MAHARASHTRA", "29": "KARNATAKA", "30": "GOA", "31": "LAKSHADWEEP", "32": "KERALA", "33": "TAMIL NADU", "34": "PUDUCHERRY",
  "35": "ANDAMAN AND NICOBAR ISLANDS", "36": "TELANGANA", "37": "ANDHRA PRADESH", "38": "LADAKH", "97": "OTHER TERRITORY",
  "99": "CENTRE JURISDICTION",
};

/** One spelling per state name, as the server compares them ("&" read as "AND", spaces collapsed): tax_rules.normalize_state_name. */
function normState(name: string | null | undefined): string {
  return (name ?? "").toUpperCase().replace(/&/g, " AND ").split(/\s+/).filter(Boolean).join(" ");
}
/** "RAJASTHAN" -> "Rajasthan", "JAMMU AND KASHMIR" -> "Jammu and Kashmir". */
export function stateTitle(name: string | null | undefined): string {
  return normState(name).toLowerCase().split(" ").filter(Boolean).map((w, i) => (w === "and" && i > 0 ? w : w[0].toUpperCase() + w.slice(1))).join(" ");
}
/** A state name's 2-digit code ("RAJASTHAN" -> "08"), or "" when it isn't one. */
export function stateCodeOf(name: string | null | undefined): string {
  const want = normState(name);
  return want ? Object.keys(GST_STATES).find((code) => GST_STATES[code] === want) ?? "" : "";
}
/** "Rajasthan (08)"; a name the table doesn't have, as it reads; "No state". */
export function stateLabel(name: string | null | undefined): string {
  if (!normState(name)) return "No state";
  const code = stateCodeOf(name);
  return code ? `${stateTitle(GST_STATES[code])} (${code})` : stateTitle(name);
}
/** The state picker: every state as "Rajasthan (08)", by name, with `home` (a state name) first. Values are the server's names. */
export function stateOptions(home?: string | null): { value: string; label: string }[] {
  const all = Object.entries(GST_STATES).map(([code, name]) => ({ value: name, label: `${stateTitle(name)} (${code})` })).sort((a, b) => a.label.localeCompare(b.label));
  const first = all.find((o) => o.value === normState(home));
  return first ? [first, ...all.filter((o) => o !== first)] : all;
}

/* ── GSTIN ─────────────────────────────────────────────── */
const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

/** The mod-36 check character over a GSTIN's first 14 characters (billing/gstin.py check_digit). */
export function gstinCheckDigit(first14: string): string {
  let total = 0;
  for (let i = 0; i < first14.length; i++) {
    const product = CHARS.indexOf(first14[i]) * (i % 2 ? 2 : 1);
    total += Math.floor(product / 36) + (product % 36);
  }
  return CHARS[(36 - (total % 36)) % 36];
}
/** What the server counts as a GSTIN at all: 15 characters, the first two digits (billing tax_rules has_gstin). "NA" isn't one. */
export function hasGstin(raw: string | null | undefined): boolean {
  const g = (raw ?? "").trim();
  return g.length === 15 && /^\d\d/.test(g);
}
/** What a GSTIN box holds while typing: upper case, letters and digits only, at most 15. */
export function cleanGstin(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 15);
}

/**
 * A typed GSTIN, checked. empty and short: nothing to say yet. invalid: it can't be a GSTIN (its words say why), so it
 * isn't saved. check: everything but the last character fits, so it may be one mistyped character; it still saves and
 * the customer stays B2B (part 1 design, decision 3), and its PAN isn't used. valid: the state code and the PAN come from it.
 */
export type GstinCheck =
  | { status: "empty" }
  | { status: "short"; length: number; problem: string }
  | { status: "invalid"; problem: string }
  | { status: "check"; warning: string; code: string; state: string }
  | { status: "valid"; code: string; state: string; pan: string };

export const GSTIN_CHECK_WARNING = "The last character doesn't match, so you may have mistyped one character. It saves as you typed it, and bills to them still go to GSTR-1 as B2B. Check it against their GST certificate.";

export function checkGstin(raw: string | null | undefined): GstinCheck {
  const g = (raw ?? "").trim().toUpperCase();
  if (!g) return { status: "empty" };
  if (g.length < 15) return { status: "short", length: g.length, problem: `A GSTIN has 15 characters; this has ${g.length}.` };
  if (g.length > 15) return { status: "invalid", problem: `A GSTIN has 15 characters; this has ${g.length}.` };
  if (!GSTIN_RE.test(g)) return { status: "invalid", problem: "This doesn't follow the GSTIN pattern (2 digits, PAN, entity number, Z, check character)." };
  const code = g.slice(0, 2);
  if (!GST_STATES[code]) return { status: "invalid", problem: `${code} isn't a state code.` };
  if (gstinCheckDigit(g.slice(0, 14)) !== g[14]) return { status: "check", warning: GSTIN_CHECK_WARNING, code, state: GST_STATES[code] };
  return { status: "valid", code, state: GST_STATES[code], pan: g.slice(2, 12) };
}
/** The PAN inside a GSTIN that passes its check (characters 3 to 12), else "". */
export function gstinPan(gstin: string | null | undefined): string {
  const c = checkGstin(gstin);
  return c.status === "valid" ? c.pan : "";
}

/* ── PAN ───────────────────────────────────────────────── */
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const PAN_PROBLEM = "A PAN has 10 characters: 5 letters, 4 digits, then a letter (like ABCDE1234F).";
/** What a PAN box holds while typing: upper case, letters and digits only, at most 10. */
export function cleanPan(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 10);
}
/** Why a typed PAN won't do, or "" (an empty one is fine: it's asked for only over ₹2,00,000). */
export function panProblem(raw: string | null | undefined): string {
  const p = (raw ?? "").trim().toUpperCase();
  return p && !PAN_RE.test(p) ? PAN_PROBLEM : "";
}
/** The PAN that counts for Rule 114B: the one typed, else the PAN in a GSTIN that passes its check (the API's `pan`). */
export function effectivePan(panNumber: string | null | undefined, gstin: string | null | undefined): string {
  return (panNumber ?? "").trim().toUpperCase() || gstinPan(gstin);
}

/* ── Indian mobile numbers ─────────────────────────────── */
/** The digits of a mobile number as typed: "+91 98290 41122" and "098290 41122" give "9829041122". */
export function mobileDigits(raw: string | null | undefined): string {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.length > 10 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d;
}
/** A mobile number as it's read out, at most 10 digits: "9829041122" -> "98290 41122". */
export function formatMobile(raw: string | null | undefined): string {
  const d = mobileDigits(raw).slice(0, 10);
  return d.length > 5 ? `${d.slice(0, 5)} ${d.slice(5)}` : d;
}
/** Why a typed mobile number won't do, or "" (empty is fine: the number is optional). */
export function mobileProblem(raw: string | null | undefined): string {
  const d = mobileDigits(raw);
  if (!d) return "";
  if (d.length !== 10) return `A mobile number has 10 digits; this has ${d.length}.`;
  if (!/^[6-9]/.test(d)) return "Indian mobile numbers start with 6, 7, 8 or 9. Check the first digit.";
  return "";
}

/* ── Email ─────────────────────────────────────────────── */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** Why a typed email won't do, or "" (it's optional). */
export function emailProblem(raw: string | null | undefined): string {
  const e = (raw ?? "").trim();
  return e && !EMAIL_RE.test(e) ? "That email looks incomplete. It should look like name@example.com." : "";
}
