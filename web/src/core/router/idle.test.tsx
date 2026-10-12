import { act, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { AuthContext } from "@/core/auth/AuthProvider";
import { salesServer } from "@/core/sales/fixtures";
import { AppLayout, RootLayout } from "@/core/shell/AppLayout";
import { ToastProvider } from "@/core/ui";
import { stubAuth, testQueryClient } from "@/test/render";
import { idlePages, lazyPage } from "./lazyPage";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-10-08T10:00:00+05:30"));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function idleClock() {
  const callbacks: IdleRequestCallback[] = [];
  const requestIdle = vi.fn((callback: IdleRequestCallback) => { callbacks.push(callback); return callbacks.length; });
  vi.stubGlobal("requestIdleCallback", requestIdle);
  const run = () => callbacks.shift()?.({ didTimeout: false, timeRemaining: () => 50 });
  return { requestIdle, run };
}

function mount(onShown: () => void, pages: RouteObject[], path = "/first") {
  const client = testQueryClient();
  const router = createMemoryRouter([{ element: <RootLayout />, children: [{ element: <AppLayout onShown={onShown} />, children: pages }] }], { initialEntries: [path] });
  const shown = render(<QueryClientProvider client={client}><AuthContext.Provider value={stubAuth()}><ToastProvider><RouterProvider router={router} /></ToastProvider></AuthContext.Provider></QueryClientProvider>);
  return { router, client, ...shown };
}

test("code waits for a real page, not its skeleton, then runs once at idle without fetching API data", async () => {
  const { requestIdle, run } = idleClock();
  const pages = Array.from({ length: 15 }, () => ({ load: vi.fn().mockResolvedValue({}) }));
  const shown = idlePages(pages);
  let arrive!: () => void;
  const Later = lazyPage(() => new Promise<{ default: () => JSX.Element }>((resolve) => { arrive = () => resolve({ default: () => <h1>First page</h1> }); }));
  const { calls } = salesServer();
  expect(requestIdle).not.toHaveBeenCalled();
  const mounted = mount(shown, [{ path: "/first", element: <Later /> }, { path: "/next", element: <h1>Next page</h1> }]);
  await act(async () => { await import("./NewShopGate"); });
  expect(screen.getByRole("status")).toHaveTextContent("Loading this page…");
  expect(requestIdle).not.toHaveBeenCalled();
  expect(pages.every(({ load }) => load.mock.calls.length === 0)).toBe(true);
  await act(async () => { arrive(); await vi.advanceTimersByTimeAsync(100); });
  expect(screen.getByRole("heading", { name: "First page" })).toBeInTheDocument();
  expect(requestIdle).toHaveBeenCalledTimes(1);
  expect(pages.every(({ load }) => load.mock.calls.length === 0)).toBe(true);
  const before = calls.length;
  await act(async () => run());
  for (const { load } of pages) expect(load).toHaveBeenCalledTimes(1);
  expect(calls).toHaveLength(before);
  await act(async () => { await mounted.router.navigate("/next"); await vi.advanceTimersByTimeAsync(100); });
  expect(screen.getByRole("heading", { name: "Next page" })).toBeInTheDocument();
  expect(requestIdle).toHaveBeenCalledTimes(1);
  for (const { load } of pages) expect(load).toHaveBeenCalledTimes(1);
  mounted.unmount(); mounted.client.clear();
});

test("offline at first show waits for online and then idle, without using up its one run", async () => {
  let online = false;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  const { requestIdle, run } = idleClock();
  const load = vi.fn().mockResolvedValue({});
  const shown = idlePages([{ load }]);
  shown(); shown();
  expect(requestIdle).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(5000);
  expect(load).not.toHaveBeenCalled();
  online = true;
  window.dispatchEvent(new Event("online"));
  expect(requestIdle).toHaveBeenCalledTimes(1);
  expect(load).not.toHaveBeenCalled();
  await act(async () => run());
  expect(load).toHaveBeenCalledTimes(1);
  shown(); window.dispatchEvent(new Event("online"));
  expect(requestIdle).toHaveBeenCalledTimes(1);
});

test("a line lost before the idle callback leaves the fetch available when the line returns", async () => {
  let online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  const { requestIdle, run } = idleClock();
  const load = vi.fn().mockResolvedValue({});
  const shown = idlePages([{ load }]);
  shown();
  online = false;
  await act(async () => run());
  expect(load).not.toHaveBeenCalled();
  shown();
  expect(requestIdle).toHaveBeenCalledTimes(1);
  online = true;
  window.dispatchEvent(new Event("online"));
  expect(requestIdle).toHaveBeenCalledTimes(2);
  await act(async () => run());
  expect(load).toHaveBeenCalledTimes(1);
});

test("a later real page can start a fetch that never ran on the first page", async () => {
  let online = false;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  const { requestIdle, run } = idleClock();
  const load = vi.fn().mockResolvedValue({});
  salesServer();
  const mounted = mount(idlePages([{ load }]), [{ path: "/first", element: <h1>First page</h1> }, { path: "/next", element: <h1>Next page</h1> }]);
  expect(screen.getByRole("heading", { name: "First page" })).toBeInTheDocument();
  expect(requestIdle).not.toHaveBeenCalled();
  online = true; // a later page can notice the recovered line even if the online event was missed
  await act(async () => { await mounted.router.navigate("/next"); await vi.advanceTimersByTimeAsync(100); });
  expect(screen.getByRole("heading", { name: "Next page" })).toBeInTheDocument();
  expect(requestIdle).toHaveBeenCalledTimes(1);
  await act(async () => run());
  expect(load).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event("online"));
  expect(requestIdle).toHaveBeenCalledTimes(1);
  mounted.unmount(); mounted.client.clear();
});

test("without requestIdleCallback the code waits two seconds, once, and a failed warm-up is handled", async () => {
  vi.stubGlobal("requestIdleCallback", undefined);
  const load = vi.fn(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module")));
  const shown = idlePages([{ load }]);
  shown(); shown();
  await vi.advanceTimersByTimeAsync(1999);
  expect(load).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(load).toHaveBeenCalledTimes(1);
  shown();
  await vi.advanceTimersByTimeAsync(2000);
  expect(load).toHaveBeenCalledTimes(1);
});
