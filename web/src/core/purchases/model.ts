import { fyOf, groupIN } from '@/core/format';
import { scaled } from '@/core/sales/maths';
import { SLABS } from '@/core/sales/slabs';
import type { SupplierRef, UsualRate } from './types';
export { SLABS as PURCHASE_SLABS } from '@/core/sales/slabs';

/** Supplier numbers ignore punctuation except between digits: 12-3 and 1-23 remain different. */
export function inwardKey(number: string): string {
  let out = '', gap = false;
  for (const ch of number.toUpperCase()) {
    if (/[0-9A-Z]/.test(ch)) { if (gap && /\d/.test(ch) && /\d$/.test(out)) out += '-'; out += ch; gap = false; }
    else gap = true;
  }
  return out;
}
export function duplicateKey(p: { business: number; supplier: Pick<SupplierRef, 'id' | 'gst_number'>; invoice_number: string; invoice_date: string }): string {
  return `${p.business}|${p.supplier.gst_number ? `g:${p.supplier.gst_number.trim().toUpperCase()}` : `id:${p.supplier.id}`}|${inwardKey(p.invoice_number)}|${fyOf(p.invoice_date)}`;
}
/** Explicit percentages win over fractional rates, so 0.25 is 0.25%, never 25%. Unknown and blank stay unchosen. */
export function slabFrom(raw: unknown): string | null {
  if (raw == null) return null;
  const text = String(raw).trim().replace(/\s/g, '').replace(/%$/, '');
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const n = Number(text), close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  return SLABS.find((s) => close(Number(s), n)) ?? SLABS.find((s) => close(Number(s), n * 100)) ?? null;
}
// These dates explain credit choices; the server alone decides locks, defaults, eligibility and lapsed credit.
export const creditDeadline = (invoiceDate: string): string => `${Number(fyOf(invoiceDate).slice(0, 4)) + 1}-11-30`;
export const lastCreditMonth = (invoiceDate: string): string => `${Number(fyOf(invoiceDate).slice(0, 4)) + 1}-10`;
/** A rate as typed, to its last decimal: 6878.012 stays ₹6,878.012, never rounded to paise. */
function rateWords(rate: string): string {
  const [whole, frac = ''] = rate.trim().split('.');
  return `₹${groupIN(Number(whole))}.${frac.replace(/0+$/, '').padEnd(2, '0')}`;
}
export function rateCheck({ rate, unit, name, usual }: { rate: string; unit: string; name: string; usual: UsualRate | null | undefined }): { x: number; text: string; fix: { rate: string; label: string; why: string } | null } | null {
  const entered = scaled(rate, 3), normal = usual?.rate ? scaled(usual.rate, 3) : null;
  if (!entered || !normal || !usual) return null;
  const x = Number(entered) / Number(normal);
  if (x < 5 && x > 0.2) return null;
  const per = x >= 5 ? [10, 100, 1000].find((k) => Math.abs(x / k - 1) < 0.3) : undefined;
  const where = usual.from === 'them' ? 'what you usually pay them' : 'what you usually pay';
  let fix = null;
  if (per) {
    const rounded = (2n * entered + BigInt(per)) / (2n * BigInt(per));
    const fixed = `${rounded / 1000n}.${String(rounded % 1000n).padStart(3, '0')}`;
    const perWord = per === 1000 && ['g', 'gms'].includes(unit) ? 'kg' : `${per} ${unit}`;
    fix = { rate: fixed, label: `Use ${rateWords(fixed)}/${unit}`, why: `the rate per ${perWord}` };
  }
  return { x, text: `${rateWords(rate)}/${unit} is about ${x >= 5 ? `${Math.round(x)} times` : `1/${Math.round(1 / x)} of`} ${where} for ${name} (${rateWords(usual.rate ?? '')}/${unit}). Check the item and the rate.`, fix };
}
