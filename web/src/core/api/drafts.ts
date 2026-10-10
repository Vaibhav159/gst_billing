// Unfinished bills (API contract §4): shop-wide on the server, so whoever makes bills sees every one, with who started
// it, and can finish it; and kept on this device too (core/deviceDrafts.ts), so a bill typed offline, or while a session
// ran out, is never lost. Nothing polls: a draft goes to the server when it's kept, and what this device kept while the
// server couldn't be reached goes when a bill form opens or the network comes back (useDraftSync). One draft's writes
// reach the server in turn, so none overtakes another still on its way. Easy (part 6) keeps its unfinished bills
// through the same calls, in the same DraftData.
import { useCallback, useEffect, useMemo, useRef } from "react";
import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import axios from "axios";
import { toCustomer, type Customer } from "@/core/api/customers";
import { useAuth } from "@/core/auth/AuthProvider";
import {
  forgetOnDevice, keepOnDevice, keepsOnDevice, keptDraft, keptDrafts, markGone, markSynced, newestFirst, useKeptDrafts, type KeptDraft,
} from "@/core/deviceDrafts";
import type { PaymentMode, Person } from "@/core/sales/types";
import { toPerson } from "@/core/sales/wire";
import { PAY } from "@/core/sales/words";
import { api } from "./client";
import { problemOf } from "./errors";
import { useNetwork } from "./network";

/** A line as an unfinished bill keeps it: what was typed, as typed (rate in rupees, up to 3 decimals; gst a percent). */
export type DraftLine = { productId: number | null; name: string; hsn: string; gst: string | null; unit: string; qty: number | null; rate: string; note: string; custom: boolean };
/**
 * An unfinished bill's own state (the server only keeps it): the firm, the customer as picked, the number and date as
 * typed or suggested, paper or not, the place of supply chosen (null: the usual), payment (null: not picked yet),
 * the note and the lines. replaces: the cancelled bill it makes again.
 */
export type DraftData = {
  v: 1; firmId: number | null; customer: Customer | null; date: string; number: string; numberTyped: boolean; paper: boolean;
  posOverride: string | null; payment: PaymentMode | null; notes: string; lines: DraftLine[]; replaces: number | null;
};
/** One unfinished bill on the server. started_by stays the person who started it, whoever changes it later. */
export type Draft = { id: string; business: number | null; started_by: Person; data: DraftData; created_at: string; updated_at: string };
/**
 * The shop's list as read, and when it was asked for (ms): a draft that reached the server after that may not be on it
 * yet. complete: fewer than the server's cap came back, so a draft missing from it isn't on the server.
 */
export type DraftList = { drafts: Draft[]; askedAt: number; complete: boolean };
/** What the form lists: the shop's unfinished bills and this device's own. onDevice: this device has a change the server hasn't. */
export type UnfinishedBill = Draft & { onDevice: boolean };
/**
 * Where a keep left the bill: on the shop's list ("server"); on this device until the server can take it ("device");
 * only until this page closes, as the browser refuses storage ("visit"); or nowhere (null), as it was saved as a bill
 * already. refusal: the server's words when it turned the draft away.
 */
export type KeepResult = { kept: "server" | "device" | "visit" | null; refusal?: string };

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
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const idOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);
/** Every payment mode: PAY words each one ("" is "not recorded", a choice; null is not picked yet). */
const PAYMENTS = Object.keys(PAY) as PaymentMode[];

