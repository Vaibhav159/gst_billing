// The paper book's words (PROTO pages/sales/lib.js:704-772, PaperBook.jsx): which months it offers, a month's numbers
// as runs, why a number is missing, the GSTR-1 due date, and the link that opens the bill form on the next paper bill.
// The server works the book out (contract §2.13, Ruling 1A-29): these only say what it sent.
import type { PaperBookBill, PaperBookExplained } from "@/core/sales/types";
import { addMonths, dateShort, daysBetween, groupIN, monthLabel, monthOf, plural } from "@/core/format";
import { NUMBER_WORDS, realReason } from "@/core/sales/words";

/** This month and the five before it, newest first: the months whose paper bills are still being typed in. */
export function paperMonths(today: string): string[] {
  const cur = monthOf(today);
  return [0, 1, 2, 3, 4, 5].map((n) => addMonths(cur, -n));
}

/** Numbers as runs: [17, 18, 19, 24, 25, 31] → "17 to 19, 24, 25, 31". */
export function numbersText(ns: readonly number[]): string {
  const runs: [number, number][] = [];
  for (const n of [...new Set(ns)].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && n === last[1] + 1) last[1] = n; else runs.push([n, n]);
  }
  return runsText(runs);
}
/** The server's runs: [[17, 29], [34, 36]] → "17 to 29, 34 to 36"; two numbers in a row read as two. */
export function runsText(runs: readonly (readonly [number, number])[]): string {
  return runs.map(([a, b]) => (a === b ? `${a}` : b === a + 1 ? `${a}, ${b}` : `${a} to ${b}`)).join(", ");
}
/** The numbers not entered yet; past the first 500 the book lists, how many there are in all (Ruling 1D-3). */
export function missingText(missing: readonly number[], count: number): string {
  const listed = numbersText(missing);
  return count > missing.length ? `${plural(count, "number")}. The first ${groupIN(missing.length)} are ${listed}.` : listed;
}

/** Why a number of the month isn't a bill that counts: "19", "cancelled (Customer returned the piece)". */
export function explainedText(x: PaperBookExplained): { number: string; why: string } {
  const reason = realReason(x.reason);
  const because = reason ? ` (${reason})` : ", no reason was given";
  return x.kind === "deleted"
    ? { number: String(x.counter), why: `deleted ${dateShort(x.deleted_at.slice(0, 10))}${because}` }
    : { number: String(x.counter), why: `cancelled${because}` };
}

/**
 * "30 to 33 are October's bills, so the next free number is 34." (empty when nothing is skipped). One month is named;
 * the bills can also be in several, this month or an earlier one (an odd-shaped "KGH-30": contract §2.13), so other bills.
 */
export function afterText(after: readonly number[], afterMonths: readonly string[], next: number): string {
  if (!after.length) return "";
  const one = after.length === 1;
  const which = one ? `${after[0]} is` : after.length === 2 ? `${after[0]} and ${after[1]} are` : `${after[0]} to ${after[after.length - 1]} are`;
  const whose = afterMonths.length === 1 ? `${monthLabel(afterMonths[0], { long: true, year: false })}'s bill${one ? "" : "s"}` : `used by ${one ? "another bill" : "other bills"}`;
  return `${which} ${whose}, so the next free number is ${next}.`;
}

/**
 * A number on more than one of the month's bills, and which get new numbers (Ruling 1D-13): all but one, never a
 * cancelled one, which keeps its number (renumbering refuses it, contract §2.6). A cancelled bill on the number holds it,
 * so then every active one moves; when all are cancelled there's nothing to do. fix: there is something to do.
 */
export function twiceText(n: number, bills: readonly Pick<PaperBookBill, "status">[]): { text: string; fix: boolean } {
  const many = bills.length > 2 ? NUMBER_WORDS[bills.length] || String(bills.length) : "two";
  const active = bills.filter((b) => b.status !== "cancelled").length;
  if (!active) return { text: `${n} is on ${many} cancelled bills: they keep their numbers.`, fix: false };
  const which = active === bills.length ? (active === 2 ? "one" : "all but one") : active === 1 ? "the active one" : "each active one";
  return { text: `${n} is on ${many} bills: give ${which} a new number before filing.`, fix: true };
}

/** "11 Oct (in 3 days)", "11 Oct (tomorrow)", "11 Oct (2 days late)". */
export function dueWords(due: string, today: string): string {
  const n = daysBetween(today, due);
  const when = n > 1 ? `in ${n} days` : n === 1 ? "tomorrow" : n === 0 ? "today" : `${plural(-n, "day")} late`;
  return `${dateShort(due)} (${when})`;
}
/** Colour follows urgency: red at 3 days or less (or late), gold within 15 days, quiet after. */
export function dueTone(due: string, today: string): "neg" | "brand" | "muted" {
  const n = daysBetween(today, due);
  return n <= 3 ? "neg" : n <= 15 ? "brand" : "muted";
}

/** The link that opens the bill form on a paper bill: its firm, date and number filled in. */
export function paperLink(firmId: number, date: string, counter: number): string {
  return `/sales/new?paper=1&firm=${firmId}&date=${date}&number=${counter}`;
}
