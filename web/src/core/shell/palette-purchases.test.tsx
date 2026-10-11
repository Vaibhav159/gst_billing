import { fireEvent, screen } from '@testing-library/react';
import { Routes, Route, useLocation } from 'react-router';
import { handClock, pass } from '@/test/clock';
import { renderApp } from '@/test/render';
import { serve } from '@/test/server';
import { Palette } from './Palette';
import './PaletteRecords';
function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.search}</p>; }
beforeEach(() => { localStorage.clear(); handClock(new Date('2026-10-08T12:30:00+05:30')); });
afterEach(() => vi.useRealTimers());
test('Ctrl K searches purchases by number or supplier and suppliers by name or GSTIN; inward recent bills are shown once', async () => {
  const calls = serve({
    'GET firms/': { results: [] }, 'GET sales/': { results: [] }, 'GET bin/': { results: [] },
    'GET search/quick/': { customers: [], invoices: [], products: [] },
    'GET purchases/': { results: [{ id: 905, invoice_number: 'UBS/0850', invoice_date: '2026-10-04', total_amount: '103.06', supplier: { name: 'Udaipur Bullion' } }] },
    'GET suppliers/': { results: [{ id: 21, name: 'Udaipur Bullion', gst_number: '08AACFU5521R1ZN', city: 'Udaipur' }] },
  });
  renderApp(<><Routes><Route path="*" element={<Palette open onClose={() => {}} />} /></Routes><Where /></>);
  await pass(0, 2); fireEvent.change(screen.getByRole('combobox'), { target: { value: 'UBS' } }); await pass(250, 2);
  const purchase = screen.getByRole('option', { name: 'UBS/0850 Udaipur Bullion · 04 Oct 2026 · ₹103.06' });
  expect(screen.getByRole('option', { name: 'Udaipur Bullion 08AACFU5521R1ZN · Udaipur' })).toBeInTheDocument();
  expect(calls.filter(c => c.url === 'purchases/').map(c => c.params)).toEqual([{ q: 'UBS', page_size: 5, summary: 0 }]);
  await pass(400, 2); fireEvent.click(purchase); await pass(0, 2); expect(screen.getByTestId('where')).toHaveTextContent('/purchases/905');
  await pass(60_000, 2); expect(calls.filter(c => c.url === 'purchases/')).toHaveLength(1);
});
test('a purchase or supplier search failure is visible and can be retried without discarding the other records', async () => {
  let down = true;
  serve({ 'GET firms/': { results: [] }, 'GET sales/': { results: [] }, 'GET bin/': { results: [] }, 'GET search/quick/': { customers: [], invoices: [], products: [] },
    'GET catalog/': { count: 0, next: null, previous: null, results: [], total_products: 0, twins: [] },
    'GET purchases/': () => ({ status: down ? 500 : 200, data: { results: [] } }), 'GET suppliers/': { results: [{ id: 21, name: 'Udaipur Bullion', gst_number: '', city: '' }] } });
  renderApp(<Palette open onClose={() => {}} />); await pass(0, 2); fireEvent.change(screen.getByRole('combobox'), { target: { value: 'bullion' } }); await pass(250, 2);
  expect(screen.getByText('Some purchases or suppliers could not be searched. Try again.')).toBeInTheDocument(); expect(screen.getByRole('option', { name: 'Udaipur Bullion Supplier' })).toBeInTheDocument();
  down = false; await pass(400, 2); fireEvent.click(screen.getByRole('button', { name: 'Try again' })); await pass(0, 2);
  expect(screen.queryByText('Some purchases or suppliers could not be searched. Try again.')).not.toBeInTheDocument();
});
