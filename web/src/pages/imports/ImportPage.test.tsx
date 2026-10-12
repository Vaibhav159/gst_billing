import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mount, serve, VIEWER } from '@/pages/customers/testing';
import ImportPage from './ImportPage';
import { IMPORT_KINDS } from './kinds';
const csv = 'Bill No,Date,Supplier,GSTIN,Item,HSN,GST Rate,Quantity,Rate\n001,04/10/2026,ABC,,Scrap,7112,0,1,100';
function choose(text = csv) { const file = new File([text], 'October.csv', { type: 'text/csv' }); Object.defineProperty(file, 'text', { value: async () => text }); fireEvent.change(screen.getByLabelText('Choose an Excel or CSV file'), { target: { files: [file] } }); }
function setup(answers = {}, me = undefined as typeof VIEWER | undefined) {
  const calls = serve({ 'GET customers/': { count: 0, results: [], next: null }, 'GET purchases/usual-rate/': { rate: null }, ...answers });
  mount([{ path: '/import', element: <ImportPage /> }], ['/import?type=purchases'], { me }); return calls;
}
describe('Excel and CSV wizard', () => {
  it('leaves a list of import kinds for records and offers photos', () => {
    setup(); expect(IMPORT_KINDS.map(k => k.value)).toEqual(['bills', 'customers', 'products', 'firms']);
    expect(screen.getByRole('link', { name: 'Import bill photos' })).toHaveAttribute('href', '/purchases/ai-import');
  });
  it('keeps viewers read-only without opening a file input', () => {
    setup({}, VIEWER); expect(screen.getByText('You can look, but not import bills')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'See the template' })).toBeEnabled();
    expect(screen.queryByLabelText('Choose an Excel or CSV file')).not.toBeInTheDocument();
  });
  it('walks layout, review, dry run and import, preserving the printed number', async () => {
    const calls = setup({ 'POST purchases/import/': (c: { data: unknown }) => { const b = c.data as { dry_run: boolean; bills: { ref: string }[] }; return { status: 200, data: { dry_run: b.dry_run, ok: true, bills: b.bills.map(row => ({ ref: row.ref, ok: true, id: b.dry_run ? null : 91, problems: [], duplicate: null, credit: { month: '2026-10', claimed: '0.00' } })), suppliers: [], totals: { bills: 1, total_amount: '100.00', credit: '0.00' } } }; } });
    choose(); await screen.findByText('October.csv'); fireEvent.click(screen.getByRole('button', { name: 'Next: check the layout' }));
    fireEvent.change(screen.getByLabelText('Whose bills'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next: check the bills' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next: import 1 bill' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Next: import 1 bill' }));
    await screen.findByRole('button', { name: 'Import 1 bill' });
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 bill' }));
    expect(await screen.findByRole('link', { name: 'Open 001' })).toHaveAttribute('href', '/purchases/91');
    expect((calls.filter(c => c.method === 'POST')[1].data as { bills: { invoice_number: string }[] }).bills[0].invoice_number).toBe('001');
  });
  it('keeps server validation beside its row and makes no actual import', async () => {
    const calls = setup({ 'POST purchases/import/': (c: { data: unknown }) => ({ status: 200, data: { dry_run: true, ok: false, bills: (c.data as { bills: { ref: string }[] }).bills.map(b => ({ ref: b.ref, ok: false, id: null, problems: [{ field: 'invoice_date', detail: 'Choose an open credit month.' }], duplicate: null, credit: null })), totals: { bills: 0, total_amount: '0.00', credit: '0.00' } } }) });
    choose(); await screen.findByText('October.csv'); fireEvent.click(screen.getByText('Next: check the layout')); fireEvent.change(screen.getByLabelText('Whose bills'), { target: { value: '3' } }); fireEvent.click(screen.getByText('Next: check the bills'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next: import 1 bill' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: 'Next: import 1 bill' }));
    expect(await screen.findByText('Choose an open credit month.')).toBeInTheDocument(); expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
  });
  it('does not accept an old file read after a newer one was chosen', async () => {
    setup(); let resolve!: (s: string) => void;
    const old = new File(['old'], 'Old.csv', { type: 'text/csv' }); Object.defineProperty(old, 'text', { value: () => new Promise<string>(r => { resolve = r; }) });
    fireEvent.change(screen.getByLabelText('Choose an Excel or CSV file'), { target: { files: [old] } }); choose();
    await screen.findByText('October.csv'); resolve(csv); await vi.waitFor(() => expect(screen.queryByText('Old.csv')).not.toBeInTheDocument());
  });
});

it('phone imports use the shared desktop handoff and never fetch importer data', () => {
  (window as unknown as { __phone?: boolean }).__phone = true;
  try {
    const calls = setup();
    expect(screen.getByText('Imports are done on the computer')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Capture a bill' })).toHaveAttribute('href', '/capture');
    expect(screen.queryByLabelText('Choose an Excel or CSV file')).not.toBeInTheDocument();
    expect(calls.some(c => c.url === 'customers/' || c.url === 'purchases/usual-rate/')).toBe(false);
  } finally { (window as unknown as { __phone?: boolean }).__phone = false; }
});
it('review says why the file total differs and keeps the missing HSN and payment notes', async () => {
  setup();
  choose('Bill No,Date,Supplier,GSTIN,Item,HSN,GST Rate,Quantity,Rate,Total,Paid by\n001,04/10/2026,ABC,,Scrap,,0,1,100,150,barter');
  await screen.findByText('October.csv'); fireEvent.click(screen.getByText('Next: check the layout')); fireEvent.change(screen.getByLabelText('Whose bills'), { target: { value: '3' } }); fireEvent.click(screen.getByText('Next: check the bills'));
  expect(await screen.findByText(/the lines are what's saved/)).toHaveTextContent('₹150.00 differs from its lines (₹100.00)');
  expect(screen.getByText('Scrap has no HSN code. Add it with Edit now, or later on the bill.')).toBeInTheDocument();
  expect(screen.getByText(/isn't a way of paying the app knows/)).toHaveTextContent('barter');
});
it('bill editor changes are frozen while dry-run validates the reviewed snapshot', async () => {
  setup({ 'POST purchases/import/': () => new Promise(() => {}) });
  choose(); await screen.findByText('October.csv'); fireEvent.click(screen.getByText('Next: check the layout')); fireEvent.change(screen.getByLabelText('Whose bills'), { target: { value: '3' } }); fireEvent.click(screen.getByText('Next: check the bills'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Next: import 1 bill' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Edit 001' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next: import 1 bill' }));
  expect(screen.getByRole('button', { name: 'Use these details' })).toBeDisabled();
  expect(screen.getByLabelText('Bill number')).toBeDisabled();
});

async function advanceToBills(text = csv) {
  choose(text); await screen.findByText('October.csv');
  fireEvent.click(screen.getByRole('button', { name: 'Next: check the layout' }));
  fireEvent.change(screen.getByLabelText('Whose bills'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Next: check the bills' }));
}
const mixedCsv = `Inward Supply\n${csv}\nOutward Supply\n${csv.replace('001', 'S001')}`;
function importReply(data: unknown, id: number, ok = true) {
  const body = data as { dry_run: boolean; bills: { ref: string }[] };
  return { dry_run: body.dry_run, ok, bills: body.bills.map(b => ({ ref: b.ref, ok, id: body.dry_run || !ok ? null : id, problems: ok ? [] : [{ field: 'invoice_number', detail: 'This number was just used by another bill.' }], duplicate: null, credit: null })), totals: { bills: body.bills.length, total_amount: '100.00', credit: '0.00' } };
}
function leaveIsProtected() { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }
it('partial success cannot reset the file while the remaining write runs; all saved lifts the guard', async () => {
  let finish!: () => void;
  setup({
    'POST purchases/import/': (c: { data: unknown }) => ({ status: 200, data: importReply(c.data, 91) }),
    'POST sales/import/': (c: { data: unknown }) => (c.data as { dry_run: boolean }).dry_run ? { status: 200, data: importReply(c.data, 92) } : new Promise(resolve => { finish = () => resolve({ status: 200, data: importReply(c.data, 92) }); }),
  });
  await advanceToBills(mixedCsv);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Next: import 2 bills' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Next: import 2 bills' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Import 2 bills' }));
  await screen.findByRole('link', { name: 'Open 001' });
  expect(screen.getByRole('button', { name: 'Import another file' })).toBeDisabled();
  expect(leaveIsProtected()).toBe(true);
  finish();
  await screen.findByRole('link', { name: 'Open S001' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Import another file' })).toBeEnabled());
  expect(leaveIsProtected()).toBe(false);
});
it.each(['refused', 'lost'])('partial success keeps unsaved rows protected when the second response is %s', async outcome => {
  setup({
    'POST purchases/import/': (c: { data: unknown }) => ({ status: 200, data: importReply(c.data, 91) }),
    'POST sales/import/': (c: { data: unknown }) => (c.data as { dry_run: boolean }).dry_run ? { status: 200, data: importReply(c.data, 92) } : outcome === 'lost' ? { status: 503, data: {} } : { status: 200, data: importReply(c.data, 92, false) },
  });
  await advanceToBills(mixedCsv);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Next: import 2 bills' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Next: import 2 bills' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Import 2 bills' }));
  expect(await screen.findByText(outcome === 'lost' ? /The app lost the answer/ : /The sales were not imported/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open 001' })).toBeInTheDocument();
  expect(leaveIsProtected()).toBe(true);
});
it('untick all also clears a warning bill that was checked manually', async () => {
  setup({ 'GET purchases/usual-rate/': { rate: '100.000' } });
  await advanceToBills(csv.replace('0,1,100', '0,1,1000') + '\n002,04/10/2026,ABC,,Scrap,7112,0,1,100');
  const warning = screen.getByRole('checkbox', { name: 'Import 001' });
  await waitFor(() => expect(warning).toBeEnabled());
  expect(warning).not.toBeChecked();
  fireEvent.click(warning);
  const all = screen.getByRole('checkbox', { name: 'Import every ready bill on this table' });
  expect(all).toBeChecked();
  fireEvent.click(all);
  expect(warning).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Import 002' })).not.toBeChecked();
});
it('amount-only taxable value can be edited without inventing quantity and rate', async () => {
  const calls = setup({ 'POST purchases/import/': (c: { data: unknown }) => ({ status: 200, data: importReply(c.data, 91) }) });
  await advanceToBills('Bill No,Date,Supplier,GSTIN,Item,HSN,GST Rate,Quantity,Rate,Taxable value\n001,04/10/2026,ABC,,Scrap,7112,0,,,100');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Edit 001' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Edit 001' }));
  fireEvent.change(screen.getByLabelText('Taxable value'), { target: { value: '123.45' } });
  fireEvent.click(screen.getByRole('button', { name: 'Use these details' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Next: import 1 bill' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Next: import 1 bill' }));
  await screen.findByRole('button', { name: 'Import 1 bill' });
  const body = calls.find(c => c.method === 'POST')!.data as { bills: { lines: Record<string, unknown>[] }[] };
  expect(body.bills[0].lines[0]).toMatchObject({ amount_only: true, taxable: '123.45' });
  expect(body.bills[0].lines[0]).not.toHaveProperty('quantity');
  expect(body.bills[0].lines[0]).not.toHaveProperty('rate');
});
it('a partial import keeps receipts while only the edited remaining bill is checked and retried', async () => {
  let salesWrites = 0;
  const calls = setup({
    'POST purchases/import/': (c: { data: unknown }) => ({ status: 200, data: importReply(c.data, 91) }),
    'POST sales/import/': (c: { data: unknown }) => {
      const dry = (c.data as { dry_run: boolean }).dry_run;
      return { status: 200, data: importReply(c.data, 92, dry || ++salesWrites > 1) };
    },
  });
  await advanceToBills(mixedCsv);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Next: import 2 bills' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Next: import 2 bills' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Import 2 bills' }));
  await screen.findByText(/The sales were not imported/);
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByRole('link', { name: 'Open 001' })).toHaveAttribute('href', '/purchases/91');
  expect(screen.queryByRole('checkbox', { name: 'Import 001' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Check the layout/ })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit S001' }));
  fireEvent.change(screen.getByLabelText('Bill number'), { target: { value: 'S002' } });
  fireEvent.change(screen.getByLabelText('Item'), { target: { value: 'Corrected scrap' } });
  fireEvent.click(screen.getByRole('button', { name: 'Use these details' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Next: import 1 bill' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Next: import 1 bill' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Import 1 bill' }));
  await screen.findByRole('link', { name: 'Open S002' });
  expect(screen.getByRole('link', { name: 'Open 001' })).toHaveAttribute('href', '/purchases/91');
  expect(leaveIsProtected()).toBe(false);
  const posts = calls.filter(c => c.method === 'POST');
  expect(posts.filter(c => c.url === 'purchases/import/')).toHaveLength(2);
  const retry = posts.slice(-2);
  expect(retry.map(c => c.url)).toEqual(['sales/import/', 'sales/import/']);
  for (const call of retry) expect(call.data).toMatchObject({ bills: [{ invoice_number: 'S002', lines: [{ product_name: 'Corrected scrap' }] }] });
  fireEvent.click(screen.getByRole('button', { name: 'Import another file' }));
  expect(screen.queryByRole('link', { name: 'Open 001' })).not.toBeInTheDocument();
  await advanceToBills(csv);
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Import 001' })).toBeEnabled());
});

it('lists a skipped bill row openly with the bill it would have changed (X-63)', async () => {
  setup();
  choose(`${csv}\n001,,,,Ring,7113,0,1,50\n002,,,,Coin,7113,0,1,5`);
  await screen.findByText('October.csv'); fireEvent.click(screen.getByRole('button', { name: 'Next: check the layout' }));
  const row = screen.getByText(/No party name, and no earlier bill 002 to join/);
  expect(row.closest('[inert]')).toBeNull();
  expect(screen.getByText('2 rows of bills', { exact: false })).toBeInTheDocument();
});
it('says a party name matches too many parties instead of asking to go back', async () => {
  setup({ 'GET customers/': { count: 150, results: [], next: 'http://test/api/customers/?page=2' } });
  await advanceToBills();
  expect(await screen.findByText(/matches more than 100 parties/)).toBeInTheDocument();
  expect(screen.queryByText(/Go back, then check the bills again/)).not.toBeInTheDocument();
});
it('announces a refused check once, gives Edit its state and names same-number bills apart', async () => {
  setup({ 'POST purchases/import/': (c: { data: unknown }) => ({ status: 200, data: importReply(c.data, 91, false) }), 'POST sales/import/': (c: { data: unknown }) => ({ status: 200, data: importReply(c.data, 92, false) }) });
  await advanceToBills(`Inward Supply\n${csv}\nOutward Supply\n${csv}`);
  const boxes = await screen.findAllByRole('checkbox', { name: /^Import 001/ });
  expect(boxes).toHaveLength(2); expect(new Set(boxes.map(b => b.getAttribute('aria-label') ?? b.closest('label')?.textContent)).size).toBe(2);
  const edit = screen.getAllByRole('button', { name: /^Edit 001/ })[0];
  expect(edit).toHaveAttribute('aria-expanded', 'false'); fireEvent.click(edit); expect(edit).toHaveAttribute('aria-expanded', 'true'); fireEvent.click(edit);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Next: import 2 bills' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Next: import 2 bills' }));
  expect(await screen.findAllByText('This number was just used by another bill.')).toHaveLength(2);
  expect(screen.queryAllByRole('alert')).toHaveLength(0);
});
it('after importing only sales, links to sales and not to purchases', async () => {
  setup({ 'POST sales/import/': (c: { data: unknown }) => ({ status: 200, data: importReply(c.data, 92) }) });
  await advanceToBills(`Outward Supply\n${csv}`);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Next: import 1 bill' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Next: import 1 bill' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Import 1 bill' }));
  expect(await screen.findByRole('link', { name: 'View sales' })).toHaveAttribute('href', '/sales');
  expect(screen.queryByRole('link', { name: 'View purchases' })).not.toBeInTheDocument();
});
