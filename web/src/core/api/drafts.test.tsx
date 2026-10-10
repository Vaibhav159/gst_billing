import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { __setNetState } from "@/core/api/network";
import { AuthContext, AuthProvider, useAuth } from "@/core/auth/AuthProvider";
import { keepOnDevice, keptDraft, keptDrafts, type KeptDraft } from "@/core/deviceDrafts";
import { refuse, salesServer, type Call } from "@/core/sales/fixtures";
import { stubAuth } from "@/test/render";
import { serve, serveWith } from "@/test/server";
import { setTokens } from "./client";
import {
  draftKeys, draftSettled, forgetDraft, newDraftId, toDraftData, useDiscardDraft, useDraftSync, useKeepDraft, useUnfinishedBills, type DraftData, type DraftList,
} from "./drafts";

const RAKESH = { id: 2, name: "Rakesh Soni" };
const ID = "5d1c2a8e-0b7f-4a8e-9c3a-1f2e3d4c5b6a";
const DATA: DraftData = {
  v: 1, firmId: 3, customer: null, date: "2026-10-08", number: "34", numberTyped: false, paper: false, posOverride: null, payment: null, notes: "",
  lines: [{ productId: 5, name: "Gold Ring 22K", hsn: "711319", gst: "3", unit: "gms", qty: 4.5, rate: "6500", note: "", custom: false }], replaces: null,
};
/** A Draft as the server sends it (contract §4). */
const row = (over: Record<string, unknown> = {}) => ({ id: ID, business: 3, started_by: RAKESH, data: DATA, created_at: "2026-10-08T15:20:00+05:30", updated_at: "2026-10-08T15:21:00+05:30", ...over });
/** A copy on this device, as an earlier visit left it. */
const copy = (over: Partial<KeptDraft> = {}): KeptDraft => ({ id: ID, business: 3, data: DATA, started_by: RAKESH, created_at: "x", updated_at: "y", synced: false, ...over });
/** The data a PUT sent. */
const sent = (c: Call) => (c.body as { data: DraftData }).data;
const methods = (calls: Call[], m: string) => calls.filter((c) => c.method === m);
/** Lets every request already started reach the fake server (one turn of the event loop, no time passes). */
const drain = () => act(() => new Promise<void>((r) => { setTimeout(r, 0); }));

function setup(me = stubAuth({ id: 1, fullName: "Kailash Mehta" })) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}><AuthContext.Provider value={me}>{children}</AuthContext.Provider></QueryClientProvider>;
  return { qc, wrapper };
}

// India's clock reads 15:40 on 8 Oct 2026 in every test: nothing waits on real time
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T15:40:00+05:30"));
  localStorage.clear();
  sessionStorage.clear();
  act(() => __setNetState("online"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("keeping an unfinished bill puts it on this device at once, then on the server, which keeps who started it", async () => {
  let land: (() => void) | undefined;
  const { calls } = salesServer([["PUT", `drafts/${ID}/`, (c) => new Promise((r) => { land = () => r(row({ data: sent(c) })); })]]);
  const { result } = renderHook(() => useKeepDraft(), { wrapper: setup().wrapper });
  let kept!: Promise<unknown>;
  act(() => { kept = result.current(ID, 3, DATA); });
  // on this device before the server has answered
  expect(keptDraft(ID)).toMatchObject({ id: ID, business: 3, synced: false, data: DATA, started_by: { id: 1, name: "Kailash Mehta" } });
  await waitFor(() => expect(land).toBeDefined());
  let where: unknown;
  await act(async () => { land?.(); where = await kept; });
  expect(where).toEqual({ kept: "server" });
  expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ business: 3, data: DATA });
  expect(keptDraft(ID)).toMatchObject({ id: ID, business: 3, synced: true, started_by: RAKESH, data: DATA });
});