/** An unfinished bill's data, whoever wrote it and whatever it left out: a field it doesn't have reads as empty. */
export function toDraftData(raw: unknown): DraftData {
  const d = obj(raw);
  const lines = Array.isArray(d.lines) ? d.lines.map(obj) : [];
  return {
    v: 1, firmId: idOrNull(d.firmId), customer: d.customer && typeof d.customer === "object" ? toCustomer(d.customer) : null,
    date: str(d.date), number: str(d.number), numberTyped: d.numberTyped === true, paper: d.paper === true,
    posOverride: typeof d.posOverride === "string" ? d.posOverride : null,
    payment: PAYMENTS.includes(d.payment as PaymentMode) ? (d.payment as PaymentMode) : null, notes: str(d.notes),
    lines: lines.map((l) => ({
      productId: idOrNull(l.productId), name: str(l.name), hsn: str(l.hsn), gst: typeof l.gst === "string" && l.gst ? l.gst : null, unit: str(l.unit) || "gms",
      qty: typeof l.qty === "number" && Number.isFinite(l.qty) ? l.qty : null, rate: str(l.rate).replace(/^\./, "0."), note: str(l.note), custom: l.custom === true,
    })),
    replaces: idOrNull(d.replaces),
  };
}
export function toDraft(raw: unknown): Draft {
  const d = obj(raw);
  return { id: str(d.id), business: idOrNull(d.business), started_by: toPerson(d.started_by), data: toDraftData(d.data), created_at: str(d.created_at), updated_at: str(d.updated_at) };
}

export const draftKeys = { all: ["drafts"] as const, list: () => ["drafts", "list"] as const };

/** Drafts saved as bills in this visit (forgetDraft): a list the server answered before the save still names them. */
const finished = new Set<string>();

/** The most the server lists (contract §4): a list that long may leave some out. */
const DRAFTS_CAP = 500;

async function fetchDrafts(signal?: AbortSignal): Promise<DraftList> {
  const askedAt = Date.now();
  const d = obj((await api.get("drafts/", { signal })).data);
  const results = Array.isArray(d.results) ? d.results : [];
  return { askedAt, complete: results.length < DRAFTS_CAP, drafts: results.map(toDraft).filter((x) => !finished.has(x.id)) };
}
/** The shop's list, asked for as a form opens and by a sync: never retried, never polled. */
const listQuery = queryOptions({ queryKey: draftKeys.list(), queryFn: ({ signal }) => fetchDrafts(signal), retry: false });

/** PUT drafts/{id}/: made (201) or replaced (200); the server keeps who started it. */
export async function putDraft(id: string, business: number | null, data: DraftData): Promise<Draft> {
  return toDraft((await api.put(`drafts/${id}/`, { business, data })).data);
}
/** DELETE drafts/{id}/: 204, also when it's gone already. */
export async function deleteDraft(id: string): Promise<void> {
  await api.delete(`drafts/${id}/`);
}

/** Every unfinished bill the shop has (newest change first). Asked for once as a bill form opens, never on a timer. */
export function useDrafts(enabled = true) {
  return useQuery({ ...listQuery, enabled, staleTime: 10_000 });
}

function upsert(qc: QueryClient, row: Draft) {
  qc.setQueryData<DraftList>(draftKeys.list(), (l) => l && { ...l, drafts: [row, ...l.drafts.filter((x) => x.id !== row.id)] });
}
function drop(qc: QueryClient, id: string) {
  qc.setQueryData<DraftList>(draftKeys.list(), (l) => l && { ...l, drafts: l.drafts.filter((x) => x.id !== id) });
}

