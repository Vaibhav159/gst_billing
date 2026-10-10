import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AxiosAdapter } from "axios";
import { createMemoryRouter, RouterProvider } from "react-router";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api } from "@/core/api/client";
import { AuthContext } from "@/core/auth/AuthProvider";
import { ToastProvider } from "@/core/ui";
import { appRoutes } from "@/core/router/routes";
import { stubAuth } from "@/test/render";
// for the tests after the brief's four
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup } from "@testing-library/react";
import { AxiosError } from "axios";
import type { DataRouter } from "react-router";
import { AppRoutes } from "@/App";
import { __setNetState } from "@/core/api/network";
import { queryClient } from "@/core/api/query";
import type { AuthValue } from "@/core/auth/AuthProvider";
import { applyTextSize } from "@/core/device";
import { Button, Page } from "@/core/ui";
import { overlayLayer } from "@/core/ui/Overlay";
import { AppLayout } from "./AppLayout";
import { useKeyboardInset } from "./keyboard";
import { tabOf } from "./nav";

const auth = stubAuth();

function mount(path: string, prefs: Record<string, unknown> = {}) {
  api.defaults.adapter = ((config) => Promise.resolve({ status: 200, statusText: "", headers: {}, config,
    data: config.url?.startsWith("preferences/") ? { data: prefs } : config.url?.startsWith("businesses/") ? { results: [] } : {} })) as AxiosAdapter;
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(<QueryClientProvider client={new QueryClient()}><AuthContext.Provider value={auth}><ToastProvider><RouterProvider router={router} /></ToastProvider></AuthContext.Provider></QueryClientProvider>);
  return router;
}

beforeEach(() => { localStorage.clear(); (window as unknown as { __phone?: boolean }).__phone = true; });
afterEach(() => { (window as unknown as { __phone?: boolean }).__phone = false; });

test("Expert on a phone: five tabs at the bottom, the current one marked", async () => {
  mount("/customers", { phoneMode: "expert" });
  const tabs = await screen.findByRole("navigation", { name: /tabs/i });
  for (const name of ["Home", "Bills", "Capture", "Customers", "More"]) expect(within(tabs).getByRole("link", { name })).toBeInTheDocument();
  expect(within(tabs).getByRole("link", { name: "Customers" })).toHaveAttribute("aria-current", "page");
});

test("Easy is the phone's default: home goes to /e and its tabs stay in Easy", async () => {
  const router = mount("/");
  await waitFor(() => expect(router.state.location.pathname).toBe("/e"));
  const tabs = await screen.findByRole("navigation", { name: /tabs/i });
  expect(within(tabs).getByRole("link", { name: "Bills" })).toHaveAttribute("href", "/e/bills");
});

test("an Easy person on an Expert page gets a way back to Easy", async () => {
  mount("/customers");
  expect(await screen.findByRole("link", { name: /back to easy/i })).toHaveAttribute("href", "/e");
});

test("More lists the other pages, switches mode and signs out", async () => {
  mount("/more", { phoneMode: "expert" });
  expect(await screen.findByRole("link", { name: /products/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /switch to easy/i })).toBeInTheDocument();
  await act(() => new Promise<void>((r) => { setTimeout(r, 300); })); // past the page's guard against a double tap's second tap (PageFrame, 300 ms)
  await userEvent.click(screen.getByRole("button", { name: /sign out/i }));
  expect(await screen.findByRole("dialog", { name: /sign out/i })).toBeInTheDocument();
});

/* ── Beyond the brief: the hand-offs (hideNav, the first paint, the keyboard) and the rest of what the shell and More do ── */

afterEach(() => { act(() => __setNetState("online")); vi.useRealTimers(); vi.unstubAllGlobals(); });