test("the server out of reach: it stays on this device, and when the network is back a sync sends it", async () => {
  let up = true;
  let onServer = false;
  const { calls } = salesServer([
    ["PUT", `drafts/${ID}/`, (c) => { if (!up) return refuse(0, null); onServer = true; return row({ data: sent(c) }); }],
    ["GET", "drafts/", () => ({ results: onServer ? [row()] : [] })],
  ]);
  const { wrapper } = setup();
  // the form opens: one sync, with nothing to send yet
  renderHook(() => useDraftSync(), { wrapper });
  await waitFor(() => expect(methods(calls, "GET")).toHaveLength(1));
  // then the server drops out as the bill is kept
  up = false;
  const keep = renderHook(() => useKeepDraft(), { wrapper });
  let where: unknown;
  await act(async () => { where = await keep.result.current(ID, 3, DATA); });
  expect(where).toEqual({ kept: "device" });
  expect(keptDraft(ID)).toMatchObject({ synced: false, started_by: { id: 1, name: "Kailash Mehta" } });
  // offline, nothing is sent
  act(() => __setNetState("offline"));
  await drain();
  expect(methods(calls, "PUT")).toHaveLength(1);
  // the network is back: the sync sends it, and the server says who started it
  up = true;
  act(() => __setNetState("online"));
  await waitFor(() => expect(keptDraft(ID)?.synced).toBe(true));
  expect(methods(calls, "PUT")).toHaveLength(2);
  expect(keptDraft(ID)?.started_by).toEqual(RAKESH);
  await waitFor(() => expect(methods(calls, "GET")).toHaveLength(2));
});

test("a copy of a bill finished on another device is let go; one sent since the list was read is kept", async () => {
  keepOnDevice(copy({ id: "a", updated_at: "2026-10-08T10:00:00Z", synced: true, syncedAt: 1 }));
  keepOnDevice(copy({ id: "b", updated_at: "2026-10-08T11:00:00Z", synced: true, syncedAt: Date.now() + 60_000 }));
  let answer: ((list: unknown) => void) | undefined;
  salesServer([["GET", "drafts/", () => new Promise((r) => { answer = r; })]]);
  const { wrapper } = setup();
  const list = renderHook(() => useUnfinishedBills(), { wrapper });
  renderHook(() => useDraftSync(), { wrapper });
  // while the shop's list is coming, a copy it may have finished isn't offered
  expect(list.result.current).toEqual({ bills: [], loading: true });
  await waitFor(() => expect(answer).toBeDefined());
  await act(async () => { answer?.({ results: [] }); });
  await waitFor(() => expect(keptDraft("a")).toBeNull());
  expect(keptDraft("b")).not.toBeNull();
  expect(list.result.current.bills.map((b) => b.id)).toEqual(["b"]);
});

test("a sync never sends an older version of a bill changed while it ran", async () => {
  const A = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
  const B = "6f5e4d3c-2b1a-4f9e-8d7c-6b5a4f3e2d1c";
  keepOnDevice(copy({ id: A, updated_at: "2026-10-08T15:30:00+05:30" }));
  keepOnDevice(copy({ id: B, updated_at: "2026-10-08T15:31:00+05:30" }));
  let landB: (() => void) | undefined;
  const { calls } = salesServer([
    ["PUT", `drafts/${B}/`, (c) => new Promise((r) => { landB = () => r(row({ id: B, data: sent(c) })); })],
    ["PUT", `drafts/${A}/`, (c) => row({ id: A, data: sent(c) })],
    ["GET", "drafts/", () => ({ results: [] })],
  ]);
  const { wrapper } = setup();
  // the network is back: the sync sends the newest first (B, slow to answer), then A
  renderHook(() => useDraftSync(), { wrapper });
  await waitFor(() => expect(landB).toBeDefined());
  // meanwhile A is changed and kept here
  const keep = renderHook(() => useKeepDraft(), { wrapper });
  const weighed: DraftData = { ...DATA, notes: "Weighed again" };
  await act(async () => { await keep.result.current(A, 3, weighed); });
  await act(async () => { landB?.(); });
  await waitFor(() => expect(methods(calls, "GET")).toHaveLength(1));
  // the sync's own copy of A was the one from before the change: it isn't sent after the newer one
  expect(methods(calls, "PUT").map((c) => [c.url, sent(c).notes])).toEqual([[`drafts/${B}/`, ""], [`drafts/${A}/`, "Weighed again"]]);
  expect(keptDraft(A)).toMatchObject({ synced: true, data: weighed });
});

