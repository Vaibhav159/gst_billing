import axios, { AxiosError, CanceledError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";
import { renderHook, act } from "@testing-library/react";
import { api, getTokens, refreshAccessToken, setSessionExpiredHandler, setTokens } from "./client";
import { problemOf, saveFailure } from "./errors";
import { __setNetState, markReachable, useNetwork, useSlow } from "./network";
import { queryClient } from "./query";

function reply(config: InternalAxiosRequestConfig, status: number, data: unknown) {
  if (status >= 400) return Promise.reject(new AxiosError("x", String(status), config, null, { status, data, statusText: "", headers: {}, config } as never));
  return Promise.resolve({ status, data, statusText: "", headers: {}, config });
}

const cfg = {} as InternalAxiosRequestConfig;
/** The server answered with this status, as axios rejects it. */
const answered = (status: number, data: unknown = {}) => new AxiosError("x", String(status), cfg, null, { status, data, statusText: "", headers: {}, config: cfg } as never);
/** No reply at all: offline, a dropped connection, a timeout. */
const noReply = () => new AxiosError("Network Error", "ERR_NETWORK", cfg);
/** SimpleJWT's answer for a refresh token it won't take. */
const refused = (status = 401) => answered(status, { detail: "Token is blacklisted", code: "token_not_valid" });
/** The server takes only requests that carry this access token. */
const acceptOnly = (access: string) => ((config) => reply(config, config.headers.Authorization === `Bearer ${access}` ? 200 : 401, {})) as AxiosAdapter;
function netState() { const h = renderHook(() => useNetwork()); const s = h.result.current; h.unmount(); return s; }
/** navigator.locks as one queue: each callback runs once the one before it has settled, as one lock name does across tabs. */
function stubLocks() {
  let tail: Promise<unknown> = Promise.resolve();
  const request = vi.fn((_name: string, callback: () => unknown) => {
    const turn = tail.then(() => callback());
    tail = turn.then(() => undefined, () => undefined);
    return turn;
  });
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request } });
  return request;
}

beforeEach(() => { localStorage.clear(); setSessionExpiredHandler(null); markReachable(); });
afterEach(() => { vi.restoreAllMocks(); delete (navigator as { locks?: unknown }).locks; });

test("two 401s at once share one refresh, and both requests are retried", async () => {
  setTokens("old-access", "refresh-1");
  let refreshes = 0;
  const post = vi.spyOn(axios, "post").mockImplementation(async () => { refreshes++; await new Promise((r) => setTimeout(r, 10)); return { data: { access: "new-access", refresh: "refresh-2" } }; });
  api.defaults.adapter = ((config) => reply(config, config.headers.Authorization === "Bearer new-access" ? 200 : 401, { ok: true })) as AxiosAdapter;
  const [a, b] = await Promise.all([api.get("invoices/"), api.get("customers/")]);
  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
  expect(refreshes).toBe(1);
  expect(getTokens()).toEqual({ access: "new-access", refresh: "refresh-2" });
  post.mockRestore();
});

test("a refused refresh clears the tokens and reports where the person was", async () => {
  setTokens("old", "bad-refresh");
  const from = vi.fn();
  setSessionExpiredHandler(from);
  const post = vi.spyOn(axios, "post").mockRejectedValue(refused());
  api.defaults.adapter = ((config) => reply(config, 401, {})) as AxiosAdapter;
  await expect(api.get("me/")).rejects.toBeTruthy();
  expect(getTokens()).toEqual({ access: null, refresh: null });
  expect(from).toHaveBeenCalledTimes(1);
  post.mockRestore();
  await expect(refreshAccessToken()).rejects.toBeTruthy();
});

