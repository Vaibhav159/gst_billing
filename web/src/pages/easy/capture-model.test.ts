import { describe, expect, it, vi } from 'vitest';
import { canRemoveCapture, captureLabel, captureFailure, createCaptureUndo, resumeInitialRead } from './capture-model';

const row = { status: 'failed' as const, supplier: '', who: { id: 2, name: 'Rakesh' } };
describe('capture permission and words', () => {
  it('lets counter staff remove only their own waiting photo', () => {
    expect(canRemoveCapture(row, 2, true, false)).toBe(true);
    expect(canRemoveCapture(row, 1, true, false)).toBe(false);
    expect(canRemoveCapture(row, 1, false, false)).toBe(false);
    expect(canRemoveCapture(row, 1, true, true)).toBe(true);
    expect(canRemoveCapture({ ...row, status: 'filled' }, 2, true, true)).toBe(false);
    expect(canRemoveCapture({ ...row, status: 'discarded' }, 2, true, true)).toBe(false);
  });
  it('keeps failure words and does not invent a read or supplier', () => {
    expect(captureLabel(row)).toBe('New bill photo');
    expect(captureLabel({ ...row, supplier: 'Rajasthan Silver Traders' })).toBe('Rajasthan Silver Traders');
    expect(captureFailure('The photo is too blurred to read the numbers.')).toBe("Couldn't read this photo: the photo is too blurred to read the numbers. The photo is kept.");
  });
});
it('does not repeat the server’s existing kept sentence', () => {
  expect(captureFailure('The photo is too blurred to read the numbers. The photo is kept.')).toBe("Couldn't read this photo: the photo is too blurred to read the numbers. The photo is kept.");
});
describe('explicit interrupted read', () => {
  it('inspects before starting an initial read', async () => {
    const get = vi.fn().mockResolvedValue({ id: 12, status: 'reading', read: null });
    const read = vi.fn().mockResolvedValue({ id: 12, status: 'ready', read: {} });
    expect((await resumeInitialRead(12, get, read)).status).toBe('ready');
    expect(get).toHaveBeenCalledExactlyOnceWith(12);
    expect(read).toHaveBeenCalledExactlyOnceWith(12);
    expect(get.mock.invocationCallOrder[0]).toBeLessThan(read.mock.invocationCallOrder[0]);
  });
  it.each(['ready', 'failed', 'filled', 'discarded'])('never restarts a %s capture on return', async status => {
    const captured = { id: 12, status, read: null };
    const read = vi.fn();
    expect(await resumeInitialRead(12, async () => captured, read)).toBe(captured);
    expect(read).not.toHaveBeenCalled();
  });
  it('never starts a second reader for an already stored read', async () => {
    const captured = { id: 12, status: 'reading', read: { invoice_number: '17' } };
    const read = vi.fn();
    expect(await resumeInitialRead(12, async () => captured, read)).toBe(captured);
    expect(read).not.toHaveBeenCalled();
  });
  it('does not read after a failed status request', async () => {
    const read = vi.fn();
    await expect(resumeInitialRead(12, async () => { throw new Error('offline'); }, read)).rejects.toThrow('offline');
    expect(read).not.toHaveBeenCalled();
  });
});
describe('six-second restore authorization', () => {
  it('restores once and ignores a second toast or keyboard invocation', async () => {
    let now = 0;
    const restore = vi.fn().mockResolvedValue(undefined);
    const undo = createCaptureUndo(() => restore(12), () => now);
    now = 5999;
    await undo(); await undo();
    expect(restore).toHaveBeenCalledExactlyOnceWith(12);
  });
  it('expires at six seconds even if the toast pauses or Ctrl Z remembers it', async () => {
    let now = 0;
    const restore = vi.fn();
    const undo = createCaptureUndo(restore, () => now);
    now = 6000;
    await undo();
    expect(restore).not.toHaveBeenCalled();
  });
  it('lets a failed restore be retried within the original six seconds', async () => {
    let now = 0;
    const restore = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const undo = createCaptureUndo(restore, () => now);
    await expect(undo()).rejects.toThrow('offline');
    now = 5000;
    await undo();
    expect(restore).toHaveBeenCalledTimes(2);
  });
});
