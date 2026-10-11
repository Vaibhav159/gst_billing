import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';
import type { Filing, Heads, Month } from '@/core/gst/types';
import { renderApp } from '@/test/render';
import { handClock, tickSync } from '@/test/clock';
import { FilingCard } from './FilingCard';
import { FilingDialog, PeriodDialog } from './FilingDialogs';
import { AmendCard } from './AmendCard';
vi.mock('./CaBundleButton', () => ({ CaBundleButton: ({ input }: { input: import('@/core/api/gstExports').BundleInput }) => <output data-testid="ca-bundle-input">{JSON.stringify(input)}</output> }));

const heads = (igst = 0, cgst = 0, sgst = 0): Heads => ({ igst, cgst, sgst, total: igst + cgst + sgst });
const filing = (kind: Filing['kind']): Filing => ({ id: kind === 'gstr1' ? 81 : 82, business: 3, month: '2026-09', kind, filed_on: '2026-10-08', arn: 'AA0810260345671', cash: kind === 'gstr3b' ? heads(0, 4110684, 4110684) : null, cash_worked_out: heads(0, 4110684, 4110684), late_fee: null, interest: null, credit_left: null, marked_by: { id: 1, name: 'Kailash Mehta' }, marked_at: '2026-10-08T12:10:00+05:30', updated_by: null, updated_at: null, legacy: false });
function month(patch: Partial<Month> = {}): Month {
  return { business: 3, firm: { id: 3, name: 'KIRAN GOLD HOUSE', short: 'Kiran', gst_number: '08VRHFA2322D1ZI' }, month: '2026-09', fy: '2026-27', stage: 'ready', running: { from: '2026-09-01', to: '2026-09-30' }, due: { gstr1: '2026-10-11', gstr3b: '2026-10-20', file_from: '2026-10-01' }, record: { gstr1: null, gstr1a: null, gstr3b: null, legacy: false, unlocked: null, relocked: null, locked_by: null, locked_on: null }, late: null, checks: { blockers: [], notes: [], passes: [] }, gstr1: { taxable: 10000000, igst: 0, cgst: 150000, sgst: 150000, tax: 300000, total: 10300000, bills: 2, cancelled: 0, deleted: 0, file: { name: 'GSTR1_08VRHFA2322D1ZI_092026.json', b2b: 1, b2cl: 0, b2cs_rows: 1, b2cs_bills: 1, nil: 0, hsn: 1, docs: 1, amendments: 0, made: true, why_not: '' }, as_filed: null }, gstr3b: { output: heads(0, 4500000, 4500000), credit: heads(0, 389316, 389316), carry_in: heads(), cash: heads(0, 4110684, 4110684), carry_on: heads(100, 200, 300), used: heads(0, 389316, 389316), amendments_in: [], late_bills: 0, to_confirm: 0, opening_missing: false, filed: false }, since_filing: null, amendments: null, amended_in: null, download: null, prev_gstr3b_missing: null, ...patch };
}
const corrected = (): Month => { const m = month(); return { ...m, stage: 'unlocked', record: { ...m.record, gstr1: filing('gstr1') }, amendments: { before_gstr3b: true, carried_by: '2026-09', file: 'GSTR1A_08VRHFA2322D1ZI_092026.json', summary: '1 B2B row', rows: 1 }, since_filing: { at: '2026-10-08', bills_diff: 1, taxable_diff: 10000, tax_diff: 300, gstr3b: null, rows: [{ id: 405, kind: 'added', invoice_number: 'KGH/2026-27/21', section: 'b2b', place_of_supply: '08', rate: '3', before: null, after: { taxable: 10000, igst: 0, cgst: 150, sgst: 150, total: 10300 }, tax_diff: 300, goes_in: 'GSTR-1A · B2B', too_late: false }] } }; };
beforeEach(() => handClock(new Date('2026-10-25T12:00:00+05:30')));
afterEach(() => vi.useRealTimers());
const ready = () => tickSync(400);

