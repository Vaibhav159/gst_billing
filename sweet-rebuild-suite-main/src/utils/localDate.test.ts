import { describe, it, expect, afterEach, vi } from "vitest";
import { toLocalDateString, todayLocal, fyBounds, fyMonthBounds } from "./localDate";

// The bug these replace: a local-midnight Date serialized through UTC.
const viaUtc = (d: Date) => d.toISOString().split("T")[0];

afterEach(() => vi.useRealTimers());

describe("fyBounds (A5)", () => {
  it("FY 2026-27 runs 1 April to 31 March", () => {
    expect(fyBounds(2026)).toEqual({ start: "2026-04-01", end: "2027-03-31" });
  });

  it("does not lose 31 March, the heaviest invoicing day of the year", () => {
    expect(fyBounds(2026).end).toBe("2027-03-31");
    // what shipped, under IST:
    expect(viaUtc(new Date(2027, 2, 31))).toBe("2027-03-30");
  });

  it("does not include the prior FY's closing day", () => {
    expect(fyBounds(2026).start).toBe("2026-04-01");
    expect(viaUtc(new Date(2026, 3, 1))).toBe("2026-03-31");
  });

  it("holds across many years", () => {
    for (let y = 2020; y <= 2030; y++) {
      expect(fyBounds(y)).toEqual({ start: `${y}-04-01`, end: `${y + 1}-03-31` });
    }
  });
});

describe("fyMonthBounds (A5)", () => {
  it("March of FY 2026-27 is the whole of March 2027", () => {
    // The audit's worst case: this used to request 2027-02-28 .. 2027-03-30,
    // dropping both the 1st and the 31st while pulling in 28 February.
    expect(fyMonthBounds(2026, 3)).toEqual({ start: "2027-03-01", end: "2027-03-31" });
  });

  it("April belongs to the FY's first calendar year", () => {
    expect(fyMonthBounds(2026, 4)).toEqual({ start: "2026-04-01", end: "2026-04-30" });
  });

  it("Jan-Mar roll into the FY's second calendar year", () => {
    expect(fyMonthBounds(2026, 1).start).toBe("2027-01-01");
    expect(fyMonthBounds(2026, 12).start).toBe("2026-12-01");
  });

  it("gets month lengths right, including February", () => {
    expect(fyMonthBounds(2026, 2).end).toBe("2027-02-28");
    expect(fyMonthBounds(2023, 2).end).toBe("2024-02-29"); // leap
    expect(fyMonthBounds(2026, 9).end).toBe("2026-09-30");
    expect(fyMonthBounds(2026, 5).end).toBe("2026-05-31");
  });

  it("every month starts on the 1st", () => {
    for (let m = 1; m <= 12; m++) {
      expect(fyMonthBounds(2026, m).start.endsWith("-01")).toBe(true);
    }
  });

  it("consecutive months do not overlap or leave gaps", () => {
    for (let m = 4; m <= 11; m++) {
      const end = new Date(`${fyMonthBounds(2026, m).end}T00:00:00`);
      const nextStart = new Date(`${fyMonthBounds(2026, m + 1).start}T00:00:00`);
      expect((nextStart.getTime() - end.getTime()) / 86400000).toBe(1);
    }
  });
});

describe("todayLocal (A10)", () => {
  it("is the local date, not the UTC one, at 01:00 IST", () => {
    // 2026-04-01T01:00 IST is still 2026-03-31 in UTC.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 1, 1, 0, 0));
    expect(todayLocal()).toBe("2026-04-01");
  });

  it("agrees with the clock at midday", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 1, 12, 0, 0));
    expect(todayLocal()).toBe("2026-04-01");
  });

  it("never drifts across a whole year of local midnights", () => {
    vi.useFakeTimers();
    const d = new Date(2026, 0, 1, 0, 30, 0);
    for (let i = 0; i < 365; i++) {
      vi.setSystemTime(d);
      expect(todayLocal()).toBe(toLocalDateString(d));
      d.setDate(d.getDate() + 1);
    }
  });
});

describe("toLocalDateString", () => {
  it("zero-pads month and day", () => {
    expect(toLocalDateString(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("does not shift a local-midnight date", () => {
    expect(toLocalDateString(new Date(2026, 3, 1))).toBe("2026-04-01");
  });
});
