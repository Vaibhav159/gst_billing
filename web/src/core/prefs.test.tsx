import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AxiosAdapter } from "axios";
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
});
