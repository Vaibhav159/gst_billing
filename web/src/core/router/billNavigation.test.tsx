// 1B's early title and Back focus must survive pages loading on demand (the reviewer's backfocus probe).
import type { ReactElement } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { billQuery } from "@/core/api/sales";
import { AuthContext } from "@/core/auth/AuthProvider";
import { salesServer, wireDetail, wireFacets, wirePage, wireRow, type Call } from "@/core/sales/fixtures";
import { ToastProvider } from "@/core/ui";
import BillPage from "@/pages/sales/BillPage";
import "@/pages/sales/SalesList"; // Compile the fixtures before the clock starts; the lazy route below still controls their arrival.
import { fakeToday } from "@/pages/sales/form/testing";
import { stubAuth, testQueryClient } from "@/test/render";
import { appRoutes } from "./routes";
import { lazyPage } from "./lazyPage";

/** Keep the app's paths, handles and shell; control only when its real bill component reaches React.lazy. */
function withBill(routes: RouteObject[], element: ReactElement): RouteObject[] {
  return routes.map((route) => route.index ? route : ({ ...route, ...(route.path === "/sales/:id" ? { element } : {}), ...(route.children ? { children: withBill(route.children, element) } : {}) }));
}

const isFacets = (call: Call) => call.params.facets === 1 && call.params.page_size === 1;

test.each(["cold", "warm"])("cached bill title and Back row focus through %s lazy pages", async (mode) => {
  fakeToday();
  vi.stubGlobal("requestIdleCallback", vi.fn());
  try {
    let codeArrives!: () => void;
    const code = new Promise<void>((resolve) => { codeArrives = resolve; });
    const load = vi.fn(() => code.then(() => ({ default: BillPage })));
    const Bill = lazyPage(load);
    if (mode === "warm") codeArrives();
    let arrive!: () => void;
    const detail = new Promise<void>((resolve) => { arrive = resolve; });
    const asked = vi.fn(() => detail.then(() => wireDetail()));
    salesServer([
      ["GET", "sales/", (call) => isFacets(call)
        ? { ...wirePage([]), facets: wireFacets() }
        : wirePage([wireRow({ id: 413, invoice_number: "KGH/2026-27/32", counter: 32 }), wireRow()])],
      ["GET", "sales/412/", asked],
    ]);
    const client = testQueryClient();
    const router = createMemoryRouter(withBill(appRoutes, <Bill />), { initialEntries: ["/sales"] });
    const view = render(<QueryClientProvider client={client}><AuthContext.Provider value={stubAuth()}><ToastProvider><RouterProvider router={router} /></ToastProvider></AuthContext.Provider></QueryClientProvider>);
    try {
      const row = await waitFor(() => {
        const found = document.querySelector<HTMLElement>('tr[data-row="412"]');
        expect(found).not.toBeNull();
        return found!;
      }, { timeout: 5000 });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      act(() => row.focus());
      fireEvent.keyDown(row, { key: "Enter" });

      if (mode === "cold") {
        await waitFor(() => expect(load).toHaveBeenCalledOnce(), { timeout: 5000 });
        expect(row).toBeInTheDocument();
        expect(row).toHaveFocus();
        expect(screen.getByRole("heading", { level: 1, name: "Sales" })).toBeInTheDocument();
        expect(screen.queryByRole("status", { name: "Loading this page…" })).not.toBeInTheDocument();
        expect(asked).not.toHaveBeenCalled();
        await act(async () => codeArrives());
      }

      expect(await screen.findByRole("heading", { level: 1, name: "KGH/2026-27/31" }, { timeout: 5000 })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/sales/412");
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(asked).toHaveBeenCalledOnce();
      expect(client.getQueryState(billQuery(412).queryKey)).toMatchObject({ status: "pending", fetchStatus: "fetching", data: undefined });

      await act(async () => arrive());
      await waitFor(() => expect(screen.getAllByText("Rakesh Soni", { exact: false }).length).toBeGreaterThan(0), { timeout: 5000 });
      await act(async () => { await vi.advanceTimersByTimeAsync(300); });
      await act(async () => { await router.navigate(-1); });
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      await waitFor(() => expect(document.querySelector('tr[data-row="412"]')).toHaveFocus(), { timeout: 5000 });
      expect(router.state.location.pathname).toBe("/sales");
    } finally {
      view.unmount();
      router.dispose();
      client.clear();
    }
  } finally {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
