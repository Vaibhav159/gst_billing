import { useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { createMemoryRouter, MemoryRouter, RouterProvider, useLocation } from "react-router";
import { renderApp, stubAuth } from "@/test/render";
import { api, getTokens, setTokens } from "@/core/api/client";
import type { AxiosAdapter } from "axios";
import { AuthContext } from "@/core/auth/AuthProvider";
import { fyOf, todayIST } from "@/core/format";
import { appRoutes } from "@/core/router/routes";
import { ToastProvider } from "@/core/ui";
import { DesktopShell } from "./DesktopShell";
import { FirmPicker } from "./ScopePickers";
import { ScopeProvider, useScope, type FirmId } from "@/core/scope";
import { AppRoutes } from "@/App";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  api.defaults.adapter = ((config) => Promise.resolve({ status: 200, statusText: "", headers: {}, config,
    data: config.url?.startsWith("businesses/") ? { results: [{ id: 3, name: "KIRAN GOLD HOUSE (SANDBOX)", gst_number: "08AAAAA0000A1Z5", state_name: "RAJASTHAN" }, { id: 4, name: "MEERA ORNAMENTS (SANDBOX)", gst_number: "08BBBBB0000B1Z5", state_name: "RAJASTHAN" }] }
      : config.url?.startsWith("preferences/") ? { data: { defaultBusinessId: "3" } } : {} })) as AxiosAdapter;
});

const shell = (role: "owner" | "staff" = "owner") => renderApp(<ScopeProvider><DesktopShell openPalette={() => {}}><p>page</p></DesktopShell></ScopeProvider>, { path: "/sales", me: role === "staff" ? { role: "staff", permissions: ["view", "bill.create"] } : undefined });

test("the nav marks the current section and folds admin pages into More", async () => {
  shell();
  const nav = screen.getByRole("navigation", { name: /main/i });
  expect(within(nav).getByRole("link", { name: "Sales" })).toHaveAttribute("aria-current", "page");
  await userEvent.click(within(nav).getByRole("button", { name: /more/i }));
  expect(await screen.findByRole("menuitem", { name: "Users and roles" })).toBeInTheDocument();
});

test("staff don't see the owner's pages in More", async () => {
  shell("staff");
  await userEvent.click(within(screen.getByRole("navigation", { name: /main/i })).getByRole("button", { name: /more/i }));
  expect(await screen.findByRole("menuitem", { name: "Products" })).toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "Users and roles" })).not.toBeInTheDocument();
});

test("the firm picker starts on the person's usual firm", async () => {
  shell();
  await waitFor(() => expect(screen.getByRole("button", { name: /firm/i })).toHaveTextContent("Kiran"));
});

test("the account menu switches theme and says who is signed in", async () => {
  shell();
  await userEvent.click(screen.getByRole("button", { name: /account/i }));
  expect(await screen.findByText(/Kailash Mehta/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("menuitem", { name: "Pearl" }));
  expect(document.documentElement.classList.contains("theme-pearl")).toBe(true);
});

test("Ctrl K opens search", async () => {
  const open = vi.fn();
  renderApp(<ScopeProvider><DesktopShell openPalette={open}><p>page</p></DesktopShell></ScopeProvider>, { path: "/sales" });
  await userEvent.keyboard("{Control>}k{/Control}");
  expect(open).toHaveBeenCalled();
});

/* ── Beyond the brief ── */

/** jsdom has no layout: give the main nav a width and each of its items a width (100 px unless `widthOf` says) and a place. */
function layout(navWidth: number, widthOf: (item: HTMLElement) => number = () => 100) {
  const order = ["dashboard", "sales", "purchases", "customers", "gst", "reports"];
  const spies = [
    vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) { return this.getAttribute("aria-label") === "Main" ? navWidth : 0; }),
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) { return this.dataset.nav ? widthOf(this) : 0; }),
    vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) { return this.dataset.nav ? 102 * Math.max(0, order.indexOf(this.dataset.nav)) : 0; }),
  ];
  return () => spies.forEach((s) => s.mockRestore());
}
/** The words on each open menu row, without its hint. */
const menuLabels = () => screen.getAllByRole("menuitem").map((i) => i.querySelector("span span")?.textContent);
const thisFy = fyOf(todayIST());
const startYear = Number(thisFy.slice(0, 4));
const lastFy = fyOf(`${startYear - 1}-04-01`);
const fyBefore = fyOf(`${startYear - 2}-04-01`);
/** Past the dialogs' guard against the second tap of a double tap (350 ms). */
const afterADoubleTap = () => act(() => { vi.advanceTimersByTime(400); });

