import { useRef, useState } from 'react';
import { problemOf } from '@/core/api/errors';
import { useBatchImport, type ImportBody, type ImportKind, type ImportResult } from './batch';
export type ImportBatch = { kind: ImportKind; body: ImportBody };
export type BatchReport = { kind: ImportKind; result: ImportResult };
export function useImportSession() {
  const purchases = useBatchImport('purchases'), sales = useBatchImport('sales');
  const [checked, setChecked] = useState<ImportBatch[] | null>(null);
  const pending = useRef<ImportBatch[] | null>(null);
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reports, setReports] = useState<BatchReport[]>([]);
  const [checks, setChecks] = useState<BatchReport[]>([]);
  const send = (batch: ImportBatch, dry_run: boolean) => (batch.kind === 'purchases' ? purchases : sales).mutateAsync({ ...batch.body, dry_run });
  const reset = () => { if (active.current) return; pending.current = null; setChecked(null); setError(''); setChecks([]); setReports([]); };
  const check = async (batches: ImportBatch[]) => {
    if (active.current || !batches.length) return false;
    active.current = true; setBusy(true); pending.current = null; setChecked(null); setError(''); setChecks([]); setReports([]);
    // JSON payloads have no Files or Dates. Copy now; edits cannot alter this reviewed snapshot.
    const snapshot = JSON.parse(JSON.stringify(batches)) as ImportBatch[];
    const results: BatchReport[] = [];
    try {
      for (const batch of snapshot) results.push({ kind: batch.kind, result: await send(batch, true) });
      setChecks(results);
      if (!results.every(r => r.result.ok && r.result.dry_run)) { setError('Nothing was imported. Fix the marked bills, then check them again.'); return false; }
      pending.current = snapshot; setChecked(snapshot); return true;
    } catch (e) { setError(e instanceof Error && !('isAxiosError' in e) ? e.message : problemOf(e).message); return false; }
    finally { active.current = false; setBusy(false); }
  };
  const importChecked = async () => {
    if (active.current || !pending.current) return;
    active.current = true; setBusy(true); setError('');
    const snapshot = pending.current; pending.current = null; setChecked(null);
    const saved: BatchReport[] = [];
    try {
      for (const batch of snapshot) {
        const result = await send(batch, false);
        if (!result.ok || result.dry_run) {
          setChecks([{ kind: batch.kind, result }]);
          setError(saved.length ? `The ${batch.kind} were not imported. The earlier batch is saved; leave those bills out before checking again.` : 'Nothing was imported. Fix the marked bills, then check them again.');
          break;
        }
        saved.push({ kind: batch.kind, result }); setReports([...saved]);
      }
    } catch (e) {
      const p = problemOf(e);
      setError(p.kind === 'offline' || p.kind === 'unreachable' || p.kind === 'server'
        ? 'The app lost the answer. Some bills may be saved. Check Purchases before importing again, and Sales if the file has sales bills.'
        : `${p.message}${saved.length ? ' The earlier batch is saved; leave those bills out before checking again.' : ''}`);
    } finally { active.current = false; setBusy(false); }
  };
  return { check, importChecked, checked, checks, reports, busy, error, reset };
}