test("a sync that reads a list asked for before a keep reached the server keeps that copy, and the list shows it", async () => {
  let answer!: (list: unknown) => void;
  salesServer([
    ["GET", "drafts/", () => new Promise((r) => { answer = r; })],
    ["PUT", `drafts/${ID}/`, (c) => row({ data: sent(c) })],
  ]);
  const { wrapper } = setup();
  // the form opens at 15:40:00 and asks for the shop's list; the answer is slow
  const list = renderHook(() => useUnfinishedBills(), { wrapper });
  // the bill reaches the server at 15:40:05, and a sync starts at 15:40:10 while that list is still on its way
  vi.setSystemTime(new Date("2026-10-08T15:40:05+05:30"));
  const keep = renderHook(() => useKeepDraft(), { wrapper });
  await act(async () => { await keep.result.current(ID, 3, DATA); });
  vi.setSystemTime(new Date("2026-10-08T15:40:10+05:30"));
  renderHook(() => useDraftSync(), { wrapper });
  await act(async () => { answer({ results: [] }); });
  await waitFor(() => expect(list.result.current.loading).toBe(false));
  expect(keptDraft(ID)).toMatchObject({ synced: true });
  expect(list.result.current.bills.map((b) => [b.id, b.onDevice])).toEqual([[ID, false]]);
});

test("discarded with the server out of reach: gone from the list here, and deleted there on the next sync", async () => {
  let up = false;
  keepOnDevice(copy({ synced: true, syncedAt: 1 }));
  const { calls } = salesServer([
    ["DELETE", `drafts/${ID}/`, () => (up ? null : refuse(0, null))],
    ["GET", "drafts/", () => ({ results: up ? [] : [row()] })],
  ]);
  const { wrapper } = setup();
  const list = renderHook(() => useUnfinishedBills(), { wrapper });
  await waitFor(() => expect(list.result.current.bills.map((b) => b.id)).toEqual([ID]));
  const discard = renderHook(() => useDiscardDraft(), { wrapper });
  await act(async () => { await discard.result.current(ID); });
  expect(keptDraft(ID)).toMatchObject({ gone: true });
  expect(list.result.current.bills).toEqual([]);
  // the server answers again (any request that gets through says so)
  up = true;
  act(() => __setNetState("online"));
  renderHook(() => useDraftSync(), { wrapper });
  await waitFor(() => expect(keptDraft(ID)).toBeNull());
  expect(methods(calls, "DELETE")).toHaveLength(2);
  await waitFor(() => expect(methods(calls, "GET")).toHaveLength(2));
  expect(list.result.current.bills).toEqual([]);
});

test("one only the shop's list has, discarded offline: gone from the list here, and deleted there on the next sync", async () => {
  let up = false;
  const { calls } = salesServer([
    ["DELETE", `drafts/${ID}/`, () => (up ? null : refuse(0, null))],
    ["GET", "drafts/", () => ({ results: up ? [] : [row()] })],
  ]);
  const { wrapper } = setup();
  const list = renderHook(() => useUnfinishedBills(), { wrapper });
  await waitFor(() => expect(list.result.current.bills.map((b) => [b.id, b.onDevice])).toEqual([[ID, false]]));
  const discard = renderHook(() => useDiscardDraft(), { wrapper });
  await act(async () => { await discard.result.current(ID); });
  await waitFor(() => expect(list.result.current.bills).toEqual([]));
  up = true;
  act(() => __setNetState("online"));
  renderHook(() => useDraftSync(), { wrapper });
  await waitFor(() => expect(methods(calls, "DELETE")).toHaveLength(2));
  await waitFor(() => expect(keptDraft(ID)).toBeNull());
  await waitFor(() => expect(methods(calls, "GET")).toHaveLength(2));
});

test("a draft the server refuses stays on this device, with the server's own words", async () => {
  let words: unknown = { data: ["This unfinished bill is too big to keep (over 64 KB). Save it as a bill, or start a new one."] };
  salesServer([["PUT", `drafts/${ID}/`, () => refuse(400, words)]]);
  const { result } = renderHook(() => useKeepDraft(), { wrapper: setup().wrapper });
  let where: unknown;
  await act(async () => { where = await result.current(ID, 3, DATA); });
  expect(where).toEqual({ kept: "device", refusal: "This unfinished bill is too big to keep (over 64 KB). Save it as a bill, or start a new one." });
  expect(keptDraft(ID)?.synced).toBe(false);
  // a firm the server doesn't know: its words too, as they are
  words = { business: ["Pick a firm from the list."] };
  await act(async () => { where = await result.current(ID, 9, DATA); });
  expect(where).toEqual({ kept: "device", refusal: "Pick a firm from the list." });
});

