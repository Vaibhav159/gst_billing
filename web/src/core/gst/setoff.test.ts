import { addHeads, headsTotal, setOff, ZERO_HEADS } from "./setoff";
import vectors from "./setoff.vectors.json";

const HEADS = ["igst", "cgst", "sgst"] as const;

test("one shared vector list retains all 8 server and 23 client cases", () => {
  expect(Array.isArray(vectors)).toBe(true);
  expect(vectors).toHaveLength(31);
  expect(new Set(vectors.map(({ name }) => name)).size).toBe(31);
  for (const { output, credit, expected } of vectors) {
    expect(Object.keys(expected).sort()).toEqual(["carry_on", "cash", "steps", "used"]);
    for (const heads of [output, credit, expected.used, expected.cash, expected.carry_on]) {
      expect(Object.keys(heads).sort()).toEqual(["cgst", "igst", "sgst", "total"]);
      expect(Object.values(heads).every((amount) => Number.isSafeInteger(amount) && amount >= 0)).toBe(true);
      expect(heads.total).toBe(headsTotal(heads));
    }
  }
});

test.each(vectors)("Rule 88A: $name", ({ output, credit, expected }) => {
  const result = setOff(output, credit);
  // The shared server shape reports credit consumed by source head; the client
  // result keeps ordered transfers in used. Adapt the result, never the oracle.
  const used = {
    igst: credit.igst - result.carry.igst,
    cgst: credit.cgst - result.carry.cgst,
    sgst: credit.sgst - result.carry.sgst,
  };
  expect({
    steps: result.used,
    used: { ...used, total: headsTotal(used) },
    cash: { ...result.cash, total: result.cashTotal },
    carry_on: { ...result.carry, total: result.carryTotal },
  }).toEqual(expected);
});

test("set-off leaves its input heads unchanged", () => {
  const output = Object.freeze({ igst: 100, cgst: 200, sgst: 300 });
  const credit = Object.freeze({ igst: 600, cgst: 30, sgst: 40 });
  setOff(output, credit);
  expect(output).toEqual({ igst: 100, cgst: 200, sgst: 300 });
  expect(credit).toEqual({ igst: 600, cgst: 30, sgst: 40 });
});

test("every combination of 0 to 3 paise conserves heads and uses minimum legal cash", () => {
  // 4^6 cases. This independent closed-form cash bound treats unused IGST
  // credit as fungible only after IGST output has been paid first.
  const failures: unknown[] = [];
  for (let n = 0; n < 4096; n++) {
    const values = Array.from({ length: 6 }, (_, place) => Math.floor(n / 4 ** place) % 4);
    const output = { igst: values[0], cgst: values[1], sgst: values[2] };
    const credit = { igst: values[3], cgst: values[4], sgst: values[5] };
    const result = setOff(output, credit);
    const igstAfterOwn = Math.max(0, output.igst - credit.igst);
    const igstCreditLeft = Math.max(0, credit.igst - output.igst);
    const localShortage = Math.max(0, output.cgst - credit.cgst) + Math.max(0, output.sgst - credit.sgst);
    const localCreditLeft = Math.max(0, credit.cgst - output.cgst) + Math.max(0, credit.sgst - output.sgst);
    const minimumCash = Math.max(0, igstAfterOwn - localCreditLeft) + Math.max(0, localShortage - igstCreditLeft);
    const legal = !result.used.some(({ from, to }) => (from === "cgst" && to === "sgst") || (from === "sgst" && to === "cgst"));
    const conserved = HEADS.every((head) => {
      const spent = result.used.filter((step) => step.from === head).reduce((sum, step) => sum + step.amount, 0);
      const paid = result.used.filter((step) => step.to === head).reduce((sum, step) => sum + step.amount, 0);
      return spent + result.carry[head] === credit[head]
        && paid + result.cash[head] === output[head]
        && Number.isSafeInteger(result.cash[head]) && result.cash[head] >= 0
        && Number.isSafeInteger(result.carry[head]) && result.carry[head] >= 0;
    });
    const totals = result.cashTotal === headsTotal(result.cash) && result.carryTotal === headsTotal(result.carry);
    const positiveSteps = result.used.every(({ amount }) => Number.isSafeInteger(amount) && amount > 0);
    const uniqueSteps = new Set(result.used.map(({ from, to }) => `${from}:${to}`)).size === result.used.length;
    if (result.cashTotal !== minimumCash || !legal || !conserved || !totals || !positiveSteps || !uniqueSteps) {
      failures.push({ output, credit, result, minimumCash, legal, conserved, totals, positiveSteps, uniqueSteps });
    }
  }
  expect(failures).toEqual([]);
});

test("head helpers add paise without changing the frozen zero heads", () => {
  expect(addHeads(ZERO_HEADS, { igst: 1, cgst: 2, sgst: 3 })).toEqual({ igst: 1, cgst: 2, sgst: 3 });
  expect(headsTotal({ igst: 1, cgst: 2, sgst: 3 })).toBe(6);
  expect(Object.isFrozen(ZERO_HEADS)).toBe(true);
});

test("contract heads with a total do not leak a stale total into the result", () => {
  const output = { igst: 10, cgst: 20, sgst: 30, total: 60 };
  const credit = { igst: 10, cgst: 20, sgst: 30, total: 60 };
  expect(setOff(output, credit)).toEqual({
    used: [
      { from: "igst", to: "igst", amount: 10 },
      { from: "cgst", to: "cgst", amount: 20 },
      { from: "sgst", to: "sgst", amount: 30 },
    ],
    cash: { igst: 0, cgst: 0, sgst: 0 },
    carry: { igst: 0, cgst: 0, sgst: 0 },
    cashTotal: 0,
    carryTotal: 0,
  });
});
