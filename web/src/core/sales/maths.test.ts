import { toPaise } from "@/core/format";
import { billFigures, lineFigures, payableOf, roundOffOf, scaled, taxFor, taxSlips } from "./maths";
import vectors from "./maths.vectors.json";

const p = (s: string) => toPaise(s) as number;

test.each(vectors.lines)("a line of $quantity at $rate and $gst_percent% (inter-state: $interstate) comes to the server's paisa", (v) => {
  expect(lineFigures(v, v.interstate)).toEqual({ taxable: p(v.taxable), cgst: p(v.cgst), sgst: p(v.sgst), igst: p(v.igst), tax: p(v.tax), amount: p(v.amount) });
});

test.each(vectors.bills)("a bill, $name, sums its lines and its slabs, highest first", (v) => {
  const b = billFigures(v.lines, v.interstate);
  expect({ taxable: b.taxable, cgst: b.cgst, sgst: b.sgst, igst: b.igst, tax: b.tax, total: b.total, payable: b.payable, round_off: b.round_off })
    .toEqual({ taxable: p(v.taxable), cgst: p(v.cgst), sgst: p(v.sgst), igst: p(v.igst), tax: p(v.tax), total: p(v.total), payable: p(v.payable), round_off: p(v.round_off) });
  expect(b.slabs).toEqual(v.slabs.map((s) => ({ gst_percent: s.gst_percent, taxable: p(s.taxable), cgst: p(s.cgst), sgst: p(s.sgst), igst: p(s.igst), tax: p(s.tax) })));
  expect(b.pending).toBe(0);
});

test.each(vectors.payable)("$total is payable as $payable, rounding by $round_off", (v) => {
  expect(payableOf(p(v.total))).toBe(p(v.payable));
  expect(roundOffOf(p(v.total))).toBe(p(v.round_off));
});

test("a line still being typed isn't worked out, and the bill counts it as pending", () => {
  expect(lineFigures({ quantity: "", rate: "6512.50", gst_percent: "3" }, false)).toBeNull();
  expect(lineFigures({ quantity: "4.5", rate: "abc", gst_percent: "3" }, false)).toBeNull();
  const b = billFigures([{ quantity: "1", rate: "100", gst_percent: "3" }, { quantity: ".", rate: "100", gst_percent: "3" }], false);
  expect(b.pending).toBe(1);
  expect(b.total).toBe(10300);
});

test("scaled reads decimals exactly, numbers too, and rounds a fourth place half-up", () => {
  expect(scaled("12.345", 3)).toBe(12345n);
  expect(scaled(12.345, 3)).toBe(12345n);
  expect(scaled("6512.5", 3)).toBe(6512500n);
  expect(scaled("3", 2)).toBe(300n);
  expect(scaled("0.25", 2)).toBe(25n);
  expect(scaled("1.0005", 3)).toBe(1001n);
  expect(scaled("-1", 3)).toBeNull();
  expect(scaled("1e3", 3)).toBeNull();
});

test("taxFor and taxSlips name a line whose stored tax isn't what its rate gives, beyond a paisa", () => {
  expect(taxFor(54967, "3")).toBe(1649);
  expect(taxSlips([
    { taxable: 54967, tax: 1649, gst_percent: "3" },
    { taxable: 54967, tax: 1650, gst_percent: "3" },
    { taxable: 100000, tax: 3200, gst_percent: "3" },
  ])).toEqual([{ index: 2, want: 3000, got: 3200 }]);
});
