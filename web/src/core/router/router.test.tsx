import { useLayoutEffect, useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Link, matchRoutes, Outlet, RouterProvider, useNavigate, useParams, type DataRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AxiosAdapter } from "axios";
import { api } from "@/core/api/client";
import { AuthContext } from "@/core/auth/AuthProvider";
import { AppRoutes } from "@/App";
import { Page, Sheet, ToastProvider, useToast, type ToastApi } from "@/core/ui";
import { AppLayout, RootLayout } from "@/core/shell/AppLayout";
import { stubAuth } from "@/test/render";
import { PageFrame } from "./PageFrame";
import { appRoutes, V2_REDIRECTS } from "./routes";
import { useUnsavedGuard } from "./useUnsavedGuard";

// The shell asks for the firms and this person's preferences: a fake server answers, so no test reaches the network.
beforeEach(() => {
  localStorage.clear();
  api.defaults.adapter = ((config) => Promise.resolve({ status: 200, statusText: "", headers: {}, config,
    data: config.url?.startsWith("businesses/") ? { results: [{ id: 3, name: "KIRAN GOLD HOUSE (SANDBOX)", gst_number: "08AAAAA0000A1Z5", state_name: "RAJASTHAN" }] }
      : config.url?.startsWith("preferences/") ? { data: {} } : {} })) as AxiosAdapter;
});

/** /api/me/'s answer for the owner, as the real sign-in state reads it. */
const OWNER_ME = { id: 1, username: "kailash", full_name: "Kailash Mehta", role: "owner", role_label: "Owner", permissions: "*", needs_role_choice: false };

/** The providers App gives the shell (queries, sign-in, toasts) around a router; `extra` renders beside the router, inside the toast provider. */
const inApp = (router: DataRouter, extra: ReactNode = null) => <QueryClientProvider client={new QueryClient()}><AuthContext.Provider value={stubAuth()}><ToastProvider>{extra}<RouterProvider router={router} /></ToastProvider></AuthContext.Provider></QueryClientProvider>;

/** `extra` renders beside the router, inside the toast provider, as App's own providers do. */
function mount(path: string, signedIn = true, extra: ReactNode = null) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(<QueryClientProvider client={new QueryClient()}><AuthContext.Provider value={stubAuth(signedIn ? undefined : null)}><ToastProvider>{extra}<RouterProvider router={router} /></ToastProvider></AuthContext.Provider></QueryClientProvider>);
  return router;
}

test("a screen from a later part says which part brings it", async () => {
  mount("/sales");
  expect(await screen.findByRole("heading", { level: 1, name: "Bills" })).toBeInTheDocument();
  expect(screen.getByText(/comes in part 1/i)).toBeInTheDocument();
});

test("signed out, any page goes to sign-in and remembers where it was going", async () => {
  const router = mount("/customers/7", false);
  await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  expect(router.state.location.search).toBe("?next=%2Fcustomers%2F7");
});

test("v2's addresses still work", async () => {
  const router = mount("/billing/invoice/edit/42");
  await waitFor(() => expect(router.state.location.pathname).toBe("/sales/42/edit"));
  expect(V2_REDIRECTS.length).toBeGreaterThanOrEqual(40);
});

test("a new page puts focus on its title and announces it", async () => {
  const router = mount("/sales");
  await screen.findByRole("heading", { level: 1, name: "Bills" });
  await act(async () => { await router.navigate("/customers"); });
  const h1 = await screen.findByRole("heading", { level: 1, name: "Customers" });
  await waitFor(() => expect(h1).toHaveFocus());
  // Ruling 6: announce() sets the text in a frame after the 90 ms timer, so wait for it
  await waitFor(() => expect(document.getElementById("route-announcer")).toHaveTextContent("Customers"));
});

