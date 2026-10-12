export const STORAGE_FAILURE = "This browser couldn't keep the files. Keep this page open and try again.";
export type QueuedCapture = {
  clientId: string; userId: number; files: File[]; businessId: number | null;
  hint: string; note: string; createdAt: string;
  captureId: number | null; phase: "queued" | "uploaded"; error: string | null;
  missing?: boolean;
};
export interface CaptureStore {
  list(userId: number): Promise<QueuedCapture[]>;
  putMany(rows: QueuedCapture[]): Promise<void>;
  update(userId: number, clientId: string, patch: Partial<QueuedCapture>): Promise<QueuedCapture | null>;
  remove(userId: number, clientId: string): Promise<void>;
}

/** Native structured cloning keeps File bytes, MIME types and original names; no base64 or localStorage copy. */
export class IndexedDbCaptureStore implements CaptureStore {
  constructor(private readonly name = "gst3.capture-queue") {}

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") { reject(new Error(STORAGE_FAILURE)); return; }
      let failed = false;
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("pending", { keyPath: ["userId", "clientId"] });
        store.createIndex("userId", "userId");
      };
      request.onblocked = request.onerror = () => { failed = true; reject(new Error(STORAGE_FAILURE)); };
      request.onsuccess = () => {
        if (failed) { request.result.close(); return; }
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    });
  }

  private async transaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
    let db: IDBDatabase;
    try { db = await this.open(); } catch { throw new Error(STORAGE_FAILURE); }
    return new Promise<T>((resolve, reject) => {
      let value: T;
      let transaction: IDBTransaction;
      try { transaction = db.transaction("pending", mode); }
      catch { db.close(); reject(new Error(STORAGE_FAILURE)); return; }
      transaction.oncomplete = () => { db.close(); resolve(value); };
      transaction.onabort = transaction.onerror = () => { db.close(); reject(new Error(STORAGE_FAILURE)); };
      try { work(transaction.objectStore("pending"), (next) => { value = next; }); }
      catch { transaction.abort(); }
    });
  }

  list(userId: number): Promise<QueuedCapture[]> {
    return this.transaction("readonly", (store, done) => {
      const request = store.index("userId").getAll(userId);
      request.onsuccess = () => done(request.result as QueuedCapture[]);
    });
  }

  putMany(rows: QueuedCapture[]): Promise<void> {
    return this.transaction("readwrite", (store, done) => { rows.forEach((row) => store.add(row)); done(undefined); });
  }

  update(userId: number, clientId: string, patch: Partial<QueuedCapture>): Promise<QueuedCapture | null> {
    return this.transaction("readwrite", (store, done) => {
      const request = store.get([userId, clientId]);
      request.onsuccess = () => {
        const row = request.result as QueuedCapture | undefined;
        if (!row) { done(null); return; }
        const next = { ...row, ...patch, userId, clientId };
        // A second tab's late upload error must not turn an acknowledged capture back into an upload.
        if (row.phase === "uploaded") { next.phase = "uploaded"; next.captureId = row.captureId; }
        store.put(next); done(next);
      };
    });
  }

  remove(userId: number, clientId: string): Promise<void> {
    return this.transaction("readwrite", (store, done) => { store.delete([userId, clientId]); done(undefined); });
  }
}
