import type { CaptureSummary } from '@/core/captures/types';

export function canRemoveCapture(row: Pick<CaptureSummary, 'status' | 'who'>, userId: number | undefined, capture: boolean, discard: boolean): boolean {
  return !['filled', 'discarded'].includes(row.status) && (discard || (capture && row.who?.id === userId));
}
export function captureLabel(row: Pick<CaptureSummary, 'supplier'>): string { return row.supplier || 'New bill photo'; }
export function captureFailure(problem: string): string {
  return `Couldn't read this photo: ${(problem || "the numbers aren't clear").replace(/ The photo is kept\.$/, '').replace(/\.$/, '').replace(/^The/, 'the')}. The photo is kept.`;
}
/** Screen returns and Check again may resume an interrupted initial read, never a successful or failed result. */
export async function resumeInitialRead<T extends { status: string; read: unknown }>(id: number, get: (id: number) => Promise<T>, read: (id: number) => Promise<T>): Promise<T> {
  const result = await get(id);
  return result.status === 'reading' && !result.read ? read(id) : result;
}
/** The kit remembers keyboard Undo for 30 s; this operation's authorization expires after 6 s. */
export function createCaptureUndo(restore: () => Promise<unknown>, now = Date.now): () => Promise<void> {
  const expires = now() + 6000;
  let busy = false;
  let done = false;
  return async () => {
    if (done || busy || now() >= expires) return;
    busy = true;
    try { await restore(); done = true; }
    finally { busy = false; }
  };
}
