import { describe, it, expect } from "vitest";
import { normalizeDate } from "./parseInvoiceExcel";

describe("normalizeDate", () => {
  it("converts DD-MM-YYYY to YYYY-MM-DD", () => {
    expect(normalizeDate("15-03-2026")).toBe("2026-03-15");
  });

  it("converts DD/MM/YYYY to YYYY-MM-DD", () => {
    expect(normalizeDate("01/12/2025")).toBe("2025-12-01");
  });

  it("returns YYYY-MM-DD as-is", () => {
    expect(normalizeDate("2026-04-10")).toBe("2026-04-10");
  });

  it("handles single-digit day and month", () => {
    expect(normalizeDate("5-3-2026")).toBe("2026-03-05");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeDate("")).toBe("");
  });
});
