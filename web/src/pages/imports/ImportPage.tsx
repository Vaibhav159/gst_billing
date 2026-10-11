import { Fragment, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, ArrowRight, FileSpreadsheet, Check, Pencil } from 'lucide-react';
import { useAuth } from '@/core/auth/AuthProvider';
import { useFirms } from '@/core/scope';
import { GST_STATES, stateCodeOf } from '@/core/ids';
import { autoPos, isInterState } from '@/core/sales/pos';
import { inr, plural, todayIST, toPaise } from '@/core/format';
import { useUnsavedGuard } from '@/core/router/useUnsavedGuard';
import { Page, Card, Button, ButtonLink, Field, Input, Select, Table, Th, Td, Tr, Checkbox, Badge, Banner, Disclosure } from '@/core/ui';
import { IMPORT_KINDS } from './kinds';
import { readWorkbook, type Sheet } from './parse';
import { BILL_FIELDS, readSheet, sheetFirm, sheetKindHint, type ColumnOverrides, type Field as ImportField, type BillKind } from './columns';
import { addPatch, checkBill, groupBills, withEdits, type BillEdit } from './model';
import { makeBatches, matchParty, rowsText, useImportParties, useImportRates, type ReadyBill } from './workbook';
import { useImportSession } from './session';
import type { ImportKind, ImportResult } from './batch';
import { useIsPhone } from '@/core/device';
import { ImportMobile } from './ImportMobile';
import { ImportTemplate } from './Template';
import { TotalsByType } from './TotalsByType';
import { BillEditor } from './BillEditor';
type SavedBill = ImportResult['bills'][number] & { kind: ImportKind };
const STEPS = ['Choose the file', 'Check the layout', 'Check the bills', 'Import'];
export default function ImportPage() {
  return useIsPhone() ? <ImportMobile /> : <ImportDesktop />;
}
function ImportDesktop() {
  const { can } = useAuth(), { firms, loading: firmsLoading, error: firmsError } = useFirms();
  const navigate = useNavigate();
  const [template, setTemplate] = useState(false);
  const [params] = useSearchParams(), lean: BillKind = params.get('type') === 'purchases' ? 'purchase' : 'sale';
  const allowSale = can('bill.create'), allowBuy = can('purchase.import'), allowed = allowSale || allowBuy;
  const [step, setStep] = useState(1), [file, setFile] = useState<{ name: string; sheets: Sheet[] } | null>(null);
  const [reading, setReading] = useState(false), [error, setError] = useState('');
  const request = useRef(0);
  const [firmFix, setFirmFix] = useState<Record<string, number>>({}), [kindFix, setKindFix] = useState<Record<string, BillKind>>({});
  const [cols, setCols] = useState<Record<string, ColumnOverrides>>({}), [edits, setEdits] = useState<Record<string, BillEdit>>({});
  const [off, setOff] = useState<Record<string, boolean>>({}), [editing, setEditing] = useState<string | null>(null), [tab, setTab] = useState('all');
  const [partyFix, setPartyFix] = useState<Record<string, number>>({});
  const session = useImportSession();
  const [receipts, setReceipts] = useState<SavedBill[]>([]);
  const savedIds = [...new Map([...receipts, ...session.reports.flatMap(r => r.result.bills.filter(b => b.id !== null).map(b => ({ ...b, kind: r.kind })))].map(b => [`${b.kind}|${b.ref}`, b])).values()];
  const savedRefs = new Set(savedIds.map(b => `${b.kind}|${b.ref}`));
  const sheets = useMemo(() => (file?.sheets ?? []).map(src => {
    const read = readSheet(src, cols[src.name]); const auto = sheetFirm(firms.map(f => ({ ...f, gst_number: f.gstin })), read);
    return { src, read, firmId: firmFix[src.name] ?? auto.firm?.id ?? null, kind: kindFix[src.name] ?? sheetKindHint(read) ?? lean, auto };
  }), [file, cols, firms, firmFix, kindFix, lean]);
  const raw = useMemo(() => sheets.filter(s => !s.read.summary).flatMap(s => groupBills(s.read, s.kind)), [sheets]);
  const bills = useMemo(() => raw.map(b => withEdits(b, edits[b.key])), [raw, edits]);
  const parties = useImportParties(bills, step >= 3 && allowed);
  const matched = new Map(bills.map(b => {
    const query = parties.get(b.gstin.trim() || b.party.trim());
    const candidates = query?.data?.rows ?? [], match = matchParty(b.party, b.gstin, candidates);
    const person = candidates.find(p => p.id === partyFix[b.key]) ?? match.exact;
    return [b.key, { query, match, person }];
  }));
  const supplierIdsByBill = Object.fromEntries(bills.filter(b => { const q = matched.get(b.key)?.query; return q?.isSuccess && !q.data.next; }).map(b => [b.key, matched.get(b.key)?.person?.id ?? null]));
  const rates = useImportRates(bills, step >= 3 && allowed, supplierIdsByBill);
  const analysed = bills.filter(b => !savedRefs.has(`${b.kind === 'purchase' ? 'purchases' : 'sales'}|Sheet “${b.sheet}” ${rowsText(b.rows)}`)).map(b => {
    const sheet = sheets.find(s => s.src.name === b.sheet)!;
    const { query: q, match, person } = matched.get(b.key)!;
    const billRates = rates.byBill.get(b.key)!;
    const firm = firms.find(f => f.id === sheet.firmId);
    const gst = person?.gst_number ?? b.gstin;
    const firmState = firm ? autoPos(stateCodeOf(firm.state), { type: 'business', gst_number: firm.gstin }) : '';
    const partyState = autoPos(stateCodeOf(person?.state_name ?? firm?.state), { type: 'business', gst_number: gst });
    const c = checkBill(b, { firmId: sheet.firmId, today: todayIST(), canSale: allowSale, canPurchase: allowBuy, partyId: person?.id, partyGstin: gst, interstate: isInterState(firmState, partyState), usualRates: Object.fromEntries(Object.entries(billRates.rates).filter(([, v]) => v !== null).map(([k, v]) => [k, toPaise(v) ?? 0])) });
    const loading = Boolean(q?.isPending) || billRates.loading;
    const failed = Boolean(q?.isError) || billRates.error || Boolean(q?.data?.next);
    const state = c.state === 'role' ? 'role' : failed ? 'fix' : c.state;
    const selectable = !loading && !failed && ['ready', 'check'].includes(state);
    const selected = selectable && !(off[b.key] ?? state === 'check');
    return { b, sheet, c, person, suggestion: match.suggestion, loading, failed, state, selectable, selected, partyState };
  });
  const chosen = analysed.filter(a => a.selected);
  const complete = session.checks.length > 0 && session.checks.every(check => check.result.bills.every(b => savedRefs.has(`${check.kind}|${b.ref}`))) && !session.busy && !session.error;
  const leave = useUnsavedGuard(Boolean(file) && !complete, 'The file and your changes are still here. Leave without importing?');
  const invalidate = () => { setReceipts(savedIds); session.reset(); };
  const take = async (f: File) => {
    if (session.busy) return;
    const id = ++request.current; setReading(true); setError(''); invalidate();
    try {
      const parsed = await readWorkbook(f); if (id !== request.current) return;
      if (!parsed.some(s => readSheet(s).rows.length)) throw new Error(`No bills were found in ${f.name}: no row of column headings with a bill number, a party and an amount. Check the file against the template.`);
      setFile({ name: f.name, sheets: parsed }); setReceipts([]); setCols({}); setFirmFix({}); setKindFix({}); setEdits({}); setOff({}); setPartyFix({}); setStep(1);
    } catch (e) { if (id === request.current) setError(e instanceof Error ? e.message : `${f.name} couldn't be read.`); }
    finally { if (id === request.current) setReading(false); }
  };
  const review = async () => {
    const selected: ReadyBill[] = chosen.map(({ b, sheet, c, person, partyState }) => ({ key: b.key, sheet: b.sheet, rows: b.rows, kind: b.kind, business: sheet.firmId!, party: person?.id ?? { name: b.party, gst_number: b.gstin, state_name: GST_STATES[partyState] ?? '', city: '', address: '' }, invoice_number: b.number.trim(), invoice_date: c.invoiceDate!, payment_mode: c.payment, lines: c.lines }));
    if (await session.check(makeBatches(file!.name, selected))) setStep(4);
  };
  const missing = sheets.flatMap(s => s.read.summary ? [] : s.read.tables.filter(t => {
    const fields = new Set(t.columns.map(c => c.field)); return !fields.has('number') || !fields.has('date') || !fields.has('party') || !(fields.has('taxable') || fields.has('total') || (fields.has('qty') && fields.has('price')));
  }));
  const patch = (key: string, edit: BillEdit) => { invalidate(); setPartyFix(x => { const next = { ...x }; delete next[key]; return next; }); setEdits(x => ({ ...x, [key]: edit })); };
  const savedLinks = savedIds.map(b => <p key={`${b.kind}-${b.ref}`}><ButtonLink to={`/${b.kind}/${b.id}`}>Open {bills.find(r => `Sheet “${r.sheet}” ${rowsText(r.rows)}` === b.ref)?.number ?? b.ref}</ButtonLink></p>);
  return <Page title="Import from Excel or Tally" icon={FileSpreadsheet} context="Read a workbook, check each bill, then import." breadcrumbs={[{ label: 'Purchases', to: '/purchases' }]} actions={<><Button onClick={() => setTemplate(true)}>See the template</Button><ButtonLink to="/purchases/ai-import">Import bill photos</ButtonLink></>}>
    {leave}
    <ImportTemplate open={template} onClose={() => setTemplate(false)} firms={firms.map(f => ({ ...f, gst_number: f.gstin }))} />
    {!allowed ? <Card><p>You can look, but not import bills</p></Card> : <>
      <Field label="What are you importing?" htmlFor="import-kind"><Select id="import-kind" disabled={session.busy} options={IMPORT_KINDS.map(k => ({ value: k.value, label: k.label }))} value="bills" onChange={e => { const kind = IMPORT_KINDS.find(k => k.value === e.target.value); if (kind && kind.value !== 'bills') navigate(kind.to); }} /></Field>
      <ol aria-label="Steps" className="flex flex-wrap gap-x-5 gap-y-1 text-sm">{STEPS.map((label, i) => <li key={label}><button className="inline-flex items-center gap-1.5 min-h-8 rounded-md" disabled={i + 1 >= step || session.busy || (savedIds.length > 0 && (i + 1 !== 3 || complete))} aria-current={i + 1 === step ? 'step' : undefined} onClick={() => { invalidate(); setStep(i + 1); }}><span className="w-5 h-5 rounded-full grid place-items-center text-2xs border border-line">{i + 1 < step ? <Check size={12} aria-hidden="true" /> : i + 1}</span>{label}</button></li>)}</ol>
      {error ? <Banner tone="neg" title="The file couldn't be read">{error}</Banner> : null}
      {session.error ? <Banner tone="neg" title={savedIds.length ? 'Some bills are saved' : 'Check the import'}>{session.error}</Banner> : null}
      {step !== 4 && savedIds.length > 0 ? <Card title="Bills imported">{savedLinks}</Card> : null}
      {step === 1 ? <Card title="Choose the file" subtitle="Excel (.xlsx) or CSV, up to 20 MB. The file is read on this computer.">
        <Field label="Choose an Excel or CSV file" htmlFor="import-file"><Input id="import-file" type="file" accept=".xlsx,.xls,.csv" onChange={e => { const f = e.target.files?.[0]; if (f) void take(f); e.target.value = ''; }} /></Field>
        {reading ? <p role="status">Reading the file…</p> : null}
        {file ? <div className="flex flex-wrap items-center gap-3 rounded-ctl border border-line bg-field px-4 py-3 mt-4"><span className="flex-1"><strong>{file.name}</strong><span className="block text-sm text-muted">{plural(sheets.length, 'sheet')} · {plural(bills.length, 'bill')} found</span></span><Button onClick={() => { ++request.current; setFile(null); setReading(false); invalidate(); setReceipts([]); }}>Choose another file</Button><Button variant="primary" iconRight={ArrowRight} disabled={reading || firmsLoading || firmsError} onClick={() => setStep(2)}>Next: check the layout</Button></div> : null}
      </Card> : null}
      {step === 2 ? <>
        <p className="text-fg2">Each sheet is read on its own: whose bills they are, where sales and purchases are, and which column is which. Check anything marked, then go on to the bills.</p>
        {sheets.map((s, index) => <Card key={s.src.name} title={`Sheet “${s.src.name}”`} subtitle={s.read.summary ? 'A summary sheet: totals, not bills. Skipped.' : `${plural(s.read.rows.length, 'row')} of bills`}>
          {s.read.summary ? null : <div className="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-2"><Field label="Whose bills" htmlFor={`firm-${index}`} hint={s.firmId ? 'Every bill on this sheet follows this firm.' : 'Pick the firm once for the whole sheet.'}><Select id={`firm-${index}`} value={s.firmId ?? ''} placeholder="Choose the firm" options={firms.map(f => ({ value: String(f.id), label: `${f.name} · ${f.gstin}` }))} onChange={e => { invalidate(); setFirmFix(x => ({ ...x, [s.src.name]: Number(e.target.value) })); }} /></Field>
            {s.read.markers ? <p>Sales and purchases, by their Outward and Inward Supply headings</p> : <Field label="What's on it" htmlFor={`kind-${index}`}><Select id={`kind-${index}`} value={s.kind} options={[{ value: 'sale', label: 'Sales' }, { value: 'purchase', label: 'Purchases' }]} onChange={e => { invalidate(); setKindFix(x => ({ ...x, [s.src.name]: e.target.value as BillKind })); }} /></Field>}</div>
            {s.read.tables.map(t => <Disclosure key={t.n} title={`Columns on row ${t.n}`} defaultOpen><Table label={`Columns on sheet ${s.src.name}, row ${t.n}`}><thead><tr><Th>Column in the file</Th><Th>Read as</Th><Th>How sure</Th></tr></thead><tbody>{t.columns.map(c => <Tr key={c.i}><Td>{c.heading}</Td><Td><Select aria-label={`Read the column ${c.heading} as`} value={c.field ?? ''} options={[{ value: '', label: 'Not used' }, ...Object.entries(BILL_FIELDS).map(([value, label]) => ({ value, label }))]} onChange={e => { invalidate(); setCols(x => ({ ...x, [s.src.name]: { ...x[s.src.name], [t.n]: { ...x[s.src.name]?.[t.n], [c.i]: e.target.value as ImportField | '' } } })); }} /></Td><Td>{c.sure === 'you' ? 'Chosen by you' : c.sure === 'sure' ? 'Sure' : c.sure === 'check' ? 'Check this' : 'Not used'}</Td></Tr>)}</tbody></Table></Disclosure>)}
            {s.read.skipped.length ? <Disclosure title={`${plural(s.read.skipped.length, 'row')} that aren't bills`}><ul>{s.read.skipped.map(r => <li key={r.n}>Row {r.n} · {r.why} · {r.text}</li>)}</ul></Disclosure> : null}
          </div>}
        </Card>)}
        {missing.length ? <Banner tone="neg" title="Some columns aren't read yet">Pick Bill number, Bill date, Party and an amount under Read as.</Banner> : null}
        <div className="flex justify-between"><Button icon={ArrowLeft} onClick={() => setStep(1)}>Back</Button><Button variant="primary" iconRight={ArrowRight} disabled={Boolean(missing.length)} onClick={() => setStep(3)}>Next: check the bills</Button></div>
      </> : null}
      {step === 3 ? <fieldset disabled={session.busy} className="min-w-0 border-0 p-0 m-0 contents">
        <Card><div className="flex flex-wrap gap-2">{[['all', 'All'], ['ready', 'Ready'], ['check', 'To check'], ['fix', 'To fix'], ['role', 'Not for your role'], ['off', 'Left out by you']].map(([value, label]) => <Button key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</Button>)}</div><p className="mt-3 text-sm text-muted">Problems are said in plain words, with the fix beside them; Edit changes any bill in place. Nothing is added until you import.</p>
          {analysed.some(a => a.suggestion) ? <Button onClick={() => { invalidate(); setPartyFix(x => ({ ...x, ...Object.fromEntries(analysed.filter(a => a.suggestion).map(a => [a.b.key, a.suggestion!.id])) })); }}>Match all similar names</Button> : null}
        </Card>
        {sheets.flatMap(sheet => (['sale', 'purchase'] as const).map(kind => {
          const group = analysed.filter(a => a.b.sheet === sheet.src.name && a.b.kind === kind && (tab === 'all' || (tab === 'off' ? off[a.b.key] : a.state === tab)));
          if (!group.length) return null;
          return <Card key={`${sheet.src.name}-${kind}`} pad={false} title={`${firms.find(f => f.id === sheet.firmId)?.name ?? 'Firm not picked'} · ${kind === 'sale' ? 'Sales' : 'Purchases'}`} subtitle={`Sheet “${sheet.src.name}” · ${plural(group.length, 'bill')}`}>
            {!sheet.firmId ? <div className="px-5 py-3"><Field label="Whose bills are these?" htmlFor={`review-firm-${sheet.src.name}-${kind}`}><Select id={`review-firm-${sheet.src.name}-${kind}`} placeholder="Choose the firm" value="" options={firms.map(f => ({ value: String(f.id), label: f.name }))} onChange={e => { invalidate(); setFirmFix(x => ({ ...x, [sheet.src.name]: Number(e.target.value) })); }} /></Field></div> : null}
            <Table label={`${kind === 'sale' ? 'Sales' : 'Purchases'} on sheet ${sheet.src.name}`} className="mt-1"><thead><tr>
              <Th className="w-10"><Checkbox hideLabel label="Import every ready bill on this table" checked={group.some(a => a.selectable) && group.filter(a => a.selectable).every(a => a.selected)} disabled={!group.some(a => a.selectable)} onChange={v => { invalidate(); setOff(x => ({ ...x, ...Object.fromEntries(group.filter(a => a.selectable && (!v || a.state !== 'check')).map(a => [a.b.key, !v])) })); }} /></Th>
              <Th>Bill</Th><Th>{kind === 'sale' ? 'Customer' : 'Supplier'}</Th><Th>Items</Th><Th align="right" className="hidden min-[1240px]:table-cell">Taxable</Th><Th align="right" className="hidden min-[1240px]:table-cell">GST</Th><Th align="right">Total</Th><Th>What was found</Th><Th className="w-12"><span className="sr-only">Edit</span></Th>
            </tr></thead><tbody>{group.map(a => {
              const b = a.b, ref = `Sheet “${b.sheet}” ${rowsText(b.rows)}`;
              const server = session.checks.flatMap(r => r.result.bills).find(r => r.ref === ref);
              return <Fragment key={b.key}><Tr>
                <Td><Checkbox hideLabel label={`Import ${b.number}`} checked={a.selected} disabled={!a.selectable || session.busy} onChange={v => { invalidate(); setOff(x => ({ ...x, [b.key]: !v })); }} /></Td>
                <Td className="min-w-[140px]"><strong className="tnum">{b.number}</strong><span className="block text-xs text-muted">{b.date}</span><span className="block text-xs text-muted">{rowsText(b.rows)}</span></Td>
                <Td className="max-w-[230px]"><span className="block font-medium">{b.party}</span><span className="block text-xs text-muted tnum">{b.gstin || 'No GSTIN'}</span><span className="block text-xs text-muted">{a.person ? `On file as ${a.person.name}` : 'New party: added only with these bills.'}</span></Td>
                <Td className="max-w-[230px]"><span className="block truncate">{b.lines.map(l => l.item).join(', ')}</span><span className="text-xs text-muted">{plural(b.lines.length, 'item')}</span></Td>
                <Td align="right" className="hidden min-[1240px]:table-cell">{inr(a.c.totals.taxable)}</Td><Td align="right" className="hidden min-[1240px]:table-cell">{inr(a.c.totals.tax)}</Td><Td align="right"><strong className="tnum">{inr(a.c.totals.total)}</strong><span className="block min-[1240px]:hidden text-xs text-muted">Taxable {inr(a.c.totals.taxable)} · GST {inr(a.c.totals.tax)}</span></Td>
                <Td className="min-w-[210px] max-w-[330px]"><Badge>{a.loading ? 'Checking…' : a.state === 'role' ? 'Not for your role' : a.state === 'ready' ? 'Ready' : a.state === 'check' ? 'To check' : 'To fix'}</Badge>
                  {a.failed ? <p role="alert">The party or usual rate couldn't be checked. Go back, then check the bills again.</p> : null}
                  {a.suggestion && !a.person ? <Button size="sm" onClick={() => { invalidate(); setPartyFix(x => ({ ...x, [b.key]: a.suggestion!.id })); }}>Use {a.suggestion.name}</Button> : null}
                  {[...a.c.problems, ...a.c.warnings].map((p, n) => <div key={`${p.field}-${n}`} className="mt-2 text-sm"><span>{p.detail}</span>{p.fix ? <Button size="sm" variant="link" onClick={() => patch(b.key, addPatch(edits[b.key], p.fix!.patch))}>{p.fix.label}</Button> : null}</div>)}
                  {a.c.notes.map((note, n) => <p key={`note-${n}`} className="mt-2 text-sm text-muted">{note}</p>)}
                  {server?.problems.map(p => <p key={p.field} role="alert" className="text-neg">{p.detail}</p>)}
                  {server?.duplicate ? <ButtonLink to={`/${b.kind === 'purchase' ? 'purchases' : 'sales'}/${server.duplicate.id}`}>Already in the app · {server.duplicate.invoice_number}</ButtonLink> : null}
                </Td><Td><Button size="sm" icon={Pencil} disabled={a.state === 'role' || session.busy} onClick={() => setEditing(editing === b.key ? null : b.key)}>Edit {b.number}</Button></Td>
              </Tr>{editing === b.key ? <Tr><Td colSpan={9}><BillEditor bill={b} onApply={edit => { patch(b.key, { ...edits[b.key], ...edit, lines: { ...edits[b.key]?.lines, ...edit.lines } }); setEditing(null); }} onUndo={() => { patch(b.key, {}); setEditing(null); }} onClose={() => setEditing(null)} /></Td></Tr> : null}</Fragment>;
            })}</tbody></Table>
          </Card>;
        }))}
        <Card title="What will be imported" subtitle="Ticked bills only, the way the GST returns count them. Untick a bill to leave it out."><TotalsByType rows={chosen.map(a => ({ kind: a.b.kind, gstin: a.person?.gst_number ?? a.b.gstin, totals: a.c.totals }))} /></Card>
        <div className="flex justify-between"><Button icon={ArrowLeft} disabled={session.busy || savedIds.length > 0} onClick={() => { invalidate(); setStep(2); }}>Back</Button><Button variant="primary" iconRight={ArrowRight} loading={session.busy} disabled={!chosen.length || session.busy} onClick={() => void review()}>Next: import {plural(chosen.length, 'bill')}</Button></div>
      </fieldset> : null}
      {step === 4 ? <Card title={complete ? 'Bills imported' : savedIds.length ? 'Some bills are saved' : 'What will be imported'}>
        {session.checked?.map(b => <p key={b.kind}>{plural(b.body.bills.length, b.kind === 'purchases' ? 'purchase bill' : 'sales bill')} · {file?.name}</p>)}
        {session.checks.map(r => <p key={r.kind}>{r.kind === 'purchases' ? 'Purchases' : 'Sales'} · {inr(toPaise(r.result.totals.total_amount) ?? 0)} · ITC {inr(toPaise(r.result.totals.credit) ?? 0)}</p>)}
        {savedLinks}
        {savedIds.length ? <><ButtonLink to="/purchases">View purchases</ButtonLink><Button disabled={session.busy} onClick={() => { if (session.busy) return; ++request.current; setFile(null); setStep(1); setEdits({}); setOff({}); invalidate(); setReceipts([]); }}>Import another file</Button></> : null}
        {!complete ? <Button onClick={() => { invalidate(); setStep(3); }} disabled={session.busy}>Back</Button> : null}
        {session.checked ? <Button variant="primary" loading={session.busy} onClick={() => void session.importChecked()}>Import {plural(session.checked.reduce((n, b) => n + b.body.bills.length, 0), 'bill')}</Button> : null}
      </Card> : null}
    </>}
  </Page>;
}
