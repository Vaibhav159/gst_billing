import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { focusManager, onlineManager, QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";
import { createMemoryRouter, MemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { api } from "@/core/api/client";
import { __setNetState } from "@/core/api/network";
import { AuthContext } from "@/core/auth/AuthProvider";
import { stubAuth } from "@/test/render";
import { AppLayout } from "./AppLayout";
import { OfflineBanner } from "./OfflineBanner";
import { ScreenBoundary } from "./ScreenBoundary";
import { Page, QueryView, ToastProvider } from "@/core/ui";

afterEach(() => act(() => __setNetState("online")));
// the tests below the brief's answer for the server; and no spy outlives its test (a muted console.error would hide warnings)
const realAdapter = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = realAdapter; vi.restoreAllMocks(); });

test("the banner says offline, or that the app couldn't get through, and nothing when all is well", () => {
  render(<MemoryRouter><OfflineBanner /></MemoryRouter>);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  act(() => __setNetState("offline"));
  expect(screen.getByText(/You're offline/)).toBeInTheDocument();
  act(() => __setNetState("unreachable"));
  expect(screen.getByText(/The app couldn't get through/)).toBeInTheDocument();
});

test("a page that crashes shows a way home instead of a blank screen", () => {
  const Boom = () => { throw new Error("boom"); };
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(<MemoryRouter><ScreenBoundary onHome={() => {}}><Boom /></ScreenBoundary></MemoryRouter>);
  expect(screen.getByText("Something went wrong on this page")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Go to the home page" })).toBeInTheDocument();
});

function Loader({ fn }: { fn: () => Promise<string> }) {
  const q = useQuery({ queryKey: ["x", fn], queryFn: fn, retry: false });
  return <QueryView query={q} what="the bills">{(d) => <p>got {d}</p>}</QueryView>;
}
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);

test("loading shows placeholder rows, then says it's still working after 1.4 s", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  wrap(<Loader fn={() => new Promise(() => {})} />);
  expect(screen.getByRole("status")).toHaveTextContent(/loading the bills/i);
  await act(async () => { vi.advanceTimersByTime(1500); });
  expect(screen.getByText(/Still loading the bills/)).toBeInTheDocument();
  vi.useRealTimers();
});

test("a failed load explains itself and offers Try again; success shows the data", async () => {
  const cfg = {} as InternalAxiosRequestConfig;
  wrap(<Loader fn={() => Promise.reject(new AxiosError("Network Error", "ERR_NETWORK", cfg))} />);
  expect(await screen.findByRole("button", { name: /try again/i })).toBeInTheDocument();
  wrap(<Loader fn={() => Promise.resolve("31 bills")} />);
  expect(await screen.findByText("got 31 bills")).toBeInTheDocument();
});

/* ── The banner against the browser's own offline state ── */

test("offline, a reply to a request sent before the connection dropped doesn't hide the banner", async () => {
  api.defaults.adapter = ((config) => Promise.resolve({ status: 200, statusText: "", headers: {}, config, data: {} })) as AxiosAdapter;
  const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  try {
    render(<MemoryRouter><OfflineBanner /></MemoryRouter>);
    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(screen.getByText(/You're offline/)).toBeInTheDocument();
    await act(async () => { await api.get("businesses/"); });
    expect(screen.getByText(/You're offline/)).toBeInTheDocument();
  } finally {
    onLine.mockRestore();
  }
  // back online, the banner goes
  act(() => { window.dispatchEvent(new Event("online")); });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

/* ── Offline, TanStack holds a request until the device is back: QueryView says so ── */

test("offline, a load says you're offline rather than still loading, and shows the data once the internet is back", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // as after the browser's "offline" event: TanStack holds requests, and the app knows it's offline
  onlineManager.setOnline(false);
  act(() => __setNetState("offline"));
  try {
    let answer: (bills: string) => void = () => {};
    wrap(<Loader fn={() => new Promise<string>((r) => { answer = r; })} />);
    expect(await screen.findByText("You're offline")).toBeInTheDocument();
    // no Try again: TanStack sends the load by itself once the device is back, and until then refetch() does nothing
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(screen.queryByText(/Still loading/)).not.toBeInTheDocument();
    act(() => { onlineManager.setOnline(true); __setNetState("online"); });
    // back online the request goes out: placeholder rows, and the slow note only after 1.4 s of that, not at once
    expect(await screen.findByText(/^Loading the bills/)).toBeInTheDocument();
    expect(screen.queryByText(/Still loading/)).not.toBeInTheDocument();
    act(() => answer("31 bills"));
    expect(await screen.findByText("got 31 bills")).toBeInTheDocument();
  } finally {
    onlineManager.setOnline(true);
    vi.useRealTimers();
  }
});

test("a load TanStack holds between tries while the tab is hidden isn't offline: it stays loading, and carries on when the tab is back", async () => {
  let tries = 0;
  // the first try gets no reply (the server is restarting); the second gets the bills
  api.defaults.adapter = ((config) => (++tries === 1
    ? Promise.reject(new AxiosError("Network Error", "ERR_NETWORK", config))
    : Promise.resolve({ status: 200, statusText: "", headers: {}, config, data: "31 bills" }))) as AxiosAdapter;
  function Retried() {
    const q = useQuery({ queryKey: ["hidden"], queryFn: async () => (await api.get<string>("sales/")).data, retry: 1, retryDelay: 10 });
    return <QueryView query={q} what="the bills">{(d) => <p>got {d}</p>}</QueryView>;
  }
  focusManager.setFocused(false); // the person is on another tab
  try {
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><MemoryRouter><Retried /></MemoryRouter></QueryClientProvider>);
    // the second try is due, and TanStack holds it until the tab is back
    await waitFor(() => expect(client.getQueryCache().find({ queryKey: ["hidden"] })?.state.fetchStatus).toBe("paused"));
    await act(() => new Promise<void>((r) => { setTimeout(r, 20); })); // and the page has drawn it
    expect(tries).toBe(1);
    expect(screen.queryByText("You're offline")).not.toBeInTheDocument();
    expect(screen.getByText(/^Loading the bills/)).toBeInTheDocument();
    act(() => focusManager.setFocused(true));
    expect(await screen.findByText("got 31 bills")).toBeInTheDocument();
  } finally {
    focusManager.setFocused(undefined);
  }
});

/* ── Wiring: AppLayout ── */

/** AppLayout around `pages`, signed in, with a server that answers the shell's questions: one firm, no preferences. */
function inApp(pages: RouteObject[], path: string) {
  api.defaults.adapter = ((config) => Promise.resolve({ status: 200, statusText: "", headers: {}, config,
    data: config.url?.startsWith("businesses/") ? { results: [{ id: 3, name: "KIRAN GOLD HOUSE (SANDBOX)", gst_number: "08AAAAA0000A1Z5", state_name: "RAJASTHAN" }] } : { data: {} } })) as AxiosAdapter;
  const router = createMemoryRouter([{ element: <AppLayout />, children: pages }], { initialEntries: [path] });
  render(<QueryClientProvider client={new QueryClient()}><AuthContext.Provider value={stubAuth()}><ToastProvider><RouterProvider router={router} /></ToastProvider></AuthContext.Provider></QueryClientProvider>);
  return router;
}
const phone = (on: boolean) => { (window as unknown as { __phone?: boolean }).__phone = on; };
const isBefore = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

test.each([
  ["a desktop", "offline", false], ["a desktop", "unreachable", false], ["a phone", "offline", true], ["a phone", "unreachable", true],
] as const)("on %s, %s: one banner, above the page and outside it, and one page", async (_, net, onPhone) => {
  phone(onPhone);
  try {
    inApp([{ path: "/sales", element: <Page title="Bills">The bills</Page> }], "/sales");
    await screen.findByRole("heading", { level: 1, name: "Bills" });
    // on a phone, no mode chosen means Easy: this full-view page has Back to Easy at the top
    const back = onPhone ? await screen.findByRole("link", { name: /back to easy/i }) : null;
    act(() => __setNetState(net));
    const banners = document.querySelectorAll<HTMLElement>("[role=status][data-offline]");
    expect(banners).toHaveLength(1);
    expect(document.querySelectorAll("#app-main")).toHaveLength(1);
    const [banner] = banners;
    expect(banner).toHaveTextContent(net === "offline"
      ? "You're offline. What you're making stays on this device. Saving, sending and uploads need the internet."
      : "The app couldn't get through. It's probably restarting after an update. Wait a minute and try again.");
    const main = document.getElementById("app-main")!;
    expect(main).not.toContainElement(banner);
    expect(isBefore(banner, main)).toBe(true);
    if (!onPhone) {
      // on a desktop it's under the top bar, as in the prototype
      expect(isBefore(screen.getByRole("banner"), banner)).toBe(true);
    } else {
      // on a phone it's the topmost thing, as in the prototype: first in the shell, above Back to Easy, and the shell first on screen
      const shell = banner.parentElement!;
      expect(shell).toContainElement(screen.getByRole("navigation", { name: /tabs/i }));
      expect(shell.firstElementChild).toBe(banner);
      expect(shell.parentElement!.firstElementChild).toBe(shell);
      expect(isBefore(banner, back!)).toBe(true);
    }
  } finally {
    phone(false);
  }
});

function Boom(): never { throw new Error("boom"); }

test("a page that fails to draw keeps the app around it, and Go to the home page goes home", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const router = inApp([
      { path: "/", element: <Page title="Home">The home page</Page> },
      { path: "/sales", element: <Boom /> },
    ], "/sales");
    expect(await screen.findByText("Something went wrong on this page")).toBeInTheDocument();
    expect(document.getElementById("app-main")).toContainElement(screen.getByRole("alert"));
    expect(await screen.findByRole("navigation", { name: "Main" })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(400); }); // past the page's double-tap guard
    await userEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Go to the home page" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(await screen.findByText("The home page")).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong on this page")).not.toBeInTheDocument();
  } finally {
    quiet.mockRestore();
    vi.useRealTimers();
  }
});
