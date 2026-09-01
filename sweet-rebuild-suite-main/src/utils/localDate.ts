/**
 * Calendar dates in the user's own timezone.
 *
 * `new Date().toISOString().split("T")[0]` is the UTC date, not the local one.
 * In IST (+5:30) those differ every day between midnight and 05:30, and any
 * Date built from local parts is shifted a full day back:
 *
 *   new Date(2026, 3, 1).toISOString()  ->  "2026-03-31T18:30:00.000Z"
 *
 * That is how an FY filter came to ask the API for 2026-03-31 .. 2027-03-30 —
 * every period carrying the previous period's closing day and dropping its
 * own, losing 31 March, the heaviest invoicing day of the Indian year.
 *
 * Only use these for *calendar dates*. A timestamp is an instant and
 * `toISOString()` is exactly right for it — don't "fix" those.
 */

/** A Date's calendar date where the user is, as YYYY-MM-DD. */
export function toLocalDateString(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Today where the user is, as YYYY-MM-DD. */
export function todayLocal(): string {
  return toLocalDateString(new Date());
}

/** Indian FY bounds: FY 2026-27 is 2026-04-01 .. 2027-03-31. */
export function fyBounds(startYear: number): { start: string; end: string } {
  return { start: `${startYear}-04-01`, end: `${startYear + 1}-03-31` };
}

/**
 * Bounds of one month within an FY. `month` is 1-12 calendar, so Jan-Mar
 * belong to the FY's second calendar year.
 */
export function fyMonthBounds(
  startYear: number,
  month: number,
): { start: string; end: string } {
  const year = month >= 4 ? startYear : startYear + 1;
  const mm = String(month).padStart(2, "0");
  // Day 0 of the next month is the last day of this one, read in local parts.
  const lastDay = new Date(year, month, 0).getDate();
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(lastDay).padStart(2, "0")}` };
}