/** Each draft's writes to the server, one after another: one that overtook another still on its way would be undone by it. */
const writes = new Map<string, Promise<void>>();
function inTurn<T>(id: string, write: () => Promise<T>): Promise<T> {
  const mine = (writes.get(id) ?? Promise.resolve()).then(write);
  const done = mine.then(() => {}, () => {});
  writes.set(id, done);
  void done.then(() => { if (writes.get(id) === done) writes.delete(id); });
  return mine;
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

/** Sends this device's copy of a draft as it is when its turn comes (a later change goes with it), unless it's sent or gone already. */
function send(qc: QueryClient, id: string): Promise<void> {
  return inTurn(id, async () => {
    const d = keptDraft(id);
    if (!d || d.gone || d.synced) return;
    putAt.set(id, ++tick);
    let row: Draft;
    try {
      row = await putDraft(id, d.business, d.data);
    } catch (e) {
      // saved as a bill already, here or on another device: this device lets it go too
      if (savedAlready(e)) { finished.add(id); forgetOnDevice(id); drop(qc, id); }
      throw e;
    }
    markSynced(id, d.updated_at, row);
    upsert(qc, row); // discarded meanwhile: hidden as gone, and dropped once its delete lands
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
  });
}
/** The shop's copy of a draft, from the list this page last read. */
const shopCopy = (qc: QueryClient, id: string) => qc.getQueryData<DraftList>(draftKeys.list())?.drafts.find((x) => x.id === id);
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
    const now = new Date().toISOString();
    // a draft picked up from the shop's list keeps who started it, and when
    const prev = keptDraft(id) ?? shopCopy(qc, id);
    keepOnDevice({ id, business, data, started_by: prev ? prev.started_by : who.current, created_at: prev?.created_at || now, updated_at: now, synced: false });
    const here = keepsOnDevice() ? "device" : "visit";
    try {
      await send(qc, id);
      return { kept: "server" };
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
 * (finished elsewhere); while the shop's list can't be read (offline, or it failed), every copy here stands in for it.
 */
export function useUnfinishedBills(enabled = true): { bills: UnfinishedBill[]; loading: boolean } {
  const server = useDrafts(enabled);
  const kept = useKeptDrafts();
  const list = server.data;
  const firstAsk = !list && server.fetchStatus === "fetching";
  const bills = useMemo(() => {
    const live = kept.filter((d) => !d.gone);
    const gone = new Set(kept.filter((d) => d.gone).map((d) => d.id));
    const fromServer = (list?.drafts ?? []).filter((d) => !gone.has(d.id));
    const listed = new Set(fromServer.map((d) => d.id));
    // a copy the server had, missing from the list: shown if the list was asked for before it was sent, or came back
    // full; with no list, shown once there won't be one (offline, or it failed), not while the first one is coming
    const sentShown = (d: KeptDraft) => (list ? !list.complete || (d.syncedAt ?? 0) >= list.askedAt : !firstAsk);
    const here = live.filter((d) => !listed.has(d.id) && (!d.synced || sentShown(d)))
      .map((d): UnfinishedBill => ({ id: d.id, business: d.business, started_by: d.started_by, data: d.data, created_at: d.created_at, updated_at: d.updated_at, onDevice: !d.synced }));
    const changed = new Map(live.filter((d) => !d.synced).map((d) => [d.id, d]));
    const merged = fromServer.map((d): UnfinishedBill => {
      const mine = changed.get(d.id);
      return mine ? { ...d, business: mine.business, data: mine.data, updated_at: mine.updated_at, onDevice: true } : { ...d, onDevice: false };
    });
    return [...here, ...merged].sort(newestFirst);
  }, [list, kept, firstAsk]);
  return { bills, loading: enabled && firstAsk };
}

/**
 * Sends what this device kept or discarded while the server couldn't hear it, then lets go of copies of bills finished
 * or discarded elsewhere: sent before the shop's list was asked for, and not on it (when it came back whole).
 */
async function syncDrafts(qc: QueryClient): Promise<void> {
  // an answer about one draft (refused, saved already) leaves it as it is and goes on; anything else stops until next time
  const each = async (ids: string[], write: (id: string) => Promise<void>) => {
    for (const id of ids) {
      try { await write(id); } catch (e) { if (!aboutThisDraft(e)) throw e; }
    }
  };
  await each(keptDrafts().filter((x) => x.gone).map((x) => x.id), (id) => deleteGone(qc, id));
  await each(keptDrafts().filter((x) => !x.gone && !x.synced).map((x) => x.id), (id) => send(qc, id));
  const list = await qc.fetchQuery({ ...listQuery, staleTime: 0 });
  if (!list.complete) return;
  const there = new Set(list.drafts.map((d) => d.id));
  for (const d of keptDrafts()) if (d.synced && !d.gone && !there.has(d.id) && (d.syncedAt ?? 0) < list.askedAt) forgetOnDevice(d.id);
}

/**
 * Brings the server and this device together: once as a bill form opens, and again each time the network comes back.
 * Never on a timer (the database is Neon's free plan). Only for someone signed in who may make bills.
 */
export function useDraftSync(): void {
  const qc = useQueryClient();
  const { can, status } = useAuth();
  const net = useNetwork();
  const allowed = status === "signed-in" && can("bill.create");
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
