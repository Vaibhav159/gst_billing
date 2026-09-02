import { describe, expect, it } from "vitest";
import {
  applyRowEdit,
  isInterstate,
  lineTaxable,
  recomputeLine,
  type EditableInvoice,
} from "./importRowEdit";

/** One line of `taxable` at 3%, filed intra or inter. */
function line(taxable: number, interstate = false, gstRate = 3) {
  const tax = +((taxable * gstRate) / 100).toFixed(2);
  const half = +(tax / 2).toFixed(2);
  return {
    qty: 1,
    rate: taxable,
    gstRate,
    amount: +(taxable + tax).toFixed(2),
    cgst: interstate ? 0 : half,
    sgst: interstate ? 0 : +(tax - half).toFixed(2),
    igst: interstate ? tax : 0,
  };
}

function invoice(lines: ReturnType<typeof line>[]): EditableInvoice {
  return {
    items: lines,
    subtotal: +lines.reduce((s, l) => s + lineTaxable(l), 0).toFixed(2),
    totalCGST: +lines.reduce((s, l) => s + l.cgst, 0).toFixed(2),
    totalSGST: +lines.reduce((s, l) => s + l.sgst, 0).toFixed(2),
    totalIGST: +lines.reduce((s, l) => s + l.igst, 0).toFixed(2),
    total: +lines.reduce((s, l) => s + l.amount, 0).toFixed(2),
  };
}

describe("A7 — saving an unchanged row changes nothing", () => {
  it("an interstate invoice keeps its total", () => {
    const before = invoice([line(10000, true)]);
    expect(before.total).toBe(10300);
    const after = applyRowEdit(before, { qty: 1, rate: 10000 });
    expect(after.total).toBe(10300); // the reported bug produced 10600
  });

  it("an intra-state invoice keeps its total", () => {
    const before = invoice([line(10000)]);
    const after = applyRowEdit(before, { qty: 1, rate: 10000 });
    expect(after.total).toBe(before.total);
  });

  it("is idempotent across repeated no-op saves", () => {
    let inv = invoice([line(10000, true)]);
    for (let i = 0; i < 5; i++) inv = applyRowEdit(inv, { qty: 1, rate: 10000 });
    expect(inv.total).toBe(10300);
    expect(inv.subtotal).toBe(10000);
  });

  it("leaves a multi-line invoice's untouched rows alone", () => {
    const before = invoice([line(10000), line(5000)]);
    const after = applyRowEdit(before, { qty: 1, rate: 10000 });
    expect(after.items[1]).toEqual(before.items[1]);
    expect(after.total).toBe(before.total);
  });
});

describe("A7 — tax heads stay on one side", () => {
  it("an interstate row never grows CGST/SGST", () => {
    const after = applyRowEdit(invoice([line(10000, true)]), { qty: 1, rate: 10000 });
    expect(after.items[0].cgst).toBe(0);
    expect(after.items[0].sgst).toBe(0);
    expect(after.items[0].igst).toBe(300);
  });

  it("an intra-state row never grows IGST", () => {
    const after = applyRowEdit(invoice([line(10000)]), { qty: 1, rate: 10000 });
    expect(after.items[0].igst).toBe(0);
    expect(after.items[0].cgst + after.items[0].sgst).toBe(300);
  });

  it("recomputeLine clears the head it is not using", () => {
    const dirty = { ...line(10000), cgst: 150, sgst: 150, igst: 300 }; // all three
    expect(recomputeLine(dirty, true)).toMatchObject({ cgst: 0, sgst: 0, igst: 300 });
    expect(recomputeLine(dirty, false)).toMatchObject({ igst: 0 });
  });

  it("reads the direction off the invoice", () => {
    expect(isInterstate(invoice([line(100, true)]))).toBe(true);
    expect(isInterstate(invoice([line(100)]))).toBe(false);
  });
});

describe("A7 — `amount` stays tax-inclusive and totals stay consistent", () => {
  it("amount is taxable plus its own tax", () => {
    const after = applyRowEdit(invoice([line(10000, true)]), { qty: 1, rate: 10000 });
    const it = after.items[0];
    expect(it.amount).toBe(10300);
    expect(lineTaxable(it)).toBe(10000);
  });

  it("subtotal is taxable, not gross", () => {
    const after = applyRowEdit(invoice([line(10000), line(5000)]), { qty: 1, rate: 10000 });
    expect(after.subtotal).toBe(15000);
  });

  it("the invoice cross-foots", () => {
    const after = applyRowEdit(invoice([line(10000), line(5000)]), { qty: 2, rate: 10000 });
    expect(after.total).toBeCloseTo(
      after.subtotal + after.totalCGST + after.totalSGST + after.totalIGST, 2,
    );
  });

  it("a real edit moves the numbers the right way", () => {
    const after = applyRowEdit(invoice([line(10000, true)]), { qty: 2, rate: 10000 });
    expect(after.subtotal).toBe(20000);
    expect(after.totalIGST).toBe(600);
    expect(after.total).toBe(20600);
  });

  it("odd paise are absorbed once, not twice", () => {
    // 549.67 at 3% = 16.49; halves must sum back to 16.49, not 16.48.
    const after = applyRowEdit(invoice([line(549.67)]), { qty: 1, rate: 549.67 });
    const it = after.items[0];
    expect(+(it.cgst + it.sgst).toFixed(2)).toBe(16.49);
  });
});

describe("A7 follow-up — the row shapes the first fix missed", () => {
  it("keeps the file's tax when the sheet could not resolve a rate", () => {
    // No GST Rate column and a commodity not in the master: gstRate is 0 but
    // the file still said CGST 150 / SGST 150. An unchanged save used to zero it.
    const before = invoice([{ ...line(10000), gstRate: 0 }]);
    const after = applyRowEdit(before, { qty: 1, rate: 10000 });
    expect(after.total).toBe(10300);
    expect(after.items[0].gstRate).toBe(3); // inferred from its own heads
  });

  it("keeps an amount-only row's taxable value (qty 0, rate 0)", () => {
    const before = invoice([{ ...line(10000), qty: 0, rate: 0 }]);
    const after = applyRowEdit(before, { qty: 0, rate: 0 });
    expect(after.subtotal).toBe(10000);
    expect(after.total).toBe(10300);
  });

  it("a genuinely zero-tax line stays zero", () => {
    const zero = { qty: 1, rate: 5000, gstRate: 0, amount: 5000, cgst: 0, sgst: 0, igst: 0 };
    const after = applyRowEdit(invoice([zero]), { qty: 1, rate: 5000 });
    expect(after.total).toBe(5000);
    expect(after.items[0].gstRate).toBe(0);
  });
});
