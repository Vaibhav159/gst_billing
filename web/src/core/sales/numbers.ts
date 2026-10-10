// Bill numbers: stored exactly as typed and trimmed, except that on or after a firm's paper_full_number_from date digits
// alone take the firm's format (34 -> KGH/2026-27/34). One series per firm and FY; a number's counter is its trailing
// digits. Whether a number is free is the server's to say (GET sales/check-number/): these say what it looks like.

/** The number part at the end: "KGH/2026-27/108" -> 108, "45" -> 45; null when there's none. */
export function counterOf(text: string | null | undefined): number | null {
  const m = /(\d+)\s*$/.exec(String(text ?? "").trim());
  return m ? Number(m[1]) : null;
}

/** The same bill number: trimmed, in any case. */
export function sameNumber(a: string | null | undefined, b: string | null | undefined): boolean {
  return String(a ?? "").trim().toUpperCase() === String(b ?? "").trim().toUpperCase();
}

/** A firm's own format: "KGH/2026-27/34", or "34" for a firm without a prefix. n: the counter, or its digits without leading zeros. */
export function fullNumber(prefix: string, fy: string, n: number | string): string {
  return prefix ? `${prefix}/${fy}/${n}` : String(n);
}

/**
 * What a typed number is stored as: digits alone take the firm's format when it uses full numbers on that date
 * (NextNumber.full_number); anything else is kept as typed. Leading zeros go, as the server's int() drops them, and the
 * digits stay text, so a long number keeps every one (a JavaScript number is exact only to 15 digits).
 */
export function storedNumber(text: string, { prefix, fy, full }: { prefix: string; fy: string; full: boolean }): string {
  const t = text.trim();
  return full && /^\d+$/.test(t) ? fullNumber(prefix, fy, t.replace(/^0+(?=\d)/, "")) : t;
}

/** What's wrong with a typed number's shape, in the server's words (contract §2.3), or "". stored: what it would be saved as. */
export function numberShapeProblem(text: string, { next, stored }: { next: string; stored: string }): string {
  const t = text.trim();
  if (!t) return `Type the bill number, or use the next free one, ${next}.`;
  if (t.length > 16) return `A GST bill number can have at most 16 characters; this has ${t.length}.`;
  if (!/^[A-Za-z0-9/-]+$/.test(t)) return "Use only letters, digits, \"-\" and \"/\" (GST rule 46). Spaces and other marks aren't allowed.";
  if (counterOf(t) == null) return "End the number with digits, like 108 or KGH/2026-27/108, so bills sort in order.";
  if (stored.length > 16) return `${stored} would have more than 16 characters. Type a shorter number.`;
  return "";
}

/** The hint under a number field (PROTO sales/parts.jsx:556): the next free number and how to type one. */
export function numberHint({ next, firm, fy, full }: { next: string; firm: string; fy: string; full: boolean }): string {
  return full
    ? `${next} is the next free number in ${firm} for FY ${fy}. Type 34 for ${next.replace(/\d+$/, "34")}, or any other format; numbers are unique in a year.`
    : `${next} is the next free number in ${firm} for FY ${fy}. Type the number as written on the paper bill; numbers are unique in a year.`;
}
