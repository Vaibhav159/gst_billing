import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";
import { renderHook, act } from "@testing-library/react";
import { api, getTokens, refreshAccessToken, setSessionExpiredHandler, setTokens } from "./client";
import { problemOf, saveFailure } from "./errors";
import { __setNetState, markReachable, useNetwork, useSlow } from "./network";
import { queryClient } from "./query";

function reply(config: InternalAxiosRequestConfig, status: number, data: unknown) {
  if (status >= 400) return Promise.reject(new AxiosError("x", String(status), config, null, { status, data, statusText: "", headers: {}, config } as never));
  return Promise.resolve({ status, data, statusText: "", headers: {}, config });
}

beforeEach(() => { localStorage.clear(); setSessionExpiredHandler(null); markReachable(); });

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

test("a failed refresh clears the tokens and reports where the person was", async () => {
  setTokens("old", "bad-refresh");
  const from = vi.fn();
  setSessionExpiredHandler(from);
  const post = vi.spyOn(axios, "post").mockRejectedValue(new Error("blacklisted"));
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
