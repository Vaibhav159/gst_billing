import { toBoard as boardOf } from '@/core/dashboard/wire';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ratesKeys } from '@/core/api/dashboard';

import { renderApp } from '@/test/render';
import { serve } from '@/test/server';
import { pass } from '@/test/clock';
import { RatesCard } from './RatesCard';
import { RatesSheet } from './RatesSheet';
import { wireBoard, wireRates } from './testing';
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); Object.defineProperty(navigator, 'onLine', { configurable: true, value: true }); });
async function sheet(over = wireRates(), post: Parameters<typeof serve>[0]['POST rates/'] = () => ({ status: 201, data: wireBoard({ id: 42 }) })) {
  const calls = serve({ 'GET rates/': over, 'POST rates/': post }); const close = vi.fn();
  renderApp(<RatesSheet open onClose={close} />); await pass(); await pass(400); return { calls, close };
}
const field = (name = 'Gold 22K (916) per 10 g') => screen.getByLabelText(name);
const type = (value: string) => fireEvent.change(field(), { target: { value } });
const posts = (calls: ReturnType<typeof serve>) => calls.filter(c => c.method === 'POST');
test.each(['card', 'easy', 'strip'] as const)('%s shows quiet unset copy and the right rows', async variant => {
  serve({ 'GET rates/': wireRates({ set_today: false, latest: wireBoard({ on: '2026-10-07', set_at: '2026-10-07T10:12:00+05:30' }) }) });
  (window as unknown as { __phone: boolean }).__phone = variant !== 'card'; renderApp(<RatesCard variant={variant} />, { path: variant === 'easy' ? '/e' : '/' }); await pass();
  expect(screen.getByText('Not set today · last set 07 Oct at 10:12')).toBeInTheDocument();
  expect(screen.getByText('Gold 22K')).toBeInTheDocument(); expect(screen.getByText('Silver 999')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(screen.queryByText('Gold 24K') !== null).toBe(variant !== 'strip');
});
test('no board shows Not set, never invented zeros, and opens the sheet', async () => {
  serve({ 'GET rates/': wireRates({ latest: null, previous: null, set_today: false }) }); renderApp(<RatesCard />); await pass();
  expect(screen.getAllByText('Not set')).toHaveLength(5); expect(screen.queryByText('₹0.00')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: "Set today's rates" })); await pass(); await pass(400); expect(screen.getByRole('dialog', { name: "Today's rates" })).toBeInTheDocument();
});
test.each(['accountant', 'viewer'] as const)('%s cannot open sheet or save', async role => {
  const calls = serve({ 'GET rates/': wireRates() }); renderApp(<><RatesCard variant="strip" /><RatesSheet open onClose={vi.fn()} /></>, { me: { role, permissions: ['view'] } }); await pass();
  const strip = screen.getByRole('button'); expect(strip).toHaveAttribute('aria-disabled', 'true'); fireEvent.click(strip); await pass();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(posts(calls)).toHaveLength(0);
});
test('counter staff can set rates', async () => {
  serve({ 'GET rates/': wireRates() }); renderApp(<RatesCard />, { me: { role: 'staff', permissions: ['view', 'rates.edit'] } }); await pass();
  fireEvent.click(screen.getByRole('button', { name: 'Change' })); await pass(); await pass(400); expect(screen.getByRole('dialog')).toBeInTheDocument();
});
test('latest quote prefill and earlier-day history; unchanged today is not posted', async () => {
  const { calls } = await sheet(); expect(field()).toHaveValue('65,125.00');
  expect(screen.getByText('07 Oct: Gold 22K ₹65,125.00 per 10 g · Silver 999 ₹78,500.00 per kg')).toBeInTheDocument();
  const save = screen.getByRole('button', { name: "Save today's rates" }); expect(save).toBeDisabled(); fireEvent.click(save); await pass(); expect(posts(calls)).toHaveLength(0);
});
test('same earlier-day quotes can establish today; success copy does not promise prefills', async () => {
  const { calls, close } = await sheet(wireRates({ set_today: false, latest: wireBoard({ on: '2026-10-07' }) }));
  fireEvent.click(screen.getByRole('button', { name: "Save today's rates" })); await pass();
  expect(posts(calls)[0].data).toEqual({ quoted: wireBoard().quoted }); expect(close).toHaveBeenCalledOnce();
  expect(screen.getByText("Today's rates are set")).toBeInTheDocument(); expect(screen.getByText("The board shows these until they're changed.")).toBeInTheDocument();
});
test('more than a fifth asks once, an edit resets it, repeated save posts once', async () => {
  const { calls } = await sheet(); type('80000'); fireEvent.click(screen.getByRole('button', { name: "Save today's rates" })); await pass();
  expect(screen.getByText('1 rate moved more than a fifth since 12 Oct. Check them, then save again.')).toBeInTheDocument(); expect(posts(calls)).toHaveLength(0);
  type('81000'); expect(screen.queryByRole('button', { name: 'Yes, save these rates' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: "Save today's rates" })); await pass();
  const confirm = screen.getByRole('button', { name: 'Yes, save these rates' }); fireEvent.click(confirm); fireEvent.click(confirm); await pass();
  expect(posts(calls)).toHaveLength(1); expect(posts(calls)[0].data).toMatchObject({ quoted: { 'gold-22K': '81000.00' } });
});
test('two moved rates read in the plural', async () => {
  const { calls } = await sheet(); type('80000'); fireEvent.change(field('Gold 24K (999) per 10 g'), { target: { value: '200000' } });
  fireEvent.click(screen.getByRole('button', { name: "Save today's rates" })); await pass();
  expect(screen.getByText('2 rates moved more than a fifth since 12 Oct. Check them, then save again.')).toBeInTheDocument(); expect(posts(calls)).toHaveLength(0);
});
test('blank, invalid precision and maximum errors remain attached to the field', async () => {
  const { calls } = await sheet();
  for (const [value, words] of [['', 'Type the Gold 22K rate per 10 g.'], ['1.234', "That's not an amount."], ['10000000', "That's more than ₹99,99,999.99 per 10 g."]]) {
    type(value); fireEvent.click(screen.getByRole('button', { name: "Save today's rates" })); await pass();
    expect(field()).toHaveAttribute('aria-invalid', 'true'); expect(document.getElementById(field().getAttribute('aria-describedby')!)).toHaveTextContent(words);
  }
  expect(posts(calls)).toHaveLength(0);
});
test('server field refusal preserves typing', async () => {
  const { close } = await sheet(wireRates(), () => ({ status: 400, data: { quoted: { 'gold-22K': ["That's not an amount."] } } }));
  type('65001.25'); fireEvent.click(screen.getByRole('button', { name: "Save today's rates" })); await pass();
  expect(field()).toHaveValue('65001.25'); expect(field()).toHaveAttribute('aria-invalid', 'true'); expect(close).not.toHaveBeenCalled();
});
test('offline save preserves typing and shows the exact words', async () => {
  const { calls, close } = await sheet(wireRates(), () => ({ status: 0 })); Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  type('65001'); fireEvent.click(screen.getByRole('button', { name: "Save today's rates" })); await pass();
  expect(screen.getByText("You're offline, so the rates weren't saved. The last board stays visible.")).toBeInTheDocument();
  expect(field()).toHaveValue('65001'); expect(posts(calls)).toHaveLength(1); expect(close).not.toHaveBeenCalled();
});
test('failed read uses QueryView without a zero board', async () => {
  serve({ 'GET rates/': () => ({ status: 500 }) }); renderApp(<RatesCard />); expect(screen.queryByText('₹0.00')).not.toBeInTheDocument(); await pass(); expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});
