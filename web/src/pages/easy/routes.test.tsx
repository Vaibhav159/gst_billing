import { act, render, screen, waitFor } from "@testing-library/react";
import { onlineManager, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, matchRoutes, RouterProvider } from "react-router";
import { AuthContext } from "@/core/auth/AuthProvider";
import { __resetDeviceDrafts } from "@/core/deviceDrafts";
import { __setNetState } from "@/core/api/network";
import { __resetDrafts } from "@/core/api/drafts";
import { AppLayout } from "@/core/shell/AppLayout";
import { tabOf } from "@/core/shell/nav";
import { appRoutes } from "@/core/router/routes";
import { ToastProvider } from "@/core/ui";
import { stubAuth, testQueryClient } from "@/test/render";
import { formServer } from "@/pages/sales/form/testing";
import { toDraftData } from "@/core/draftData";
import { wireDetail } from "@/core/sales/fixtures";
import BillFlow, { useEasyBill } from "./BillFlow";

function Probe() {
  const { F } = useEasyBill();
  return <><h1 data-page-title="">Bill probe</h1><output>{F.f.date}:{String(F.f.paper)}:{F.f.notes}</output><button onClick={() => F.set({ notes: "kept across steps" })}>Write note</button></>;
}
function mount(path: string | { pathname: string; state: { fullView: true } } = "/e/new", me = stubAuth()) {
  const router = createMemoryRouter([{ element: <AppLayout />, children: [
    { path: "/", element: <h1>Full probe</h1> }, { path: "/e", element: <h1>Home probe</h1> },
    { path: "/e/new", element: <BillFlow />, children: [{ index: true, element: <Probe /> }, { path: "items", element: <Probe /> }, { path: "customer", element: <Probe /> }] },
  ] }], { initialEntries: [path] });
  render(<QueryClientProvider client={testQueryClient()}><AuthContext.Provider value={me}><ToastProvider><RouterProvider router={router} /></ToastProvider></AuthContext.Provider></QueryClientProvider>);
  return router;
}
beforeEach(() => { (window as Window & { __phone?: boolean }).__phone = true; localStorage.clear(); __resetDeviceDrafts(); __resetDrafts(); formServer(); });
it("keeps a single form through both step transitions, resets when leaving the flow", async () => {
  const router = mount();
  await screen.findByRole("heading", { name: "Bill probe" });
  // Advance only the page guard's clock; no real sleep.
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1000);
  act(() => screen.getByRole("button", { name: "Write note" }).click());
  await act(async () => { await router.navigate("/e/new/items"); });
  expect(screen.getByRole("status")).toHaveTextContent("kept across steps");
  await act(async () => { await router.navigate("/e/new/customer"); });
  expect(screen.getByRole("status")).toHaveTextContent("kept across steps");
  await act(async () => { await router.navigate("/e"); });
  await screen.findByRole("heading", { name: "Home probe" });
  await act(async () => { await router.navigate("/e/new"); });
  await screen.findByRole("heading", { name: "Bill probe" });
  expect(screen.getByRole("status")).not.toHaveTextContent("kept across steps");
  now.mockRestore();
});
it("visits full home without changing Easy preference; a new home visit redirects", async () => {
  const router = mount("/e");
  await screen.findByRole("heading", { name: "Home probe" });
  await act(async () => { await router.navigate("/", { state: { fullView: true } }); });
  expect(await screen.findByRole("heading", { name: "Full probe" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Back to Easy/i })).toBeInTheDocument();
  await act(async () => { await router.navigate("/"); });
  await waitFor(() => expect(router.state.location.pathname).toBe("/e"));
});
it("resumes an earlier-day draft without moving it to today or full view", async () => {
  const data = toDraftData({ firmId: 3, date: "2026-09-30", paper: true, number: "29", numberTyped: true, lines: [], notes: "September" });
  formServer([["GET", "drafts/", () => ({ results: [{ id: "draft-old", business: 3, started_by: { id: 2, name: "Rakesh" }, data, created_at: "2026-10-08T10:00:00+05:30", updated_at: "2026-10-08T10:00:00+05:30" }] })]]);
  mount("/e/new/items?draft=draft-old");
  await screen.findByRole("heading", { name: "Bill probe" });
  expect(screen.getByRole("status")).toHaveTextContent("2026-09-30:true:September");
});
it("requires full view for an explicit place of supply, even on an earlier-day draft", async () => {
  const data = toDraftData({ firmId: 3, date: "2026-09-30", paper: true, posOverride: "24" });
  formServer([["GET", "drafts/", () => ({ results: [{ id: "draft-pos", business: 3, data }] })]]);
  mount("/e/new/items?draft=draft-pos");
  expect(await screen.findByRole("button", { name: "Finish in the full view" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Bill probe" })).not.toBeInTheDocument();
});
it("requires full view when remaking a cancelled bill with a place-of-supply override", async () => {
  formServer([["GET", "sales/412/", () => wireDetail({ status: "cancelled", place_of_supply: "24", place_of_supply_name: "GUJARAT" })]]);
  const router = mount("/e/new/items?again=412");
  const finish = await screen.findByRole("button", { name: "Finish in the full view" });
  expect(finish).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Bill probe" })).not.toBeInTheDocument();
  const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1000);
  await act(async () => finish.click());
  expect(router.state.location.pathname + router.state.location.search).toBe("/sales/new?remake=412");
  expect(router.state.location.state).toEqual({ fullView: true });
  now.mockRestore();
});
it("every contract route maps the right tab and forms/print hide tabs", () => {
  const cases = [ ["/e", "home", false], ["/e/new", "home", true], ["/e/new/items", "home", true], ["/e/new/customer", "home", true], ["/e/saved/412", "bills", false], ["/e/bills", "bills", false], ["/e/bill/412", "bills", false], ["/e/bill/412/print", "bills", true], ["/e/customers", "customers", false], ["/e/customers/new", "customers", true], ["/e/customers/7/edit", "customers", true], ["/e/capture", "capture", false], ["/e/gst", "home", false], ["/e/more", "more", false], ["/e/profile", "more", false] ] as const;
  for (const [path, tab, hidden] of cases) {
    const matched = matchRoutes(appRoutes, path)!;
    expect(matched.at(-1)?.route.path).not.toBe("*");
    expect(tabOf(path)).toBe(tab);
    expect(matched.some(m => m.route.handle?.hideNav)).toBe(hidden);
  }
});

it.each(["?again=412", "?customer=7"])("settles a no-firm deep link %s without waiting forever", async search => {
  formServer([["GET", /^(?:businesses|firms)\/$/, () => ({ results: [] })]]);
  mount(`/e/new/items${search}`);
  expect(await screen.findByText("No firm to bill from yet. The owner adds firms in Records.")).toBeInTheDocument();
});

it("treats persisted Full view router state on reload as an ordinary Easy home", async () => {
  const router = mount({ pathname: "/", state: { fullView: true } });
  await waitFor(() => expect(router.state.location.pathname).toBe("/e"));
});

afterEach(() => { onlineManager.setOnline(true); __setNetState("online"); });
it.each(["?again=412", "?customer=7"])("explains an uncached offline deep link %s", async search => {
  const router = mount("/e/new");
  await screen.findByRole("heading", { name: "Bill probe" });
  await act(async () => { await router.navigate("/e"); });
  act(() => { onlineManager.setOnline(false); __setNetState("offline"); });
  await act(async () => { await router.navigate(`/e/new/items${search}`); });
  expect(await screen.findByText(/can't load without the internet/)).toBeInTheDocument();
});
