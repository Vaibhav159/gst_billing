import { counterOf, fullNumber, numberHint, numberShapeProblem, sameNumber, storedFor, storedNumber } from "./numbers";

test("a number's counter is its trailing digits", () => {
  expect(counterOf("KGH/2026-27/108")).toBe(108);
  expect(counterOf(" 45 ")).toBe(45);
  expect(counterOf("KGH-A")).toBeNull();
});

test("the same number in any case, trimmed", () => {
  expect(sameNumber(" kgh/2026-27/31 ", "KGH/2026-27/31")).toBe(true);
  expect(sameNumber("KGH/2026-27/31", "KGH/2026-27/131")).toBe(false);
});

test("digits alone take the firm's format only when it uses full numbers on that date; anything else is kept as typed", () => {
  expect(fullNumber("KGH", "2026-27", 34)).toBe("KGH/2026-27/34");
  expect(fullNumber("", "2026-27", 34)).toBe("34");
  expect(storedNumber(" 34 ", { prefix: "KGH", fy: "2026-27", full: true })).toBe("KGH/2026-27/34");
  expect(storedNumber("34", { prefix: "KGH", fy: "2026-27", full: false })).toBe("34");
  expect(storedNumber("MO/26/9", { prefix: "KGH", fy: "2026-27", full: true })).toBe("MO/26/9");
  // the server drops leading zeros as it formats (int(text)), so this says what it will store
  expect(storedNumber("034", { prefix: "KGH", fy: "2026-27", full: true })).toBe("KGH/2026-27/34");
  expect(storedNumber("000", { prefix: "KGH", fy: "2026-27", full: true })).toBe("KGH/2026-27/0");
  // and keeps every digit (Python's int is exact): 16 digits are past what a JavaScript number holds exactly
  expect(storedNumber("9007199254740993", { prefix: "KGH", fy: "2026-27", full: true })).toBe("KGH/2026-27/9007199254740993");
});

test("a next-number answer says what a typed number is stored as: storedNumber, with the firm's prefix read off its number", () => {
  const next = { fy: "2026-27", invoice_number: "KGH/2026-27/35", full_number: true };
  expect(storedFor(next, " 034 ")).toBe("KGH/2026-27/34");
  expect(storedFor(next, "MO/26/9")).toBe("MO/26/9");
  expect(storedFor({ fy: "2026-27", invoice_number: "KGH/A/2026-27/35", full_number: true }, "34")).toBe("KGH/A/2026-27/34");
  // before the firm's full-number date, or with no answer yet, a number is kept as typed
  expect(storedFor({ fy: "2026-27", invoice_number: "35", full_number: false }, " 34 ")).toBe("34");
  expect(storedFor(undefined, " 34 ")).toBe("34");
});

test("a number's shape in the server's words", () => {
  const at = (text: string, stored = text.trim()) => numberShapeProblem(text, { next: "KGH/2026-27/35", stored });
  expect(at("  ")).toBe("Type the bill number, or use the next free one, KGH/2026-27/35.");
  expect(at("KGH/2026-27/12345")).toBe("A GST bill number can have at most 16 characters; this has 17.");
  expect(at("KGH 34")).toBe("Use only letters, digits, \"-\" and \"/\" (GST rule 46). Spaces and other marks aren't allowed.");
  expect(at("KGH-A")).toBe("End the number with digits, like 108 or KGH/2026-27/108, so bills sort in order.");
  expect(at("1234567", "LONGPREFIX/2026-27/1234567")).toBe("LONGPREFIX/2026-27/1234567 would have more than 16 characters. Type a shorter number.");
  expect(at("34", "KGH/2026-27/34")).toBe("");
});

test("the hint names the next free number and how to type one", () => {
  expect(numberHint({ next: "KGH/2026-27/35", firm: "KIRAN GOLD HOUSE", fy: "2026-27", full: true }))
    .toBe("KGH/2026-27/35 is the next free number in KIRAN GOLD HOUSE for FY 2026-27. Type 34 for KGH/2026-27/34, or any other format; numbers are unique in a year.");
  expect(numberHint({ next: "35", firm: "KIRAN GOLD HOUSE", fy: "2026-27", full: false }))
    .toBe("35 is the next free number in KIRAN GOLD HOUSE for FY 2026-27. Type the number as written on the paper bill; numbers are unique in a year.");
});
