import { addMonths, amountInWords, date, daysBetween, fyOf, groupIN, inr, mobileText, monthLabel, paiseToDecimal, parseRupees, pct, qty, toPaise, todayIST } from "./format";
import { cn } from "./cn";

test("money in Indian digits, held as paise", () => {
  expect(groupIN(23200075)).toBe("2,32,00,075");
  expect(inr(8708321)).toBe("₹87,083.21");
  expect(inr(-500)).toBe("−₹5.00");
  expect(inr(23200075, { whole: true })).toBe("₹2,32,001");
  expect(inr(100, { sign: true })).toBe("+₹1.00");
  expect(inr(null)).toBe("—");
});

test("rupees typed by a person", () => {
  expect(parseRupees("6,512.50")).toBe(651250);
  expect(parseRupees("6512.5")).toBe(651250);
  expect(parseRupees("₹ 87083.21")).toBe(8708321);
  expect(parseRupees("abc")).toBeNull();
});

test("the API's decimals to paise and back, half-up like the server", () => {
  expect(toPaise("87083.21")).toBe(8708321);
  expect(toPaise("0.1")).toBe(10);
  expect(toPaise(12.3)).toBe(1230);
  expect(toPaise("-5.5")).toBe(-550);
  expect(toPaise("2.345")).toBe(235);
  expect(toPaise("-2.345")).toBe(-235);
  expect(toPaise("")).toBeNull();
  expect(toPaise("1,000.00")).toBeNull();
  expect(paiseToDecimal(8708321)).toBe("87083.21");
  expect(paiseToDecimal(-550)).toBe("-5.50");
  expect(paiseToDecimal(105)).toBe("1.05");
  expect(paiseToDecimal(-5)).toBe("-0.05");
});

test("dates, months and the financial year", () => {
  expect(date("2026-10-08")).toBe("08 Oct 2026");
  expect(monthLabel("2026-09", { long: true })).toBe("September 2026");
  expect(monthLabel("2026-09", { long: true, year: false })).toBe("September");
  expect(fyOf("2026-03-31")).toBe("2025-26");
  expect(fyOf("2026-04-01")).toBe("2026-27");
  expect(addMonths("2026-11", 3)).toBe("2027-02");
  expect(daysBetween("2026-10-08", "2026-10-11")).toBe(3);
});

test("today is the Indian calendar date, whatever the device's clock zone", () => {
  vi.stubEnv("TZ", "America/Los_Angeles");
  try {
    expect(new Date("2026-10-08T20:00:00Z").getDate()).toBe(8); // the stub took: this clock is on 8 Oct, India is on 9 Oct
    expect(todayIST(new Date("2026-10-08T20:00:00Z"))).toBe("2026-10-09");
    expect(todayIST(new Date("2026-10-08T18:00:00Z"))).toBe("2026-10-08");
  } finally {
    vi.unstubAllEnvs();
  }
});

test("units, rates and words", () => {
  expect(qty(12.345, "g")).toBe("12.345 g");
  expect(qty(4, "pcs")).toBe("4 pcs");
  expect(pct(0.0025)).toBe("0.25%");
  expect(pct(0.03)).toBe("3%");
  expect(amountInWords(8708321)).toBe("Eighty Seven Thousand Eighty Three Rupees and Twenty One Paise Only");
});

test("cn joins what's truthy", () => {
  expect(cn("a", false, null, "b", ["c", undefined])).toBe("a b c");
});

test("a mobile number reads in two groups; anything else stays as typed", () => {
  expect(mobileText("9829041122")).toBe("98290 41122");
  expect(mobileText(" 6123456789 ")).toBe("61234 56789");
  // a landline, a number with its country code, one already spaced, a short one: as typed
  expect(mobileText("0141 2345678")).toBe("0141 2345678");
  expect(mobileText("01412345678")).toBe("01412345678");
  expect(mobileText("+91 98290 41122")).toBe("+91 98290 41122");
  expect(mobileText("919829041122")).toBe("919829041122");
  expect(mobileText("5123456789")).toBe("5123456789");
  expect(mobileText("98290")).toBe("98290");
  expect(mobileText("")).toBe("");
  expect(mobileText(null)).toBe("");
});
