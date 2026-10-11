/** Rule 88A mirror of billing.tax_rules.set_off, fixed by Ruling 3-D5.
 * All figures are whole paise. Shared vectors bind both implementations. */
export type GstHead = "igst" | "cgst" | "sgst";
export type GstHeads = Record<GstHead, number>;
export type SetOffStep = { from: GstHead; to: GstHead; amount: number };
export type SetOff = { used: SetOffStep[]; cash: GstHeads; carry: GstHeads; cashTotal: number; carryTotal: number };

export const ZERO_HEADS: Readonly<GstHeads> = Object.freeze({ igst: 0, cgst: 0, sgst: 0 });
export function headsTotal(heads: GstHeads): number { return heads.igst + heads.cgst + heads.sgst; }
export function addHeads(a: GstHeads, b: GstHeads): GstHeads {
  return { igst: a.igst + b.igst, cgst: a.cgst + b.cgst, sgst: a.sgst + b.sgst };
}

/** Use IGST first, fill local shortages, then balance carry; local heads never cross. */
export function setOff(output: GstHeads, credit: GstHeads): SetOff {
  const cash = addHeads(ZERO_HEADS, output), carry = addHeads(ZERO_HEADS, credit);
  const used: SetOffStep[] = [];
  const use = (from: GstHead, to: GstHead, want = Infinity) => {
    const amount = Math.min(want, carry[from], cash[to]);
    if (amount <= 0) return;
    carry[from] -= amount;
    cash[to] -= amount;
    const existing = used.find((step) => step.from === from && step.to === to);
    if (existing) existing.amount += amount;
    else used.push({ from, to, amount });
  };
  use("igst", "igst");
  if (carry.igst > 0) {
    use("igst", "cgst", Math.max(0, cash.cgst - carry.cgst));
    use("igst", "sgst", Math.max(0, cash.sgst - carry.sgst));
    if (carry.igst > 0) {
      const room = Math.min(carry.igst, cash.cgst + cash.sgst);
      const carryC = carry.cgst - cash.cgst, carryS = carry.sgst - cash.sgst;
      let toC = Math.max(0, Math.min(cash.cgst, room, Math.floor((carryS - carryC + room + 1) / 2)));
      const toS = Math.min(cash.sgst, room - toC);
      toC = Math.min(cash.cgst, room - toS);
      use("igst", "cgst", toC);
      use("igst", "sgst", toS);
    }
  }
  use("cgst", "cgst");
  use("cgst", "igst");
  use("sgst", "sgst");
  use("sgst", "igst");
  return { used, cash, carry, cashTotal: headsTotal(cash), carryTotal: headsTotal(carry) };
}
