import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, type AxiosAdapter } from "axios";
import { api } from "@/core/api/client";
import { AuthContext } from "@/core/auth/AuthProvider";
import { stubAuth } from "@/test/render";
import { phoneModeOf, usePrefs, type Prefs } from "./prefs";

/** The server's /api/preferences/: GET gives { data }, PATCH shallow-merges and answers with the whole blob. */
function prefsServer(start: Record<string, unknown>) {
  const calls: { method?: string; body?: unknown }[] = [];
  let stored = { ...start };
  api.defaults.adapter = ((config) => {
    const body = config.data ? JSON.parse(config.data as string) : undefined;
    calls.push({ method: config.method, body });
    if (config.method === "patch") stored = { ...stored, ...body };
    return Promise.resolve({ status: 200, statusText: "", headers: {}, config, data: { data: stored } });
  }) as AxiosAdapter;
  return calls;
}
const signedInAs = (me: Parameters<typeof stubAuth>[0]) => ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}><AuthContext.Provider value={stubAuth(me)}>{children}</AuthContext.Provider></QueryClientProvider>
);

beforeEach(() => localStorage.clear());
/** The copy of a person's preferences kept on this device (Ruling 38). */
const kept = (id: number) => JSON.parse(localStorage.getItem(`gst3.prefs.${id}`) ?? "null") as Prefs | null;

test("Easy or Expert on a phone: the person's setting, else what v2 remembered on this phone, else Easy", () => {
  expect(phoneModeOf({})).toBe("easy");
  localStorage.setItem("mobile-mode", "expert");
  expect(phoneModeOf({})).toBe("expert");
  expect(phoneModeOf({ phoneMode: "easy" })).toBe("easy");
  localStorage.setItem("mobile-mode", "tablet");
  expect(phoneModeOf({ phoneMode: "tablet" as never })).toBe("easy");
});

test("the person's preferences load once signed in; a change sends only itself and keeps the server's merged answer", async () => {
  const calls = prefsServer({ defaultBusinessId: "3", theme: "pearl" });
  const { result } = renderHook(() => usePrefs(), { wrapper: signedInAs(undefined) });
  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(result.current.prefs.defaultBusinessId).toBe("3"));
  let saved: unknown;
  await act(async () => { saved = await result.current.setPrefs({ phoneMode: "expert" }); });
  expect(saved).toEqual({ defaultBusinessId: "3", theme: "pearl", phoneMode: "expert" });
  await waitFor(() => expect(result.current.prefs).toEqual(saved));
  // no second GET: the PATCH's answer is the new cache
  expect(calls).toEqual([{ method: "get", body: undefined }, { method: "patch", body: { phoneMode: "expert" } }]);
});

test("signed out, preferences ask the server nothing", async () => {
  const calls = prefsServer({ defaultBusinessId: "3" });
  const { result } = renderHook(() => usePrefs(), { wrapper: signedInAs(null) });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(calls).toEqual([]);
  expect(result.current.prefs).toEqual({});
});

// Ruling 31: preferences are per person

test("a change still on its way when the person switches stays with the person who made it", async () => {
  const blobs: Record<number, Prefs> = { 1: { phoneMode: "easy" }, 2: { defaultBusinessId: "4" } };
  let signedIn = 1; // whose token the server sees
  const held: (() => void)[] = [];
  api.defaults.adapter = ((config) => {
    const who = signedIn;
    const ok = () => ({ status: 200, statusText: "", headers: {}, config, data: { data: blobs[who] } });
    if (config.method !== "patch") return Promise.resolve(ok());
    return new Promise((resolve) => { held.push(() => { blobs[who] = { ...blobs[who], ...JSON.parse(config.data as string) }; resolve(ok()); }); });
  }) as AxiosAdapter;
  let auth = stubAuth({ id: 1 });
  const client = new QueryClient();
  const { result, rerender } = renderHook(() => usePrefs(), {
    wrapper: ({ children }) => <QueryClientProvider client={client}><AuthContext.Provider value={auth}>{children}</AuthContext.Provider></QueryClientProvider>,
  });
  await waitFor(() => expect(result.current.prefs).toEqual({ phoneMode: "easy" }));
  let saving: Promise<Prefs> | undefined;
  act(() => { saving = result.current.setPrefs({ phoneMode: "expert" }); }); // Kailash's change goes out...
  await waitFor(() => expect(held).toHaveLength(1));
  signedIn = 2; // ...and Rakesh signs in before it's answered
  auth = stubAuth({ id: 2, username: "rakesh", fullName: "Rakesh Soni", role: "staff", roleLabel: "Counter staff", permissions: ["view"] });
  rerender();
  await waitFor(() => expect(result.current.prefs).toEqual({ defaultBusinessId: "4" })); // Rakesh's own, not Kailash's
  await act(async () => { held[0](); await saving; });
  expect(client.getQueryData(["prefs", 2])).toEqual({ defaultBusinessId: "4" });
  expect(client.getQueryData(["prefs", 1])).toEqual({ phoneMode: "expert" }); // Kailash's answer is kept for Kailash
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(result.current.prefs).toEqual({ defaultBusinessId: "4" });
  // and so are the copies each keeps on this device (Ruling 38)
  expect(kept(1)).toEqual({ phoneMode: "expert" });
  expect(kept(2)).toEqual({ defaultBusinessId: "4" });
});

// Ruling 38: each person's preferences are kept on this device, so the next load starts from them instead of the defaults

test("each answer from the server, a change's too, is kept on this device for that person", async () => {
  prefsServer({ defaultBusinessId: "3" });
  const { result } = renderHook(() => usePrefs(), { wrapper: signedInAs(undefined) });
  await waitFor(() => expect(kept(1)).toEqual({ defaultBusinessId: "3" }));
  await act(async () => { await result.current.setPrefs({ phoneMode: "expert" }); });
  expect(kept(1)).toEqual({ defaultBusinessId: "3", phoneMode: "expert" });
});