/** Past the guards against the second tap of a double tap: the page's (300 ms) and a dialog's (350 ms). */
const afterADoubleTap = () => act(() => { vi.advanceTimersByTime(400); });
const wait = (ms: number) => act(() => new Promise<void>((r) => { setTimeout(r, ms); }));
const frame = () => document.getElementById("app-main")!.firstElementChild as HTMLElement;
const phone = (on: boolean) => { (window as unknown as { __phone?: boolean }).__phone = on; };

type Call = { method?: string; url?: string; body?: unknown };
/**
 * The server: this person's preferences (a PATCH merges into them and answers with the whole set) and no firms.
 * prefsFail: the preferences can't be reached; patchFail: a change can't be saved; hold: each preferences GET, or each PATCH, waits for release().
 */
function server({ prefs = {}, prefsFail = false, patchFail = false, hold }: { prefs?: Record<string, unknown>; prefsFail?: boolean; patchFail?: boolean; hold?: "get" | "patch" } = {}) {
  const calls: Call[] = [];
  const waiting: (() => void)[] = [];
  let stored = { ...prefs };
  api.defaults.adapter = ((config) => {
    const body = config.data ? JSON.parse(config.data as string) : undefined;
    calls.push({ method: config.method, url: config.url, body });
    const answer = (data: unknown) => ({ status: 200, statusText: "", headers: {}, config, data });
    const down = () => Promise.reject(new AxiosError("Network Error", "ERR_NETWORK", config));
    if (!config.url?.startsWith("preferences/")) return Promise.resolve(answer(config.url?.startsWith("businesses/") ? { results: [] } : {}));
    if (config.method === "patch") {
      if (patchFail) return down();
      const save = () => { stored = { ...stored, ...body }; return answer({ data: stored }); };
      if (hold === "patch") return new Promise((resolve) => { waiting.push(() => resolve(save())); });
      return Promise.resolve(save());
    }
    if (prefsFail) return down();
    if (hold === "get") return new Promise((resolve) => { waiting.push(() => resolve(answer({ data: stored }))); });
    return Promise.resolve(answer({ data: stored }));
  }) as AxiosAdapter;
  return { calls, pending: () => waiting.length, release: () => act(async () => { waiting.splice(0).forEach((go) => go()); }) };
}

/** A router inside the app's providers, signed in as `who`; queries don't retry, so a failure shows at once. */
function renderIn(router: DataRouter, who: AuthValue = stubAuth()) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AuthContext.Provider value={who}><ToastProvider><RouterProvider router={router} /></ToastProvider></AuthContext.Provider></QueryClientProvider>);
  return router;
}
const open = (path: string, who?: AuthValue) => renderIn(createMemoryRouter(appRoutes, { initialEntries: [path] }), who);

/** A visual viewport that shrinks when the keyboard opens, on an 844 px tall phone. */
function viewport() {
  const vv = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 });
  vi.stubGlobal("visualViewport", vv);
  vi.stubGlobal("innerHeight", 844);
  return { keyboard: (px: number, event = "resize") => act(() => { vv.height = 844 - px; vv.dispatchEvent(new Event(event)); }) };
}
function makeRoot() {
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  return root;
}

// Task 10/13 hand-off: the tabs make way on forms and print, and the action bar then clears the home indicator itself

test("a form hides the tabs, and its action bar clears the home indicator itself; other pages keep the tabs", async () => {
  server();
  const router = renderIn(createMemoryRouter([{ element: <AppLayout />, children: [
    { path: "/sales", element: <Page title="Bills" actionBar={<Button>New bill</Button>}>The list</Page> },
    { path: "/sales/new", handle: { hideNav: true }, element: <Page title="New bill" actionBar={<Button>Save</Button>}>The form</Page> },
  ] }], { initialEntries: ["/sales"] }));
  await screen.findByRole("heading", { level: 1, name: "Bills" });
  expect(screen.getByRole("navigation", { name: /tabs/i })).toBeInTheDocument();
  expect(document.querySelector("[data-actionbar]")).toHaveClass("pb-3");
  await act(async () => { await router.navigate("/sales/new"); });
  await screen.findByRole("heading", { level: 1, name: "New bill" });
  expect(screen.queryByRole("navigation", { name: /tabs/i })).not.toBeInTheDocument();
  expect(document.querySelector("[data-actionbar]")).toHaveClass("pb-[calc(12px+env(safe-area-inset-bottom,0px))]");
  expect(document.querySelector("[data-actionbar]")).not.toHaveClass("pb-3");
  cleanup();

  // and the app's own routes: a new bill hides them, the bills list keeps them
  open("/sales/new");
  await screen.findByRole("heading", { level: 1, name: "Bills" });
  expect(screen.queryByRole("navigation", { name: /tabs/i })).not.toBeInTheDocument();
  cleanup();
  open("/sales");
  expect(await screen.findByRole("navigation", { name: /tabs/i })).toBeInTheDocument();
});