test("a sync goes past a draft the server refuses: that one stays here unsent, the next one goes", async () => {
  const OTHER = "2b3c4d5e-6f70-4812-9a3b-4c5d6e7f8091";
  keepOnDevice(copy({ updated_at: "2026-10-08T15:31:00+05:30" }));
  keepOnDevice(copy({ id: OTHER, updated_at: "2026-10-08T15:30:00+05:30" }));
  const { calls } = salesServer([
    ["PUT", `drafts/${ID}/`, () => refuse(400, { data: ["This unfinished bill is too big to keep (over 64 KB). Save it as a bill, or start a new one."] })],
    ["PUT", `drafts/${OTHER}/`, (c) => row({ id: OTHER, data: sent(c) })],
    ["GET", "drafts/", () => ({ results: [row({ id: OTHER })] })],
  ]);
  renderHook(() => useDraftSync(), { wrapper: setup().wrapper });
  await waitFor(() => expect(keptDraft(OTHER)?.synced).toBe(true));
  expect(keptDraft(ID)?.synced).toBe(false);
  await waitFor(() => expect(methods(calls, "GET")).toHaveLength(1));
});

test("nothing syncs for someone who can't make bills, or for no one", async () => {
  keepOnDevice(copy());
  const { calls } = salesServer([]);
  renderHook(() => useDraftSync(), { wrapper: setup(stubAuth({ role: "accountant", permissions: ["view", "customer.edit"] })).wrapper });
  renderHook(() => useDraftSync(), { wrapper: setup(stubAuth(null)).wrapper });
  await drain();
  expect(calls).toEqual([]);
  expect(keptDraft(ID)?.synced).toBe(false);
});

