import rows from './rows.json';
import type { Board, RateRow, RatesData } from '@/core/api/dashboard';
export type { Board, RateRow } from '@/core/api/dashboard';
export type Rates = RatesData;
export type RateKey = 'gold-24K' | 'gold-22K' | 'gold-18K' | 'silver-999' | 'silver-925';
export const RATE_ROWS = rows as (RateRow & { key: RateKey })[];
export type Quoted = Board['quoted'];
export type QuoteInput = Record<string, number | null>;
/** Accept the shared product mapper's output; never infer kind from a name or HSN. */
export function rateKey(product: unknown): RateKey | null {
  if (!product || typeof product !== 'object' || !('kind_effective' in product) || !('purity' in product)) return null;
  const key = `${product.kind_effective}-${product.purity}`;
  return RATE_ROWS.find(r => r.key === key)?.key ?? null;
}
/** Three-place rupee rate from a non-negative integer count of milli-rupees. */
export function milliText(n: bigint): string { return `${n / 1000n}.${String(n % 1000n).padStart(3, '0')}`; }
/** Preview only: quotes stay in paise and the server supplies the saved per_gram. */
export function perGram(paise: number, per: number): string {
  const n = BigInt(paise) * 10n, d = BigInt(per);
  return milliText((2n * n + d) / (2n * d));
}
export function quotedErrors(values: QuoteInput): Partial<Record<RateKey, string>> {
  return Object.fromEntries(RATE_ROWS.flatMap(r => {
    const n = values[r.key];
    const error = n == null ? `Type the ${r.label} rate per ${r.per_label}.`
      : !Number.isSafeInteger(n) || n <= 0 ? "That's not an amount."
        : n > 999999999 ? `That's more than ₹99,99,999.99 per ${r.per_label}.` : '';
    return error ? [[r.key, error]] : [];
  }));
}
export function changed(values: QuoteInput, latest: Board | null): boolean {
  return !latest || RATE_ROWS.some(r => values[r.key] !== latest.quoted[r.key]);
}
export function moved(values: QuoteInput, latest: Board | null): RateKey[] {
  return latest ? RATE_ROWS.filter(r => {
    const n = values[r.key], old = latest.quoted[r.key];
    return n != null && Number.isSafeInteger(n) && old > 0 && Math.abs(n - old) * 5 > old;
  }).map(r => r.key) : [];
}