test("each page lights its own tab: Easy's by its pages, Expert's by section, and a supplier's bill being captured under Capture", async () => {
  const tabs = {
    "/": "home", "/sales/7": "bills", "/scan": "bills", "/billing/invoice/kgh/2026-27/31": "bills", "/capture": "capture", "/purchases/capture": "capture",
    "/purchases/inbox": "capture", "/purchases/inbox/4": "capture", "/purchases/9": "more", "/suppliers": "more", "/customers/7/statement": "customers",
    "/gst": "more", "/products/5": "more", "/more": "more", "/e": "home", "/e/new/items": "home", "/e/gst": "home", "/e/bills": "bills", "/e/bill/5": "bills",
    "/e/saved/5": "bills", "/e/capture": "capture", "/e/customers/7/edit": "customers", "/e/more": "more", "/e/profile": "more",
  };
  expect(Object.fromEntries(Object.keys(tabs).map((p) => [p, tabOf(p)]))).toEqual(tabs);

  server();
  const router = open("/e/bill/5");
  const nav = await screen.findByRole("navigation", { name: /tabs/i });
  expect(within(nav).getByRole("link", { name: "Bills" })).toHaveAttribute("aria-current", "page");
  expect(within(nav).getAllByRole("link").filter((a) => a.hasAttribute("aria-current"))).toHaveLength(1);
  // a tab is a place, not a step: going to another tab takes this page's place in history, as the prototype's tabs do
  await userEvent.click(within(nav).getByRole("link", { name: "Customers" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/e/customers"));
  expect(router.state.historyAction).toBe("REPLACE");
});

test("on a desktop, Easy's addresses open the dashboard", async () => {
  phone(false);
  server();
  const router = open("/e/bills");
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  cleanup();
  const again = open("/e");
  await waitFor(() => expect(again.state.location.pathname).toBe("/"));
});

// Ruling 38: Easy or Expert from the first paint, and never Easy for an Expert person before their setting is known

test("an Expert person's phone isn't sent to Easy while their setting is on its way, nor after it arrives", async () => {
  const s = server({ prefs: { phoneMode: "expert" }, hold: "get" });
  const router = open("/");
  await screen.findByRole("heading", { level: 1, name: "Dashboard" });
  await waitFor(() => expect(s.pending()).toBe(1));
  await wait(50);
  expect(router.state.location.pathname).toBe("/");
  expect(screen.queryByRole("link", { name: /back to easy/i })).not.toBeInTheDocument(); // not known yet, so nothing offered
  await s.release();
  await wait(50);
  expect(router.state.location.pathname).toBe("/");
  expect(screen.queryByRole("link", { name: /back to easy/i })).not.toBeInTheDocument();
});

test("a phone kept on Easy opens on Easy at once, before the server answers, as the page the app opened on: no slide, nothing read out", async () => {
  localStorage.setItem("gst3.prefs.1", JSON.stringify({ phoneMode: "easy" }));
  const s = server({ prefs: { phoneMode: "easy" }, hold: "get" });
  const router = open("/");
  await waitFor(() => expect(router.state.location.pathname).toBe("/e"));
  expect(s.pending()).toBe(1); // the kept setting decided; the server hasn't answered
  const h1 = await screen.findByRole("heading", { level: 1, name: "Easy" });
  expect(frame()).toHaveClass("h-full", { exact: true });
  await wait(200);
  expect(h1).not.toHaveFocus();
  expect(document.getElementById("route-announcer")).toBeEmptyDOMElement();
});

test("an Easy person tapping Home on a full-view page goes to Easy's home, greeted like any move", async () => {
  server();
  const router = open("/customers");
  await screen.findByRole("link", { name: /back to easy/i }); // the setting is in: Easy
  await userEvent.click(within(screen.getByRole("navigation", { name: /tabs/i })).getByRole("link", { name: "Home" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/e"));
  const h1 = await screen.findByRole("heading", { level: 1, name: "Easy" });
  await waitFor(() => expect(h1).toHaveFocus());
  await waitFor(() => expect(document.getElementById("route-announcer")).toHaveTextContent("Easy"));
});

test("a setting that arrives late still opens the phone on Easy, as if the app had opened there", async () => {
  const s = server({ hold: "get" });
  const router = open("/");
  await screen.findByRole("heading", { level: 1, name: "Dashboard" });
  await s.release();
  await waitFor(() => expect(router.state.location.pathname).toBe("/e"));
  expect(router.state.historyAction).toBe("REPLACE"); // the stand-in home isn't left behind for Back
  const h1 = await screen.findByRole("heading", { level: 1, name: "Easy" });
  expect(frame()).toHaveClass("h-full", { exact: true });
  await wait(200);
  expect(h1).not.toHaveFocus();
  expect(document.getElementById("route-announcer")).toBeEmptyDOMElement();
});

test("when the setting can't be loaded, a phone opens on what today's app chose there, else on Easy", async () => {
  server({ prefsFail: true });
  const router = open("/");
  await waitFor(() => expect(router.state.location.pathname).toBe("/e"));
  cleanup();

  localStorage.setItem("mobile-mode", "expert");
  const s = server({ prefsFail: true });
  const again = open("/");
  await screen.findByRole("heading", { level: 1, name: "Dashboard" });
  await waitFor(() => expect(s.calls.some((c) => c.url === "preferences/")).toBe(true));
  await wait(50);
  expect(again.state.location.pathname).toBe("/");
});

test("on a phone, signing in goes on to Easy with focus on its title and its name read out, whether the setting was kept or not", async () => {
  const OWNER_ME = { id: 1, username: "kailash", full_name: "Kailash Mehta", role: "owner", role_label: "Owner", permissions: "*", needs_role_choice: false };
  for (const kept of [true, false]) {
    localStorage.clear();
    queryClient.clear();
    if (kept) localStorage.setItem("gst3.prefs.1", JSON.stringify({ phoneMode: "easy" }));
    server();
    const answer = api.defaults.adapter as AxiosAdapter;
    api.defaults.adapter = ((config) => (config.url === "token/" || config.url === "me/"
      ? Promise.resolve({ status: 200, statusText: "", headers: {}, config, data: config.url === "token/" ? { access: "a", refresh: "r" } : OWNER_ME })
      : answer(config))) as AxiosAdapter;
    const router = createMemoryRouter(appRoutes, { initialEntries: ["/login"] });
    render(<AppRoutes router={router} />);
    await userEvent.type(await screen.findByLabelText("Username"), "kailash");
    await userEvent.type(screen.getByLabelText("Password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/e"));
    const h1 = await screen.findByRole("heading", { level: 1, name: "Easy" });
    await waitFor(() => expect(h1, kept ? "kept" : "not kept").toHaveFocus());
    await waitFor(() => expect(document.getElementById("route-announcer")).toHaveTextContent("Easy"));
    cleanup();
  }
  queryClient.clear();
});

test("the greeting after signing in is spent once a page stays: a later redraw of the page, like the window crossing the phone width, is quiet", async () => {
  phone(false);
  // a matchMedia that tells the app when the width crosses the line, as a browser does
  const crossings = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width: 767px") && Boolean((window as unknown as { __phone?: boolean }).__phone), media: query, onchange: null,
    addEventListener: (_: string, cb: () => void) => crossings.add(cb), removeEventListener: (_: string, cb: () => void) => crossings.delete(cb),
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
  queryClient.clear();
  server({ prefs: { phoneMode: "expert" } });
  const answer = api.defaults.adapter as AxiosAdapter;
  api.defaults.adapter = ((config) => (config.url === "token/" || config.url === "me/"
    ? Promise.resolve({ status: 200, statusText: "", headers: {}, config, data: config.url === "token/" ? { access: "a", refresh: "r" } : { id: 1, username: "kailash", full_name: "Kailash Mehta", role: "owner", role_label: "Owner", permissions: "*", needs_role_choice: false } })
    : answer(config))) as AxiosAdapter;
  render(<AppRoutes router={createMemoryRouter(appRoutes, { initialEntries: ["/login?next=%2Fsales"] })} />);
  await userEvent.type(await screen.findByLabelText("Username"), "kailash");
  await userEvent.type(screen.getByLabelText("Password"), "pw");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  const announcer = () => document.getElementById("route-announcer")!;
  await waitFor(() => expect(announcer()).toHaveTextContent("Bills")); // greeted
  act(() => { announcer().textContent = ""; });
  act(() => { phone(true); crossings.forEach((cb) => cb()); }); // the phone shell takes over, and the page is drawn afresh in it
  await screen.findByRole("navigation", { name: /tabs/i });
  expect(frame()).toHaveClass("h-full", { exact: true });
  await wait(200);
  expect(announcer()).toBeEmptyDOMElement();
  queryClient.clear();
});

// More: the mode, the pages by role, text size, sign out

test("Switch to Expert keeps the choice for this person and opens the Expert home, and the phone stays there", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  const s = server();
  const router = open("/e/more");
  const button = await screen.findByRole("button", { name: /switch to expert/i });
  await waitFor(() => expect(s.calls.some((c) => c.url === "preferences/")).toBe(true));
  afterADoubleTap();
  await userEvent.click(button);
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  await screen.findByRole("heading", { level: 1, name: "Dashboard" });
  expect(s.calls).toContainEqual({ method: "patch", url: "preferences/", body: { phoneMode: "expert" } });
  const tabs = screen.getByRole("navigation", { name: /tabs/i });
  expect(within(tabs).getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
  expect(within(tabs).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  await wait(50);
  expect(router.state.location.pathname).toBe("/");
  expect(screen.queryByRole("link", { name: /back to easy/i })).not.toBeInTheDocument();
});

test("Switch to Easy keeps the choice and opens Easy's home", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  const s = server({ prefs: { phoneMode: "expert" } });
  const router = open("/more");
  const button = await screen.findByRole("button", { name: /switch to easy/i });
  afterADoubleTap();
  await userEvent.click(button);
  await waitFor(() => expect(router.state.location.pathname).toBe("/e"));
  await screen.findByRole("heading", { level: 1, name: "Easy" });
  expect(s.calls).toContainEqual({ method: "patch", url: "preferences/", body: { phoneMode: "easy" } });
  expect(within(screen.getByRole("navigation", { name: /tabs/i })).getByRole("link", { name: "More" })).toHaveAttribute("href", "/e/more");
  expect(screen.queryByRole("link", { name: /back to easy/i })).not.toBeInTheDocument(); // already there
});

test("a switch that can't be saved says so, and the phone stays where it was", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  server({ prefs: { phoneMode: "expert" }, patchFail: true });
  const router = open("/more");
  const button = await screen.findByRole("button", { name: /switch to easy/i });
  afterADoubleTap();
  await userEvent.click(button);
  expect(await screen.findByText("Not saved: the app couldn't get through")).toBeInTheDocument();
  expect(screen.getByText("Nothing was changed. Try again in a minute.")).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/more");
  expect(screen.getByRole("button", { name: /switch to easy/i })).not.toHaveAttribute("aria-busy");
});

test("offline, a switch says so at once and asks the server nothing", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  const s = server({ prefs: { phoneMode: "expert" } });
  const router = open("/more");
  const button = await screen.findByRole("button", { name: /switch to easy/i });
  act(() => __setNetState("offline"));
  afterADoubleTap();
  await userEvent.click(button);
  expect(await screen.findByText("You're offline, so this wasn't saved")).toBeInTheDocument();
  expect(screen.getByText("Switch again when the internet is back.")).toBeInTheDocument();
  expect(s.calls.filter((c) => c.method === "patch")).toEqual([]);
  expect(router.state.location.pathname).toBe("/more");
});

test("a switch answered after the person has left More doesn't pull them to a home", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  const s = server({ prefs: { phoneMode: "expert" }, hold: "patch" });
  const router = open("/more");
  const button = await screen.findByRole("button", { name: /switch to easy/i });
  afterADoubleTap();
  await userEvent.click(button);
  await waitFor(() => expect(s.pending()).toBe(1));
  expect(button).toHaveAttribute("aria-busy", "true");
  await act(async () => { await router.navigate("/customers"); });
  await s.release();
  await wait(50);
  expect(router.state.location.pathname).toBe("/customers");
});

test("More offers only the pages this person's role can open, and says who is signed in", async () => {
  server({ prefs: { phoneMode: "expert" } });
  /** Where the page's own links go (the tabs aside). */
  const offered = () => [...document.querySelectorAll("#app-main a")].map((a) => a.getAttribute("href"));
  const ADMIN = ["/users", "/backup", "/audit", "/settings"];
  const STAFF = ["view", "bill.create", "bill.send", "capture", "purchase.create", "purchase.import", "supplier.edit", "customer.edit", "rates.edit", "reports.export"] as const;
  open("/more", stubAuth({ role: "staff", roleLabel: "Counter staff", permissions: [...STAFF] }));
  await screen.findByText("Kailash Mehta · Counter staff");
  expect(offered()).toEqual(["/purchases", "/purchases/inbox", "/gst", "/reports", "/scan", "/products", "/suppliers", "/firms", "/profile"]);
  cleanup();

  open("/more", stubAuth({ role: "viewer", roleLabel: "View only", permissions: ["view", "reports.export"] }));
  await screen.findByText("Kailash Mehta · View only");
  expect(offered()).not.toContain("/purchases/inbox");
  expect(offered()).toContain("/products");
  cleanup();

  open("/more");
  await screen.findByText("Kailash Mehta · Owner");
  expect(offered()).toEqual(expect.arrayContaining(["/purchases/inbox", ...ADMIN]));
  expect(screen.getByRole("link", { name: /^Users and roles/ })).toHaveAttribute("href", "/users");
});

test("Text size on this phone lists each size with its hint, and a pick applies at once and stays on this phone", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  const root = makeRoot();
  try {
    server({ prefs: { phoneMode: "expert" } });
    open("/more");
    const row = await screen.findByRole("button", { name: "Text size Normal" });
    afterADoubleTap();
    await userEvent.click(row);
    const sheet = await screen.findByRole("dialog", { name: "Text size on this phone" });
    expect(within(sheet).getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["NormalAs designed", "LargeA tenth bigger", "LargerA fifth bigger"]);
    expect(within(sheet).getByRole("menuitem", { name: "Normal As designed" })).toHaveAttribute("aria-current", "true");
    afterADoubleTap();
    await userEvent.click(within(sheet).getByRole("menuitem", { name: "Large A tenth bigger" }));
    await waitFor(() => expect(root.style.zoom).toBe("1.1"));
    expect(localStorage.getItem("gst3.textSize")).toBe("1.1");
    expect(await screen.findByRole("button", { name: "Text size Large · a tenth bigger" })).toBeInTheDocument();
  } finally {
    applyTextSize(1);
    root.remove();
  }
});

test("Sign out asks first: Stay signed in keeps the session, Sign out ends it", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  server({ prefs: { phoneMode: "expert" } });
  const signOut = vi.fn();
  open("/more", { ...stubAuth(), signOut });
  const ask = async () => {
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    const dialog = await screen.findByRole("dialog", { name: "Sign out of this phone?" });
    afterADoubleTap();
    return dialog;
  };
  await screen.findByRole("button", { name: "Sign out" });
  afterADoubleTap();
  let dialog = await ask();
  expect(dialog).toHaveTextContent("You'll need your password to sign in again. Unfinished bills stay on this phone.");
  await userEvent.click(within(dialog).getByRole("button", { name: "Stay signed in" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(signOut).not.toHaveBeenCalled();

  dialog = await ask();
  await userEvent.click(within(dialog).getByRole("button", { name: "Sign out" }));
  expect(signOut).toHaveBeenCalledTimes(1);
});

// the shell's other duties: offline, and the keyboard

test("offline, the phone shell carries has-offline", async () => {
  server({ prefs: { phoneMode: "expert" } });
  open("/customers");
  const shell = (await screen.findByRole("navigation", { name: /tabs/i })).parentElement!;
  expect(shell).not.toHaveClass("has-offline");
  act(() => __setNetState("offline"));
  expect(shell).toHaveClass("has-offline");
  act(() => __setNetState("unreachable"));
  expect(shell).not.toHaveClass("has-offline");
});

// Task 6 hand-off and the keyboard inset

test("on a phone the keyboard's height is --kb on the app, in the app's own pixels, and the overlay layer follows it", async () => {
  const root = makeRoot();
  document.getElementById("overlay-root")?.remove(); // made again below, beside this #root
  try {
    const { keyboard } = viewport();
    function Probe() { useKeyboardInset(); return null; }
    render(<Probe />);
    expect(root.style.getPropertyValue("--kb")).toBe("0px");
    const layer = overlayLayer();
    keyboard(300);
    expect(root.style.getPropertyValue("--kb")).toBe("300px");
    await waitFor(() => expect(layer.style.getPropertyValue("--kb")).toBe("300px"));
    keyboard(44); // the browser's own bars moving, not a keyboard
    expect(root.style.getPropertyValue("--kb")).toBe("0px");
    root.style.zoom = "1.2"; // Larger text: each of the app's pixels is 1.2 of the screen's
    keyboard(300, "scroll");
    expect(root.style.getPropertyValue("--kb")).toBe("250px");
    keyboard(0);
    expect(root.style.getPropertyValue("--kb")).toBe("0px");
  } finally {
    root.remove();
    document.getElementById("overlay-root")?.remove();
  }
});

test("on a desktop the keyboard inset stays off", () => {
  phone(false);
  const root = makeRoot();
  try {
    const { keyboard } = viewport();
    function Probe() { useKeyboardInset(); return null; }
    render(<Probe />);
    keyboard(300);
    expect(root.style.getPropertyValue("--kb")).toBe("");
  } finally {
    root.remove();
  }
});

test("every page follows the keyboard, the sign-in page too, and the browser is asked not to shrink the page for it", async () => {
  const root = makeRoot();
  try {
    const { keyboard } = viewport();
    server();
    open("/login", stubAuth(null));
    await screen.findByLabelText("Username");
    keyboard(320);
    expect(root.style.getPropertyValue("--kb")).toBe("320px");
  } finally {
    root.remove();
  }
  // a browser that resized the page for the keyboard could make a wide touch screen a phone mid-typing (Task 6)
  const html = readFileSync(resolve(__dirname, "../../../index.html"), "utf8");
  expect(html).toMatch(/<meta name="viewport" content="[^"]*\binteractive-widget=resizes-visual\b/);
});
