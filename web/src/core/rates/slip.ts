import { dateShort } from '@/core/format';
import { scaled } from '@/core/sales/maths';
import { rateText, timeOf } from '@/core/sales/words';
import { milliText, RATE_ROWS, rateKey, type Board, type RateKey } from './model';
export type RateSlip = { text: string; fix: string; label: string };
export function rateSlip({ product, unit, rate, board, easy = false }: {
  product: unknown; unit: string; rate: string; board: Board | null; easy?: boolean;
}): RateSlip | null {
  const key = rateKey(product);
  if (!key || !board || !['g', 'gms'].includes(unit)) return null;
  const typed = scaled(rate, 3), reference = scaled(board.per_gram[key], 3);
  if (!typed || !reference) return null;
  const row = RATE_ROWS.find(r => r.key === key)!;
  const metal = row.label.replace(/^Gold/, 'gold').replace(/^Silver/, 'silver');
  const per = easy ? 'Rates here are per gram' : 'Rates are per gram';
  let text: string, n = typed, d = 1n;
  if (typed >= reference * 8n && typed <= reference * 12n) {
    text = `That's about 10 times the board's rate for ${metal} (${rateText(board.per_gram[key])} a gram). ${per}, not per 10 grams.`; d = 10n;
  } else if (typed >= reference * 800n && typed <= reference * 1200n) {
    text = `That's about 1,000 times the board's rate for ${metal} (${rateText(board.per_gram[key])} a gram). ${per}, not per kg.`; d = 1000n;
  } else if (key.startsWith('gold-') && typed * 100n >= reference * 8n && typed * 100n <= reference * 12n) {
    text = `That's about a tenth of the board's rate for ${metal} (${rateText(board.per_gram[key])} a gram). ${easy ? 'Rates here are per gram. Check the rate is for one gram.' : 'Check the rate is for one gram.'}`; n *= 10n;
  } else return null;
  const fix = milliText((2n * n + d) / (2n * d));
  return { text, fix, label: `Use ${rateText(fix)}` };
}
export function rateNote(board: Board | null, key: RateKey | null, date: string, today: string): string {
  if (!board || !key || board.on > date) return '';
  const amount = `${rateText(board.per_gram[key])} a gram`;
  if (date === today && board.on === today) {
    const name = board.set_by?.name.trim().split(/\s+/)[0];
    return `Today's board: ${amount} · set ${timeOf(board.set_at)}${name ? ` by ${name}` : ''}`;
  }
  return `Board ${board.on === date ? 'on' : 'of'} ${dateShort(board.on)}: ${amount}`;
}
