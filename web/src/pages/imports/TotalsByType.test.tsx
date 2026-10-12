import { render, screen, within } from '@testing-library/react';
import { billFigures } from '@/core/sales/maths';
import { TotalsByType, type ImportTotalRow } from './TotalsByType';
const figures = (rate: string, gst_percent: string, interstate = false) => billFigures([{ quantity: '1', rate, gst_percent }], interstate);
const row = (label: string) => screen.getByText(label).closest('tr')!;
test('groups B2B, large interstate B2C, other sales, taxed purchases and no-credit purchases', () => {
  const rows: ImportTotalRow[] = [
    { kind: 'sale', gstin: '27XTZPS7585P1ZB', totals: figures('100', '3', true) },
    { kind: 'sale', gstin: '', totals: figures('100001', '0', true) },
    { kind: 'sale', gstin: '', totals: figures('100000', '0', true) },
    { kind: 'purchase', gstin: '08AACFU5521R1ZN', totals: figures('100', '3') },
    { kind: 'purchase', gstin: '', totals: figures('100', '0') },
  ];
  render(<TotalsByType rows={rows} />);
  expect(within(row('Sales to a GSTIN (B2B)')).getByText('₹103.00')).toBeInTheDocument();
  expect(row('Sales without a GSTIN (B2C)')).toHaveTextContent('₹2,00,001.00');
  expect(row('Purchases with credit')).toHaveTextContent('ITC checked before import');
  expect(row('Purchases without credit')).toHaveTextContent('₹100.00');
  expect(row('All ticked')).toHaveTextContent('5');
});
test('selection changes the sum without re-rounding uneven split tax', () => {
  const first: ImportTotalRow = { kind: 'purchase', gstin: '08AACFU5521R1ZN', totals: figures('1', '3') };
  const second: ImportTotalRow = { ...first, totals: figures('2', '3') };
  const { rerender } = render(<TotalsByType rows={[first, second]} />);
  const all = row('All ticked');
  expect(within(all).getAllByRole('cell').map(c => c.textContent)).toEqual(['All ticked', '2', '₹3.00', '₹0.05', '₹0.04', '₹0.00', '₹3.09']);
  rerender(<TotalsByType rows={[first]} />);
  expect(within(row('All ticked')).getAllByRole('cell').map(c => c.textContent)).toEqual(['All ticked', '1', '₹1.00', '₹0.02', '₹0.01', '₹0.00', '₹1.03']);
});
test('server credit is displayed exactly and lapsed taxed purchases do not claim tax as credit', () => {
  const totals = figures('100', '3');
  render(<TotalsByType rows={[{ kind: 'purchase', gstin: '08AACFU5521R1ZN', totals, credit: 0 }]} />);
  expect(row('Purchases without credit')).toHaveTextContent('₹103.00');
  expect(screen.queryByText('ITC checked before import')).not.toBeInTheDocument();
});
test('server confirms the eligible credit instead of the whole purchase tax', () => {
  render(<TotalsByType rows={[{ kind: 'purchase', gstin: '08AACFU5521R1ZN', totals: figures('100', '3'), credit: 100 }]} />);
  expect(row('Purchases with credit')).toHaveTextContent('ITC ₹1.00');
});
