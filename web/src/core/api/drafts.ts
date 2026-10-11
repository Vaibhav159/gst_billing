// Unfinished bills (API contract §4): shop-wide on the server, so whoever makes bills sees every one, with who started
// it, and can finish it; and kept on this device too (core/deviceDrafts.ts), so a bill typed offline, or while a session
// ran out, is never lost. Nothing polls: a draft goes to the server when it's kept, and what this device kept while the
// server couldn't be reached goes when a bill form opens or the network comes back (useDraftSync). One draft's writes
// reach the server in turn, so none overtakes another still on its way. Easy (part 6) keeps its unfinished bills
// through the same calls, in the same DraftData.
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { queryOptions, skipToken, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { invalidateDashboard } from "@/core/due/fresh";
import axios from "axios";
import { useAuth } from "@/core/auth/AuthProvider";
import {
  forgetOnDevice, keepOnDevice, keepsOnDevice, keptDraft, keptDrafts, markGone, markSynced, newestFirst, useKeptDrafts, type KeptDraft,
} from "@/core/deviceDrafts";
import type { Person } from "@/core/sales/types";
import { toDraft, type Draft, type DraftData, type DraftList, type UnfinishedBill, type KeepResult } from "@/core/draftData";
import { api } from "./client";
import { problemOf } from "./errors";
import { useNetwork } from "./network";

export { toDraft, toDraftData, type DraftLine, type DraftData, type Draft, type DraftList, type UnfinishedBill, type KeepResult } from "@/core/draftData";

/** A new unfinished bill's id: a UUID made here (the server keeps the client's), on any page, https or not. */
export function newDraftId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});

export const draftKeys = { all: ["drafts"] as const, list: (business?: number | null) => ["drafts", "list", ...(business === undefined ? [] : [business])] as const };

/**
 * Drafts saved as bills in this visit, here (forgetDraft) or on another counter (a PUT answered 409 draft_saved): a list
 * the server answered before the save still names them, and none is kept again.
 */
const finished = new Set<string>();
/** The server's words for a draft it said a bill was made from already (409 draft_saved), for a keep that comes later. */
const savedAs = new Map<string, string>();

/** The most the server lists (contract §4): a list that long may leave some out. */
const DRAFTS_CAP = 500;

async function fetchDrafts(signal?: AbortSignal, business?: number): Promise<DraftList> {
  const askedAt = Date.now();
  const d = obj((await api.get("drafts/", { signal, ...(business === undefined ? {} : { params: { business_id: business } }) })).data);
  const results = Array.isArray(d.results) ? d.results : [];
  return { askedAt, complete: results.length < DRAFTS_CAP, drafts: results.map(toDraft).filter((x) => !finished.has(x.id)) };
}
/** The shop's list, asked for as a form opens and by a sync: never retried, never polled. */
const listQuery = queryOptions({ queryKey: draftKeys.list(), queryFn: ({ signal }) => fetchDrafts(signal), retry: false, staleTime: 10_000 });

/** PUT drafts/{id}/: made (201) or replaced (200); the server keeps who started it. */
export async function putDraft(id: string, business: number | null, data: DraftData): Promise<Draft> {
  return toDraft((await api.put(`drafts/${id}/`, { business, data })).data);
}
/** DELETE drafts/{id}/: 204, also when it's gone already. */
export async function deleteDraft(id: string): Promise<void> {
  await api.delete(`drafts/${id}/`);
}

/**
 * Every unfinished bill the shop has (newest change first). Asked for once as a bill form opens, never on a timer.
 * fresh: asked for again as it mounts, whatever the cache holds.
 */
export function useDrafts(enabled = true, fresh = false, business?: number | null) {
  return useQuery({
    ...listQuery, queryKey: draftKeys.list(business),
    queryFn: business === null ? skipToken : ({ signal }) => fetchDrafts(signal, business),
    enabled, ...(fresh ? { refetchOnMount: "always" as const } : {}),
  });
}

function upsert(qc: QueryClient, row: Draft) {
  for (const [key] of qc.getQueriesData<DraftList>({ queryKey: draftKeys.list() })) {
    qc.setQueryData<DraftList>(key, (l) => l && { ...l, drafts: [
      ...(key[2] === undefined || key[2] === row.business ? [row] : []), ...l.drafts.filter((x) => x.id !== row.id),
    ] });
  }
}
function drop(qc: QueryClient, id: string) {
  qc.setQueriesData<DraftList>({ queryKey: draftKeys.list() }, (l) => l && { ...l, drafts: l.drafts.filter((x) => x.id !== id) });
}

