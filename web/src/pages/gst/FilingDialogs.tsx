import { useRef, useState } from 'react';
import { useAuth } from '@/core/auth/AuthProvider';
import { saveFailure, type ApiProblem } from '@/core/api/errors';
import { addMonths, date, inr, monthLabel, paiseToDecimal, plural, todayIST } from '@/core/format';
import type { Filing, FilingInput, Head, Month } from '@/core/gst/types';
import { Banner, Button, Checkbox, Dialog, Disclosure, DL, FailNote, Field, Input, MoneyInput, Textarea } from '@/core/ui';
import { DateField } from '@/pages/sales/form/fields';

type Common = { month: Month; busy?: boolean; error?: ApiProblem | null; onClose: () => void };
const labels = { gstr1: 'GSTR-1', gstr1a: 'GSTR-1A', gstr3b: 'GSTR-3B', both: 'GSTR-3B' };
const HEADS: Head[] = ['igst', 'cgst', 'sgst'];
const arnProblem = (s: string) => !s || /^[A-Z0-9]{15}$/.test(s) ? '' : `An ARN has 15 letters and digits (this has ${s.replace(/[^A-Z0-9]/g, '').length}). Copy it from the portal's confirmation, or leave it empty.`;

/** Controlled by the mutation owner: a failed save leaves every field and acknowledgement mounted. */
export function FilingDialog({ month: m, kind, record, busy = false, error, onClose, onSubmit }: Common & { kind: FilingInput['kind']; record?: Filing; onSubmit: (body: FilingInput) => void }) {
  const { can, whyNot } = useAuth();
  const today = todayIST(), name = monthLabel(m.month, { long: true, year: false });
  const next = monthLabel(addMonths(m.month, 1), { long: true, year: false });
  const cashReturn = kind === 'gstr3b' || kind === 'both';
  const worked = record?.cash_worked_out?.total ?? m.gstr3b?.cash.total ?? 0;
  const [filed, setFiled] = useState(record?.filed_on ?? today);
  const [g1, setG1] = useState(m.record.gstr1?.filed_on ?? today);
  const [g1a, setG1a] = useState(today);
  const [arn, setArn] = useState(record?.arn ?? '');
  const [arn1, setArn1] = useState('');
  const [arn1a, setArn1a] = useState('');
  const [cash, setCash] = useState<number | null>(record?.cash?.total ?? worked);
  const [credit, setCredit] = useState<Record<Head, number | null>>(record?.credit_left ?? m.gstr3b?.carry_on ?? { igst: 0, cgst: 0, sgst: 0 });
  const [lateFee, setLateFee] = useState<number | null>(record?.late_fee ?? null);
  const [interest, setInterest] = useState<number | null>(record?.interest ?? null);
  const [include1a, setInclude1a] = useState(false);
  const [acked, setAcked] = useState(false);
  const [tried, setTried] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const failedChecks = !record && (kind === 'gstr1' || kind === 'both') && m.checks.blockers.length > 0;
  const corrections = !record && kind === 'gstr3b' && Boolean(m.since_filing?.rows.length) && !m.record.gstr1a;
  const showCredit = cashReturn && (cash !== worked || record?.credit_left != null);
  const late = cashReturn && filed > m.due.gstr3b;
  const dateProblem = (value: string, label: string, key: string) => !value ? typed[key]?.trim() ? `“${typed[key]}” isn't a date. Type it like 08 Oct 2026.` : `Type the day you filed ${label}, like ${date(today)}.` : value < m.due.file_from ? `${label} for ${name} can't be filed before ${date(m.due.file_from)}.` : value > today ? "That's after today. Type the day you actually filed." : '';
  const firstDate = kind === 'both' ? g1 : m.record.gstr1?.filed_on;
  const fields: Record<string, string> = {
    filed_on: dateProblem(filed, labels[kind], 'filed_on') || (kind !== 'gstr1' && firstDate && filed < firstDate ? `${labels[kind]} is filed on or after GSTR-1 (${date(firstDate)}).` : ''),
    arn: arnProblem(arn),
    ...(kind === 'both' ? { gstr1_filed_on: dateProblem(g1, 'GSTR-1', 'gstr1_filed_on'), gstr1_arn: arnProblem(arn1) } : {}),
    ...(include1a ? { gstr1a_filed_on: dateProblem(g1a, 'GSTR-1A', 'gstr1a_filed_on') || (firstDate && g1a < firstDate ? `GSTR-1A is filed on or after GSTR-1 (${date(firstDate)}).` : g1a > filed ? 'GSTR-1A is filed on or before GSTR-3B.' : ''), gstr1a_arn: arnProblem(arn1a) } : {}),
    ...(cashReturn && (cash == null || cash < 0) ? { cash_total: 'Type the cash paid with GSTR-3B, or 0.' } : {}),
    ...(showCredit ? Object.fromEntries(HEADS.map((h) => [`credit_left.${h}`, credit[h] == null ? `Type the ${h.toUpperCase()} balance, or 0.` : credit[h]! < 0 ? "A credit balance can't be below zero." : ''])) : {}),
  };
  const show = (key: string) => error?.fields?.[key] || ((tried || touched[key]) ? fields[key] : '');
  const bad = Object.values(fields).some(Boolean);
  const submit = () => {
    setTried(true);
    if (busy || !can('gst.file') || bad || (!record && !acked)) return;
    const payment: Partial<FilingInput> = {};
    if (cashReturn) {
      // PATCH omission preserves both the recorded heads and the optional amounts.
      if (!record || cash !== (record.cash?.total ?? worked)) payment.cash_total = paiseToDecimal(cash!);
      if (!record || (showCredit && touched.credit_left && (!record.credit_left || HEADS.some(h => credit[h] !== record.credit_left![h])))) {
        payment.credit_left = showCredit ? { igst: paiseToDecimal(credit.igst!), cgst: paiseToDecimal(credit.cgst!), sgst: paiseToDecimal(credit.sgst!) } : null;
      }
      if (!record || (late && lateFee !== record.late_fee)) payment.late_fee = late && lateFee != null ? paiseToDecimal(lateFee) : null;
      if (!record || (late && interest !== record.interest)) payment.interest = late && interest != null ? paiseToDecimal(interest) : null;
    }
    onSubmit({ business: m.business, month: m.month, kind, filed_on: filed, arn,
      ...(kind === 'both' ? { gstr1_filed_on: g1, gstr1_arn: arn1 } : {}),
      ...(include1a ? { gstr1a_filed_on: g1a, gstr1a_arn: arn1a } : {}),
      ...payment,
      ...(!record ? { confirm_checks: failedChecks && acked } : {}),
    });
  };
  const dateField = (key: string, label: string, value: string, set: (value: string) => void) => <Field label={label} htmlFor={`mf-${key}`} error={show(key)}>{busy ? <Input id={`mf-${key}`} value={date(value)} disabled /> : <DateField id={`mf-${key}`} label={label} value={value} today={today} invalid={Boolean(show(key))} offReason={(iso) => dateProblem(iso, label.replace(' filed on', ''), key)} onChange={(iso, raw) => { set(iso ?? ''); setTyped((old) => ({ ...old, [key]: raw })); setTouched((old) => ({ ...old, [key]: true })); }} />}</Field>;
  const arnField = (key: string, label: string, value: string, set: (value: string) => void) => <Field label={label} htmlFor={`mf-${key}`} error={show(key)} hint="Optional. On the portal's confirmation after filing; kept as proof."><Input id={`mf-${key}`} value={value} onChange={(e) => set(e.target.value.toUpperCase().replace(/\s+/g, ''))} placeholder="Like AA0810260345671" maxLength={20} autoComplete="off" spellCheck={false} invalid={Boolean(show(key))} inputClassName="tnum uppercase" /></Field>;
  const ack = failedChecks ? `${kind === 'gstr1' ? 'GSTR-1 is' : 'Both returns are'} on the GST portal, even though a check fails here` : kind === 'both' ? 'Both returns are filed on the GST portal' : cashReturn ? 'GSTR-3B is filed and the tax is paid on the GST portal' : `${labels[kind]} is filed on the GST portal`;
  const title = record ? `Edit ${labels[kind]} filing details` : kind === 'both' ? `Mark both of ${name}'s returns filed?` : `Mark ${name}'s ${labels[kind]} filed?`;
  const changed = m.download?.changed.map((x) => x.invoice_number).join(', ');
  return <Dialog open onClose={busy ? () => {} : onClose} title={title} size="md" footer={<><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} disabled={!can('gst.file') || (!record && !acked) || (tried && bad)} onClick={submit}>{busy ? record ? 'Saving…' : 'Marking filed…' : error ? 'Try again' : record ? 'Save filing details' : cashReturn ? 'Mark filed and lock' : `Mark ${labels[kind]} filed`}</Button></>}>
    <div className="flex flex-col gap-3">
      <div className="rounded-ctl border border-line bg-field px-4 py-1"><DL rows={[["Firm", `${m.firm.name} · ${m.firm.gst_number}`], ['Month', monthLabel(m.month, { long: true })], ['Sales bills', `${m.gstr1?.bills ?? 0} · ${inr(m.gstr1?.total ?? 0)}`], [cashReturn ? 'Tax to pay in cash' : 'Tax on sales', inr(cashReturn ? worked : m.gstr1?.tax ?? 0)]]} /></div>
      <p className="text-fg2">{record ? 'The figures as filed stay the same. The change goes in the Audit log with the old and new details.' : kind === 'gstr1' ? `This locks ${name}'s sales bills against edits, cancels and deletes, and keeps GSTR-1 as filed. Purchases stay open for GSTR-3B, due ${date(m.due.gstr3b)}.` : kind === 'gstr1a' ? `This keeps GSTR-1A's corrected figures as filed. File GSTR-3B after GSTR-1A.` : `This locks ${name}: sales, purchases and credit. Every figure is kept as filed; ${next} carries on from it.`}</p>
      {failedChecks ? <Banner tone="neg" title={`${plural(m.checks.blockers.length, 'check')} ${m.checks.blockers.length === 1 ? 'fails' : 'fail'} for ${name}`}><ul className="list-disc pl-4">{m.checks.blockers.map((b, i) => <li key={i}>{b.text}</li>)}</ul><span className="block mt-1">Mark it only if the return is already on the portal (your CA may have filed with the fix made there). The portal file stays blocked here until the checks pass.</span></Banner> : null}
      {!record && (kind === 'gstr1' || kind === 'both') && m.prev_gstr3b_missing ? <Banner tone="muted" title="Previous return not on record">{monthLabel(m.prev_gstr3b_missing, { long: true, year: false })}'s GSTR-3B isn't marked filed. The portal takes {name}'s GSTR-1 only after it.</Banner> : null}
      {!record && m.download?.stale ? <Banner tone="neg" title="The file has changed">{changed ? `${changed} changed after ${m.download.by.name} ${m.download.via === 'share' ? 'sent' : 'downloaded'} the file on ${date(m.download.at.slice(0, 10))}.` : 'The books make a different file from the one downloaded.'} Check what the CA filed. The figures kept here are the books now.</Banner> : null}
      <fieldset disabled={busy} className="flex flex-col gap-3 min-w-0">
        {kind === 'both' ? <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{dateField('gstr1_filed_on', 'GSTR-1 filed on', g1, setG1)}{arnField('gstr1_arn', 'GSTR-1 ARN', arn1, setArn1)}</div> : null}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{dateField('filed_on', `${labels[kind]} filed on`, filed, setFiled)}{arnField('arn', `${labels[kind]} ARN`, arn, setArn)}</div>
        {corrections ? <><Banner tone="muted" title="Corrections since GSTR-1">GSTR-1A with these corrections isn't on record. Check what was filed before GSTR-3B.</Banner><Checkbox label="GSTR-1A with these corrections is filed too" checked={include1a} onChange={setInclude1a} />{include1a ? <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{dateField('gstr1a_filed_on', 'GSTR-1A filed on', g1a, setG1a)}{arnField('gstr1a_arn', 'GSTR-1A ARN', arn1a, setArn1a)}</div> : null}</> : null}
        {cashReturn ? <><Field label="Cash paid with GSTR-3B" htmlFor="mf-cash" error={show('cash_total')} hint={cash === worked ? `What the app worked out for ${name}.` : `The app worked out ${inr(worked)}. What you type is kept as paid.`}><MoneyInput id="mf-cash" value={cash} onChange={setCash} /></Field>
          {showCredit ? <Disclosure title="Credit left on the portal after this return" defaultOpen><p className="text-sm text-muted mb-3">The cash differs from the app's working, so the credit left on the portal may differ too. Copy it from the portal's electronic credit ledger.</p><div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{HEADS.map((h) => <Field key={h} label={`${h.toUpperCase()} credit`} htmlFor={`mf-credit-${h}`} error={show(`credit_left.${h}`)}><MoneyInput id={`mf-credit-${h}`} value={credit[h]} onChange={(value) => { setCredit((old) => ({ ...old, [h]: value })); setTouched((old) => ({ ...old, credit_left: true })); }} /></Field>)}</div></Disclosure> : null}
          {late ? <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><Field label="Late fee paid" htmlFor="mf-fee" hint="Optional. Kept as paid; separate from the tax." error={error?.fields?.late_fee}><MoneyInput id="mf-fee" value={lateFee} onChange={setLateFee} /></Field><Field label="Interest paid" htmlFor="mf-interest" hint="Optional. Kept as paid; separate from the tax." error={error?.fields?.interest}><MoneyInput id="mf-interest" value={interest} onChange={setInterest} /></Field></div> : null}
        </> : null}
        {!record ? <Checkbox label={ack} checked={acked} onChange={setAcked} /> : null}
      </fieldset>
      {!can('gst.file') ? <p className="text-sm text-neg">{whyNot('gst.file')}</p> : null}
      <FailNote error={error ? saveFailure(error) : null} />
    </div>
  </Dialog>;
}

export function PeriodDialog({ month: m, kind, record, busy = false, error, onClose, onSubmit }: Common & { kind: 'unlock' | 'relock' | 'remove'; record?: Filing; onSubmit: (body: { business: number; month: string; reason?: string }) => void }) {
  const { can, whyNot } = useAuth();
  const [reason, setReason] = useState('');
  const reasonField = useRef<HTMLTextAreaElement>(null);
  const [tried, setTried] = useState(false);
  const name = monthLabel(m.month, { long: true, year: false }), long = monthLabel(m.month, { long: true });
  const next = monthLabel(m.amendments?.carried_by ?? addMonths(m.month, 1), { long: true, year: false });
  const only1 = !m.record.gstr3b && !m.record.legacy, count = m.since_filing?.rows.length ?? 0;
  const action = kind === 'relock' ? 'gst.lock' : 'gst.unlock';
  const allowed = can(action);
  const example = m.since_filing?.rows[0]?.invoice_number ?? 'a bill';
  const missing = tried && !reason.trim() ? kind === 'remove' ? 'Say why in a few words. It goes into the Audit log.' : `Write why ${name} needs unlocking, for example “Wrong GSTIN on ${example}: correct it and amend in ${only1 ? `GSTR-1A for ${name}` : `${next}'s GSTR-1`}”.` : '';
  const submit = () => { setTried(true); if (busy || !allowed) return; if (kind !== 'relock' && (!reason.trim() || reason.trim().length > 255)) { reasonField.current?.focus(); return; } onSubmit({ business: m.business, month: m.month, ...(kind !== 'relock' ? { reason: reason.trim() } : {}) }); };
  const title = kind === 'remove' ? `Remove ${record ? labels[record.kind] : 'this'} filing record?` : kind === 'relock' ? `Lock ${name} again?` : only1 ? `Unlock ${name}'s sales bills?` : `Unlock ${long}?`;
  return <Dialog open onClose={busy ? () => {} : onClose} title={title} size="sm" footer={<><Button disabled={busy} onClick={onClose}>Cancel</Button><Button variant={kind === 'relock' ? 'primary' : 'danger'} disabled={!allowed} loading={busy} onClick={submit}>{busy ? kind === 'unlock' ? 'Unlocking…' : kind === 'remove' ? 'Removing…' : 'Locking…' : error ? 'Try again' : kind === 'remove' ? 'Remove this record' : `${kind === 'unlock' ? 'Unlock' : 'Lock'} ${name}`}</Button></>}>
    <div className="flex flex-col gap-3"><div className="rounded-ctl border border-line bg-field px-4 py-1"><DL rows={[["Firm", m.firm.name], ['Month', long], kind === 'relock' ? ['Changes since filing', count ? plural(count, 'bill') : 'None'] : ['Filed', [m.record.gstr1 ? `GSTR-1 ${date(m.record.gstr1.filed_on)}` : '', m.record.gstr3b ? `GSTR-3B ${date(m.record.gstr3b.filed_on)}` : ''].filter(Boolean).join(' · ')]]} /></div>
      <p className="text-fg2">{kind === 'remove' ? 'Remove a record marked by mistake. This does not remove a return from the GST portal. The reason and filing details go into the Audit log.' : kind === 'unlock' ? only1 ? `${name}'s sales bills can be changed again. GSTR-1 is already on the portal: corrections go in GSTR-1A for ${name}, before you file GSTR-3B.` : `${name}'s bills can be changed again. The returns on the portal don't change: corrections go in ${next}'s GSTR-1 as amendments, and any tax difference in ${next}'s GSTR-3B.` : only1 ? `${name}'s sales bills lock again. GSTR-1 stays as filed${count ? '; the changes go in GSTR-1A, before you file GSTR-3B' : ''}.` : `${name}'s bills lock again. The returns stay as filed${count ? `; the changes go in ${next}'s GSTR-1 as amendments and the tax difference in ${next}'s GSTR-3B` : ''}.`}</p>
      {kind === 'relock' && m.checks.blockers.length > 0 ? <Banner tone="neg" title={`${plural(m.checks.blockers.length, 'check')} ${m.checks.blockers.length === 1 ? 'fails' : 'fail'} for ${name}`}><ul className="list-disc pl-4">{m.checks.blockers.map((check, i) => <li key={i}>{check.text}</li>)}</ul><p className="mt-1">You can lock the month again. The returns stay as filed; the portal file stays blocked until the checks pass.</p></Banner> : null}
      {kind !== 'relock' ? <Field label={kind === 'unlock' ? 'Reason for unlocking' : 'Reason for removing'} htmlFor="period-reason" required error={error?.fields?.reason || missing} hint="Recorded in the Audit log with your name and the time."><Textarea ref={reasonField} id="period-reason" value={reason} disabled={busy} maxLength={255} invalid={Boolean(missing || error?.fields?.reason)} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'unlock' ? 'What needs correcting' : 'Why this record was marked by mistake'} /></Field> : null}
      {!allowed ? <p className="text-sm text-neg">{whyNot(action)}</p> : null}<FailNote error={error ? saveFailure(error) : null} />
    </div>
  </Dialog>;
}