test("a narrow window folds the last sections into More, and a folded current section shows there", async () => {
  // 370 px of room beside More: Dashboard, Sales and Purchases fit
  const restore = layout(500);
  try {
    // on Sales, which still fits, Sales is marked and More isn't
    const view = shell();
    let nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Dashboard", "Sales", "Purchases"]);
    expect(within(nav).getByRole("link", { name: "Sales" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("button", { name: /more/i })).not.toHaveAttribute("aria-current");
    view.unmount();

    // on Reports, folded away, More is marked and names it
    renderApp(<ScopeProvider><DesktopShell openPalette={() => {}}><p>page</p></DesktopShell></ScopeProvider>, { path: "/reports" });
    nav = screen.getByRole("navigation", { name: "Main" });
    const more = within(nav).getByRole("button", { name: /^More · Reports/ });
    expect(more).toHaveAttribute("aria-current", "page");
    await userEvent.click(more);
    await screen.findAllByRole("menuitem");
    expect(menuLabels()).toEqual(["Customers", "GST", "Reports", "Products", "Firms", "Users and roles", "Backup and restore", "Audit log", "Settings"]);
    expect(screen.getByRole("menuitem", { name: "Reports" })).toHaveAttribute("aria-current", "true");
  } finally {
    restore();
  }
});

test("after moving to another section, a resize keeps the underline under the new one", async () => {
  const resize: (() => void)[] = [];
  vi.stubGlobal("ResizeObserver", class {
    constructor(private cb: ResizeObserverCallback) {}
    observe() { resize.push(() => this.cb([{ contentRect: { width: 1300 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)); }
    unobserve() {}
    disconnect() {}
  });
  const restore = layout(1000);
  try {
    shell();
    const nav = screen.getByRole("navigation", { name: "Main" });
    const bar = () => nav.querySelector<HTMLElement>("span.absolute");
    expect(bar()).toHaveStyle({ transform: "translateX(102px)", width: "100px" });
    await userEvent.click(within(nav).getByRole("link", { name: "Customers" }));
    await waitFor(() => expect(bar()).toHaveStyle({ transform: "translateX(306px)" }));
    act(() => resize.forEach((r) => r()));
    expect(bar()).toHaveStyle({ transform: "translateX(306px)" });
  } finally {
    restore();
    vi.unstubAllGlobals();
  }
});

test("the firm menu lists All firms, then each firm by its short name; a pick is remembered for that person", async () => {
  shell();
  await userEvent.click(await screen.findByRole("button", { name: "Firm: Kiran" }));
  await screen.findAllByRole("menuitem");
  expect(menuLabels()).toEqual(["All firms", "Kiran", "Meera"]);
  const [all, kiran] = screen.getAllByRole("menuitem");
  expect(all).toHaveTextContent("Kiran and Meera together");
  expect(kiran).toHaveTextContent("08AAAAA0000A1Z5");
  expect(kiran).toHaveAttribute("aria-current", "true");
  await userEvent.click(screen.getByRole("menuitem", { name: /^Meera/ }));
  expect(await screen.findByRole("button", { name: "Firm: Meera" })).toBeInTheDocument();
  expect(localStorage.getItem("gst3.scope.1")).toBe("4");
});

test("a person's remembered firm wins over the usual one; someone else's doesn't; a firm that's gone falls back", async () => {
  localStorage.setItem("gst3.scope.1", "4");
  let view = shell();
  expect(await screen.findByRole("button", { name: "Firm: Meera" })).toBeInTheDocument();
  view.unmount();

  localStorage.setItem("gst3.scope.1", "all");
  view = shell();
  // the usual firm loads too, and must not take over a remembered "All firms"
  await waitFor(() => expect(screen.getByRole("button", { name: "Firm: All firms" })).toBeInTheDocument());
  await act(() => new Promise((r) => setTimeout(r, 30)));
  expect(screen.getByRole("button", { name: "Firm: All firms" })).toBeInTheDocument();
  view.unmount();

  localStorage.clear();
  localStorage.setItem("gst3.scope.2", "4");
  view = shell();
  expect(await screen.findByRole("button", { name: "Firm: Kiran" })).toBeInTheDocument();
  view.unmount();

  localStorage.setItem("gst3.scope.1", "99");
  shell();
  expect(await screen.findByRole("button", { name: "Firm: Kiran" })).toBeInTheDocument();
});

test("the year starts from today's app's pick and offers this year and the two before", async () => {
  localStorage.setItem("gst_selected_fy", lastFy);
  shell();
  await userEvent.click(screen.getByRole("button", { name: `Financial year ${lastFy}, not the current year` }));
  await screen.findAllByRole("menuitem");
  expect(menuLabels()).toEqual([`FY ${thisFy} · this year`, `FY ${lastFy}`, `FY ${fyBefore}`]);
  const [, last] = screen.getAllByRole("menuitem");
  expect(last).toHaveAttribute("aria-current", "true");
  expect(last).toHaveTextContent(`1 Apr ${startYear - 1} to 31 Mar ${startYear}`);
});

test("this device's year wins over today's app's; a year the picker doesn't offer is ignored", async () => {
  localStorage.setItem("gst3.fy", fyBefore);
  localStorage.setItem("gst_selected_fy", lastFy);
  let view = shell();
  expect(screen.getByRole("button", { name: `Financial year ${fyBefore}, not the current year` })).toBeInTheDocument();
  view.unmount();
  localStorage.setItem("gst3.fy", "2019-20");
  view = shell();
  expect(screen.getByRole("button", { name: `Financial year ${lastFy}, not the current year` })).toBeInTheDocument();
  view.unmount();
  localStorage.setItem("gst_selected_fy", "next year");
  view = shell();
  expect(screen.getByRole("button", { name: `Financial year ${thisFy}` })).toBeInTheDocument();
});

test("picking last year says what follows the pick, and the pick stays on this device", async () => {
  shell();
  await userEvent.click(screen.getByRole("button", { name: `Financial year ${thisFy}` }));
  await userEvent.click(await screen.findByRole("menuitem", { name: new RegExp(`^FY ${lastFy}`) }));
  expect(await screen.findByText(`Showing FY ${lastFy}`)).toBeInTheDocument();
  expect(screen.getByText(/Lists, figures and returns follow the year you pick/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: `Financial year ${lastFy}, not the current year` })).toBeInTheDocument();
  expect(localStorage.getItem("gst3.fy")).toBe(lastFy);
});

function Where() { return <p data-testid="where">{useLocation().pathname}</p>; }

test("Alt N starts a sales bill for someone who makes bills; Alt P tells someone who can't add purchases why", async () => {
  const view = renderApp(<ScopeProvider><DesktopShell openPalette={() => {}}><Where /></DesktopShell></ScopeProvider>, { path: "/sales" });
  await userEvent.keyboard("{Alt>}n{/Alt}");
  expect(screen.getByTestId("where")).toHaveTextContent("/sales/new");
  view.unmount();

  renderApp(<ScopeProvider><DesktopShell openPalette={() => {}}><Where /></DesktopShell></ScopeProvider>, { path: "/sales", me: { role: "viewer", permissions: ["view", "reports.export"] } });
  await userEvent.keyboard("{Alt>}p{/Alt}");
  expect(await screen.findByText("You can't add purchases")).toBeInTheDocument();
  expect(screen.getByText("Only the owner, the accountant and counter staff can add purchases. Ask the owner if you need it.")).toBeInTheDocument();
  expect(screen.getByTestId("where")).toHaveTextContent(/^\/sales$/);
});

test("? lists the shortcuts, except while typing in a field, where Ctrl K still opens search", async () => {
  const open = vi.fn();
  renderApp(<ScopeProvider><DesktopShell openPalette={open}><input aria-label="Note" /></DesktopShell></ScopeProvider>, { path: "/sales" });
  const note = screen.getByRole("textbox", { name: "Note" });
  await userEvent.click(note);
  await userEvent.keyboard("?");
  expect(note).toHaveValue("?");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await userEvent.keyboard("{Control>}k{/Control}");
  expect(open).toHaveBeenCalledTimes(1);

  act(() => note.blur());
  await userEvent.keyboard("?");
  const dialog = await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
  expect(dialog).toHaveTextContent("Search customers, bills and pages");
  expect(dialog).toHaveTextContent("Show these shortcuts");
});

test("/ jumps to the page's own search box", async () => {
  renderApp(<ScopeProvider><DesktopShell openPalette={() => {}}><input data-page-search aria-label="Search sales bills" /></DesktopShell></ScopeProvider>, { path: "/sales" });
  await userEvent.keyboard("/");
  const box = screen.getByRole("textbox", { name: "Search sales bills" });
  expect(box).toHaveFocus();
  expect(box).toHaveValue("");
});

test("the account menu offers Settings only to someone who can change them, and opens the shortcuts", async () => {
  let view = shell("staff");
  await userEvent.click(screen.getByRole("button", { name: /account/i }));
  expect(await screen.findByRole("menuitem", { name: "Profile and password" })).toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "Settings" })).not.toBeInTheDocument();
  view.unmount();

  view = shell();
  await userEvent.click(screen.getByRole("button", { name: /account/i }));
  expect(await screen.findByText("Kailash Mehta · Owner")).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Settings" })).toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Larger A fifth bigger" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("menuitem", { name: "Keyboard shortcuts" }));
  expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
});