/** Each draft's writes to the server, one after another: one that overtook another still on its way would be undone by it. */
const writes = new Map<string, Promise<void>>();
/** Told when a draft's first write sets off and when its last one lands (useDraftBusy). */
const busyListeners = new Set<() => void>();
const busyChanged = () => busyListeners.forEach((l) => l());
function inTurn<T>(id: string, write: () => Promise<T>): Promise<T> {
  const idle = !writes.has(id);
  const mine = (writes.get(id) ?? Promise.resolve()).then(write);
  const done = mine.then(() => {}, () => {});
  writes.set(id, done);
  if (idle) busyChanged();
  void done.then(() => { if (writes.get(id) === done) { writes.delete(id); busyChanged(); } });
  return mine;
}
function onBusy(cb: () => void) {
  busyListeners.add(cb);
  return () => { busyListeners.delete(cb); };
}
/**
 * Whether a write of this draft is on its way to the server: a keep, a sync's PUT (this device's change, sent as a form
 * opens or the network comes back) or a discard's DELETE. A bill saved from the draft waits for them first (draftSettled),
 * up to a request's 100 s, so the form can say so.
 */
export function useDraftBusy(id: string | null): boolean {
  return useSyncExternalStore(onBusy, () => id !== null && writes.has(id), () => false);
}
/** A count, not the clock: what happened after what. A save notes when it found its draft settled, and a PUT when it went out. */
let tick = 0;
const settledAt = new Map<string, number>();
const putAt = new Map<string, number>();
/**
 * Resolves once no write of this draft (a keep, a sync or a discard) is on its way to the server. A bill saved from a
 * draft waits for it before its POST takes draft_id, so no keep can reach the server after the save and make the draft
 * again; a PUT that goes out after this anyway (a sync) is caught by forgetDraft.
 */
export function draftSettled(id: string): Promise<void> {
  return (writes.get(id) ?? Promise.resolve()).then(() => { settledAt.set(id, ++tick); });
}

/** Tests only: forget what this page learnt about drafts (saved ones, the writes on their way and their order), beside __resetDeviceDrafts. */
export function __resetDrafts(): void {
  finished.clear();
  savedAs.clear();
  writes.clear();
  busyChanged();
  tick = 0;
  settledAt.clear();
  putAt.clear();
}

/** The server's answer to a PUT of a draft a bill took already (contract §4): it won't make the draft again. */
const savedAlready = (e: unknown) => problemOf(e).code === "draft_saved";
/**
 * A refusal about this draft alone (400, 404, 409: too big, not there, saved already), so a sync goes on to the next.
 * No reply, 401, 403, 429 and 5xx say every write would fail now, so it stops (Ruling 1D-7).
 */
function aboutThisDraft(e: unknown): boolean {
  const status = axios.isAxiosError(e) ? e.response?.status : undefined;
  return status !== undefined && status < 500 && status !== 401 && status !== 403 && status !== 429;
}

/**
 * Sends this device's copy of a draft as it is when its turn comes (a later change goes with it), unless it's sent or
 * gone already. Resolves with the server's words when a write before it heard that a bill was made from the draft
 * (409 draft_saved), which let this device's copy go: nothing is sent, and a keep says so in those words (N1).
 */
function send(qc: QueryClient, id: string): Promise<string | null> {
  return inTurn(id, async () => {
    const d = keptDraft(id);
    if (!d) return savedAs.get(id) ?? null;
    if (d.gone || d.synced) return null;
    putAt.set(id, ++tick);
    let row: Draft;
    try {
      row = await putDraft(id, d.business, d.data);
    } catch (e) {
      // saved as a bill already, here or on another device: this device lets it go too
      if (savedAlready(e)) { finished.add(id); savedAs.set(id, problemOf(e).message); forgetOnDevice(id); drop(qc, id); invalidateDashboard(qc); }
      throw e;
    }
    markSynced(id, d.updated_at, row);
    upsert(qc, row); // discarded meanwhile: hidden as gone, and dropped once its delete lands
    invalidateDashboard(qc);
    return null;
  });
}
/** Deletes a discarded draft on the server when its turn comes, unless it was kept again meanwhile (Undo); then lets it go here. */
function deleteGone(qc: QueryClient, id: string): Promise<void> {
  return inTurn(id, async () => {
    const d = keptDraft(id);
    if (d && !d.gone) return;
    await deleteDraft(id);
    if (keptDraft(id)?.gone) forgetOnDevice(id); // kept again while the delete was out: that keep goes after it
    drop(qc, id);
    invalidateDashboard(qc);
  });
}
/** The shop's copy of a draft, from the list this page last read. */
const shopCopy = (qc: QueryClient, id: string) => qc.getQueriesData<DraftList>({ queryKey: draftKeys.list() }).flatMap(([, list]) => list?.drafts ?? []).find((x) => x.id === id);
/** Off every list here at once, then deleted on the server. Offline, this device keeps it as gone and the next sync deletes it there. */
async function discard(qc: QueryClient, id: string): Promise<void> {
  // one only the shop's list had is kept here as gone, so an offline discard still reaches the server
  const row = keptDraft(id) ? undefined : shopCopy(qc, id);
  if (row) keepOnDevice({ ...row, synced: false, gone: true });
  else markGone(id);
  drop(qc, id);
  try { await deleteGone(qc, id); } catch { /* gone here; the next sync tells the server */ }
}

