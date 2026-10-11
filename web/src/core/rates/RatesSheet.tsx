import { useRef, useState } from 'react';
import { AlertTriangle, History } from 'lucide-react';
import { useAuth } from '@/core/auth/AuthProvider';
import { problemOf } from '@/core/api/errors';
import { dateShort, inr } from '@/core/format';
import { rateText } from '@/core/sales/words';
import { useView } from '@/core/view';
import { Banner, Button, Dialog, Field, MoneyInput, QueryView, useToast } from '@/core/ui';
import { useRates, useSetRates } from './api';
import { changed, moved, perGram, quotedErrors, RATE_ROWS, type QuoteInput, type Quoted, type RateKey, type Rates } from './model';

export function RatesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { can } = useAuth();
  const query = useRates(undefined, open && can('rates.edit'));
  if (!open || !can('rates.edit')) return null;
  return <QueryView query={query} what="today's rates">{data => <Editor initial={data} onClose={onClose} />}</QueryView>;
}
function Editor({ initial, onClose }: { initial: Rates; onClose: () => void }) {
  // Freeze the opening board: a background refresh must not replace typing or its comparison baseline.
  const [base] = useState(initial);
  const [values, setValues] = useState<QuoteInput>(() => Object.fromEntries(RATE_ROWS.map(r => [r.key, base.latest?.quoted[r.key] ?? null])) as QuoteInput);
  const [invalidRaw, setInvalidRaw] = useState<Partial<Record<RateKey, boolean>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [asked, setAsked] = useState(false);
  const mutation = useSetRates();
  const saving = useRef(false);
  const { isEasy } = useView();
  const { show } = useToast();
  const differences = moved(values, base.latest);
  const dirty = changed(values, base.latest);
  const unchanged = base.set_today && !dirty;
  const close = () => { if (!saving.current) onClose(); };
  const save = async () => {
    if (saving.current || unchanged) return;
    const invalid = { ...quotedErrors(values), ...Object.fromEntries(RATE_ROWS.filter(r => invalidRaw[r.key]).map(r => [r.key, "That's not an amount."])) };
    if (Object.keys(invalid).length) { setErrors(invalid); setMessage(Object.values(invalid)[0]!); return; }
    if (differences.length && !asked) {
      setAsked(true); setMessage(`${differences.length} rates moved more than a fifth since ${dateShort(base.latest!.on)}. Check them, then save again.`); return;
    }
    saving.current = true;
    try {
      await mutation.mutateAsync(values as Quoted);
      show({ title: "Today's rates are set", body: "The board shows these until they're changed." }); onClose();
    } catch (error) {
      const problem = problemOf(error);
      setErrors(Object.fromEntries(Object.entries(problem.fields ?? {}).map(([k, v]) => [k.replace(/^quoted\./, ''), v])));
      setMessage(problem.kind === 'offline' ? "You're offline, so the rates weren't saved. The last board stays visible."
        : problem.kind === 'unreachable' || problem.kind === 'server' ? "The rates weren't saved: the app couldn't get through. The last board stays visible; try again in a minute." : problem.message);
    } finally { saving.current = false; }
  };
  return <Dialog open onClose={close} title="Today's rates" description="Type them as the board reads: gold per 10 g, silver per kg. The board is a reference; type each bill's rate as written."
    confirmClose={!mutation.isPending && dirty ? 'Discard the changes to these rates?' : undefined}
    footer={<><Button onClick={close} disabled={mutation.isPending}>{isEasy ? 'Go back' : 'Cancel'}</Button><Button variant="primary" loading={mutation.isPending} disabled={unchanged} onClick={() => void save()}>{mutation.isPending ? 'Saving…' : asked && differences.length ? 'Yes, save these rates' : "Save today's rates"}</Button></>}>
    <div className="flex flex-col gap-4">
      {message ? <Banner tone="neg" icon={AlertTriangle} title={message} /> : null}
      {RATE_ROWS.map(row => {
        const value = values[row.key], old = base.latest?.quoted[row.key];
        const warning = differences.includes(row.key) && value != null && old
          ? `That's ${value > old ? 'up' : 'down'} ${Math.round(Math.abs(value - old) * 100 / old)}% on ${dateShort(base.latest!.on)} (${inr(old)}). Check it's per ${row.per_label}.` : '';
        const valid = value != null && Number.isSafeInteger(value) && value > 0 && value <= 999999999;
        return <Field key={row.key} label={`${row.label} (${row.sub}) per ${row.per_label}`} htmlFor={`rate-${row.key}`} error={errors[row.key]}
          hint={warning || (valid ? `${rateText(perGram(value, row.per))} a gram` : base.latest ? `${dateShort(base.latest.on)}: ${inr(old)} per ${row.per_label}` : 'Not set')}>
          <MoneyInput id={`rate-${row.key}`} value={value} disabled={mutation.isPending} onChange={(p, raw) => {
            setValues(v => ({ ...v, [row.key]: p })); setInvalidRaw(v => ({ ...v, [row.key]: p == null && raw.trim() !== '' }));
            setErrors(e => { const next = { ...e }; delete next[row.key]; return next; }); setMessage(''); setAsked(false);
          }} />
        </Field>;
      })}
      {base.previous ? <p className="text-sm text-muted flex items-center gap-1.5"><History size={14} aria-hidden="true" />
        {dateShort(base.previous.on)}: Gold 22K {inr(base.previous.quoted['gold-22K'])} per 10 g · Silver 999 {inr(base.previous.quoted['silver-999'])} per kg
      </p> : null}
    </div>
  </Dialog>;
}
