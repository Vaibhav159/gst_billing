import { AlertTriangle } from 'lucide-react';
import { Button } from '@/core/ui';
import type { RateSlip } from './slip';
export type Reference = { note: string; slip: RateSlip | null };
export function RateReference({ id, reference, onFix }: { id: string; reference: Reference | null; onFix: (rate: string) => void }) {
  if (!reference) return null;
  return <div id={id} className="flex flex-col gap-1 mt-1.5">
    <p className="text-xs text-muted">{reference.note}</p>
    {reference.slip ? <><p className="text-sm text-brand" role="status"><AlertTriangle size={14} className="inline -mt-0.5 mr-1" aria-hidden="true" />{reference.slip.text}</p>
      <Button size="sm" variant="link" className="self-start" onClick={() => onFix(reference.slip!.fix)}>{reference.slip.label}</Button></> : null}
  </div>;
}
