import { useLayoutEffect } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AxiosAdapter } from "axios";
import { createMemoryRouter, Link, RouterProvider, useLocation, useNavigate, type DataRouter } from "react-router";
import { api } from "@/core/api/client";
import { AuthContext } from "@/core/auth/AuthProvider";
import { AppLayout } from "@/core/shell/AppLayout";
import { Page, ToastProvider } from "@/core/ui";
import { stubAuth } from "@/test/render";

// The shell asks for the firms and this person's preferences: a fake server answers, so nothing reaches the network.
beforeEach(() => {
  localStorage.clear();
  api.defaults.adapter = ((config) => Promise.resolve({ status: 200, statusText: "", headers: {}, config,
    data: config.url?.startsWith("businesses/") ? { results: [] } : config.url?.startsWith("preferences/") ? { data: {} } : {} })) as AxiosAdapter;
});
afterEach(() => { vi.useRealTimers(); });

const inApp = (router: DataRouter) => render(
  <QueryClientProvider client={new QueryClient()}><AuthContext.Provider value={stubAuth()}><ToastProvider><RouterProvider router={router} /></ToastProvider></AuthContext.Provider></QueryClientProvider>,
);
/** Past the page frame's guard against the second click of a double click (300 ms), with Date faked. */
const pastGuard = () => act(() => { vi.advanceTimersByTime(400); });

test("Back puts focus on the row that opened the page, even when that page's title took focus first (Ruling 60)", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  const router = createMemoryRouter([{ element: <AppLayout />, children: [
    { path: "/customers", element: <Page title="Customers"><Link to="/customers/7" data-row="7">Anil Gupta</Link></Page> },
    { path: "/customers/7", element: <Page title="Anil Gupta">His bills</Page> },
  ] }], { initialEntries: ["/customers"] });
  inApp(router);
  await screen.findByRole("heading", { level: 1, name: "Customers" });
  pastGuard();
  await userEvent.click(screen.getByRole("link", { name: "Anil Gupta" }));
  await screen.findByRole("heading", { level: 1, name: "Anil Gupta" });
  // from here the clock moves only when the test says, so the page's own 90 ms focus comes after the late one below
  vi.useRealTimers(); // (a second useFakeTimers keeps the first one's settings)
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  await act(async () => { await router.navigate(-1); });
  const title = screen.getByRole("heading", { level: 1, name: "Customers" });
  // a Back quicker than the closed page's own focus: that late focus lands on this page's title
  act(() => title.focus());
  act(() => { vi.advanceTimersByTime(100); });
  expect(screen.getByRole("link", { name: "Anil Gupta" })).toHaveFocus();
});

test("a row that can't take focus itself hands Back's focus to its own button", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  function List() {
    const navigate = useNavigate();
    return <Page title="Bills"><div data-row="7"><button type="button" onClick={() => navigate("/sales/7")}>KGH/2026-27/7</button></div></Page>;
  }
  const router = createMemoryRouter([{ element: <AppLayout />, children: [
    { path: "/sales", element: <List /> },
    { path: "/sales/7", element: <Page title="KGH/2026-27/7">The bill</Page> },
  ] }], { initialEntries: ["/sales"] });
  inApp(router);
  await screen.findByRole("heading", { level: 1, name: "Bills" });
  pastGuard();
  await userEvent.click(screen.getByRole("button", { name: "KGH/2026-27/7" }));
  await screen.findByRole("heading", { level: 1, name: "KGH/2026-27/7" });
  await act(async () => { await router.navigate(-1); });
  await waitFor(() => expect(screen.getByRole("button", { name: "KGH/2026-27/7" })).toHaveFocus());
});

test("the closed page's own focus, come due once Back's page is on screen (a slow phone), leaves that page alone (Ruling 60)", async () => {
  // time passes after Back's page is on screen and before React tidies up after the page that closed
  let slow = false;
  function SlowPhone() {
    const { pathname } = useLocation();
    useLayoutEffect(() => { if (slow) vi.advanceTimersByTime(100); }, [pathname]);
    return null;
  }
  const router = createMemoryRouter([{ element: <><AppLayout /><SlowPhone /></>, children: [
    { path: "/customers", element: <Page title="Customers"><Link to="/customers/7" data-row="7">Anil Gupta</Link></Page> },
    { path: "/customers/7", element: <Page title="Anil Gupta">His bills</Page> },
  ] }], { initialEntries: ["/customers"] });
  inApp(router);
  await screen.findByRole("heading", { level: 1, name: "Customers" });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const titles: string[] = [];
  document.getElementById("app-main")!.addEventListener("focusin", (e) => { const el = e.target as HTMLElement; if (el.matches("[data-page-title]")) titles.push(el.textContent ?? ""); });
  act(() => screen.getByRole("link", { name: "Anil Gupta" }).focus()); // the row, opened from the keyboard
  await act(async () => { await router.navigate("/customers/7"); });
  slow = true;
  await act(async () => { await router.navigate(-1); }); // Back before that page's own 90 ms focus
  act(() => { vi.advanceTimersByTime(100); });
  expect(titles).toEqual([]);
  expect(screen.getByRole("link", { name: "Anil Gupta" })).toHaveFocus();
});