test("Sign out asks first; Stay signed in keeps the session, Sign out ends it", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  try {
    const signOut = vi.fn();
    // renderApp's sign-in stub can't be watched: the same providers, with a sign-out to check
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AuthContext.Provider value={{ ...stubAuth(), signOut }}>
          <MemoryRouter initialEntries={["/sales"]}><ToastProvider>
            <ScopeProvider><DesktopShell openPalette={() => {}}><p>page</p></DesktopShell></ScopeProvider>
          </ToastProvider></MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );
    const ask = async () => {
      await userEvent.click(screen.getByRole("button", { name: /account/i }));
      await userEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
      const dialog = await screen.findByRole("dialog", { name: "Sign out?" });
      afterADoubleTap();
      return dialog;
    };
    let dialog = await ask();
    expect(dialog).toHaveTextContent("You'll need your password to sign in again.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Stay signed in" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(signOut).not.toHaveBeenCalled();

    dialog = await ask();
    await userEvent.click(within(dialog).getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

/** A SimpleJWT-shaped access token naming `userId`. */
const jwt = (userId: number) => ["e30", btoa(JSON.stringify({ token_type: "access", user_id: userId })).replace(/=+$/, ""), "sig"].join(".");

test("through the real sign-in state, Sign out ends the session and the app goes to the sign-in page", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  try {
    const owner = { id: 1, username: "kailash", full_name: "Kailash Mehta", role: "owner", role_label: "Owner", permissions: "*", needs_role_choice: false };
    const answer = api.defaults.adapter as AxiosAdapter;
    api.defaults.adapter = ((config) => (config.url?.startsWith("me/") ? Promise.resolve({ status: 200, statusText: "", headers: {}, config, data: owner }) : answer(config))) as AxiosAdapter;
    setTokens(jwt(1), "r1");
    const router = createMemoryRouter(appRoutes, { initialEntries: ["/sales"] });
    render(<AppRoutes router={router} />);
    await userEvent.click(await screen.findByRole("button", { name: "Account: Kailash Mehta" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
    const dialog = await screen.findByRole("dialog", { name: "Sign out?" });
    afterADoubleTap();
    await userEvent.click(within(dialog).getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(getTokens().access).toBeNull();
    // Ruling 35: a plain sign-in page, so whoever signs in next on this computer doesn't land on this person's page
    expect(router.state.location.search).toBe("");
  } finally {
    vi.useRealTimers();
  }
});

test("a shop with no firm yet shows only how to start; a firm list that fails to load keeps the whole header", async () => {
  api.defaults.adapter = ((config) => Promise.resolve({ status: 200, statusText: "", headers: {}, config,
    data: config.url?.startsWith("businesses/") ? { results: [] } : { data: {} } })) as AxiosAdapter;
  const view = shell();
  expect(await screen.findByText("Setting up the shop")).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /firm|search|financial year/i })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /account/i })).toBeInTheDocument();
  view.unmount();

  let failed = false;
  api.defaults.adapter = ((config) => {
    if (!config.url?.startsWith("businesses/")) return Promise.resolve({ status: 200, statusText: "", headers: {}, config, data: { data: {} } });
    failed = true;
    return Promise.reject(new AxiosError("Network Error", "ERR_NETWORK", config));
  }) as AxiosAdapter;
  shell();
  await waitFor(() => expect(failed).toBe(true));
  await act(() => new Promise((r) => setTimeout(r, 30)));
  expect(screen.queryByText("Setting up the shop")).not.toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
});

/** A page that shows its own firm picker once asked: a second user of the firm list, arriving after it loaded. */
function LaterPicker() {
  const [on, setOn] = useState(false);
  return on ? <FirmPicker /> : <button type="button" onClick={() => setOn(true)}>Show another picker</button>;
}

test("the firm list is asked for once, with room for every firm, however often the shell redraws or new pages use it", async () => {
  const asked: string[] = [];
  const answer = api.defaults.adapter as AxiosAdapter;
  api.defaults.adapter = ((config) => { asked.push(api.getUri(config)); return answer(config); }) as AxiosAdapter;
  renderApp(<ScopeProvider><DesktopShell openPalette={() => {}}><LaterPicker /></DesktopShell></ScopeProvider>, { path: "/sales" });
  await userEvent.click(await screen.findByRole("button", { name: "Firm: Kiran" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: /^Meera/ }));
  await screen.findByRole("button", { name: "Firm: Meera" });
  await userEvent.click(screen.getByRole("button", { name: "Show another picker" }));
  expect(await screen.findAllByRole("button", { name: "Firm: Meera" })).toHaveLength(2);
  await act(() => new Promise((r) => setTimeout(r, 30)));
  expect(asked.filter((u) => u.includes("businesses/"))).toEqual(["/api/businesses/?page_size=100"]);
});

test("a firm list the server doesn't page is read the same way", async () => {
  const paged = api.defaults.adapter as AxiosAdapter;
  api.defaults.adapter = ((config) => paged(config).then((r) => (config.url?.startsWith("businesses/") ? { ...r, data: r.data.results } : r))) as AxiosAdapter;
  shell();
  expect(await screen.findByRole("button", { name: "Firm: Kiran" })).toBeInTheDocument();
});

test("pages inside a section mark it: a supplier is in Purchases, the QR scanner in Sales, a product under More", () => {
  const at = (path: string) => renderApp(<ScopeProvider><DesktopShell openPalette={() => {}}><p>page</p></DesktopShell></ScopeProvider>, { path });
  let view = at("/suppliers/5");
  expect(screen.getByRole("link", { name: "Purchases" })).toHaveAttribute("aria-current", "page");
  view.unmount();
  view = at("/scan");
  expect(screen.getByRole("link", { name: "Sales" })).toHaveAttribute("aria-current", "page");
  view.unmount();
  at("/products/7/edit");
  expect(screen.getByRole("button", { name: /^More · Products/ })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("navigation", { name: "Main" }).querySelector('[aria-current="page"]')).toHaveAttribute("data-nav", "more");
});

test("under 1220 px the search button keeps only its icon and the app's name is left to screen readers", () => {
  const resize: ((width: number) => void)[] = [];
  vi.stubGlobal("ResizeObserver", class {
    constructor(private cb: ResizeObserverCallback) {}
    observe() { resize.push((width) => this.cb([{ contentRect: { width } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver)); }
    unobserve() {}
    disconnect() {}
  });
  try {
    shell();
    const search = screen.getByRole("button", { name: "Search (Ctrl K)" });
    const name = screen.getByText("GST Billing").parentElement!;
    act(() => resize.forEach((r) => r(1300)));
    expect(search).toHaveTextContent("Search");
    expect(name).not.toHaveClass("sr-only");
    act(() => resize.forEach((r) => r(1219)));
    expect(search).toHaveTextContent("");
    expect(name).toHaveClass("sr-only");
    expect(search).toHaveAttribute("aria-keyshortcuts", "Control+K");
  } finally {
    vi.unstubAllGlobals();
  }
});

test("a text size picked in the account menu is marked there and stays on this device", async () => {
  shell();
  await userEvent.click(screen.getByRole("button", { name: /account/i }));
  expect(await screen.findByRole("menuitem", { name: "Normal" })).toHaveAttribute("aria-current", "true");
  await userEvent.click(screen.getByRole("menuitem", { name: "Larger A fifth bigger" }));
  expect(localStorage.getItem("gst3.textSize")).toBe("1.2");
  await userEvent.click(screen.getByRole("button", { name: /account/i }));
  expect(await screen.findByRole("menuitem", { name: "Larger A fifth bigger" })).toHaveAttribute("aria-current", "true");
  expect(screen.getByRole("menuitem", { name: "Normal" })).not.toHaveAttribute("aria-current");
});

/* ── Wiring: AppLayout ── */

function mountApp(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AuthContext.Provider value={stubAuth()}><ToastProvider><RouterProvider router={router} /></ToastProvider></AuthContext.Provider></QueryClientProvider>);
  return router;
}
const phone = (on: boolean) => { (window as unknown as { __phone?: boolean }).__phone = on; };

test("on a desktop every signed-in page has the shell, and Skip to main content moves focus to the page", async () => {
  mountApp("/customers");
  const nav = await screen.findByRole("navigation", { name: "Main" });
  expect(within(nav).getByRole("link", { name: "Customers" })).toHaveAttribute("aria-current", "page");
  expect(await screen.findByRole("button", { name: "Firm: Kiran" })).toBeInTheDocument();
  expect(await screen.findByRole("heading", { level: 1, name: "Customers" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("link", { name: "Skip to main content" }));
  expect(document.getElementById("app-main")).toHaveFocus();
});

test("a phone doesn't get the desktop shell", async () => {
  phone(true);
  try {
    mountApp("/customers");
    await screen.findByRole("heading", { level: 1, name: "Customers" });
    expect(screen.queryByRole("navigation", { name: "Main" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Skip to main content" })).not.toBeInTheDocument();
  } finally {
    phone(false);
  }
});

/* ── The integration fix: Ruling 38 and the review's Minors ── */

/** The server answers the preferences only when told to; the firm list and the rest as before. */
function slowPrefs() {
  const waiting: (() => void)[] = [];
  const answer = api.defaults.adapter as AxiosAdapter;
  api.defaults.adapter = ((config) => (config.url?.startsWith("preferences/")
    ? new Promise((resolve, reject) => { waiting.push(() => { answer(config).then(resolve, reject); }); })
    : answer(config))) as AxiosAdapter;
  return { asked: () => waiting.length, answer: () => act(async () => { waiting.splice(0).forEach((go) => go()); }) };
}
/** The firm each render of the scope settled on, in order. */
const seen: FirmId[] = [];
function Seen() { seen.push(useScope().firmId); return null; }
const scoped = () => renderApp(<ScopeProvider><Seen /><FirmPicker /></ScopeProvider>, { path: "/sales" });

test("the next load shows the usual firm from its first paint, before the server answers, and never All firms (Ruling 38)", async () => {
  const server = slowPrefs();
  // the first load on this device: nothing kept yet, so the picker waits for this person's preferences
  let view = scoped();
  expect(screen.getByRole("button", { name: "Firm: loading" })).toBeInTheDocument();
  await waitFor(() => expect(server.asked()).toBe(1));
  await server.answer();
  expect(await screen.findByRole("button", { name: "Firm: Kiran" })).toBeInTheDocument();
  view.unmount();

  // the next load: a fresh query cache, the same storage, and the server slow to answer
  seen.length = 0;
  view = scoped();
  expect(seen[0]).toBe(3);
  expect(await screen.findByRole("button", { name: "Firm: Kiran" })).toBeInTheDocument(); // the firm list is in; the preferences aren't yet
  await waitFor(() => expect(server.asked()).toBe(1));
  await server.answer();
  await act(() => new Promise((r) => setTimeout(r, 30)));
  expect(screen.getByRole("button", { name: "Firm: Kiran" })).toBeInTheDocument();
  expect(seen).not.toContain("all");
});

test("someone else's kept preferences never choose this person's firm", async () => {
  // Rakesh used this computer first: his usual firm is Meera, and his preferences are kept here
  let usual = "4";
  const answer = api.defaults.adapter as AxiosAdapter;
  api.defaults.adapter = ((config) => (config.url?.startsWith("preferences/")
    ? Promise.resolve({ status: 200, statusText: "", headers: {}, config, data: { data: { defaultBusinessId: usual } } })
    : answer(config))) as AxiosAdapter;
  const rakesh = renderApp(<ScopeProvider><FirmPicker /></ScopeProvider>, { path: "/sales", me: { id: 2, username: "rakesh", fullName: "Rakesh Soni", role: "staff", roleLabel: "Counter staff", permissions: ["view", "bill.create"] } });
  expect(await screen.findByRole("button", { name: "Firm: Meera" })).toBeInTheDocument();
  rakesh.unmount();
  // then Kailash, whose usual firm is Kiran, and whose server is slow to answer
  usual = "3";
  const server = slowPrefs();
  seen.length = 0;
  scoped();
  expect(screen.getByRole("button", { name: "Firm: loading" })).toBeInTheDocument();
  await waitFor(() => expect(server.asked()).toBe(1));
  await server.answer();
  expect(await screen.findByRole("button", { name: "Firm: Kiran" })).toBeInTheDocument();
  expect(seen).not.toContain(4);
});

test("until the firm list is in, the firm button's name says it's loading", async () => {
  localStorage.setItem("gst3.scope.1", "4");
  let release: (() => void) | undefined;
  const answer = api.defaults.adapter as AxiosAdapter;
  api.defaults.adapter = ((config) => (config.url?.startsWith("businesses/")
    ? new Promise((resolve, reject) => { release = () => { answer(config).then(resolve, reject); }; })
    : answer(config))) as AxiosAdapter;
  shell();
  expect(screen.getByRole("button", { name: "Firm: loading" })).toBeInTheDocument();
  await waitFor(() => expect(release).toBeDefined());
  await act(async () => release!());
  expect(await screen.findByRole("button", { name: "Firm: Meera" })).toBeInTheDocument();
});

test("another tab's pick doesn't take this tab over: this person's pick is read once", async () => {
  shell();
  expect(await screen.findByRole("button", { name: "Firm: Kiran" })).toBeInTheDocument();
  localStorage.setItem("gst3.scope.1", "4"); // the same person picks Meera on another tab
  // this tab draws again: a year picked here
  await userEvent.click(screen.getByRole("button", { name: `Financial year ${thisFy}` }));
  await userEvent.click(await screen.findByRole("menuitem", { name: new RegExp(`^FY ${lastFy}`) }));
  expect(await screen.findByRole("button", { name: `Financial year ${lastFy}, not the current year` })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Firm: Kiran" })).toBeInTheDocument();
});

test("moving between two pages under More, the underline takes More's new width", async () => {
  // More's width follows its words: "More · Products" is wider than "More · Firms"
  const restore = layout(1000, (el) => (el.dataset.nav === "more" ? 60 + (el.textContent ?? "").length * 5 : 100));
  try {
    renderApp(<ScopeProvider><DesktopShell openPalette={() => {}}><p>page</p></DesktopShell></ScopeProvider>, { path: "/products" });
    const nav = screen.getByRole("navigation", { name: "Main" });
    const bar = () => nav.querySelector<HTMLElement>("span.absolute");
    const more = () => within(nav).getByRole("button", { name: /^More · / });
    const before = more().offsetWidth;
    expect(bar()).toHaveStyle({ width: `${before}px` });
    await userEvent.click(more());
    await userEvent.click(await screen.findByRole("menuitem", { name: "Firms" }));
    await waitFor(() => expect(more()).toHaveTextContent(/^More · Firms/));
    expect(more().offsetWidth).toBeLessThan(before);
    await waitFor(() => expect(bar()).toHaveStyle({ width: `${more().offsetWidth}px` }));
  } finally {
    restore();
  }
});

test("with a menu or a dialog open, shortcuts wait, except Ctrl K", async () => {
  const open = vi.fn();
  renderApp(<ScopeProvider><DesktopShell openPalette={open}><Where /></DesktopShell></ScopeProvider>, { path: "/sales" });
  await userEvent.click(screen.getByRole("button", { name: /account/i }));
  await screen.findByRole("menu");
  await userEvent.keyboard("?");
  await userEvent.keyboard("{Alt>}n{/Alt}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByTestId("where")).toHaveTextContent(/^\/sales$/);
  await userEvent.keyboard("{Control>}k{/Control}");
  expect(open).toHaveBeenCalledTimes(1);

  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  await userEvent.keyboard("?"); // nothing open now
  expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  await userEvent.keyboard("{Alt>}n{/Alt}");
  expect(screen.getByTestId("where")).toHaveTextContent(/^\/sales$/);
});
