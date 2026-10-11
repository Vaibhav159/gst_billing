import { useState } from 'react';
import { Coins, Pencil } from 'lucide-react';
import { useAuth } from '@/core/auth/AuthProvider';
import { cn } from '@/core/cn';
import { dateShort, inr } from '@/core/format';
import { rateText, timeOf } from '@/core/sales/words';
import { Button, Card, Money, QueryView } from '@/core/ui';
import { useRates } from '@/core/api/dashboard';
import { RATE_ROWS, type Rates } from './model';
import { RatesSheet } from './RatesSheet';
export type RatesVariant = 'card' | 'strip' | 'easy';
export function RatesCard({ variant = 'card', className }: { variant?: RatesVariant; className?: string }) {
  const query = useRates();
  return <QueryView query={query} what="today's rates">{data => <BoardCard data={data} variant={variant} className={className} />}</QueryView>;
}
function BoardCard({ data, variant, className }: { data: Rates; variant: RatesVariant; className?: string }) {
  const { can, whyNot } = useAuth(); const allowed = can('rates.edit');
  const [open, setOpen] = useState(false); const board = data.latest;
  const stale = !data.set_today;
  const setLine = !board ? 'No rates have been set yet' : stale
    ? `Not set today · last set ${dateShort(board.on)} at ${timeOf(board.set_at)}`
    : `Set today at ${timeOf(board.set_at)}${board.set_by ? ` by ${board.set_by.name}` : ''}`;
  const sheet = <RatesSheet open={open} onClose={() => setOpen(false)} />;
  if (variant === 'strip') return <>
    <button type="button" onClick={() => { if (allowed) setOpen(true); }} aria-disabled={!allowed || undefined}
      className={cn('card w-full flex items-center gap-3 px-4 py-3 text-left min-h-14', className)} title={allowed ? undefined : whyNot('rates.edit')}>
      <Coins size={20} className="text-brand shrink-0" aria-hidden="true" />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold">{stale ? setLine : `Today's rates · set ${timeOf(board?.set_at)}`}</span>
        {RATE_ROWS.filter(row => ['gold-22K', 'silver-999'].includes(row.key)).map(row => <span key={row.key} className="flex justify-between gap-3 text-sm tnum">
          <span className="text-fg2">{row.label}</span><span><span className="font-semibold text-fg">{board ? inr(board.quoted[row.key]) : 'Not set'}</span><span className="text-muted"> / {row.per_label}</span></span>
        </span>)}
      </span>
      {allowed ? <span className="text-brand text-sm font-semibold shrink-0">{stale ? "Set today's rates" : 'Change'}</span> : null}
    </button>{sheet}
  </>;
  const easy = variant === 'easy';
  return <Card title="Today's rates" subtitle={easy ? <span className="text-[15px]">{setLine}</span> : setLine} className={className}
    actions={allowed ? <Button size={easy ? 'md' : 'sm'} variant={stale ? 'primary' : 'secondary'} icon={Pencil} onClick={() => setOpen(true)}>{stale ? "Set today's rates" : 'Change'}</Button> : undefined}>
    <ul className={cn('flex flex-col', easy ? 'gap-1' : '')}>
      {RATE_ROWS.map(row => <li key={row.key} className={cn('flex items-baseline justify-between gap-3 border-t border-rule first:border-t-0', easy ? 'py-2.5' : 'py-1.5')}>
        <span className={cn(easy ? 'text-md' : 'text-sm')}><span className="font-medium">{row.label}</span> <span className="text-muted">{row.sub}</span></span>
        <span className="text-right whitespace-nowrap" title={board ? `${rateText(board.per_gram[row.key])} a gram` : undefined}>
          {board ? <Money value={board.quoted[row.key]} className={cn('font-semibold', easy && 'text-lg')} /> : <span className="text-muted">Not set</span>}
          <span className={cn('text-muted', easy ? 'text-[15px]' : 'text-sm')}> / {row.per_label}</span>
        </span>
      </li>)}
    </ul>
    {!allowed && stale ? <p className={cn('text-muted mt-2', easy ? 'text-[15px]' : 'text-sm')}>{whyNot('rates.edit')}</p> : null}{sheet}
  </Card>;
}