test("problems in plain words", () => {
  const cfg = {} as InternalAxiosRequestConfig;
  const err = (status: number, data: unknown) => new AxiosError("x", String(status), cfg, null, { status, data, statusText: "", headers: {}, config: cfg } as never);
  expect(problemOf(new AxiosError("Network Error", "ERR_NETWORK", cfg)).kind).toBe("unreachable");
  expect(problemOf(err(400, { gst_number: ["Enter a valid GSTIN."] }))).toMatchObject({ kind: "validation", fields: { gst_number: "Enter a valid GSTIN." } });
  expect(problemOf(err(409, { error: "Bill number KGH/2026-27/31 is already used." })).message).toBe("Bill number KGH/2026-27/31 is already used.");
  expect(problemOf(err(429, {})).kind).toBe("throttled");
  expect(problemOf(err(500, "<html>")).kind).toBe("server");
  expect(saveFailure({ kind: "unreachable", message: "" }).title).toBe("Not saved: the app couldn't get through");
  expect(saveFailure({ kind: "offline", message: "" }).title).toBe("You're offline, so this wasn't saved");
});

test("network state follows real requests only (no polling)", async () => {
  const { result } = renderHook(() => useNetwork());
  expect(result.current).toBe("online");
  act(() => __setNetState("unreachable"));
  expect(result.current).toBe("unreachable");
});

test("slow means still busy after 1.4 s", () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(({ busy }) => useSlow(busy), { initialProps: { busy: true } });
  expect(result.current).toBe(false);
  act(() => { vi.advanceTimersByTime(1500); });
  expect(result.current).toBe(true);
  rerender({ busy: false });
  expect(result.current).toBe(false);
  vi.useRealTimers();
});

test("the query cache never polls and never refetches on focus", () => {
  const d = queryClient.getDefaultOptions().queries!;
  expect(d.refetchOnWindowFocus).toBe(false);
  expect(d.refetchInterval).toBeUndefined();
});

// Ruling 26: a network blip never signs you out

test("a refresh that gets no reply keeps you signed in: the request fails as unreachable, and the next one refreshes again", async () => {
  setTokens("old-access", "refresh-1");
  const from = vi.fn();
  setSessionExpiredHandler(from);
  const post = vi.spyOn(axios, "post").mockRejectedValueOnce(noReply()).mockResolvedValueOnce({ data: { access: "new-access", refresh: "refresh-2" } });
  api.defaults.adapter = acceptOnly("new-access");
  const failed: unknown = await api.get("invoices/").catch((e: unknown) => e);
  expect(problemOf(failed).kind).toBe("unreachable");
  expect(netState()).toBe("unreachable");
  expect(getTokens()).toEqual({ access: "old-access", refresh: "refresh-1" });
  expect(from).not.toHaveBeenCalled();
  // the network is back: the next request refreshes and goes through
  await expect(api.get("invoices/")).resolves.toMatchObject({ status: 200 });
  expect(post).toHaveBeenCalledTimes(2);
  expect(getTokens()).toEqual({ access: "new-access", refresh: "refresh-2" });
  expect(netState()).toBe("online");
});

test("the connection drops during the refresh: the request reads as offline, and you stay signed in", async () => {
  setTokens("old-access", "refresh-1");
  const from = vi.fn();
  setSessionExpiredHandler(from);
  vi.spyOn(axios, "post").mockImplementation(async () => { vi.spyOn(navigator, "onLine", "get").mockReturnValue(false); throw noReply(); });
  api.defaults.adapter = acceptOnly("new-access");
  const failed: unknown = await api.get("invoices/").catch((e: unknown) => e);
  expect(problemOf(failed).kind).toBe("offline");
  expect(netState()).toBe("offline");
  expect(getTokens()).toEqual({ access: "old-access", refresh: "refresh-1" });
  expect(from).not.toHaveBeenCalled();
});

test("a 5xx from the refresh keeps you signed in too, and a 502, 503 or 504 marks the app server unreachable", async () => {
  const from = vi.fn();
  setSessionExpiredHandler(from);
  const post = vi.spyOn(axios, "post");
  api.defaults.adapter = acceptOnly("new-access");
  for (const [status, state] of [[500, "online"], [502, "unreachable"], [503, "unreachable"], [504, "unreachable"]] as const) {
    setTokens("old-access", "refresh-1");
    markReachable();
    post.mockRejectedValueOnce(answered(status, "<html>…</html>"));
    const failed: unknown = await api.get("invoices/").catch((e: unknown) => e);
    expect(problemOf(failed).kind).toBe("server");
    expect(netState()).toBe(state);
    expect(getTokens()).toEqual({ access: "old-access", refresh: "refresh-1" });
  }
  expect(from).not.toHaveBeenCalled();
});

