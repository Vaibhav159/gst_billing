import { CircleCheck, CircleDot, FileCheck2, Lock, LockOpen, TriangleAlert } from "lucide-react";
import { dueDates, dueText, dueTone, STATE_META, TONE_TEXT } from "./stages";

test("every filing stage keeps the contract's exact words and prototype's icon and tone", () => {
  expect(STATE_META).toEqual({
    filed: { label: "Filed and locked", short: "Filed · locked", word: "Filed", tone: "file", icon: Lock },
    gstr1: { label: "GSTR-1 filed · GSTR-3B to file", short: "GSTR-1 filed", word: "GSTR-1 filed", tone: "file", icon: FileCheck2 },
    blocked: { label: "Blocked", short: "Blocked", word: "Blocked", tone: "neg", icon: TriangleAlert },
    ready: { label: "Ready to file", short: "Ready to file", word: "Ready", tone: "sale", icon: CircleCheck },
    open: { label: "Open · month running", short: "Open", word: "Open", tone: "muted", icon: CircleDot },
    unlocked: { label: "Unlocked for a correction", short: "Unlocked", word: "Unlocked", tone: "muted", icon: LockOpen },
    future: { label: "Not started", short: "–", word: "–", tone: "muted", icon: null },
  });
  expect(TONE_TEXT).toEqual({ sale: "text-sale", brand: "text-brand", amber: "text-amber", neg: "text-neg", file: "text-file", muted: "text-muted" });
});

test.each([
  ["2026-09", { gstr1: "2026-10-11", gstr3b: "2026-10-20", file_from: "2026-10-01" }],
  ["2026-12", { gstr1: "2027-01-11", gstr3b: "2027-01-20", file_from: "2027-01-01" }],
  ["2027-03", { gstr1: "2027-04-11", gstr3b: "2027-04-20", file_from: "2027-04-01" }],
  ["2028-02", { gstr1: "2028-03-11", gstr3b: "2028-03-20", file_from: "2028-03-01" }],
])("monthly due dates for %s stay on IST calendar days", (month, expected) => {
  expect(dueDates(month as string)).toEqual(expected);
});

test.each([
  ["2026-10-08", "2026-10-11", "in 3 days"],
  ["2026-10-10", "2026-10-11", "tomorrow"],
  ["2026-10-11", "2026-10-11", "today"],
  ["2026-10-12", "2026-10-11", "1 day late"],
  ["2026-10-13", "2026-10-11", "2 days late"],
  ["2028-02-28", "2028-03-01", "in 2 days"],
  ["2026-12-31", "2027-01-01", "tomorrow"],
])("due words from %s to %s", (today, due, expected) => {
  expect(dueText(today, due)).toBe(expected);
});

test.each([
  [-20, "neg"], [0, "neg"], [3, "neg"], [4, "brand"], [15, "brand"], [16, "muted"],
])("due tone at %s days", (days, expected) => {
  expect(dueTone(days as number)).toBe(expected);
});
