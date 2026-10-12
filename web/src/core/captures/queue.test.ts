import { afterEach, describe, expect, it, vi } from "vitest";
import { createCaptureQueue, type CaptureQueue } from "./queue";
import { IndexedDbCaptureStore, type CaptureStore, type QueuedCapture } from "./store";

class MemoryStore implements CaptureStore {
  rows: QueuedCapture[] = [];
  async list(userId: number) { return this.rows.filter((row) => row.userId === userId).map((row) => ({ ...row })); }
  async putMany(rows: QueuedCapture[]) { this.rows.push(...rows); }
  async update(userId: number, clientId: string, patch: Partial<QueuedCapture>) {
    const index = this.rows.findIndex((row) => row.userId === userId && row.clientId === clientId);
    if (index < 0) return null;
    this.rows[index] = { ...this.rows[index], ...patch };
    return { ...this.rows[index] };
  }
  async remove(userId: number, clientId: string) { this.rows = this.rows.filter((row) => row.userId !== userId || row.clientId !== clientId); }
}

const pdf = (name = "bill.pdf") => new File(["synthetic bill"], name, { type: "application/pdf" });
const options = { businessId: null, hint: " Solanki ", note: " counter ", asPages: false };
const queues: CaptureQueue[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture(store = new MemoryStore()) {
  let online = false; let sequence = 0;
  const upload = vi.fn(async (_row: QueuedCapture, _signal?: AbortSignal) => ({ id: 12 }));
  const read = vi.fn(async (_id: number, _signal: AbortSignal | undefined, _owner: number) => ({ id: 12, status: "ready" }));
  const changed = vi.fn();
  const queue = createCaptureQueue(store, { upload, read, changed, isOnline: () => online, uuid: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}` });
  queues.push(queue);
  return { queue, store, upload, read, changed, online: (value = true) => { online = value; } };
}
afterEach(() => { queues.splice(0).forEach((queue) => queue.dispose()); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("durable capture queue", () => {
  it("does not announce or upload queued files before the storage transaction commits", async () => {
    const f = fixture(); const committed = deferred<void>();
    const save = f.store.putMany.bind(f.store);
    vi.spyOn(f.store, "putMany").mockImplementation(async (rows) => { await committed.promise; await save(rows); });
    await f.queue.setUser(7);
    const adding = f.queue.add([pdf()], options);
    expect(f.queue.getSnapshot().items).toEqual([]);
    expect(f.upload).not.toHaveBeenCalled();
    committed.resolve(); await adding;
    const [row] = f.queue.getSnapshot().items;
    expect(row).toMatchObject({ userId: 7, hint: "Solanki", note: "counter", businessId: null, phase: "queued", captureId: null });
    expect(row.clientId).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.files[0].name).toBe("bill.pdf");
  });

  it("storage refusal never claims files are kept; the caller can preserve its chosen files", async () => {
    const f = fixture(); await f.queue.setUser(7);
    vi.spyOn(f.store, "putMany").mockRejectedValue(new Error("quota"));
    await expect(f.queue.add([pdf()], options)).rejects.toThrow("This browser couldn't keep the files. Keep this page open and try again.");
    expect(f.queue.getSnapshot().items).toEqual([]);
    expect(f.upload).not.toHaveBeenCalled();
  });

  it("refuses a complete multipart body over 24 MiB before persisting or announcing any group", async () => {
    const f = fixture(); await f.queue.setUser(7);
    const save = vi.spyOn(f.store, "putMany");
    const files = [new File([new Uint8Array(12 * 1024 * 1024)], "front.pdf", { type: "application/pdf" }),
      new File([new Uint8Array(12 * 1024 * 1024)], "back.pdf", { type: "application/pdf" })];
    await expect(f.queue.add(files, { ...options, asPages: true })).rejects.toThrow("These pages come to 24.0 MB. One bill can send at most 24 MB; take fewer or smaller pages.");
    expect(save).not.toHaveBeenCalled(); expect(f.store.rows).toEqual([]);
    expect(f.queue.getSnapshot().items).toEqual([]); expect(f.upload).not.toHaveBeenCalled();
    // The unchanged selection remains usable: the person can explicitly choose separate bills.
    expect(files.map((file) => file.size)).toEqual([12 * 1024 * 1024, 12 * 1024 * 1024]);
    await f.queue.add(files, options);
    expect(f.store.rows).toHaveLength(2);
  });

  it("keeps UUID and all files through offline reload, then uploads and reads serially", async () => {
    const f = fixture(); await f.queue.setUser(7);
    await f.queue.add([pdf("front.pdf"), pdf("back.pdf")], { ...options, asPages: true });
    const before = f.store.rows[0]; f.queue.dispose();
    const reloaded = fixture(f.store); reloaded.online();
    await reloaded.queue.setUser(7);
    expect(reloaded.upload).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ clientId: before.clientId, files: before.files }), expect.any(AbortSignal));
    expect(reloaded.read).toHaveBeenCalledExactlyOnceWith(12, expect.any(AbortSignal), 7);
    expect(reloaded.store.rows).toEqual([]);
  });

  it("reuses the UUID after an uncertain upload response", async () => {
    const f = fixture(); await f.queue.setUser(7); await f.queue.add([pdf()], options); f.online();
    f.upload.mockRejectedValueOnce(new Error("response lost"));
    await f.queue.resume();
    const clientId = f.store.rows[0].clientId;
    await f.queue.resume();
    expect(f.upload.mock.calls.map(([row]) => row.clientId)).toEqual([clientId, clientId]);
    expect(f.read).toHaveBeenCalledOnce();
  });

  it("two tabs send the same client UUID, so the server can answer one capture", async () => {
    const first = fixture(); await first.queue.setUser(7); await first.queue.add([pdf()], options);
    const second = fixture(first.store); await second.queue.setUser(7);
    const server = new Map<string, number>();
    const upload = async (row: QueuedCapture) => {
      if (!server.has(row.clientId)) server.set(row.clientId, 80 + server.size);
      return { id: server.get(row.clientId)! };
    };
    first.upload.mockImplementation(upload); second.upload.mockImplementation(upload);
    first.online(); second.online(); await Promise.all([first.queue.resume(), second.queue.resume()]);
    expect(first.upload).toHaveBeenCalledOnce(); expect(second.upload).toHaveBeenCalledOnce();
    expect(first.upload.mock.calls[0][0].clientId).toBe(second.upload.mock.calls[0][0].clientId);
    expect(server.size).toBe(1); expect(first.store.rows).toEqual([]);
  });

  it("clears a stale local snapshot when another tab removed the pending capture", async () => {
    const f = fixture(); await f.queue.setUser(7); await f.queue.add([pdf()], options);
    await f.store.remove(7, f.store.rows[0].clientId);
    expect(f.queue.getSnapshot().items).toHaveLength(1);
    f.online(); await f.queue.resume();
    expect(f.queue.getSnapshot().items).toEqual([]);
    expect(f.upload).not.toHaveBeenCalled();
  });

  it("sends a capture added while an earlier queue pass is about to finish empty", async () => {
    const f = fixture(); await f.queue.setUser(7); f.online();
    const entered = deferred<void>(); const emptyList = deferred<QueuedCapture[]>();
    vi.spyOn(f.store, "list").mockImplementationOnce(async () => { entered.resolve(); return emptyList.promise; });
    const finishing = f.queue.resume(); await entered.promise;
    await f.queue.add([pdf()], options);
    emptyList.resolve([]); await finishing; await f.queue.idle();
    expect(f.upload).toHaveBeenCalledOnce();
    expect(f.queue.getSnapshot().items).toEqual([]);
  });

  it("persists the server receipt before reading; failed reads never cause another upload", async () => {
    const f = fixture(); await f.queue.setUser(7); await f.queue.add([pdf()], options); f.online();
    f.read.mockImplementationOnce(async () => {
      expect(f.store.rows[0]).toMatchObject({ captureId: 12, phase: "uploaded" });
      throw new Error("read reply lost");
    });
    await f.queue.resume();
    expect(f.store.rows[0]).toMatchObject({ captureId: 12, phase: "uploaded", error: expect.any(String) });
    await f.queue.resume(f.store.rows[0].clientId);
    expect(f.upload).toHaveBeenCalledOnce(); expect(f.read).toHaveBeenCalledTimes(2);
    expect(f.store.rows).toEqual([]);
  });

  it("online/visible never automatically retry an errored read", async () => {
    const f = fixture(); await f.queue.setUser(7); await f.queue.add([pdf()], options); f.online();
    f.read.mockRejectedValueOnce(new Error("reader unavailable")); await f.queue.resume();
    f.queue.start();
    window.dispatchEvent(new Event("online")); document.dispatchEvent(new Event("visibilitychange"));
    await f.queue.idle();
    expect(f.upload).toHaveBeenCalledOnce(); expect(f.read).toHaveBeenCalledOnce();
    expect(f.store.rows).toHaveLength(1);
  });

  it("a receipt recovered after a crash asks the safe read adapter without uploading", async () => {
    const f = fixture(); await f.queue.setUser(7); await f.queue.add([pdf()], options);
    f.store.rows[0] = { ...f.store.rows[0], phase: "uploaded", captureId: 55 };
    f.online(); await f.queue.resume();
    expect(f.upload).not.toHaveBeenCalled(); expect(f.read).toHaveBeenCalledExactlyOnceWith(55, expect.any(AbortSignal), 7);
  });

  it("keeps a purged capture receipt as missing and permits only local removal, including after reload", async () => {
    const f = fixture(); await f.queue.setUser(7); await f.queue.add([pdf()], options);
    const clientId = f.store.rows[0].clientId;
    await f.store.update(7, clientId, { phase: "uploaded", captureId: 55 });
    f.read.mockRejectedValue({ isAxiosError: true, response: { status: 404, data: { detail: "That photo isn't in the inbox any more." } } });
    f.online(); await f.queue.resume();
    expect(f.queue.getSnapshot().items[0]).toMatchObject({ phase: "uploaded", captureId: 55, missing: true,
      error: "This photo is no longer in the inbox. Remove this saved upload from this device." });
    await f.queue.resume(clientId);
    f.queue.start(); window.dispatchEvent(new Event("online")); await f.queue.idle();
    expect(f.read).toHaveBeenCalledOnce(); expect(f.upload).not.toHaveBeenCalled();
    f.queue.dispose();
    const reloaded = fixture(f.store); reloaded.online(); await reloaded.queue.setUser(7);
    expect(reloaded.queue.getSnapshot().items[0]).toMatchObject({ clientId, missing: true, captureId: 55 });
    expect(reloaded.upload).not.toHaveBeenCalled(); expect(reloaded.read).not.toHaveBeenCalled();
    await expect(reloaded.queue.remove(clientId)).resolves.toBeUndefined();
    expect(f.store.rows).toEqual([]); expect(reloaded.queue.getSnapshot().items).toEqual([]);
  });

  it.each([403, 500, null])("does not make an uploaded receipt removable after a %s failure", async (status) => {
    const f = fixture(); await f.queue.setUser(7); await f.queue.add([pdf()], options);
    const clientId = f.store.rows[0].clientId;
    await f.store.update(7, clientId, { phase: "uploaded", captureId: 55 });
    f.read.mockRejectedValue({ isAxiosError: true, ...(status === null ? {} : { response: { status,
      data: { detail: "This photo is no longer in the inbox. Remove this saved upload from this device." } } }) });
    f.online(); await f.queue.resume();
    expect(f.queue.getSnapshot().items[0]).not.toMatchObject({ missing: true });
    await expect(f.queue.remove(clientId)).rejects.toThrow("This photo is in the inbox. Remove it there.");
    expect(f.store.rows).toHaveLength(1); expect(f.upload).not.toHaveBeenCalled();
  });

  it("does not label an unacknowledged upload as a missing receipt when the upload endpoint returns 404", async () => {
    const f = fixture(); await f.queue.setUser(7); await f.queue.add([pdf()], options);
    f.upload.mockRejectedValue({ isAxiosError: true, response: { status: 404, data: { detail: "Not found." } } });
    f.online(); await f.queue.resume();
    expect(f.queue.getSnapshot().items[0]).toMatchObject({ phase: "queued", captureId: null });
    expect(f.queue.getSnapshot().items[0]).not.toMatchObject({ missing: true });
    expect(f.read).not.toHaveBeenCalled();
  });

  it("isolates pending files by person and preserves them through sign-out", async () => {
    const f = fixture(); await f.queue.setUser(7); await f.queue.add([pdf("seven.pdf")], options);
    await f.queue.setUser(null); expect(f.queue.getSnapshot().items).toEqual([]);
    await f.queue.setUser(9); expect(f.queue.getSnapshot().items).toEqual([]);
    await f.queue.add([pdf("nine.pdf")], options);
    await f.queue.remove(f.store.rows[0].clientId);
    expect(f.store.rows).toHaveLength(2);
    await f.queue.setUser(7); expect(f.queue.getSnapshot().items[0].files[0].name).toBe("seven.pdf");
    await f.queue.remove(f.queue.getSnapshot().items[0].clientId);
    expect(f.store.rows.map((row) => row.userId)).toEqual([9]);
  });

  it("aborts an old person's request and never reads it with the next person's session", async () => {
    const f = fixture(); await f.queue.setUser(7); await f.queue.add([pdf()], options); f.online();
    const entered = deferred<void>(); const response = deferred<{ id: number }>();
    f.upload.mockImplementationOnce(async () => { entered.resolve(); return response.promise; });
    const sending = f.queue.resume(); await entered.promise;
    const switched = f.queue.setUser(9);
    expect(f.queue.getSnapshot().items).toEqual([]);
    expect(f.upload.mock.calls[0][1]?.aborted).toBe(true);
    response.resolve({ id: 21 }); await sending; await switched;
    expect(f.read).not.toHaveBeenCalled();
    expect(f.store.rows[0]).toMatchObject({ userId: 7, captureId: 21, phase: "uploaded" });
  });

  it("coalesces concurrent resume calls and never sends separate bills in parallel", async () => {
    const f = fixture(); await f.queue.setUser(7); await f.queue.add([pdf("a.pdf"), pdf("b.pdf")], options); f.online();
    const entered = deferred<void>(); const first = deferred<{ id: number }>();
    f.upload.mockImplementationOnce(async () => { entered.resolve(); return first.promise; });
    const sending = f.queue.resume(); await entered.promise;
    const again = f.queue.resume(); expect(f.upload).toHaveBeenCalledOnce();
    first.resolve({ id: 11 }); await sending; await again;
    expect(f.upload).toHaveBeenCalledTimes(2);
    expect(f.read.mock.calls.map(([id]) => id)).toEqual([11, 12]);
  });

  it("resumes from online and visible events, installs no polling timer and cleans listeners", async () => {
    vi.useFakeTimers(); const f = fixture(); await f.queue.setUser(7); await f.queue.add([pdf()], options);
    const stop = f.queue.start(); f.online(); window.dispatchEvent(new Event("online")); await f.queue.idle();
    expect(f.upload).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    f.online(false); await f.queue.add([pdf("second.pdf")], options); f.online();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange")); await f.queue.idle();
    expect(f.upload).toHaveBeenCalledTimes(2); stop();
    f.online(false); await f.queue.add([pdf("third.pdf")], options); f.online();
    window.dispatchEvent(new Event("online")); await f.queue.idle();
    expect(f.upload).toHaveBeenCalledTimes(2);
  });

  it("refuses metadata overflow without silently truncating it", async () => {
    const f = fixture(); await f.queue.setUser(7);
    await expect(f.queue.add([pdf()], { ...options, hint: "x".repeat(121) })).rejects.toThrow("Keep the supplier note to 120 characters.");
    await expect(f.queue.add([pdf()], { ...options, note: "x".repeat(256) })).rejects.toThrow("Keep the note to 255 characters.");
    expect(f.store.rows).toEqual([]);
  });

  it("refuses local removal while uploading or after the server has the capture", async () => {
    const f = fixture(); await f.queue.setUser(7); await f.queue.add([pdf()], options); f.online();
    const entered = deferred<void>(); const response = deferred<{ id: number }>();
    f.upload.mockImplementationOnce(async () => { entered.resolve(); return response.promise; });
    const sending = f.queue.resume(); await entered.promise;
    await expect(f.queue.remove(f.store.rows[0].clientId)).rejects.toThrow("Wait for this upload to finish.");
    f.read.mockRejectedValueOnce(new Error("read error")); response.resolve({ id: 12 }); await sending;
    await expect(f.queue.remove(f.store.rows[0].clientId)).rejects.toThrow("This photo is in the inbox. Remove it there.");
  });

  it("reports missing IndexedDB as storage failure instead of falling back to memory", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(new IndexedDbCaptureStore().list(7)).rejects.toThrow("This browser couldn't keep the files. Keep this page open and try again.");
  });
});
