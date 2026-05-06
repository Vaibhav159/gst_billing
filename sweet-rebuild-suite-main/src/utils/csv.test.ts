import { describe, it, expect } from "vitest";
import { csvCell, toCSV } from "./csv";

describe("csvCell", () => {
  it("returns plain string as-is", () => {
    expect(csvCell("hello")).toBe("hello");
  });

  it("wraps string with commas in quotes", () => {
    expect(csvCell("hello, world")).toBe('"hello, world"');
  });

  it("escapes double quotes inside value", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("wraps string with newlines in quotes", () => {
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("handles numbers", () => {
    expect(csvCell(42)).toBe("42");
  });

  it("handles null and undefined", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("handles zero", () => {
    expect(csvCell(0)).toBe("0");
  });
});

describe("toCSV", () => {
  it("converts simple rows to CSV", () => {
    const result = toCSV([["a", "b"], ["1", "2"]]);
    expect(result).toBe("a,b\n1,2");
  });

  it("escapes values with commas", () => {
    const result = toCSV([["Name", "Address"], ["John", "123, Main St"]]);
    expect(result).toBe('Name,Address\nJohn,"123, Main St"');
  });

  it("handles empty rows", () => {
    expect(toCSV([])).toBe("");
  });

  it("handles mixed types", () => {
    const result = toCSV([["Item", "Qty", "Rate"], ["Gold", 5.25, 6500]]);
    expect(result).toBe("Item,Qty,Rate\nGold,5.25,6500");
  });
});
