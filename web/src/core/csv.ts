/**
 * One cell. Text that starts as a formula would (=, +, - or @, or a tab or carriage return) gets a ' in front, so a
 * spreadsheet shows it as text and never runs it: a customer named "=HYPERLINK(…)" stays a name. Then it's quoted when it
 * holds a comma, a quote or a line break. (Money here is never negative, so no figure turns into text.)
 */
export function csvCell(v: string | number): string {
  const s = typeof v === "number" ? String(v) : /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