test('Easy sheet uses Go back and labelled fields', async () => {
  (window as unknown as { __phone: boolean }).__phone = true; serve({ 'GET rates/': wireRates() }); renderApp(<RatesSheet open onClose={vi.fn()} />, { path: '/e' }); await pass(); await pass(400);
  expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Go back' })).toBeInTheDocument(); expect(field()).toBeInTheDocument();
});
test('a cold failed sheet remains a closable dialog with its retry inside', async () => {
  serve({ 'GET rates/': () => ({ status: 500 }) }); const close = vi.fn(); renderApp(<RatesSheet open onClose={close} />);
  expect(screen.getByRole('dialog', { name: "Today's rates" })).toBeInTheDocument(); await pass(); await pass(400);
  const dialog = screen.getByRole('dialog'); expect(within(dialog).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' })); expect(close).toHaveBeenCalledOnce();
});

test('a refreshed new IST day permits unchanged quotes without replacing typing', async () => {
  let cache: QueryClient;
  function CaptureCache() { cache = useQueryClient(); return null; }
  serve({ 'GET rates/': wireRates() }); renderApp(<><CaptureCache /><RatesSheet open onClose={vi.fn()} /></>); await pass(); await pass(400);
  expect(screen.getByRole('button', { name: "Save today's rates" })).toBeDisabled();
  act(() => cache.setQueryData(ratesKeys.board(), { ...wireRates(), latest: boardOf(wireBoard()), previous: null, today: '2026-10-13', set_today: false })); await pass();
  expect(screen.getByRole('button', { name: "Save today's rates" })).toBeEnabled(); expect(field()).toHaveValue('65,125.00');
  type('65001.25');
  act(() => cache.setQueryData(ratesKeys.board(), { ...wireRates(), latest: boardOf(wireBoard({ id: 42 })), previous: null })); await pass();
  expect(field()).toHaveValue('65001.25');
  type('');
  act(() => cache.setQueryData(ratesKeys.board(), { ...wireRates(), latest: boardOf(wireBoard({ id: 43, on: '2026-10-13', quoted: { ...wireBoard().quoted, 'gold-22K': '68000.00' } })), previous: null })); await pass();
  expect(screen.getByText('13 Oct: ₹68,000.00 per 10 g')).toBeInTheDocument();
});
