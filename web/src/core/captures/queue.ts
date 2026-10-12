import { problemOf } from "@/core/api/errors";
import { prepareFiles } from "./files";
import { captureFormData } from "./multipart";
import { STORAGE_FAILURE, type CaptureStore, type QueuedCapture } from "./store";

export const OFFLINE_RETRY = "You're offline. The photo is kept here and goes up by itself when the internet is back.";
const RETRYABLE = new Set(["offline", "unreachable", "server"]);
export type CaptureOptions = { businessId: number | null; hint: string; note: string; asPages: boolean };
export type QueueSnapshot = { items: QueuedCapture[]; loading: boolean; error: string | null; busy: string | null };
export type QueueDependencies = {
  upload(row: QueuedCapture, signal?: AbortSignal): Promise<{ id: number }>;
  /** Inspect first: never POST read for a stored result, ready/failed/filled/discarded capture. Failed reads retry only from the inbox. */
  read(id: number, signal: AbortSignal | undefined, owner: number): Promise<unknown>;
  /** A capture changed on the server; refresh lists and that capture only (never another open fill page). */
  changed(captureId: number | null): void;
  isOnline?(): boolean;
  uuid?(): string;
};

export function createCaptureQueue(store: CaptureStore, dependencies: QueueDependencies) {
  let userId: number | null = null;
  let generation = 0;
  let snapshot: QueueSnapshot = { items: [], loading: false, error: null, busy: null };
  let running: Promise<void> | null = null;
  let runningAutomatic = false;
  let controller: AbortController | null = null;
  const listeners = new Set<() => void>();
  const cleanups = new Set<() => void>();
  const online = dependencies.isOnline ?? (() => navigator.onLine !== false);
  const publish = (patch: Partial<QueueSnapshot>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach((listener) => listener()); };
  const sameUser = (owner: number, version: number) => userId === owner && generation === version;

  async function refresh(owner: number, version: number) {
    const items = await store.list(owner);
    if (sameUser(owner, version)) publish({ items: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)), loading: false });
  }

  async function drain(clientId: string | undefined, automatic: boolean) {
    if (userId === null || !online()) return;
    const owner = userId; const version = generation;
    const attempted = new Set<string>();
    try {
      while (sameUser(owner, version) && online()) {
        const rows = await store.list(owner);
        const item = rows.find((row) => !row.missing && !attempted.has(row.clientId) && (!clientId || row.clientId === clientId)
          // Automatic passes retry only uploads that failed offline/unreachable/5xx; refusals and failed reads wait for Try now.
          && !(automatic && row.error && (row.phase === "uploaded" || !row.autoRetry)));
        if (!item || !sameUser(owner, version)) break;
        attempted.add(item.clientId);
        publish({ busy: item.clientId, error: null });
        controller = new AbortController();
        const signal = controller.signal;
        let reading = false;
        let captureId = item.captureId;
        try {
          if (item.phase === "queued") {
            const uploaded = await dependencies.upload(item, signal);
            captureId = uploaded.id;
            // Commit the receipt even if sign-out happened while the response was on its way.
            const saved = await store.update(owner, item.clientId, { captureId, phase: "uploaded", error: null });
            if (!saved) continue;
            dependencies.changed(captureId);
          }
          if (!sameUser(owner, version) || signal.aborted) break;
          if (captureId !== null) {
            reading = true;
            await dependencies.read(captureId, signal, owner);
            await store.remove(owner, item.clientId);
            dependencies.changed(captureId);
          }
        } catch (error) {
          if (!signal.aborted) {
            const problem = problemOf(error);
            const missing = reading && sameUser(owner, version) && problem.kind === "notfound";
            await store.update(owner, item.clientId, missing
              ? { missing: true, error: "This photo is no longer in the inbox. Remove this saved upload from this device." }
              : { error: problem.message, autoRetry: !reading && RETRYABLE.has(problem.kind) });
            dependencies.changed(captureId);
          }
        } finally { controller = null; }
        await refresh(owner, version);
      }
      if (sameUser(owner, version)) await refresh(owner, version);
    } catch { if (sameUser(owner, version)) publish({ error: STORAGE_FAILURE, loading: false }); }
    finally { if (sameUser(owner, version)) publish({ busy: null }); }
  }

  function run(clientId?: string, automatic = false): Promise<void> {
    if (userId === null) return Promise.resolve();
    if (!online()) { if (!automatic) publish({ error: OFFLINE_RETRY }); return Promise.resolve(); }
    // A Try now during an automatic pass runs after it: the automatic pass skips rows that wait for Try now.
    if (running) return clientId || (runningAutomatic && !automatic) ? running.then(() => run(clientId, automatic)) : running;
    runningAutomatic = automatic;
    running = drain(clientId, automatic).finally(() => { running = null; });
    return running;
  }

  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    async setUser(next: number | null): Promise<void> {
      if (next === userId) return;
      userId = next; generation++; controller?.abort();
      publish({ items: [], loading: next !== null, error: null, busy: null });
      if (next === null) return;
      const version = generation;
      try {
        await refresh(next, version);
        if (running) await running;
        if (sameUser(next, version)) await run(undefined, true);
      } catch { if (sameUser(next, version)) publish({ error: STORAGE_FAILURE, loading: false }); }
    },
    async add(files: File[], options: CaptureOptions): Promise<void> {
      if (userId === null) throw new Error("Sign in to capture a bill.");
      const owner = userId; const version = generation;
      if (options.hint.trim().length > 120) throw new Error("Keep the supplier note to 120 characters.");
      if (options.note.trim().length > 255) throw new Error("Keep the note to 255 characters.");
      const groups = await prepareFiles(files, options.asPages);
      if (!sameUser(owner, version)) throw new Error("The person signed in changed. Choose the files again.");
      const rows = groups.map((group): QueuedCapture => ({
        clientId: (dependencies.uuid ?? (() => crypto.randomUUID()))(), userId: owner, files: group,
        businessId: options.businessId, hint: options.hint.trim(), note: options.note.trim(), createdAt: new Date().toISOString(),
        captureId: null, phase: "queued", error: null,
      }));
      // Validate every complete request before persisting any selected bill.
      for (const row of rows) captureFormData({ files: row.files, client_id: row.clientId,
        business_id: row.businessId, hint: row.hint, note: row.note });
      try { await store.putMany(rows); }
      catch { throw new Error(STORAGE_FAILURE); }
      await refresh(owner, version);
      if (sameUser(owner, version)) {
        if (running) void running.then(() => { if (sameUser(owner, version)) void run(undefined, true); });
        else void run(undefined, true);
      }
    },
    resume: (clientId?: string) => run(clientId),
    idle: () => running ?? Promise.resolve(),
    async remove(clientId: string): Promise<void> {
      if (userId === null) return;
      if (snapshot.busy === clientId) throw new Error("Wait for this upload to finish.");
      const owner = userId; const version = generation;
      const item = (await store.list(owner)).find((row) => row.clientId === clientId);
      if (!item) return;
      if (item.phase === "uploaded" && !item.missing) throw new Error("This photo is in the inbox. Remove it there.");
      await store.remove(owner, clientId); await refresh(owner, version);
    },
    start(): () => void {
      const resume = () => { void run(undefined, true); };
      const visible = () => { if (document.visibilityState === "visible") resume(); };
      window.addEventListener("online", resume); document.addEventListener("visibilitychange", visible);
      const stop = () => {
        window.removeEventListener("online", resume); document.removeEventListener("visibilitychange", visible); cleanups.delete(stop);
      };
      cleanups.add(stop); resume(); return stop;
    },
    dispose() { cleanups.forEach((stop) => stop()); controller?.abort(); userId = null; generation++; listeners.clear(); },
  };
}

export type CaptureQueue = ReturnType<typeof createCaptureQueue>;