/** The server holds each GET until released, then answers with the person's blob. */
function slowServer(blob: Prefs) {
  const waiting: (() => void)[] = [];
  api.defaults.adapter = ((config) => new Promise((resolve) => {
    waiting.push(() => resolve({ status: 200, statusText: "", headers: {}, config, data: { data: blob } }));
  })) as AxiosAdapter;
  return { asked: () => waiting.length, answer: () => act(async () => { waiting.splice(0).forEach((go) => go()); }) };
}

test("the next load starts from the kept copy: ready at once, still loading until the server answers, then the server's copy", async () => {
  localStorage.setItem("gst3.prefs.1", JSON.stringify({ defaultBusinessId: "3", phoneMode: "expert" }));
  const server = slowServer({ defaultBusinessId: "4" });
  const { result } = renderHook(() => usePrefs(), { wrapper: signedInAs(undefined) });
  expect(result.current.prefs).toEqual({ defaultBusinessId: "3", phoneMode: "expert" }); // the first render
  expect(result.current.ready).toBe(true);
  expect(result.current.loading).toBe(true); // a caller that must have the server's copy still waits
  await waitFor(() => expect(server.asked()).toBe(1));
  await server.answer();
  await waitFor(() => expect(result.current.prefs).toEqual({ defaultBusinessId: "4" }));
  expect(result.current.loading).toBe(false);
  expect(kept(1)).toEqual({ defaultBusinessId: "4" });
});

test("with nothing kept, ready waits for the server's answer", async () => {
  const server = slowServer({ defaultBusinessId: "4" });
  const { result } = renderHook(() => usePrefs(), { wrapper: signedInAs(undefined) });
  expect(result.current).toMatchObject({ prefs: {}, ready: false, loading: true });
  await waitFor(() => expect(server.asked()).toBe(1));
  await server.answer();
  await waitFor(() => expect(result.current).toMatchObject({ prefs: { defaultBusinessId: "4" }, ready: true, loading: false }));
});

test("someone else's kept copy is never used: this person waits for their own", async () => {
  // Rakesh used this computer first, so his preferences are kept here
  prefsServer({ defaultBusinessId: "4" });
  const rakesh = renderHook(() => usePrefs(), { wrapper: signedInAs({ id: 2, username: "rakesh", fullName: "Rakesh Soni", role: "staff", roleLabel: "Counter staff", permissions: ["view"] }) });
  await waitFor(() => expect(kept(2)).toEqual({ defaultBusinessId: "4" }));
  rakesh.unmount();
  // then Kailash signs in on it, and his server is slow to answer
  const server = slowServer({ defaultBusinessId: "3" });
  const { result } = renderHook(() => usePrefs(), { wrapper: signedInAs(undefined) });
  expect(result.current).toMatchObject({ prefs: {}, ready: false });
  await waitFor(() => expect(server.asked()).toBe(1));
  await server.answer();
  await waitFor(() => expect(result.current.prefs).toEqual({ defaultBusinessId: "3" }));
  expect(kept(2)).toEqual({ defaultBusinessId: "4" }); // Rakesh's copy is left alone
});

test("when the server can't be reached the kept copy stays in use, and with nothing kept the defaults are ready", async () => {
  api.defaults.adapter = ((config) => Promise.reject(new AxiosError("Network Error", "ERR_NETWORK", config))) as AxiosAdapter;
  const offline = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AuthContext.Provider value={stubAuth()}>{children}</AuthContext.Provider></QueryClientProvider>
  );
  let view = renderHook(() => usePrefs(), { wrapper: offline });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  expect(view.result.current).toMatchObject({ prefs: {}, ready: true });
  view.unmount();

  localStorage.setItem("gst3.prefs.1", JSON.stringify({ defaultBusinessId: "3" }));
  view = renderHook(() => usePrefs(), { wrapper: offline });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  expect(view.result.current).toMatchObject({ prefs: { defaultBusinessId: "3" }, ready: true });
});

test("a switch to someone else never writes their preferences into the last person's kept copy", async () => {
  // AuthProvider's switch resets the cache, which refetches the last person's query at once, with the new person's token
  const blobs: Record<number, Prefs> = { 1: { defaultBusinessId: "3" }, 2: { defaultBusinessId: "4" } };
  let signedIn = 1; // whose token the server sees
  api.defaults.adapter = ((config) => Promise.resolve({ status: 200, statusText: "", headers: {}, config, data: { data: blobs[signedIn] } })) as AxiosAdapter;
  let auth = stubAuth({ id: 1 });
  const client = new QueryClient();
  const { result, rerender } = renderHook(() => usePrefs(), {
    wrapper: ({ children }) => <QueryClientProvider client={client}><AuthContext.Provider value={auth}>{children}</AuthContext.Provider></QueryClientProvider>,
  });
  await waitFor(() => expect(kept(1)).toEqual({ defaultBusinessId: "3" }));
  act(() => {
    signedIn = 2; // Rakesh signs in on another tab
    void client.resetQueries();
    auth = stubAuth({ id: 2, username: "rakesh", fullName: "Rakesh Soni", role: "staff", roleLabel: "Counter staff", permissions: ["view"] });
    rerender();
  });
  await waitFor(() => expect(result.current.prefs).toEqual({ defaultBusinessId: "4" }));
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  expect(kept(2)).toEqual({ defaultBusinessId: "4" });
  expect(kept(1)).toEqual({ defaultBusinessId: "3" }); // Kailash's copy is still his
});