test.each([false, true])('CA bundle receives exact month metadata and saved split=%s', (split) => {
  localStorage.setItem('gst3.report.split', split ? '1' : '0');
  renderApp(<FilingCard month={month()} onAction={vi.fn()} />);
  expect(JSON.parse(screen.getByTestId('ca-bundle-input').textContent!)).toEqual({
    businessId: 3, month: '2026-09', short: 'Kiran', gstin: '08VRHFA2322D1ZI', split, includeGstr1: true,
  });
});

test('failed checks omit the portal file from the CA bundle input', () => {
  const m = month();
  m.checks.blockers = [{ kind: 'empty', blocks: true, text: 'Empty bill', detail: '', bills: [], more_bills: 0, customer: null, suggested: null }];
  renderApp(<FilingCard month={m} onAction={vi.fn()} />);
  expect(JSON.parse(screen.getByTestId('ca-bundle-input').textContent!).includeGstr1).toBe(false);
});

test.each(['gstr1', 'gstr1a', 'gstr3b', 'both'] as const)('records %s with normalized ARN and decimal cash', (kind) => {
  const m = kind === 'gstr1a' || kind === 'gstr3b' ? corrected() : month();
  const submit = vi.fn(); renderApp(<FilingDialog month={m} kind={kind} onClose={vi.fn()} onSubmit={submit} />); ready();
  const name = kind === 'both' ? 'GSTR-3B' : kind === 'gstr1' ? 'GSTR-1' : kind === 'gstr1a' ? 'GSTR-1A' : 'GSTR-3B';
  fireEvent.change(screen.getByLabelText(`${name} ARN`), { target: { value: ' aa0810260345671 ' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /on the GST portal|on the portal/ }));
  fireEvent.click(screen.getByRole('button', { name: /^(Mark GSTR-1 filed|Mark GSTR-1A filed|Mark filed and lock)$/ }));
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ kind, filed_on: '2026-10-25', arn: 'AA0810260345671', ...(kind === 'both' || kind === 'gstr3b' ? { cash_total: '82213.68' } : {}) }));
});

test('failed checks require the portal acknowledgement; stale named bills and previous 3B warn without blocking', () => {
  const m = month({ checks: { blockers: [{ kind: 'empty', blocks: true, text: 'KGH/2026-27/21 has no items', detail: '', bills: [], more_bills: 0, customer: null, suggested: null }], notes: [], passes: [] }, prev_gstr3b_missing: '2026-08', download: { at: '2026-10-06T12:00:00+05:30', by: { id: 2, name: 'Neha Agarwal' }, via: 'download', stale: true, changed: [{ id: 405, invoice_number: 'KGH/2026-27/21', action: 'updated', at: '2026-10-07', by: 'Kailash Mehta' }] } });
  const submit = vi.fn(); renderApp(<FilingDialog month={m} kind="gstr1" onClose={vi.fn()} onSubmit={submit} />); ready();
  expect(screen.getByText("August's GSTR-3B isn't marked filed. The portal takes September's GSTR-1 only after it.")).toBeInTheDocument();
  expect(screen.getByText(/KGH\/2026-27\/21 changed after Neha Agarwal/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Mark GSTR-1 filed' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'GSTR-1 is on the GST portal, even though a check fails here' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mark GSTR-1 filed' }));
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ confirm_checks: true }));
});