test("only a refused refresh (400 or 401) ends the session: tokens cleared, reported once with the page, and the request reads as signed out", async () => {
  window.history.pushState({}, "", "/sales/31?tab=items");
  api.defaults.adapter = ((config) => reply(config, 401, {})) as AxiosAdapter;
  for (const status of [400, 401]) {
    setTokens("old-access", "refresh-1");
    const from = vi.fn();
    setSessionExpiredHandler(from);
    vi.spyOn(axios, "post").mockImplementation(async () => { await new Promise((r) => setTimeout(r, 10)); throw refused(status); });
    const [a, b] = await Promise.all([api.get("invoices/").catch((e: unknown) => e), api.get("customers/").catch((e: unknown) => e)]);
    expect(problemOf(a).kind).toBe("auth");
    expect(problemOf(b).kind).toBe("auth");
    expect(getTokens()).toEqual({ access: null, refresh: null });
    expect(from.mock.calls).toEqual([["/sales/31?tab=items"]]);
  }
  window.history.pushState({}, "", "/");
});

// Ruling 26: two tabs share one refresh

test("another tab refreshed while this one waited for the lock: its tokens are used and no second refresh is sent", async () => {
  const request = stubLocks();
  setTokens("old-access", "refresh-1");
  const post = vi.spyOn(axios, "post").mockResolvedValue({ data: { access: "mine", refresh: "refresh-3" } });
  let otherTabDone = () => {};
  const otherTab = request("gst-token-refresh", () => new Promise<void>((resolve) => { otherTabDone = resolve; }));
  api.defaults.adapter = acceptOnly("other-access");
  const status = api.get("invoices/").then((r) => r.status, (e: unknown) => e);
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2)); // this tab now waits behind the other one
  setTokens("other-access", "refresh-2"); // the other tab's refresh lands
  otherTabDone();
  await otherTab;
  expect(await status).toBe(200);
  expect(post).not.toHaveBeenCalled();
  expect(getTokens()).toEqual({ access: "other-access", refresh: "refresh-2" });
  expect(request).toHaveBeenLastCalledWith("gst-token-refresh", expect.any(Function));
});

test("with Web Locks, one tab's parallel 401s still take the lock once and send one refresh", async () => {
  const request = stubLocks();
  setTokens("old-access", "refresh-1");
  const post = vi.spyOn(axios, "post").mockImplementation(async () => { await new Promise((r) => setTimeout(r, 10)); return { data: { access: "new-access", refresh: "refresh-2" } }; });
  api.defaults.adapter = acceptOnly("new-access");
  const [a, b] = await Promise.all([api.get("invoices/"), api.get("customers/")]);
  expect([a.status, b.status]).toEqual([200, 200]);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith("gst-token-refresh", expect.any(Function));
  expect(post).toHaveBeenCalledTimes(1);
  expect(getTokens()).toEqual({ access: "new-access", refresh: "refresh-2" });
});

// Ruling 26: what the brief's tests missed

test("the stored access token goes on every request as Authorization: Bearer …", async () => {
  const seen: unknown[] = [];
  api.defaults.adapter = ((config) => { seen.push(config.headers.Authorization); return reply(config, 200, {}); }) as AxiosAdapter;
  setTokens("access-1", "refresh-1");
  await api.get("me/");
  setTokens("access-2");
  await api.get("me/");
  localStorage.clear();
  await api.get("me/");
  expect(seen).toEqual(["Bearer access-1", "Bearer access-2", undefined]);
});