test("the list: newest change first, whichever clock wrote it and wherever it's kept; a draft changed here shows this device's version", async () => {
  const changed: DraftData = { ...DATA, notes: "Waiting for the bangles to be weighed" };
  // changed here at 15:30 India time; kept here at 09:25; kept here in UTC at 05:00, which is 10:30 India time
  keepOnDevice(copy({ data: changed, updated_at: "2026-10-08T15:30:00+05:30" }));
  keepOnDevice(copy({ id: "c", business: 2, started_by: null, updated_at: "2026-10-08T09:25:00+05:30" }));
  keepOnDevice(copy({ id: "e", started_by: null, updated_at: "2026-10-08T05:00:00.000Z" }));
  expect(keptDrafts().map((d) => d.id)).toEqual([ID, "e", "c"]);
  // the shop's: this one at 15:21 (older than the change here), and Rakesh's at 09:40
  salesServer([["GET", "drafts/", () => ({ results: [row(), row({ id: "d", updated_at: "2026-10-08T09:40:00+05:30" })] })]]);
  const { result } = renderHook(() => useUnfinishedBills(), { wrapper: setup().wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.bills.map((b) => [b.id, b.onDevice])).toEqual([[ID, true], ["e", true], ["d", false], ["c", true]]);
  expect(result.current.bills[0].data.notes).toBe("Waiting for the bangles to be weighed");
  expect(result.current.bills[0].started_by).toEqual(RAKESH);
});

test("offline, the shop's list can't be read: every unfinished bill on this device is listed, the ones sent before too", () => {
  keepOnDevice(copy({ updated_at: "2026-10-08T15:21:00+05:30", synced: true, syncedAt: 1 }));
  keepOnDevice(copy({ id: "c", updated_at: "2026-10-08T15:25:00+05:30" }));
  keepOnDevice(copy({ id: "g", updated_at: "2026-10-08T15:26:00+05:30", gone: true }));
  const { calls } = salesServer([["GET", "drafts/", () => ({ results: [] })]]);
  onlineManager.setOnline(false);
  try {
    const view = renderHook(() => useUnfinishedBills(), { wrapper: setup().wrapper });
    expect(view.result.current.loading).toBe(false);
    expect(view.result.current.bills.map((b) => [b.id, b.onDevice])).toEqual([["c", true], [ID, false]]);
    expect(calls).toHaveLength(0);
    view.unmount();
  } finally {
    onlineManager.setOnline(true);
  }
});

test("one draft's writes go in turn: a keep waits for the one on its way, and a discard for both, so the server ends as this device does", async () => {
  const held: (() => void)[] = [];
  const { calls } = salesServer([
    ["PUT", `drafts/${ID}/`, (c) => new Promise((r) => { held.push(() => r(row({ data: sent(c) }))); })],
    ["GET", "drafts/", () => ({ results: [] })],
    ["DELETE", `drafts/${ID}/`, () => null],
  ]);
  const { wrapper } = setup();
  const list = renderHook(() => useUnfinishedBills(), { wrapper });
  await waitFor(() => expect(list.result.current.loading).toBe(false));
  const keep = renderHook(() => useKeepDraft(), { wrapper });
  const discard = renderHook(() => useDiscardDraft(), { wrapper });
  let first!: Promise<unknown>;
  let second!: Promise<unknown>;
  act(() => { first = keep.result.current(ID, 3, DATA); });
  await waitFor(() => expect(held).toHaveLength(1));
  vi.setSystemTime(new Date("2026-10-08T15:40:02+05:30"));
  act(() => { second = keep.result.current(ID, 3, { ...DATA, notes: "Two rings, not one" }); });
  // the second change waits for the first one's answer, so it can't arrive first and be overwritten
  await drain();
  expect(methods(calls, "PUT")).toHaveLength(1);
  await act(async () => { held[0](); await first; });
  await waitFor(() => expect(held).toHaveLength(2));
  expect(methods(calls, "PUT").map((c) => sent(c).notes)).toEqual(["", "Two rings, not one"]);
  // discarded while the second is still on its way: the delete goes after it, so the keep can't make it again
  let gone!: Promise<void>;
  act(() => { gone = discard.result.current(ID); });
  expect(list.result.current.bills).toEqual([]);
  await drain();
  expect(methods(calls, "DELETE")).toHaveLength(0);
  await act(async () => { held[1](); await second; await gone; });
  expect(calls.map((c) => c.method)).toEqual(["GET", "PUT", "PUT", "DELETE"]);
  expect(keptDraft(ID)).toBeNull();
  expect(list.result.current.bills).toEqual([]);
});

test("a discard undone while its delete is on its way: the bill comes back, here and on the server", async () => {
  keepOnDevice(copy({ synced: true, syncedAt: 1 }));
  let land: (() => void) | undefined;
  const { calls } = salesServer([
    ["DELETE", `drafts/${ID}/`, () => new Promise((r) => { land = () => r(null); })],
    ["PUT", `drafts/${ID}/`, (c) => row({ data: sent(c) })],
  ]);
  const { wrapper } = setup();
  const discard = renderHook(() => useDiscardDraft(), { wrapper });
  const keep = renderHook(() => useKeepDraft(), { wrapper });
  let gone!: Promise<void>;
  act(() => { gone = discard.result.current(ID); });
  await waitFor(() => expect(land).toBeDefined());
  // Undo: kept again as it was, while the delete is still out
  let back!: Promise<unknown>;
  act(() => { back = keep.result.current(ID, 3, DATA); });
  await act(async () => { land?.(); await gone; await back; });
  expect(calls.map((c) => c.method)).toEqual(["DELETE", "PUT"]);
  expect(keptDraft(ID)).toMatchObject({ synced: true, data: DATA });
});

test("saved as a bill: the draft leaves this device and the shop's list at once, and a keep still on its way can't bring it back", async () => {
  const SAVED = "0f6b3c1e-2d4a-4b5c-8e9f-a1b2c3d4e5f6";
  let land!: () => void;
  const { calls } = salesServer([
    ["PUT", `drafts/${SAVED}/`, (c) => new Promise((r) => { land = () => r(row({ id: SAVED, data: sent(c) })); })],
    // a list the server answered before the save took the draft off it
    ["GET", "drafts/", () => ({ results: [row({ id: SAVED })] })],
    ["DELETE", `drafts/${SAVED}/`, () => null],
  ]);
  const { qc, wrapper } = setup();
  const list = renderHook(() => useUnfinishedBills(), { wrapper });
  await waitFor(() => expect(list.result.current.bills.map((b) => b.id)).toEqual([SAVED]));
  const keep = renderHook(() => useKeepDraft(), { wrapper });
  let kept!: Promise<unknown>;
  act(() => { kept = keep.result.current(SAVED, 3, DATA); });
  await waitFor(() => expect(methods(calls, "PUT")).toHaveLength(1));
  // a save waits for the keep on its way before it sends the bill
  let settled = false;
  void draftSettled(SAVED).then(() => { settled = true; });
  await drain();
  expect(settled).toBe(false);
  // the bill saved (its POST took draft_id) while that keep was still out: gone from here at once
  act(() => forgetDraft(qc, SAVED));
  expect(list.result.current.bills).toEqual([]);
  await act(async () => { land(); await kept; });
  await waitFor(() => expect(settled).toBe(true));
  // the keep may have reached the server after the save and made the draft again: it's deleted there once it lands
  await waitFor(() => expect(keptDraft(SAVED)).toBeNull());
  expect(methods(calls, "DELETE")).toHaveLength(1);
  expect(qc.getQueryData<DraftList>(draftKeys.list())?.drafts).toEqual([]);
  // and a list the server answered before the save still names it: left out
  await act(async () => { await qc.refetchQueries({ queryKey: draftKeys.list() }); });
  expect(methods(calls, "GET")).toHaveLength(2);
  expect(qc.getQueryData<DraftList>(draftKeys.list())?.drafts).toEqual([]);
  await drain();
  expect(list.result.current.bills).toEqual([]);
});

test("saved as a bill with nothing on its way: forgotten here at once, and the server isn't asked again", async () => {
  const SAVED = "7c9e1a2b-3d4e-4f50-9a1b-2c3d4e5f6a7b";
  keepOnDevice(copy({ id: SAVED, synced: true, syncedAt: 1 }));
  const { calls } = salesServer([["GET", "drafts/", () => ({ results: [row({ id: SAVED })] })]]);
  const { qc, wrapper } = setup();
  const list = renderHook(() => useUnfinishedBills(), { wrapper });
  await waitFor(() => expect(list.result.current.bills.map((b) => b.id)).toEqual([SAVED]));
  act(() => forgetDraft(qc, SAVED));
  expect(keptDraft(SAVED)).toBeNull();
  expect(list.result.current.bills).toEqual([]);
  await act(async () => { await draftSettled(SAVED); });
  expect(calls.map((c) => c.method)).toEqual(["GET"]);
});

const ME = { id: 2, username: "rakesh", full_name: "Rakesh Soni", role: "staff", role_label: "Counter staff", permissions: ["view", "bill.create"], needs_role_choice: false };
/** The real sign-in, with a keep beside it. */
function signedIn() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}><AuthProvider>{children}</AuthProvider></QueryClientProvider>;
  return renderHook(() => ({ auth: useAuth(), keep: useKeepDraft() }), { wrapper });
}

