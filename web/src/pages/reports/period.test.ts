import { describe, expect, it } from "vitest";
import { periodRange, periodChoices, rangeProblems, resolvePeriod, reportPeriodKey } from "./period";

describe("report periods in IST", () => {
  it("keeps 31 March and leap day without constructing UTC dates", () => {
    expect(periodRange("2025-26", "q4", "2026-10-08")).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(periodRange("2023-24", "fy", "2026-10-08")).toEqual({ from: "2023-04-01", to: "2024-03-31" });
    expect(periodRange("2023-24", "last", "2024-03-01")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });
  it("offers current presets and past quarters, and defaults month by month to FY", () => {
    expect(periodChoices("2026-27", "2026-10-08").map(x => x.value)).toEqual(["month", "last", "quarter", "fy", "custom"]);
    expect(periodChoices("2025-26", "2026-10-08").map(x => x.value)).toEqual(["fy", "q1", "q2", "q3", "q4", "custom"]);
    expect(resolvePeriod(null, "months", "2026-27", "2026-10-08")).toEqual({ p: "fy", from: "2026-04-01", to: "2026-10-08" });
    expect(resolvePeriod(null, "sales", "2026-27", "2026-10-08")).toEqual({ p: "last", from: "2026-09-01", to: "2026-09-30" });
    expect(resolvePeriod({ p: "q4" }, "sales", "2026-27", "2026-10-08").p).toBe("last");
  });
  it("allows cross-FY ranges down to April 2022 and rejects exact boundary errors", () => {
    expect(rangeProblems("2022-04-01", "2026-03-31", "2026-10-08")).toEqual({});
    expect(rangeProblems("2022-03-31", "2026-10-09", "2026-10-08")).toEqual({ from: "The app goes back to 01 Apr 2022. Pick that day or later.", to: "That's after today. Pick 08 Oct 2026 or earlier." });
    expect(rangeProblems("2026-06-01", "2026-05-31", "2026-10-08")).toEqual({ to: "The range ends before it starts (01 Jun 2026). Pick a later end date." });
    expect(rangeProblems("", "", "2026-10-08")).toEqual({ from: "Pick the first day of the range.", to: "Pick the last day of the range." });
    expect(rangeProblems("2026-02-30", "2026-10-08", "2026-10-08").from).toBe("Pick the first day of the range.");
  });
  it("rejects malformed stored periods and keys storage by viewer", () => {
    expect(resolvePeriod({ p: "custom", from: "2026-01-01", to: "2026-10-09" }, "sales", "2026-27", "2026-10-08").p).toBe("last");
    expect(resolvePeriod({ p: "custom", from: "2025-03-31", to: "2025-04-02" }, "sales", "2026-27", "2026-10-08").p).toBe("custom");
    expect(reportPeriodKey(3)).not.toBe(reportPeriodKey(4));
  });
});