test('cash difference opens portal credit and serializes zero, odd paise and optional charges exactly', () => {
  const submit = vi.fn(); renderApp(<FilingDialog month={corrected()} kind="gstr3b" onClose={vi.fn()} onSubmit={submit} />); ready();
  fireEvent.change(screen.getByLabelText('Cash paid with GSTR-3B'), { target: { value: '80000.01' } });
  expect(screen.getByRole('button', { name: 'Credit left on the portal after this return' })).toHaveAttribute('aria-expanded', 'true');
  fireEvent.change(screen.getByLabelText('IGST credit'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('CGST credit'), { target: { value: '10.01' } });
  fireEvent.change(screen.getByLabelText('Late fee paid'), { target: { value: '250' } });
  fireEvent.change(screen.getByLabelText('Interest paid'), { target: { value: '18.49' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'GSTR-3B is filed and the tax is paid on the GST portal' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mark filed and lock' }));
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ cash_total: '80000.01', credit_left: { igst: '0.00', cgst: '10.01', sgst: '3.00' }, late_fee: '250.00', interest: '18.49' }));
});

test('GSTR-3B can record GSTR-1A corrections at the same time', () => {
  const submit = vi.fn(); renderApp(<FilingDialog month={corrected()} kind="gstr3b" onClose={vi.fn()} onSubmit={submit} />); ready();
  fireEvent.click(screen.getByRole('checkbox', { name: 'GSTR-1A with these corrections is filed too' }));
  fireEvent.change(screen.getByLabelText('GSTR-1A filed on'), { target: { value: '24 Oct 2026' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'GSTR-3B is filed and the tax is paid on the GST portal' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mark filed and lock' }));
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ gstr1a_filed_on: '2026-10-24' }));
});

test('invalid ARN and reversed filing dates cannot submit', () => {
  const submit = vi.fn(); renderApp(<FilingDialog month={corrected()} kind="gstr3b" onClose={vi.fn()} onSubmit={submit} />); ready();
  fireEvent.change(screen.getByLabelText('GSTR-3B filed on'), { target: { value: '7 Oct 2026' } });
  fireEvent.change(screen.getByLabelText('GSTR-3B ARN'), { target: { value: 'bad' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'GSTR-3B is filed and the tax is paid on the GST portal' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mark filed and lock' }));
  expect(screen.getByText('GSTR-3B is filed on or after GSTR-1 (08 Oct 2026).')).toBeInTheDocument();
  expect(screen.getByText(/An ARN has 15 letters and digits \(this has 3\)/)).toBeInTheDocument();
  expect(submit).not.toHaveBeenCalled();
});

test('retry retains typed values; busy save blocks cancel and inputs', () => {
  const submit = vi.fn(), close = vi.fn(), m = month();
  const props = { month: m, kind: 'gstr1' as const, onClose: close, onSubmit: submit };
  function Retry() { const [failed, setFailed] = useState(false); const [busy, setBusy] = useState(false); return <><button onClick={() => setFailed(true)}>Fail save</button><button onClick={() => setBusy(true)}>Start save</button><FilingDialog {...props} busy={busy} error={failed ? { kind: 'offline', message: "You're offline" } : null} /></>; }
  renderApp(<Retry />); ready();
  fireEvent.change(screen.getByLabelText('GSTR-1 ARN'), { target: { value: 'AA0810260345671' } });
  fireEvent.click(screen.getByText('Fail save'));
  expect(screen.getByLabelText('GSTR-1 ARN')).toHaveValue('AA0810260345671');
  expect(screen.getByText('What you typed is still here. Save again when the internet is back.')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Start save'));
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect(screen.getByLabelText('GSTR-1 filed on')).toBeDisabled();
  expect(screen.getByLabelText('GSTR-1 ARN')).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(close).not.toHaveBeenCalled();
});

test('as-filed download remains enabled after the books develop blockers; only owner can unlock/remove', () => {
  const m = month(); m.stage = 'filed'; m.record.gstr1 = filing('gstr1'); m.record.gstr3b = filing('gstr3b'); m.gstr1!.file.made = false; m.gstr1!.file.why_not = 'Fix the checks first';
  renderApp(<FilingCard month={m} onAction={vi.fn()} />, { me: { role: 'accountant', permissions: ['view', 'gst.file', 'gst.download', 'gst.lock'] } });
  expect(screen.getByRole('button', { name: 'Download GSTR-1 as filed' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Unlock September…' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Remove this record' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Edit filing details' })).toHaveLength(2);
});

test('legacy filing details and viewer read-only state remain accessible', () => {
  const m = month(); m.stage = 'filed'; m.record.legacy = true;
  renderApp(<FilingCard month={m} onAction={vi.fn()} />, { me: { role: 'viewer', permissions: ['view'] } });
  expect(screen.getByText('Filed and locked · before the app kept filing records')).toBeInTheDocument();
  expect(screen.getByText(/You can look at every return/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add the filing details' })).not.toBeInTheDocument();
});

test('amendments use server routing and show GSTR-1A filing plus relock for accountants', () => {
  const action = vi.fn(); renderApp(<AmendCard month={corrected()} onAction={action} />, { me: { role: 'accountant', permissions: ['view', 'gst.file', 'gst.download', 'gst.lock'] } });
  expect(screen.getByText('Goes in GSTR-1A · B2B')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Mark GSTR-1A filed…' }));
  expect(action).toHaveBeenCalledWith({ type: 'mark', kind: 'gstr1a' });
  expect(screen.getByRole('button', { name: 'Lock September again…' })).toBeEnabled();
});

test.each(['unlock', 'remove'] as const)('%s requires a trimmed reason', (kind) => {
  const submit = vi.fn(); renderApp(<PeriodDialog month={corrected()} kind={kind} record={filing('gstr1')} onClose={vi.fn()} onSubmit={submit} />); ready();
  fireEvent.click(screen.getByRole('button', { name: kind === 'unlock' ? 'Unlock September' : 'Remove this record' }));
  expect(submit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(kind === 'unlock' ? /Reason for unlocking/ : /Reason for removing/), { target: { value: '  Marked the wrong month  ' } });
  fireEvent.click(screen.getByRole('button', { name: kind === 'unlock' ? 'Unlock September' : 'Remove this record' }));
  expect(submit).toHaveBeenCalledWith({ business: 3, month: '2026-09', reason: 'Marked the wrong month' });
});

test.each(['unlock', 'remove'] as const)('%s denies an accountant even when mounted directly', (kind) => {
  const submit = vi.fn(); renderApp(<PeriodDialog month={corrected()} kind={kind} record={filing('gstr1')} onClose={vi.fn()} onSubmit={submit} />, { me: { role: 'accountant', permissions: ['view', 'gst.file', 'gst.lock'] } }); ready();
  const button = screen.getByRole('button', { name: kind === 'unlock' ? 'Unlock September' : 'Remove this record' });
  expect(button).toBeDisabled(); fireEvent.click(button); expect(submit).not.toHaveBeenCalled();
});

test('editing retains the recorded cash and snapshots while allowing the ARN to change', () => {
  const record = filing('gstr3b'), submit = vi.fn();
  renderApp(<FilingDialog month={corrected()} kind="gstr3b" record={record} onClose={vi.fn()} onSubmit={submit} />); ready();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Late fee paid')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('GSTR-3B ARN'), { target: { value: 'AA081026034590Z' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save filing details' }));
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ arn: 'AA081026034590Z' }));
  expect(submit.mock.calls[0][0]).not.toHaveProperty('cash_total');
  expect(record.arn).toBe('AA0810260345671');
  expect(submit.mock.calls[0][0]).not.toHaveProperty('figures');
});

test('relock submits only the month and keeps the figures as filed', () => {
  const submit = vi.fn(); renderApp(<PeriodDialog month={corrected()} kind="relock" onClose={vi.fn()} onSubmit={submit} />, { me: { role: 'accountant', permissions: ['view', 'gst.lock'] } }); ready();
  expect(screen.getByText("September's sales bills lock again. GSTR-1 stays as filed; the changes go in GSTR-1A, before you file GSTR-3B.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Lock September' }));
  expect(submit).toHaveBeenCalledWith({ business: 3, month: '2026-09' });
});

test('a stale fingerprint warns even when no changed bill can be named', () => {
  const m = month({ download: { at: '2026-10-06T12:00:00+05:30', by: { id: 2, name: 'Neha Agarwal' }, via: 'download', stale: true, changed: [] } });
  renderApp(<FilingDialog month={m} kind="gstr1" onClose={vi.fn()} onSubmit={vi.fn()} />);
  expect(screen.getByText(/The books make a different file from the one downloaded/)).toBeInTheDocument();
});

test('expired amendments remain visible and cannot produce a file', () => {
  const m = corrected(); m.since_filing!.rows[0].too_late = true;
  renderApp(<AmendCard month={m} onAction={vi.fn()} />);
  expect(screen.getByText('Too late to amend on the portal (30 Nov 2027 was the last day). Ask your CA.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Download the amendments' })).toBeDisabled();
});

test('counter staff see filing controls disabled with the role reason', () => {
  const m = month(); renderApp(<FilingCard month={m} onAction={vi.fn()} />, { me: { role: 'staff', permissions: ['view'] } });
  expect(screen.getByRole('button', { name: 'Download GSTR-1 file for the portal' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Mark GSTR-1 filed…' })).toBeDisabled();
  expect(screen.getByText('Only the owner and the accountant can mark returns filed. Ask the owner if you need it.')).toBeInTheDocument();
});

test('a correction on a locked month does not offer relock', () => {
  const m = corrected(); m.stage = 'gstr1'; renderApp(<AmendCard month={m} onAction={vi.fn()} />);
  expect(screen.queryByRole('button', { name: 'Lock September again…' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Mark GSTR-1A filed…' })).toBeEnabled();
});

test.each([false, true])('metadata-only edits preserve payment heads and untouched optional amounts (portal credit %s)', (portalCredit) => {
  const record = filing('gstr3b'), submit = vi.fn();
  record.filed_on = '2026-10-24'; record.cash = heads(100, 4000000, 4000001);
  record.late_fee = 25000; record.interest = 1849; record.credit_left = portalCredit ? heads(0, 1001, 300) : null;
  renderApp(<FilingDialog month={corrected()} kind="gstr3b" record={record} onClose={vi.fn()} onSubmit={submit} />); ready();
  fireEvent.change(screen.getByLabelText('GSTR-3B ARN'), { target: { value: 'AA081026034590Z' } });
  fireEvent.change(screen.getByLabelText('GSTR-3B filed on'), { target: { value: '20 Oct 2026' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save filing details' }));
  expect(submit).toHaveBeenCalledWith({ business: 3, month: '2026-09', kind: 'gstr3b', filed_on: '2026-10-20', arn: 'AA081026034590Z' });
  expect(record.cash).toEqual({ igst: 100, cgst: 4000000, sgst: 4000001, total: 8000101 });
  expect(record.late_fee).toBe(25000); expect(record.interest).toBe(1849);
});

test('editing only the cash leaves credit and charges out of PATCH', () => {
  const record = filing('gstr3b'), submit = vi.fn(); record.credit_left = heads(0, 1001, 300);
  renderApp(<FilingDialog month={corrected()} kind="gstr3b" record={record} onClose={vi.fn()} onSubmit={submit} />); ready();
  fireEvent.change(screen.getByLabelText('Cash paid with GSTR-3B'), { target: { value: '80000.01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save filing details' }));
  expect(submit).toHaveBeenCalledWith({ business: 3, month: '2026-09', kind: 'gstr3b', filed_on: record.filed_on, arn: record.arn, cash_total: '80000.01' });
});

test('editing optional amounts sends only those changes and allows an explicit clear', () => {
  const record = filing('gstr3b'), submit = vi.fn(); record.filed_on = '2026-10-24'; record.late_fee = 25000; record.interest = 1849; record.credit_left = heads(0, 1001, 300);
  renderApp(<FilingDialog month={corrected()} kind="gstr3b" record={record} onClose={vi.fn()} onSubmit={submit} />); ready();
  fireEvent.change(screen.getByLabelText('CGST credit'), { target: { value: '12.34' } });
  fireEvent.change(screen.getByLabelText('Late fee paid'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Interest paid'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save filing details' }));
  expect(submit).toHaveBeenCalledWith({ business: 3, month: '2026-09', kind: 'gstr3b', filed_on: record.filed_on, arn: record.arn, credit_left: { igst: '0.00', cgst: '12.34', sgst: '3.00' }, late_fee: null, interest: '0.00' });
});

test('relock names failed checks and still permits locking the recorded figures', () => {
  const m = corrected(), submit = vi.fn(); m.checks.blockers = [{ kind: 'empty', blocks: true, text: 'KGH/2026-27/21 has no items', detail: '', bills: [], more_bills: 0, customer: null, suggested: null }];
  renderApp(<PeriodDialog month={m} kind="relock" onClose={vi.fn()} onSubmit={submit} />); ready();
  expect(screen.getByText('1 check fails for September')).toBeInTheDocument();
  expect(screen.getByText('KGH/2026-27/21 has no items')).toBeInTheDocument();
  expect(screen.getByText('You can lock the month again. The returns stay as filed; the portal file stays blocked until the checks pass.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Lock September' }));
  expect(submit).toHaveBeenCalledWith({ business: 3, month: '2026-09' });
});

test('a check that fails after GSTR-1 is filed is not shown as the next step', () => {
  const blocker = { kind: 'hsn' as const, blocks: true, text: 'A line has no HSN code', detail: '', bills: [], more_bills: 0, customer: null, suggested: null };
  const m = month({ stage: 'gstr1', checks: { blockers: [blocker], notes: [], passes: [] } }); m.record.gstr1 = filing('gstr1');
  const view = renderApp(<FilingCard month={m} onAction={vi.fn()} />);
  const steps = screen.getByRole('list', { name: 'Filing steps' });
  expect(steps.querySelector('[aria-current="step"]')).toHaveTextContent(/GSTR-3B/);
  expect(steps).not.toHaveTextContent(/^Fix 1 check/);
  view.unmount();
  m.stage = 'filed'; m.record.gstr3b = filing('gstr3b');
  renderApp(<FilingCard month={m} onAction={vi.fn()} />);
  expect(screen.getByRole('list', { name: 'Filing steps' }).querySelector('[aria-current="step"]')).toBeNull();
});

test('moving a late GSTR-3B to on time offers to clear the recorded late fee and interest', () => {
  const record = filing('gstr3b'), submit = vi.fn(); record.filed_on = '2026-10-24'; record.late_fee = 25000; record.interest = 1849;
  renderApp(<FilingDialog month={corrected()} kind="gstr3b" record={record} onClose={vi.fn()} onSubmit={submit} />); ready();
  fireEvent.change(screen.getByLabelText('GSTR-3B filed on'), { target: { value: '19 Oct 2026' } });
  fireEvent.blur(screen.getByLabelText('GSTR-3B filed on'));
  fireEvent.click(screen.getByRole('checkbox', { name: 'GSTR-3B is now on time: clear the late fee and interest recorded (₹268.49)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save filing details' }));
  expect(submit).toHaveBeenCalledWith({ business: 3, month: '2026-09', kind: 'gstr3b', filed_on: '2026-10-19', arn: record.arn, late_fee: null, interest: null });
});

test('the GSTR-1A summary shows the correction, not the whole month', () => {
  renderApp(<FilingDialog month={corrected()} kind="gstr1a" onClose={vi.fn()} onSubmit={vi.fn()} />); ready();
  expect(screen.getByText('Tax change since GSTR-1').parentElement).toHaveTextContent('+₹3.00');
  expect(screen.queryByText('Tax on sales')).not.toBeInTheDocument();
});

test('amendment bills open through an in-app link, and a legacy month without a plan corrects in the next GSTR-1', () => {
  const view = renderApp(<AmendCard month={corrected()} onAction={vi.fn()} />);
  expect(screen.getByRole('link', { name: 'Open the bill' })).toHaveAttribute('href', '/sales/405');
  view.unmount();
  const m = corrected(); m.amendments = null; m.record = { ...m.record, gstr1: null, legacy: true };
  renderApp(<AmendCard month={m} onAction={vi.fn()} />);
  expect(screen.getByText("Both returns filed · corrections go in October's GSTR-1")).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mark GSTR-1A filed…' })).not.toBeInTheDocument();
});
