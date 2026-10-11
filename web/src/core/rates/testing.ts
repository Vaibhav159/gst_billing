// Synthetic contract fixtures; nothing in the app imports this module.
import { RATE_ROWS, type Board, type Rates } from './model';
export type WireBoard = Omit<Board, 'quoted'> & { quoted: Record<string, string> };
export type WireRates = Omit<Rates, 'latest' | 'previous' | 'in_force'> & { latest: WireBoard | null; previous: WireBoard | null; in_force?: WireBoard | null };
export function wireBoard(over: Partial<WireBoard> = {}): WireBoard {
  return { id: 41, on: '2026-10-12', set_at: '2026-10-12T10:05:12.204311+05:30', set_by: { id: 1, name: 'Kailash Mehta' },
    quoted: { 'gold-24K': '71040.00', 'gold-22K': '65125.00', 'gold-18K': '53280.00', 'silver-999': '78500.00', 'silver-925': '72610.00' },
    per_gram: { 'gold-24K': '7104.000', 'gold-22K': '6512.500', 'gold-18K': '5328.000', 'silver-999': '78.500', 'silver-925': '72.610' }, ...over };
}
export function wireRates(over: Partial<WireRates> = {}): WireRates {
  return { today: '2026-10-12', rows: RATE_ROWS, latest: wireBoard(), previous: wireBoard({ id: 40, on: '2026-10-07', set_at: '2026-10-07T10:12:00+05:30' }), set_today: true, ...over };
}
