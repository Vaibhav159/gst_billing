import { toPaise } from '@/core/format';
/** Contract money fields; numeric counts, rates and quantities stay untouched. */
const MONEY = new Set(['igst','cgst','sgst','total','taxable','tax','total_amount','value','amount','cash_total','cash_diff','taxable_diff','tax_diff','fee','cap','per_day','interest','interest_on','late_fee','paid_amount','left_amount','inter','intra']);
export function readGst<T>(value: unknown): T {
  const visit = (v: unknown, key = ''): unknown => {
    if (typeof v === 'string' && MONEY.has(key)) {
      const p = toPaise(v);
      if (p === null || !Number.isSafeInteger(p)) throw new Error('The return contains an amount the app cannot read.');
      return p;
    }
    if (Array.isArray(v)) return v.map(x => visit(x));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, visit(x, k)]));
    return v;
  };
  return visit(value) as T;
}