/**
 * Keeps an unfinished bill: on this device at once, then on the server. Answers where it's kept now (KeepResult): the
 * next sync sends one the server couldn't take, and the server's words come back when it turned the draft away.
 */
export function useKeepDraft(): (id: string, business: number | null, data: DraftData) => Promise<KeepResult> {
  const qc = useQueryClient();
  const { me } = useAuth();
  const who = useRef<Person>(null);
  who.current = me ? { id: me.id, name: me.fullName || me.username } : null;
  return useCallback(async (id, business, data) => {
    // a bill was made from it already (here, or the server said so): it's never kept again, here or there (Ruling 1D-4/F6)
    if (finished.has(id)) {
      const words = savedAs.get(id);
      return words ? { kept: null, refusal: words } : { kept: null };
    }
    const now = new Date().toISOString();
    // a draft picked up from the shop's list keeps who started it, and when
    const prev = keptDraft(id) ?? shopCopy(qc, id);
    keepOnDevice({ id, business, data, started_by: prev ? prev.started_by : who.current, created_at: prev?.created_at || now, updated_at: now, synced: false });
    const here = keepsOnDevice() ? "device" : "visit";
    try {
      // a write before this one heard that a bill was made from it: this change went nowhere (N1)
      const words = await send(qc, id);
      return words ? { kept: null, refusal: words } : { kept: "server" };
    } catch (e) {
      const p = problemOf(e);
      // saved as a bill already: forgotten here. Refused (too big, its firm gone): it stays here. Both in the server's words.
      if (savedAlready(e)) return { kept: null, refusal: p.message };
      // offline, or the session ran out: the next sync sends it
      return p.kind === "validation" || p.kind === "conflict" ? { kept: here, refusal: p.message } : { kept: here };
    }
  }, [qc]);
}

/** Discards an unfinished bill everywhere. Offline, it leaves every list here at once and the server hears on the next sync. */
export function useDiscardDraft(): (id: string) => Promise<void> {
  const qc = useQueryClient();
  return useCallback((id) => discard(qc, id), [qc]);
}

/**
 * A draft saved as a bill (its POST took draft_id, and the server deleted the draft with the bill): off this device and
 * the shop's list at once, and left out of a list the server answered before the save. A PUT of it that went out after
 * the save found it settled (draftSettled), such as a sync's, still out or landed already, may have made the draft
 * again on the server: its answer doesn't bring it back here, and the draft is deleted there once it lands (offline, by
 * the next sync). Without a draftSettled first, any PUT of it counts.
 */
export function forgetDraft(qc: QueryClient, id: string): void {
  finished.add(id);
  // a PUT still out went out after the save's tick too: draftSettled waited for every one out before it
  if ((putAt.get(id) ?? 0) > (settledAt.get(id) ?? 0)) { void discard(qc, id); return; }
  forgetOnDevice(id);
  drop(qc, id);
}

/**
 * The shop's unfinished bills and this device's own, newest change first. This device's version of one it changed wins
 * until the server has it. A copy the server already had shows until a list asked for after it was sent leaves it out
 * (finished elsewhere); while the shop's list can't be read (offline, or it failed), every copy here stands in for it
 * (Ruling 1D-4).
 *
 * fresh: the list is asked for again as this mounts, and loading lasts until that answer, since a list cached before a
 * draft was made doesn't have it. answered: the shop's list answered (since this mounted, when fresh); false while it's
 * coming, when it failed, and while it waits for the network: only an answer can say a draft isn't there any more.
 */
