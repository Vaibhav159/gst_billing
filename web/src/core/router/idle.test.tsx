import { isValidElement } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { AuthContext } from "@/core/auth/AuthProvider";
import { salesServer } from "@/core/sales/fixtures";
import { ToastProvider } from "@/core/ui";
import { fakeToday } from "@/pages/sales/form/testing";
import { stubAuth, testQueryClient } from "@/test/render";
import { idlePages } from "./lazyPage";
import { appRoutes } from "./routes";

const { rendererLoaded, paletteLoaded } = vi.hoisted(() => ({ rendererLoaded: vi.fn(), paletteLoaded: vi.fn() }));
vi.mock("@/core/shell/Palette", async (real) => { paletteLoaded(); return real<typeof import("@/core/shell/Palette")>(); });
vi.mock("@react-pdf/renderer", () => { rendererLoaded(); return {}; });

// This test imports all fourteen screens; module transforms share the dispatch's two CPUs with other suites.
vi.setConfig({ testTimeout: 20_000 });

const all = (routes: RouteObject[]): RouteObject[] => routes.flatMap((r) => [r, ...all(r.children ?? [])]);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

test("Selling's code waits for the shell and idle, loads each screen once, and fetches neither PDF renderer nor API data", async () => {
  const user = fakeToday();
  let idle!: IdleRequestCallback;
  const requestIdle = vi.fn((callback: IdleRequestCallback) => { idle = callback; return 1; });
  vi.stubGlobal("requestIdleCallback", requestIdle);
  const pages = [...new Set(all(appRoutes).flatMap((r) => isValidElement(r.element) && typeof r.element.type !== "string" && "load" in r.element.type ? [r.element.type as { load: () => Promise<unknown> }] : []))];
  const loads = pages.map((page) => vi.spyOn(page, "load"));
  const { calls } = salesServer();
  expect(loads.every((load) => load.mock.calls.length === 0)).toBe(true);
  expect(requestIdle).not.toHaveBeenCalled();
  expect(rendererLoaded).not.toHaveBeenCalled();
  expect(paletteLoaded).not.toHaveBeenCalled();
  const qc = testQueryClient();
  const router = createMemoryRouter(appRoutes, { initialEntries: ["/"] });
  const tree = () => <QueryClientProvider client={qc}><AuthContext.Provider value={stubAuth()}><ToastProvider><RouterProvider router={router} /></ToastProvider></AuthContext.Provider></QueryClientProvider>;
  const shown = render(tree());
  expect(screen.getByRole("banner")).toBeInTheDocument();
  expect(requestIdle).toHaveBeenCalledTimes(1);
  expect(loads.every((load) => load.mock.calls.length === 0)).toBe(true);
  await waitFor(() => expect(qc.isFetching()).toBe(0), { timeout: 5000 });
  const before = calls.length;
  await act(async () => {
    idle({ didTimeout: false, timeRemaining: () => 50 });
    await Promise.all(loads.map((load) => load.mock.results[0]?.value));
  });
  expect(pages).toHaveLength(14);
  await waitFor(() => expect(paletteLoaded).toHaveBeenCalledTimes(1), { timeout: 5000 });
  for (const load of loads) expect(load).toHaveBeenCalledTimes(1);
  expect(rendererLoaded).not.toHaveBeenCalled();
  expect(calls).toHaveLength(before);
  await user.click(screen.getByRole("button", { name: "Search (Ctrl K)" }));
  expect(await screen.findByRole("dialog", { name: "Search" }, { timeout: 5000 })).toBeInTheDocument();
  // Remounting the signed-in shell still belongs to this page load.
  shown.unmount();
  render(tree());
  expect(requestIdle).toHaveBeenCalledTimes(1);
  for (const load of loads) expect(load).toHaveBeenCalledTimes(1);
  qc.clear();
});

test("without requestIdleCallback the code waits for a timer, once, and a failed warm-up is handled", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("requestIdleCallback", undefined);
  const load = vi.fn(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module")));
  const shown = idlePages([{ load }]);
  expect(load).not.toHaveBeenCalled();
  shown(); shown();
  expect(load).not.toHaveBeenCalled();
  await vi.runOnlyPendingTimersAsync();
  expect(load).toHaveBeenCalledTimes(1);
  shown();
  await vi.runOnlyPendingTimersAsync();
  expect(load).toHaveBeenCalledTimes(1);
});
