import { afterText, dueTone, dueWords, explainedText, missingText, numbersText, paperLink, paperMonths, runsText } from "./book";

test("the months offered are this month and the five before it, newest first", () => {
  expect(paperMonths("2026-10-08")).toEqual(["2026-10", "2026-09", "2026-08", "2026-07", "2026-06", "2026-05"]);
  expect(paperMonths("2027-02-01")).toEqual(["2027-02", "2027-01", "2026-12", "2026-11", "2026-10", "2026-09"]);
});

test("numbers read as runs", () => {
  expect(runsText([[17, 29], [34, 36]])).toBe("17 to 29, 34 to 36");
  expect(runsText([[5, 5]])).toBe("5");
  expect(numbersText([32, 31, 40, 41, 42, 45])).toBe("31, 32, 40 to 42, 45");
  expect(runsText([[28, 29]])).toBe("28, 29");
  expect(numbersText([31])).toBe("31");
  expect(numbersText([])).toBe("");
  expect(runsText([])).toBe("");
});

test("a missing number says why: cancelled or deleted, with the reason, or that none was given", () => {
  expect(explainedText({ counter: 19, kind: "cancelled", id: 205, invoice_number: "KGH/2026-27/19", reason: "Customer returned the piece the same day" }))
    .toEqual({ number: "19", why: "cancelled (Customer returned the piece the same day)" });
  expect(explainedText({ counter: 27, kind: "deleted", bin_id: 4, invoice_number: "KGH/2026-27/27", reason: "Entered twice by mistake", deleted_at: "2026-10-03T18:40:00+05:30" }))
    .toEqual({ number: "27", why: "deleted 03 Oct (Entered twice by mistake)" });
  expect(explainedText({ counter: 21, kind: "cancelled", id: 207, invoice_number: "KGH/2026-27/21", reason: "No reason given." }).why).toBe("cancelled, no reason was given");
});

test("numbers other bills already use are named, with the next free one", () => {
  expect(afterText([30, 31, 32, 33], ["2026-10"], 34)).toBe("30 to 33 are October's bills, so the next free number is 34.");
  expect(afterText([30], ["2026-10"], 31)).toBe("30 is October's bill, so the next free number is 31.");
  // the bills can be in this month, an earlier one or several (an odd-shaped "KGH-30" in any month: contract §2.13)
  expect(afterText([30, 31], ["2026-08", "2026-10"], 32)).toBe("30 and 31 are other bills, so the next free number is 32.");
  expect(afterText([30], ["2026-09", "2026-10"], 31)).toBe("30 is another bill, so the next free number is 31.");
  expect(afterText([], [], 30)).toBe("");
});

test("the numbers not entered yet, and how many when the book lists only the first 500 of them (Ruling 1D-3)", () => {
  expect(missingText([22, 23], 2)).toBe("22, 23");
  const first = Array.from({ length: 500 }, (_, i) => 17 + i);
  expect(missingText(first, 1234)).toBe("1,234 numbers. The first 500 are 17 to 516.");
});

test("the GSTR-1 due date in words, red at 3 days or less", () => {
  expect(dueWords("2026-10-11", "2026-10-08")).toBe("11 Oct (in 3 days)");
  expect(dueWords("2026-10-11", "2026-10-10")).toBe("11 Oct (tomorrow)");
  expect(dueWords("2026-10-11", "2026-10-11")).toBe("11 Oct (today)");
  expect(dueWords("2026-10-11", "2026-10-13")).toBe("11 Oct (2 days late)");
  expect(dueTone("2026-10-11", "2026-10-08")).toBe("neg");
  expect(dueTone("2026-11-11", "2026-10-28")).toBe("brand");
  expect(dueTone("2026-11-11", "2026-10-08")).toBe("muted");
});

test("the next paper bill's link carries its firm, date and number", () => {
  expect(paperLink(3, "2026-09-29", 34)).toBe("/sales/new?paper=1&firm=3&date=2026-09-29&number=34");
});
