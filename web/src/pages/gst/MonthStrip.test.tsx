import { fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { renderApp } from '@/test/render';
import { heads, yearFixture, monthFixture } from '@/core/gst/fixtures';
import { MonthStrip, StatusCard } from './MonthStrip';
import type { Filing } from '@/core/gst/types';
afterEach(() => vi.useRealTimers());
test('month strip exposes stage labels and roves by arrow/Home/End', () => {
  const onPick=vi.fn(); renderApp(<MonthStrip year={yearFixture()} month="2026-09" onPick={onPick} />);
  const group=screen.getByRole('radiogroup',{name:'Months of FY 2026-27'});
  fireEvent.keyDown(group,{key:'ArrowRight'}); expect(onPick).toHaveBeenLastCalledWith('2026-10');
  fireEvent.keyDown(group,{key:'Home'}); expect(onPick).toHaveBeenLastCalledWith('2026-04');
  fireEvent.keyDown(group,{key:'End'}); expect(onPick).toHaveBeenLastCalledWith('2026-10');
  expect(screen.getByRole('radio',{name:/September 2026.*Ready to file/})).toHaveAttribute('aria-checked','true');
});
test('status uses server totals and cap with no local money calculations', () => {
  const m=monthFixture({late:{gstr1:{days:43,per_day:5000,fee:200000,cap:200000,capped:true},gstr3b:{days:0,per_day:5000,fee:0,cap:200000,capped:false},interest:0,interest_on:20000,interest_from:'2026-10-21',turnover_band:'upto_1.5cr',nil:{gstr1:false,gstr3b:false},total:200000}});
  renderApp(<StatusCard month={m} />);
  expect(screen.getByText(/cap ₹2,000.00 reached/)).toBeInTheDocument();
  expect(screen.getByText(/43 days.*₹50.00 a day/)).toBeInTheDocument();
});

const record = (kind: Filing['kind']): Filing => ({ id: kind === 'gstr1' ? 81 : 82, business: 3, month: '2026-09', kind, filed_on: kind === 'gstr1' ? '2026-10-10' : '2026-10-19', arn: kind === 'gstr1' ? 'AA0810260345671' : 'AA081026034590Z', cash: kind === 'gstr3b' ? heads(0, 12500, 12500) : null, cash_worked_out: kind === 'gstr3b' ? heads(0, 10000, 10000) : null, late_fee: null, interest: null, credit_left: null, marked_by: { id: 1, name: 'Kailash Mehta' }, marked_at: '2026-10-19T17:00:00+05:30', updated_by: null, updated_at: null, legacy: false });

test('filed returns show dates and ARNs instead of overdue words, and retain recorded cash', () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-02T12:00:00+05:30'));
  const m = monthFixture({ stage: 'filed' });
  m.record.gstr1 = record('gstr1'); m.record.gstr3b = record('gstr3b');
  m.record.locked_by = { id: 1, name: 'Kailash Mehta' }; m.record.locked_on = '2026-10-19';
  m.gstr3b!.filed = true;
  renderApp(<StatusCard month={m} />);
  expect(screen.getByText('GSTR-1').parentElement).toHaveTextContent('filed 10 Oct 2026ARN AA0810260345671');
  expect(screen.getByText('GSTR-3B').parentElement).toHaveTextContent('filed 19 Oct 2026ARN AA081026034590Z');
  expect(screen.queryByText(/days late/)).not.toBeInTheDocument();
  expect(screen.getByText('Locked').parentElement).toHaveTextContent('by Kailash Mehta on 19 Oct 2026');
  expect(screen.getByText(/Tax paid in cash/).parentElement).toHaveTextContent('₹250.00');
  expect(screen.getByText('as filed 19 Oct 2026 · the return worked out ₹200.00')).toBeInTheDocument();
});

test('a GSTR-1-only month shows its filing and keeps the GSTR-3B due date', () => {
  const m = monthFixture({ stage: 'gstr1' }); m.record.gstr1 = record('gstr1');
  renderApp(<StatusCard month={m} />);
  expect(screen.getByText('GSTR-1').parentElement).toHaveTextContent('filed 10 Oct 2026');
  expect(screen.getByText('GSTR-3B').parentElement).toHaveTextContent('due 20 Oct 2026');
  expect(screen.getByText('Sales bills').parentElement).toHaveTextContent('locked since GSTR-1 (marked by Kailash Mehta)');
});

test('an unlocked month shows live cash on the books and the amount paid before it was unlocked', () => {
  const m = monthFixture({ stage: 'unlocked', amendments: { before_gstr3b: false, carried_by: '2026-11', file: 'amendments.json', summary: '1 B2CSA row', rows: 1 }, since_filing: { at: '2026-10-25T12:00:00+05:30', bills_diff: 1, taxable_diff: 333333, tax_diff: 10000, rows: [], gstr3b: { output_diff: heads(0, 5000, 5000), credit_diff: heads(), cash_diff: 10000 } } });
  m.record.gstr1 = record('gstr1'); m.record.gstr3b = record('gstr3b');
  m.record.unlocked = { at: '2026-10-25T12:00:00+05:30', by: { id: 1, name: 'Kailash Mehta' }, reason: 'A deleted bill was a real sale' };
  m.gstr3b!.cash = heads(0, 15000, 15000); m.gstr3b!.output = heads(0, 20000, 20000);
  const view = renderApp(<StatusCard month={m} />);
  expect(screen.getByText(/Tax in cash on the books now/).parentElement).toHaveTextContent('₹300.00');
  expect(screen.queryByText('Tax to pay in cash')).not.toBeInTheDocument();
  expect(screen.getByText("₹250.00 was paid with GSTR-3B on 19 Oct 2026; the +₹100.00 goes in November's GSTR-3B")).toBeInTheDocument();
  expect(screen.getByText('Unlocked').parentElement).toHaveTextContent('by Kailash Mehta on 25 Oct 2026');
  expect(screen.getByText('A deleted bill was a real sale')).toBeInTheDocument();
  view.unmount();
  m.since_filing = null;
  renderApp(<StatusCard month={m} />);
  expect(screen.getByText('₹250.00 was paid with GSTR-3B on 19 Oct 2026')).toBeInTheDocument();
  expect(screen.queryByText(/goes in November/)).not.toBeInTheDocument();
});

test('legacy filing dates are unknown rather than overdue', () => {
  const m = monthFixture({ stage: 'filed' }); m.record.legacy = true;
  renderApp(<StatusCard month={m} />);
  expect(screen.getByText('GSTR-1').parentElement).toHaveTextContent('Filed before the app');
  expect(screen.getByText('GSTR-3B').parentElement).toHaveTextContent('Filed before the app');
  expect(screen.queryByText(/days late/)).not.toBeInTheDocument();
});