test("unfinished bills stay on this device through a sign-out, and one kept as the session runs out isn't lost (part 0 carry)", async () => {
  keepOnDevice(copy());
  setTokens("a", "r");
  serve({ "GET me/": ME });
  const first = signedIn();
  await waitFor(() => expect(first.result.current.auth.status).toBe("signed-in"));
  act(() => first.result.current.auth.signOut());
  expect(first.result.current.auth.status).toBe("signed-out");
  expect(keptDrafts().map((d) => d.id)).toEqual([ID]);
  first.unmount();
  // signed in again; then a bill is kept as the session runs out: the server turns it away and refuses the refresh
  const LATER = "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
  setTokens("a", "r");
  serveWith((c) => (c.url === "me/" ? { status: 200, data: ME } : { status: 401, data: { detail: "Given token not valid for any token type" } }));
  vi.spyOn(axios, "post").mockRejectedValue(new AxiosError("x", "401", {} as InternalAxiosRequestConfig, null, { status: 401, data: { detail: "Token is blacklisted" }, statusText: "", headers: {}, config: {} } as never));
  const again = signedIn();
  await waitFor(() => expect(again.result.current.auth.status).toBe("signed-in"));
  let where: unknown;
  await act(async () => { where = await again.result.current.keep(LATER, 3, DATA); });
  expect(where).toEqual({ kept: "device" });
  expect(again.result.current.auth.status).toBe("signed-out");
  expect(keptDraft(LATER)).toMatchObject({ synced: false, data: DATA, started_by: RAKESH });
  expect(keptDraft(ID)).not.toBeNull();
  again.unmount();
});

test("an unfinished bill's data reads whatever another client left out, and new ids are UUIDs even off https", () => {
  expect(toDraftData({ firmId: 3, lines: [{ name: "Ring", qty: "x" }] })).toMatchObject({
    v: 1, firmId: 3, customer: null, number: "", numberTyped: false, paper: false, payment: null, replaces: null,
    lines: [{ productId: null, name: "Ring", hsn: "", gst: null, unit: "gms", qty: null, rate: "", note: "", custom: false }],
  });
  // a payment this app doesn't know reads as not picked yet; "" is "not recorded", which is a choice
  expect(toDraftData({ payment: "cheque" }).payment).toBeNull();
  expect(toDraftData({ payment: "" }).payment).toBe("");
  // a rate kept as typed with a leading dot reads as a number the bill maths takes (1B's scaled() waits on ".5")
  expect(toDraftData({ lines: [{ name: "Silver Coin", rate: ".5" }] }).lines[0].rate).toBe("0.5");
  expect(newDraftId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const real = globalThis.crypto.randomUUID;
  Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
  try {
    expect(newDraftId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally {
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: real, configurable: true });
  }
});