export function useUnfinishedBills(enabled = true, { fresh = false, businessId }: { fresh?: boolean; businessId?: number | null } = {}): { bills: UnfinishedBill[]; loading: boolean; answered: boolean } {
  const server = useDrafts(enabled, fresh, businessId);
  const kept = useKeptDrafts();
  const list = server.data;
  const firstAsk = !list && server.fetchStatus === "fetching";
  // its last ask failed, or waits for the network: what the cache holds may be older than a copy here
  const unread = server.isError || server.fetchStatus === "paused";
  const bills = useMemo(() => {
    const live = kept.filter((d) => !d.gone && (businessId === undefined || d.business === businessId));
    const gone = new Set(kept.filter((d) => d.gone).map((d) => d.id));
    const fromServer = (list?.drafts ?? []).filter((d) => !gone.has(d.id));
    const listed = new Set(fromServer.map((d) => d.id));
    // a copy the server had, missing from the list: shown if the list was asked for before it was sent, or came back
    // full; with no list it can read, shown once there won't be one (offline, or it failed), not while the first one is coming
    const sentShown = (d: KeptDraft) => (list && !unread ? !list.complete || (d.syncedAt ?? 0) >= list.askedAt : !firstAsk);
    const here = live.filter((d) => !listed.has(d.id) && (!d.synced || sentShown(d)))
      .map((d): UnfinishedBill => ({ id: d.id, business: d.business, started_by: d.started_by, data: d.data, created_at: d.created_at, updated_at: d.updated_at, onDevice: !d.synced }));
    const changed = new Map(live.filter((d) => !d.synced).map((d) => [d.id, d]));
    const merged = fromServer.map((d): UnfinishedBill => {
      const mine = changed.get(d.id);
      return mine ? { ...d, business: mine.business, data: mine.data, updated_at: mine.updated_at, onDevice: true } : { ...d, onDevice: false };
    });
    return businessId === null ? [] : [...here, ...merged].sort(newestFirst);
  }, [list, kept, firstAsk, unread, businessId]);
  const asking = fresh ? server.fetchStatus === "fetching" && !server.isFetchedAfterMount : firstAsk;
  const answered = server.isSuccess && server.fetchStatus !== "paused" && (!fresh || server.isFetchedAfterMount);
  return { bills, loading: enabled && asking, answered: enabled && answered };
}

/**
 * Sends what this device kept or discarded while the server couldn't hear it, then lets go of copies of bills finished
 * or discarded elsewhere: sent before the shop's list was asked for, and not on it (when it came back whole).
 */
async function syncDrafts(qc: QueryClient): Promise<void> {
  let sent = false;
  // an answer about one draft (refused, saved already) leaves it as it is and goes on; anything else stops until next time
  const each = async (ids: string[], write: (id: string) => Promise<unknown>) => {
    for (const id of ids) {
      sent = true;
      try { await write(id); } catch (e) { if (!aboutThisDraft(e)) throw e; }
    }
  };
  await each(keptDrafts().filter((x) => x.gone).map((x) => x.id), (id) => deleteGone(qc, id));
  await each(keptDrafts().filter((x) => !x.gone && !x.synced).map((x) => x.id), (id) => send(qc, id));
  if (!sent && !keptDrafts().some((d) => d.synced && !d.gone)) return;
  // A draft opened from its address or the unfinished-bills panel may have just asked for the list. Reuse that answer;
  // the askedAt check below keeps a copy sent after it was read, and each write already updates the cached list.
  const list = await qc.fetchQuery(listQuery);
  if (!list.complete) return;
  const there = new Set(list.drafts.map((d) => d.id));
  for (const d of keptDrafts()) if (d.synced && !d.gone && !there.has(d.id) && (d.syncedAt ?? 0) < list.askedAt) forgetOnDevice(d.id);
}

/**
 * Brings the server and this device together: once as a bill form opens, and again each time the network comes back.
 * Never on a timer (the database is Neon's free plan). Only for someone signed in who may make bills.
 */
export function useDraftSync(enabled = true): void {
  const qc = useQueryClient();
  const { can, status } = useAuth();
  const net = useNetwork();
  const allowed = enabled && status === "signed-in" && can("bill.create");
  const running = useRef(false);
  const was = useRef(net);
  const opened = useRef(false);
  useEffect(() => {
    if (!allowed) return;
    const back = was.current !== "online" && net === "online";
    was.current = net;
    if (net !== "online" || (opened.current && !back) || running.current) return;
    opened.current = true;
    running.current = true;
    // offline, or the session ran out: the next open or reconnect tries again
    void syncDrafts(qc).catch(() => {}).finally(() => { running.current = false; });
  }, [allowed, net, qc]);
}
