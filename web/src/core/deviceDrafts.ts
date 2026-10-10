// Unfinished bills kept on this device (localStorage), beside the shop-wide copies on the server (core/api/drafts.ts).
// A bill typed offline, or while a session ran out, is never lost: it stays here until the server has it. Signing out
// keeps them ("Unfinished bills stay on this phone"): drafts are the shop's, not one person's, so whoever signs in next
// on this device can finish them. A browser that refuses storage keeps them for the visit.
import { useSyncExternalStore } from "react";
import { toDraftData, type DraftData } from "@/core/api/drafts";
import type { Person } from "@/core/sales/types";

/**
 * One unfinished bill on this device. synced: the server has this version (until then the next sync sends it).
 * gone: discarded here while the server couldn't be told; the next sync deletes it there, then here.
 * syncedAt: when the server last confirmed it (ms), so a shop's list asked for before then can't say it was finished elsewhere.
 */
export type KeptDraft = {
  id: string; business: number | null; data: DraftData; started_by: Person; created_at: string; updated_at: string;
  synced: boolean; gone?: boolean; syncedAt?: number;
};

/** Newest change first, by the moment itself: this device writes UTC ("…Z") and the server India's time ("…+05:30"). */
export const newestFirst = (a: { updated_at: string }, b: { updated_at: string }) => (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0);

const KEY = "gst3.drafts";
const listeners = new Set<() => void>();
/** What was read or written last; once storage refuses a write, it's the only copy for the visit. */
let cache: { raw: string | null; list: KeptDraft[] } = { raw: null, list: [] };
let memoryOnly = false;
/** Whether this page has tried storage yet, by a write or by keepsOnDevice(). */
let checked = false;

function parse(raw: string | null): KeptDraft[] {
  try {
    const v: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(v)) return [];
    // a copy an older version of the app kept reads as today's bill: whatever its data left out reads as empty
    return v.filter((d): d is KeptDraft => Boolean(d) && typeof d === "object" && typeof (d as KeptDraft).id === "string")
      .map((d) => ({ ...d, data: toDraftData(d.data) })).sort(newestFirst);
  } catch { return []; }
}
function read(): KeptDraft[] {
  if (memoryOnly) return cache.list;
  let raw: string | null;
  try { raw = localStorage.getItem(KEY); } catch { return cache.list; }
  if (raw !== cache.raw) cache = { raw, list: parse(raw) };
  return cache.list;
}
function write(list: KeptDraft[]) {
  const sorted = [...list].sort(newestFirst);
  const raw = JSON.stringify(sorted);
  try { localStorage.setItem(KEY, raw); checked = true; } catch { memoryOnly = true; }
  cache = { raw, list: sorted };
  listeners.forEach((l) => l());
}

/** Every unfinished bill on this device, newest change first (discarded ones too, until the server hears of it). */
export function keptDrafts(): KeptDraft[] {
  return read();
}
export function keptDraft(id: string): KeptDraft | null {
  return read().find((d) => d.id === id) ?? null;
}
/** Keeps (or replaces) one unfinished bill on this device. */
export function keepOnDevice(d: KeptDraft): void {
  write([...read().filter((x) => x.id !== d.id), d]);
}
/** The server has the version sent at `sentAt`: marked so, unless the bill changed again while it was on its way. */
export function markSynced(id: string, sentAt: string, server: { started_by: Person; created_at: string }): void {
  const d = keptDraft(id);
  if (!d || d.gone || d.updated_at !== sentAt) return;
  keepOnDevice({ ...d, synced: true, syncedAt: Date.now(), started_by: server.started_by ?? d.started_by, created_at: server.created_at || d.created_at });
}
/** Discarded here, but the server couldn't be told yet: kept as gone until a sync deletes it there. */
export function markGone(id: string): void {
  const d = keptDraft(id);
  if (d) keepOnDevice({ ...d, gone: true, synced: false });
}
/** Gone from this device: saved as a bill, discarded, or finished on another device. */
export function forgetOnDevice(id: string): void {
  const list = read();
  if (list.some((d) => d.id === id)) write(list.filter((d) => d.id !== id));
}

/**
 * Whether this device keeps unfinished bills. False when the browser refuses storage (a private window, a full disk):
 * they last until this page is closed or reloaded.
 */
export function keepsOnDevice(): boolean {
  if (!memoryOnly && !checked) {
    checked = true;
    try { localStorage.setItem(`${KEY}.check`, "1"); localStorage.removeItem(`${KEY}.check`); } catch { read(); memoryOnly = true; }
  }
  return !memoryOnly;
}
/** Tests only: forget what this page read, wrote or found out about storage. */
export function __resetDeviceDrafts(): void {
  cache = { raw: null, list: [] };
  memoryOnly = false;
  checked = false;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  // another tab kept, sent or finished one
  const onStorage = (e: StorageEvent) => { if (e.key === KEY || e.key === null) cb(); };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(cb); window.removeEventListener("storage", onStorage); };
}
/** This device's unfinished bills, newest change first, kept up to date as they're kept, sent or finished. */
export function useKeptDrafts(): KeptDraft[] {
  return useSyncExternalStore(subscribe, read, read);
}
