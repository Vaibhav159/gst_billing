import type { RatesData } from '@/core/api/dashboard';
import { rateKey } from '@/core/rates/model';
import { rateNote } from '@/core/rates/slip';
import type { FormLine } from '@/pages/sales/form/model';
import type { SaleProduct } from '@/pages/sales/form/products';
import type { LineNotice } from './BillItems';
import { easyRateSlip } from './rates';

export type BillRateNotices = {
  references: Record<string, string>;
  notices: Record<string, LineNotice[]>;
  ratesByLine: Record<string, ReturnType<typeof easyRateSlip>>;
};

/** Presentation of the shared dated board: no request, key inference, slip maths or mutation. */
export function billRateNotices(lines: FormLine[], products: SaleProduct[] | undefined,
  rates: RatesData | undefined, chosenDate: string): BillRateNotices {
  const result: BillRateNotices = { references: {}, notices: {}, ratesByLine: {} };
  const board = rates?.in_force;
  if (!chosenDate || !rates || !board || board.on > chosenDate) return result;
  for (const line of lines) {
    if (line.custom || !['g', 'gms'].includes(line.unit)) continue;
    const matches = products?.filter((p) => line.productId !== null ? p.id === line.productId : p.name === line.name) ?? [];
    if (matches.length !== 1) continue;
    const product = matches[0];
    const key = rateKey(product);
    if (!key || !board.per_gram[key]) continue;
    result.references[line.key] = rateNote(board, key, chosenDate, rates.today);
    const slip = easyRateSlip({ product, board, unit: line.unit, rate: line.rate, name: line.name });
    result.ratesByLine[line.key] = slip;
    if (slip) result.notices[line.key] = [{ text: slip.text, field: 'rate', fix: { label: slip.label, patch: { rate: slip.fix } } }];
  }
  return result;
}