test("a request still refused after a refresh isn't refreshed again (no loop)", async () => {
  setTokens("old-access", "refresh-1");
  let refreshes = 0;
  vi.spyOn(axios, "post").mockImplementation(async () => {
    refreshes++;
    if (refreshes > 3) throw refused(); // ends a loop, if there is one
    return { data: { access: `access-${refreshes}`, refresh: `refresh-${refreshes + 1}` } };
  });
  let sends = 0;
  api.defaults.adapter = ((config) => { sends++; return reply(config, 401, {}); }) as AxiosAdapter;
  await expect(api.get("bills/")).rejects.toMatchObject({ response: { status: 401 } });
  expect({ refreshes, sends }).toEqual({ refreshes: 1, sends: 2 });
});

test("a real reply marks the server reachable; no reply marks it unreachable, or offline when the browser says so", async () => {
  const dropped = ((config) => Promise.reject(new AxiosError("Network Error", "ERR_NETWORK", config))) as AxiosAdapter;
  api.defaults.adapter = dropped;
  await api.get("invoices/").catch(() => {});
  expect(netState()).toBe("unreachable");
  api.defaults.adapter = ((config) => reply(config, 200, [])) as AxiosAdapter;
  await api.get("invoices/");
  expect(netState()).toBe("online");
  __setNetState("unreachable");
  api.defaults.adapter = ((config) => reply(config, 404, {})) as AxiosAdapter;
  await api.get("invoices/9/").catch(() => {});
  expect(netState()).toBe("online");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  api.defaults.adapter = dropped;
  await api.get("invoices/").catch(() => {});
  expect(netState()).toBe("offline");
});

test("a cancelled request changes nothing: not the network state, not the tokens, and no refresh", async () => {
  setTokens("old-access", "refresh-1");
  const from = vi.fn();
  setSessionExpiredHandler(from);
  const post = vi.spyOn(axios, "post").mockRejectedValue(new Error("no refresh expected"));
  api.defaults.adapter = ((config) => new Promise((_, reject) => { config.signal?.addEventListener?.("abort", () => reject(new CanceledError(undefined, config))); })) as AxiosAdapter;
  for (const before of ["online", "offline"] as const) {
    __setNetState(before);
    const c = new AbortController();
    const settled = api.get("invoices/", { signal: c.signal }).catch((e: unknown) => e);
    c.abort();
    expect(await settled).toMatchObject({ code: "ERR_CANCELED" });
    expect(netState()).toBe(before);
  }
  expect(post).not.toHaveBeenCalled();
  expect(from).not.toHaveBeenCalled();
  expect(getTokens()).toEqual({ access: "old-access", refresh: "refresh-1" });
});

// Ruling 26: two small fixes

test("a sign-in call is never refreshed, with or without a leading slash", async () => {
  setTokens("old-access", "refresh-1");
  const from = vi.fn();
  setSessionExpiredHandler(from);
  const post = vi.spyOn(axios, "post").mockRejectedValue(new Error("no refresh expected"));
  api.defaults.adapter = ((config) => reply(config, 401, { detail: "No active account found with the given credentials" })) as AxiosAdapter;
  for (const url of ["token/", "/token/"]) {
    await expect(api.post(url, { username: "rakesh", password: "nope" })).rejects.toMatchObject({ response: { status: 401 } });
  }
  expect(post).not.toHaveBeenCalled();
  expect(from).not.toHaveBeenCalled();
  expect(getTokens()).toEqual({ access: "old-access", refresh: "refresh-1" });
});

test("a 502, 503 or 504 means the proxy answered but the app server didn't: unreachable; other replies mean reachable", async () => {
  for (const [status, state] of [[502, "unreachable"], [503, "unreachable"], [504, "unreachable"], [500, "online"], [404, "online"], [429, "online"]] as const) {
    __setNetState(state === "online" ? "unreachable" : "online");
    api.defaults.adapter = ((config) => reply(config, status, "<html>…</html>")) as AxiosAdapter;
    await api.get("invoices/").catch(() => {});
    expect(netState()).toBe(state);
  }
});