test("an unknown address shows the not-found page with a way home", async () => {
  mount("/no/such/page");
  expect(await screen.findByRole("heading", { level: 1, name: /isn't here/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /home/i })).toHaveAttribute("href", "/");
});

test("something outside a page's own boundary that fails to draw (the shell, sign-in, search) shows the same words and Reload, never React Router's error page", async () => {
  const reported = vi.spyOn(console, "error").mockImplementation(() => {}); // React and React Router report the error, as they should
  const reload = vi.fn();
  vi.stubGlobal("location", { ...window.location, reload });
  try {
    let broken = true;
    function Shell() { if (broken) throw new Error("the shell broke"); return <p>the home page</p>; }
    // the app's own root route, around a shell that throws while it draws
    const [root] = appRoutes;
    const router = createMemoryRouter([{ element: root.element, errorElement: root.errorElement, children: [{ path: "*", element: <Shell /> }] }], { initialEntries: ["/sales"] });
    render(inApp(router));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong on this page");
    expect(alert).toHaveTextContent("Nothing you saved is affected. Reload the app, or go back to the home page and try again.");
    expect(screen.queryByText(/Unexpected Application Error/)).not.toBeInTheDocument();
    expect(screen.queryByText(/the shell broke/)).not.toBeInTheDocument(); // no message, no stack trace
    await userEvent.click(within(alert).getByRole("button", { name: "Reload the app" }));
    expect(reload).toHaveBeenCalledTimes(1);
    // once it draws again, the home page is a button away
    broken = false;
    await userEvent.click(within(alert).getByRole("button", { name: "Go to the home page" }));
    expect(await screen.findByText("the home page")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
  } finally {
    vi.unstubAllGlobals();
    reported.mockRestore();
  }
});

test("the second click of a double click doesn't land on the page that just opened", async () => {
  const router = mount("/sales");
  await screen.findByRole("heading", { level: 1, name: "Bills" });
  await act(async () => { await router.navigate("/customers"); });
  const h1 = await screen.findByRole("heading", { level: 1, name: "Customers" });
  const spy = vi.fn();
  h1.addEventListener("click", spy);
  await userEvent.click(h1);
  expect(spy).not.toHaveBeenCalled();
});

/* ── Beyond the brief: the page frame's Back and the unsaved-changes guard ── */

/** Past the guards that drop the second tap of a double tap (300 ms for a new page, 350 ms for a dialog). */
const afterADoubleTap = () => act(() => { vi.advanceTimersByTime(400); });
const frame = () => document.getElementById("app-main")!.firstElementChild as HTMLElement;
const wait = (ms: number) => act(() => new Promise<void>((r) => { setTimeout(r, ms); }));
/** After the frame in which a page that just opened scrolls itself to the top, the moment a person could scroll it. */
const nextFrame = () => act(() => new Promise<void>((r) => { requestAnimationFrame(() => r()); }));

test("Back returns to the same scroll and to the row that opened the page; a new page starts at the top", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  try {
    const router = createMemoryRouter([{ element: <AppLayout />, children: [
      { path: "/customers", element: <Page title="Customers"><Link to="/customers/7" data-row="7">Anil Gupta</Link></Page> },
      { path: "/customers/7", element: <Page title="Anil Gupta">His bills</Page> },
    ] }], { initialEntries: ["/customers"] });
    render(inApp(router));
    await screen.findByRole("heading", { level: 1, name: "Customers" });
    await nextFrame();
    const main = document.getElementById("app-main")!;
    main.scrollTop = 480;
    fireEvent.scroll(main);
    afterADoubleTap();
    await userEvent.click(screen.getByRole("link", { name: "Anil Gupta" }));
    const title = await screen.findByRole("heading", { level: 1, name: "Anil Gupta" });
    await waitFor(() => expect(main.scrollTop).toBe(0));
    await waitFor(() => expect(title).toHaveFocus());

    await act(async () => { await router.navigate(-1); });
    const row = await screen.findByRole("link", { name: "Anil Gupta" });
    await waitFor(() => expect(main.scrollTop).toBe(480));
    await waitFor(() => expect(row).toHaveFocus());
  } finally {
    vi.useRealTimers();
  }
});

test("leaving a page with unsaved changes asks first: Stay keeps the page, Leave goes", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  try {
    function NewBill() { return <>{useUnsavedGuard(true)}<p>the form</p></>; }
    const router = createMemoryRouter([{ path: "/sales", element: <p>the list</p> }, { path: "/sales/new", element: <NewBill /> }], { initialEntries: ["/sales", "/sales/new"], initialIndex: 1 });
    render(<ToastProvider><RouterProvider router={router} /></ToastProvider>);
    // closing the tab asks too
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    await act(async () => { await router.navigate("/sales"); });
    let dialog = await screen.findByRole("dialog", { name: "Leave without saving?" });
    expect(dialog).toHaveTextContent("Your changes aren't saved. Leave this page and lose them?");
    afterADoubleTap();
    fireEvent.click(within(dialog).getByRole("button", { name: "Stay" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe("/sales/new");

    // the browser's Back asks the same
    await act(async () => { await router.navigate(-1); });
    dialog = await screen.findByRole("dialog", { name: "Leave without saving?" });
    afterADoubleTap();
    fireEvent.click(within(dialog).getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/sales"));
    expect(screen.getByText("the list")).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

/* ── The review's rulings ── */

test("one toast host covers sign-in and the app: a toast shows exactly once on either", async () => {
  let toast!: ToastApi;
  function Grab() { toast = useToast(); return null; }
  mount("/login", false, <Grab />);
  await screen.findByRole("heading", { level: 1, name: "GST Billing" }); // the sign-in page (Task 14)
  act(() => { toast.show({ title: "Shown on the sign-in page" }); });
  expect(await screen.findAllByText("Shown on the sign-in page")).toHaveLength(1);
  cleanup();

  mount("/sales", true, <Grab />);
  await screen.findByRole("heading", { level: 1, name: "Bills" });
  act(() => { toast.show({ title: "Shown in the app" }); });
  expect(await screen.findAllByText("Shown in the app")).toHaveLength(1);
});

const phone = (on: boolean) => { (window as unknown as { __phone?: boolean }).__phone = on; };

test("on a phone, Back up to the page above slides back, even with no page before it in the tab", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  phone(true);
  try {
    const router = createMemoryRouter([{ element: <AppLayout />, children: [
      { path: "/sales/7", element: <Page title="Bill 7" back="/sales">The bill</Page> },
      { path: "/sales/7/edit", element: <Page title="Edit bill 7" back="/sales/7">The form</Page> },
    ] }], { initialEntries: ["/sales/7/edit"] });
    render(inApp(router));
    await screen.findByRole("heading", { level: 1, name: "Edit bill 7" });
    afterADoubleTap();
    // opened straight from a link: Back goes up to the bill, in this entry's place
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("heading", { level: 1, name: "Bill 7" });
    expect(router.state.historyAction).toBe("REPLACE");
    expect(frame()).toHaveClass("anim-page-pop");

    await act(async () => { await router.navigate("/sales/7/edit"); });
    await screen.findByRole("heading", { level: 1, name: "Edit bill 7" });
    expect(frame()).toHaveClass("anim-page-push");
  } finally {
    phone(false);
    vi.useRealTimers();
  }
});

test("forms and print hide the phone's tabs; every other page keeps them", () => {
  const hidesTabs = (path: string) => {
    const m = matchRoutes(appRoutes, path);
    return Boolean(m && m[m.length - 1].route.handle?.hideNav);
  };
  const hidden = [
    "/sales/new", "/sales/7/edit", "/sales/7/print", "/customers/new", "/customers/7/edit", "/purchases/new", "/purchases/9/edit", "/purchases/inbox/4",
    "/products/new", "/products/5/edit", "/firms/new", "/firms/3/edit", "/e/new", "/e/new/items", "/e/customers/new", "/e/customers/7/edit",
  ];
  for (const path of hidden) expect(hidesTabs(path), path).toBe(true);
  const shown = [
    "/", "/sales", "/sales/7", "/sales/paper", "/customers/7", "/customers/7/statement", "/purchases/inbox", "/purchases/9", "/products/5", "/firms/3",
    "/e", "/e/bills", "/e/customers", "/e/bill/5", "/more", "/login", "/no/such/page",
  ];
  for (const path of shown) expect(hidesTabs(path), path).toBe(false);
});

/* ── Found in self-review ── */

test("the page the app opened on doesn't play its entrance again when the shell around it re-renders", async () => {
  phone(true);
  try {
    // as AppLayout is, now that it holds search's open state (Task 17)
    function Shell() {
      const [, setOpen] = useState(0);
      return <><button onClick={() => setOpen((n) => n + 1)}>Search</button><main id="app-main"><PageFrame><Outlet /></PageFrame></main></>;
    }
    const router = createMemoryRouter([{ element: <Shell />, children: [
      { path: "/sales", element: <Page title="Bills">The list</Page> },
      { path: "/sales/7", element: <Page title="Bill 7">The bill</Page> },
    ] }], { initialEntries: ["/sales"] });
    // signed in, as the frame always is (it notes who opened each record)
    render(<AuthContext.Provider value={stubAuth()}><ToastProvider><RouterProvider router={router} /></ToastProvider></AuthContext.Provider>);
    await screen.findByRole("heading", { level: 1, name: "Bills" });
    expect(frame()).toHaveClass("h-full", { exact: true });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(frame()).toHaveClass("h-full", { exact: true });

    // moving on still slides, and so does coming back to it
    await act(async () => { await router.navigate("/sales/7"); });
    await screen.findByRole("heading", { level: 1, name: "Bill 7" });
    expect(frame()).toHaveClass("anim-page-push");
    await act(async () => { await router.navigate(-1); });
    await screen.findByRole("heading", { level: 1, name: "Bills" });
    expect(frame()).toHaveClass("anim-page-pop");
  } finally {
    phone(false);
  }
});

/* ── Ruling 33 (review round 1) ── */

test("a filter change (?query) is the same page: no replay, no swallowed tap, no announcement; scroll and focus stay", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  try {
    const router = createMemoryRouter([{ element: <AppLayout />, children: [
      { path: "/sales/paper", element: <Page title="Paper book"><button>Next month</button></Page> },
    ] }], { initialEntries: ["/sales/paper"] });
    render(inApp(router));
    await screen.findByRole("heading", { level: 1, name: "Paper book" });
    await nextFrame();
    const page = frame();
    const main = document.getElementById("app-main")!;
    const next = screen.getByRole("button", { name: "Next month" });
    afterADoubleTap();
    act(() => next.focus());
    main.scrollTop = 480;
    await act(async () => { await router.navigate("/sales/paper?month=2026-10", { replace: true }); });
    expect(frame()).toBe(page);
    expect(page).toHaveClass("h-full", { exact: true });
    const spy = vi.fn();
    next.addEventListener("click", spy);
    fireEvent.click(next);
    expect(spy).toHaveBeenCalledTimes(1);
    await wait(200); // past the 90 ms announcement and a frame
    expect(document.getElementById("route-announcer")).toBeEmptyDOMElement();
    expect(main.scrollTop).toBe(480);
    expect(next).toHaveFocus();
  } finally {
    vi.useRealTimers();
  }
});

test("on a phone, a filter change on a page reached by Back keeps its slide and the toast on screen", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  phone(true);
  try {
    let toast!: ToastApi;
    function Grab() { toast = useToast(); return null; }
    const router = createMemoryRouter([{ element: <RootLayout />, children: [{ element: <AppLayout />, children: [
      { path: "/sales/paper", element: <Page title="Paper book">The book</Page> },
      { path: "/sales/7", element: <Page title="Bill 7">The bill</Page> },
    ] }] }], { initialEntries: ["/sales/paper", "/sales/7"], initialIndex: 1 });
    render(inApp(router, <Grab />));
    await screen.findByRole("heading", { level: 1, name: "Bill 7" });
    await act(async () => { await router.navigate(-1); });
    await screen.findByRole("heading", { level: 1, name: "Paper book" });
    const page = frame();
    expect(page).toHaveClass("h-full anim-page-pop", { exact: true });
    act(() => { toast.show({ title: "Bill 7 saved" }); });
    act(() => { vi.advanceTimersByTime(2000); }); // older than the 1.2 s a toast shown just before a move is kept
    await act(async () => { await router.navigate("/sales/paper?month=2026-10", { replace: true }); });
    await wait(250); // a dismissed toast is gone after 170 ms
    expect(frame()).toBe(page);
    expect(page).toHaveClass("h-full anim-page-pop", { exact: true });
    expect(screen.getByText("Bill 7 saved")).toBeInTheDocument();
  } finally {
    phone(false);
    vi.useRealTimers();
  }
});

test("a row opened from the keyboard is where Back puts focus, not the last thing clicked", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  try {
    function List() {
      const navigate = useNavigate();
      return <Page title="Bills"><button id="filter">Filter</button><div data-row="7" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") navigate("/sales/7"); }}>KGH/7</div></Page>;
    }
    const router = createMemoryRouter([{ element: <AppLayout />, children: [
      { path: "/sales", element: <List /> },
      { path: "/sales/7", element: <Page title="Bill 7">The bill</Page> },
    ] }], { initialEntries: ["/sales"] });
    render(inApp(router));
    await screen.findByRole("heading", { level: 1, name: "Bills" });
    afterADoubleTap();
    await userEvent.click(screen.getByRole("button", { name: "Filter" }));
    const row = screen.getByText("KGH/7");
    act(() => row.focus());
    fireEvent.keyDown(row, { key: "Enter" });
    await screen.findByRole("heading", { level: 1, name: "Bill 7" });
    await act(async () => { await router.navigate(-1); });
    await screen.findByRole("heading", { level: 1, name: "Bills" });
    await waitFor(() => expect(screen.getByText("KGH/7")).toHaveFocus());
  } finally {
    vi.useRealTimers();
  }
});

test("Back keeps the list's place even when the next page's clamp is reported before the list is gone (slow phones)", async () => {
  // Swapping in a short page clamps the list's scroll, and a slow phone can report that scroll while React is still
  // committing. Here the short page reports it from its layout effect, in the very commit that removes the list.
  function ShortPage() {
    useLayoutEffect(() => {
      const main = document.getElementById("app-main")!;
      main.scrollTop = 0;
      main.dispatchEvent(new Event("scroll"));
    }, []);
    return <Page title="Dashboard">Today</Page>;
  }
  const router = createMemoryRouter([{ element: <AppLayout />, children: [
    { path: "/sales", element: <Page title="Bills">A long list</Page> },
    { path: "/", element: <ShortPage /> },
  ] }], { initialEntries: ["/sales"] });
  render(inApp(router));
  await screen.findByRole("heading", { level: 1, name: "Bills" });
  await nextFrame();
  const main = document.getElementById("app-main")!;
  main.scrollTop = 3000;
  fireEvent.scroll(main);
  await act(async () => { await router.navigate("/"); });
  await screen.findByRole("heading", { level: 1, name: "Dashboard" });
  await act(async () => { await router.navigate(-1); });
  await screen.findByRole("heading", { level: 1, name: "Bills" });
  await waitFor(() => expect(main.scrollTop).toBe(3000));
});

test("signing in lands with focus on the page's title and announces it; the page the app opened on is left alone", async () => {
  // opened straight on a page: the browser decides where focus starts
  mount("/sales");
  const opened = await screen.findByRole("heading", { level: 1, name: "Bills" });
  await wait(200);
  expect(opened).not.toHaveFocus();
  expect(document.getElementById("route-announcer")).toBeEmptyDOMElement();
  cleanup();

  // signing in on the sign-in page, through the app's own providers and sign-in state: the page goes on to `next` itself
  const answer = api.defaults.adapter as AxiosAdapter;
  api.defaults.adapter = ((config) => (config.url === "token/" || config.url === "me/"
    ? Promise.resolve({ status: 200, statusText: "", headers: {}, config, data: config.url === "token/" ? { access: "a", refresh: "r" } : OWNER_ME })
    : answer(config))) as AxiosAdapter;
  const router = createMemoryRouter(appRoutes, { initialEntries: ["/login?next=%2Fsales"] });
  render(<AppRoutes router={router} />);
  await screen.findByRole("heading", { level: 1, name: "GST Billing" }); // the sign-in page (Task 14)
  await userEvent.type(screen.getByLabelText("Username"), "kailash");
  await userEvent.type(screen.getByLabelText("Password"), "pw");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  const h1 = await screen.findByRole("heading", { level: 1, name: "Bills" });
  expect(router.state.location.pathname).toBe("/sales");
  await waitFor(() => expect(h1).toHaveFocus());
  await waitFor(() => expect(document.getElementById("route-announcer")).toHaveTextContent("Bills"));
});

test("Back remembers the place on the last 50 pages left, and forgets older ones", async () => {
  function Numbered() { const { n } = useParams(); return <Page title={`Page ${n}`}>Page {n}</Page>; }
  const router = createMemoryRouter([{ element: <AppLayout />, children: [{ path: "/p/:n", element: <Numbered /> }] }], { initialEntries: ["/p/0"] });
  render(inApp(router));
  await screen.findByRole("heading", { level: 1, name: "Page 0" });
  const main = document.getElementById("app-main")!;
  const scrollTo = async (y: number) => { await nextFrame(); main.scrollTop = y; fireEvent.scroll(main); };
  await scrollTo(300);
  await act(async () => { await router.navigate("/p/1"); });
  await scrollTo(200);
  for (let n = 2; n <= 50; n++) await act(async () => { await router.navigate(`/p/${n}`); });
  // 50 pages left behind; going Back leaves page 50 too, the 51st: page 0, the oldest, is forgotten and page 1 kept
  await act(async () => { await router.navigate(-49); });
  await screen.findByRole("heading", { level: 1, name: "Page 1" });
  await waitFor(() => expect(main.scrollTop).toBe(200));
  await act(async () => { await router.navigate(-1); });
  await screen.findByRole("heading", { level: 1, name: "Page 0" });
  await nextFrame();
  await waitFor(() => expect(main.scrollTop).toBe(0));
});

test("the sign-in page carries the view too, so phone fields there get the 16 px text that keeps iOS from zooming", async () => {
  phone(true);
  try {
    mount("/login", false);
    const h1 = await screen.findByRole("heading", { level: 1, name: "GST Billing" }); // the sign-in page (Task 14)
    expect(h1.closest("[data-view]")).toHaveAttribute("data-view", "expert");
    expect(screen.getByLabelText("Username").closest("[data-view]")).toHaveAttribute("data-view", "expert");
  } finally {
    phone(false);
  }
});

test("every v2 address lands on its own new address; v2's number link stays a page", async () => {
  const wrong: string[] = [];
  for (const [path, to] of V2_REDIRECTS) {
    const params: Record<string, string> = {};
    const url = path.replace(/:(\w+)/g, (_m, k: string) => (params[k] = k === "id" ? "42" : k));
    const router = mount(url);
    try { await waitFor(() => expect(router.state.location.pathname).toBe(to(params)), { timeout: 500 }); }
    catch { wrong.push(`${url} -> ${router.state.location.pathname}, not ${to(params)}`); }
    cleanup();
  }
  expect(wrong).toEqual([]);
  const router = mount("/billing/invoice/kgh/2026-27/31");
  await screen.findByRole("heading", { level: 1, name: "Bills" });
  expect(router.state.location.pathname).toBe("/billing/invoice/kgh/2026-27/31");
});

test("a sheet on its way out as the page changes doesn't keep focus from the new page's title", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  // a sheet outside the page (the shell's, as search will be): picking a place closes it and opens that page
  function WithSheet() {
    const [open, setOpen] = useState(false);
    const navigate = useNavigate();
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>Go to</button>
        <Outlet />
        <Sheet open={open} onClose={() => setOpen(false)} title="Go to">
          <button type="button" onClick={() => { setOpen(false); navigate("/customers"); }}>Customers</button>
        </Sheet>
      </>
    );
  }
  try {
    const router = createMemoryRouter([{ element: <WithSheet />, children: [{ element: <AppLayout />, children: [
      { path: "/sales", element: <Page title="Bills">The bills</Page> },
      { path: "/customers", element: <Page title="Customers">The customers</Page> },
    ] }] }], { initialEntries: ["/sales"] });
    render(inApp(router));
    await screen.findByRole("heading", { level: 1, name: "Bills" });
    afterADoubleTap();
    fireEvent.click(screen.getByRole("button", { name: "Go to" }));
    const sheet = await screen.findByRole("dialog", { name: "Go to" });
    afterADoubleTap();
    fireEvent.click(within(sheet).getByRole("button", { name: "Customers" }));
    const h1 = await screen.findByRole("heading", { level: 1, name: "Customers" });
    await waitFor(() => expect(h1).toHaveFocus());
  } finally {
    vi.useRealTimers();
  }
});
