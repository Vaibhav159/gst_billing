import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider, type DataRouter, type RouteObject } from "react-router";
import { AuthContext } from "@/core/auth/AuthProvider";
import { wireDashboard, wireDue } from "@/core/dashboard/fixtures";
import { wireRates } from "@/core/rates/testing";
import { appRoutes } from "@/core/router/routes";
import { loadedPage } from "@/core/router/lazyPage";
import { salesServer } from "@/core/sales/fixtures";
import { ToastProvider } from "@/core/ui";
import { stubAuth, testQueryClient } from "@/test/render";

const clients: QueryClient[] = [];
const routers: DataRouter[] = [];
const everyRoute = (routes: RouteObject[]): RouteObject[] => routes.flatMap(route => [route, ...everyRoute(route.children ?? [])]);
afterEach(() => {
  cleanup();
  routers.splice(0).forEach(router => router.dispose());
  clients.splice(0).forEach(client => client.clear());
  vi.useRealTimers();
  (window as unknown as { __phone?: boolean }).__phone = false;
});

test.each([false, true])("the real / route composes Today and 5C's rates, phone=%s", async (phone) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T10:00:00+05:30"));
  localStorage.clear();
  (window as unknown as { __phone?: boolean }).__phone = phone;
  // Resolve the lazy module before Testing Library's DOM timeout starts. The
  // assertion still mounts the actual route, including its Suspense boundary.
  await loadedPage(everyRoute(appRoutes).find(route => route.path === "/")?.element);
  const { calls } = salesServer([
    ["GET", "preferences/", () => ({ data: { phoneMode: "expert" } })],
    ["GET", "dashboard/", wireDashboard],
    ["GET", "due-next/", wireDue],
    ["GET", "rates/", () => wireRates()],
  ]);
  const client = testQueryClient(); clients.push(client);
  const router = createMemoryRouter(appRoutes, { initialEntries: ["/"] }); routers.push(router);
  render(<QueryClientProvider client={client}><AuthContext.Provider value={stubAuth()}><ToastProvider><RouterProvider router={router} /></ToastProvider></AuthContext.Provider></QueryClientProvider>);
  expect(await screen.findByRole("heading", { level: 1, name: "Today" })).toBeInTheDocument();
  const rates = phone
    ? await screen.findByRole("button", { name: /^Today's rates · set/ })
    : await screen.findByRole("region", { name: "Today's rates" });
  expect(within(rates).getByText("Gold 22K")).toBeInTheDocument();
  expect(within(rates).getByText("Silver 999")).toBeInTheDocument();
  expect(rates).toHaveTextContent(/65,125\.00/);
  expect(rates).toHaveTextContent(/78,500\.00/);
  if (phone) expect(within(rates).queryByText("Gold 24K")).not.toBeInTheDocument();
  else expect(within(rates).getAllByRole("listitem")).toHaveLength(5);
  expect(calls.filter(call => call.url === "rates/")).toHaveLength(1);
  expect(screen.getByRole("region", { name: "Due next" })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/");
  if (phone) expect(screen.getByRole("button", { name: "Search customers and bills" })).toBeInTheDocument();
}, 15_000);
