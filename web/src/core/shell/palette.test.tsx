import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AxiosAdapter } from "axios";
import { Routes, Route } from "react-router";
import { api } from "@/core/api/client";
import { renderApp } from "@/test/render";
import { Palette } from "./Palette";
import { noteVisit } from "./recent";
// for the tests after the brief's four
import { act, render, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { MoreHorizontal, Sun } from "lucide-react";
import { createMemoryRouter, RouterProvider, type DataRouter } from "react-router";
import { __setNetState } from "@/core/api/network";
import { AuthContext } from "@/core/auth/AuthProvider";
import { IconButton, Page, ToastProvider } from "@/core/ui";
import { stubAuth } from "@/test/render";
import { AppLayout } from "./AppLayout";
import { recentVisits } from "./recent";

const calls: string[] = [];
beforeEach(() => {
  localStorage.clear(); calls.length = 0;
  api.defaults.adapter = ((config) => {
    calls.push(String(config.url) + "?" + new URLSearchParams(config.params).toString());
    const data = config.url?.startsWith("customers/") ? { results: [{ id: 7, name: "Meena Jain", mobile_number: "9414126508", gst_number: "" }] }
      : config.url?.startsWith("invoices/") ? { results: [{ id: 32, invoice_number: "KGH/2026-27/32", customer_name: "Meena Jain", invoice_date: "2026-10-08", total_amount: "38412.50" }] }
      : { results: [] };
    return Promise.resolve({ status: 200, statusText: "", headers: {}, config, data });
  }) as AxiosAdapter;
});

const mount = (role: "owner" | "viewer" = "owner") => renderApp(
  <Routes><Route path="*" element={<Palette open onClose={() => {}} />} /><Route path="/customers/7" element={<p>customer 7</p>} /></Routes>,
  { path: "/", me: role === "viewer" ? { role: "viewer", permissions: ["view", "reports.export"] } : undefined });

test("empty, it offers recent records, actions the role allows, and pages", async () => {
  noteVisit(1, { to: "/sales/32", label: "KGH/2026-27/32" });
  mount();
  expect(screen.getByRole("combobox")).toHaveFocus();
  expect(screen.getByRole("option", { name: /KGH\/2026-27\/32/ })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /New sales bill/ })).toBeInTheDocument();
});

test("a view-only person isn't offered actions they can't do", () => {
  mount("viewer");
  expect(screen.queryByRole("option", { name: /New sales bill/ })).not.toBeInTheDocument();
});

test("typing searches customers and bills once, after a pause, and Enter opens the first", async () => {
  mount();
  await userEvent.type(screen.getByRole("combobox"), "meena");
  // anchored: the bill's row names its customer too ("Meena Jain · 08 Oct 2026 · ₹38,412.50")
  expect(await screen.findByRole("option", { name: /^Meena Jain/ })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /KGH\/2026-27\/32 .*₹38,412\.50/ })).toBeInTheDocument();
  expect(calls.filter((c) => c.startsWith("customers/")).length).toBe(1);
  expect(calls.some((c) => c.startsWith("invoices/") && c.includes("type_of_invoice=outward"))).toBe(true);
  await userEvent.keyboard("{Enter}");
  await waitFor(() => expect(screen.getByText("customer 7")).toBeInTheDocument());
});

test("arrow keys move the highlight and the input says which option is active", async () => {
  mount();
  const input = screen.getByRole("combobox");
  await userEvent.keyboard("{ArrowDown}");
  const active = input.getAttribute("aria-activedescendant");
  expect(active).toBeTruthy();
  expect(document.getElementById(active!)).toHaveAttribute("aria-selected", "true");
  expect(document.getElementById(active!)!.className).toContain("row-on");
});

/* ── Beyond the brief: what the server search does, how the rows read, Opened recently, and the shells' ways in ── */

afterEach(() => { act(() => __setNetState("online")); vi.restoreAllMocks(); vi.useRealTimers(); (window as unknown as { __phone?: boolean }).__phone = false; });

const wait = (ms: number) => act(() => new Promise<void>((r) => { setTimeout(r, ms); }));
const answer = (config: Parameters<AxiosAdapter>[0], data: unknown) => Promise.resolve({ status: 200, statusText: "", headers: {}, config, data });
type Held = { url: string; params: Record<string, unknown>; signal?: AbortSignal };
/** A server that never answers: each request waits, so a test can see what was asked and what was cancelled. */
function holdingServer(): Held[] {
  const held: Held[] = [];
  api.defaults.adapter = ((config) => {
    held.push({ url: String(config.url), params: config.params as Record<string, unknown>, signal: config.signal as AbortSignal | undefined });
    return new Promise(() => {});
  }) as AxiosAdapter;
  return held;
}

test("nothing is asked on opening or for one character; a search waits for a pause, and a newer one cancels the one still out", async () => {
  const held = holdingServer();
  mount();
  await wait(300);
  expect(held).toHaveLength(0);
  const box = screen.getByRole("combobox");
  await userEvent.type(box, "9");
  await wait(300);
  expect(held).toHaveLength(0);
  expect(screen.getByRole("status")).toHaveTextContent("Keep typing to search customers and bills.");
  await userEvent.type(box, "4");
  expect(held).toHaveLength(0);
  // while it's out the box says so: not "Nothing matches"
  expect(screen.getByRole("status")).toHaveTextContent("Searching…");
  await waitFor(() => expect(held).toHaveLength(4));
  expect(held.map((h) => [h.url, h.params])).toEqual([
    ["customers/", { search: "94", page_size: 5 }],
    ["invoices/", { search: "94", type_of_invoice: "outward", page_size: 5 }],
    ["products/", { search: "94", page_size: 3 }],
    ["businesses/", { search: "94", page_size: 3 }],
  ]);
  expect(held.some((h) => h.signal?.aborted)).toBe(false);
  await userEvent.type(box, "1");
  expect(held.every((h) => h.signal?.aborted)).toBe(true);
  await waitFor(() => expect(held).toHaveLength(8));
  expect(held.slice(4).every((h) => h.params.search === "941" && !h.signal?.aborted)).toBe(true);
  // a space at the end is the same search
  await userEvent.type(box, " ");
  await wait(300);
  expect(held).toHaveLength(8);
});

test("an older search's rows never stand in for what's typed now", async () => {
  const answers: (() => void)[] = [];
  api.defaults.adapter = ((config) => new Promise((resolve) => {
    const meena = config.url?.startsWith("customers/") && config.params?.search === "meena";
    answers.push(() => resolve({ status: 200, statusText: "", headers: {}, config, data: { results: meena ? [{ id: 7, name: "Meena Jain", mobile_number: "9414126508", gst_number: "" }] : [] } }));
  })) as AxiosAdapter;
  mount();
  const box = screen.getByRole("combobox");
  await userEvent.type(box, "meena");
  await waitFor(() => expect(answers).toHaveLength(4));
  await act(async () => { answers.splice(0).forEach((a) => a()); });
  expect(await screen.findByRole("option", { name: /^Meena Jain/ })).toBeInTheDocument();
  await userEvent.type(box, "x");
  expect(screen.queryByRole("option", { name: /^Meena Jain/ })).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Searching…");
  await waitFor(() => expect(answers).toHaveLength(4));
  await act(async () => { answers.splice(0).forEach((a) => a()); });
  expect(await screen.findByText(/^Nothing matches “meenax”/)).toBeInTheDocument();
});

test("each record says what it is: a mobile in two groups, else the GSTIN, else Customer; a product's HSN and GST; a firm's GSTIN", async () => {
  api.defaults.adapter = ((config) => answer(config, config.url?.startsWith("customers/") ? [ // unpaged: the array itself
    { id: 1, name: "Anil Gupta", mobile_number: "+91 98290 41122", gst_number: "" },
    { id: 2, name: "Anil Traders", mobile_number: "", gst_number: "08AAAAA0000A1Z5" },
    { id: 3, name: "Anil Kumar", mobile_number: null, gst_number: null },
  ] : config.url?.startsWith("products/") ? { results: [{ id: 5, name: "Anklet", hsn_code: "7113", gst_tax_rate: "0.0300" }] }
    : config.url?.startsWith("businesses/") ? { results: [{ id: 3, name: "ANIL JEWELLERS", gst_number: "08BBBBB0000B1Z5" }] }
      : { results: [] })) as AxiosAdapter;
  renderApp(<Routes><Route path="*" element={<Palette open onClose={() => {}} />} /><Route path="/firms/3" element={<p>firm 3</p>} /></Routes>);
  await userEvent.type(screen.getByRole("combobox"), "anil");
  expect(await screen.findByRole("option", { name: "Anil Gupta 98290 41122" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Anil Traders 08AAAAA0000A1Z5" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Anil Kumar Customer" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Anklet HSN 7113 · GST 3%" })).toBeInTheDocument();
  expect([...document.querySelectorAll("#palette-list .caps")].map((h) => h.textContent)).toEqual(["Customers", "Products", "Firms"]);
  await userEvent.click(screen.getByRole("option", { name: "ANIL JEWELLERS 08BBBBB0000B1Z5" }));
  expect(await screen.findByText("firm 3")).toBeInTheDocument();
});

test("a finished search that finds nothing says so, with what to try", async () => {
  api.defaults.adapter = ((config) => answer(config, { results: [] })) as AxiosAdapter;
  mount();
  await userEvent.type(screen.getByRole("combobox"), "zzz");
  expect(await screen.findByText("Nothing matches “zzz”. Try a phone number, or a bill number like 31 or KGH/2026-27/31.")).toHaveAttribute("role", "status");
  expect(screen.queryByRole("option")).not.toBeInTheDocument();
});

test("records that couldn't be searched say why, never “Nothing matches”, and Try again asks again", async () => {
  let down = true;
  api.defaults.adapter = ((config) => (down ? Promise.reject(new AxiosError("Network Error", "ERR_NETWORK", config))
    : answer(config, config.url?.startsWith("customers/") ? { results: [{ id: 7, name: "Meena Jain", mobile_number: "9414126508", gst_number: "" }] } : { results: [] }))) as AxiosAdapter;
  const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  mount();
  const box = screen.getByRole("combobox");
  await userEvent.type(box, "meena");
  expect(await screen.findByText("You're offline, so customers and bills can't be searched.")).toHaveAttribute("role", "status");
  onLine.mockReturnValue(true);
  await userEvent.type(box, "{Backspace}");
  expect(await screen.findByText("The app couldn't reach the shop's records just now, so customers and bills weren't searched.")).toBeInTheDocument();
  expect(screen.queryByText(/Nothing matches/)).not.toBeInTheDocument();
  // pages still match while records can't be searched, and the reason stays above them
  await userEvent.clear(box);
  await userEvent.type(box, "sales");
  expect(screen.getByRole("option", { name: /^Sales/ })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("The app couldn't reach the shop's records just now"));
  down = false;
  await wait(400); // past the dialog's guard against the tail of the tap that opened it
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("option", { name: /^Meena Jain/ })).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  expect(box).toHaveFocus();
});

test("typing finds the actions and pages it names, as far as the role allows", async () => {
  api.defaults.adapter = (() => new Promise(() => {})) as AxiosAdapter; // records never come: only what typing matches here
  const view = mount();
  const box = screen.getByRole("combobox");
  await userEvent.type(box, "add");
  expect(screen.getAllByRole("option").map((o) => o.textContent?.replace(/Alt P$/, ""))).toEqual(["Add a purchase by hand", "Add a customer", "Add a product"]);
  await userEvent.clear(box);
  await userEvent.type(box, "set");
  expect(screen.getByRole("option", { name: /^Settings/ })).toBeInTheDocument();
  view.unmount();
  mount("viewer");
  await userEvent.type(screen.getByRole("combobox"), "set");
  expect(screen.queryByRole("option", { name: /^Settings/ })).not.toBeInTheDocument();
});

test("Home and End jump to the ends, pointing moves the highlight, and choosing a row closes search and opens its page", async () => {
  const order: string[] = [];
  function Reports() { order.push("page"); return <p>reports page</p>; }
  renderApp(<Routes><Route path="*" element={<Palette open onClose={() => { order.push("closed"); }} />} /><Route path="/reports" element={<Reports />} /></Routes>);
  const box = screen.getByRole("combobox");
  const options = screen.getAllByRole("option");
  await userEvent.keyboard("{End}");
  expect(box).toHaveAttribute("aria-activedescendant", options[options.length - 1].id);
  expect(options[options.length - 1]).toHaveTextContent("Settings");
  await userEvent.keyboard("{Home}");
  expect(box).toHaveAttribute("aria-activedescendant", options[0].id);
  await userEvent.keyboard("{ArrowUp}");
  expect(box).toHaveAttribute("aria-activedescendant", options[0].id);
  const reports = screen.getByRole("option", { name: /^Reports/ });
  await userEvent.hover(reports);
  expect(box).toHaveAttribute("aria-activedescendant", reports.id);
  expect(screen.getAllByRole("option").filter((o) => o.getAttribute("aria-selected") === "true")).toEqual([reports]);
  expect(box).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(await screen.findByText("reports page")).toBeInTheDocument();
  expect(order[0]).toBe("closed");
});

test("on a desktop the footer shows the keys and a hint that promises only what search does; a phone's sheet has neither", () => {
  const view = mount();
  let dialog = screen.getByRole("dialog", { name: "Search" });
  expect(dialog).toHaveTextContent("Type a name, phone, bill number or page");
  expect(dialog).not.toHaveTextContent(/udhaar|gstr1|new anil/);
  expect(screen.getByRole("combobox")).toHaveAttribute("placeholder", "Customer, phone, bill number or a page");
  expect(screen.getByRole("option", { name: /^New sales bill/ }).querySelector("kbd")).toHaveTextContent(/N$/);
  view.unmount();
  (window as unknown as { __phone?: boolean }).__phone = true;
  mount();
  dialog = screen.getByRole("dialog", { name: "Search" });
  expect(dialog).not.toHaveTextContent("Type a name, phone, bill number or page");
  expect(dialog.querySelector("kbd")).toBeNull();
});

test("Opened recently: this person's newest five records, each under its own icon", () => {
  noteVisit(2, { to: "/sales/99", label: "KGH/2026-27/99" });
  const mine: [string, string][] = [["/sales/31", "KGH/2026-27/31"], ["/customers/7", "Meena Jain"], ["/purchases/9", "UBS/26-27/0850"], ["/products/5", "Gold chain"], ["/suppliers/4", "Jaipur Gem Exporters"], ["/sales/32", "KGH/2026-27/32"]];
  for (const [to, label] of mine) noteVisit(1, { to, label });
  mount();
  const rows = screen.getAllByRole("option").slice(0, 6);
  expect(rows.map((r) => r.textContent)).toEqual(["KGH/2026-27/32", "Jaipur Gem Exporters", "Gold chain", "UBS/26-27/0850", "Meena Jain", "New sales billAlt N"]);
  const icons = ["lucide-file-text", "lucide-truck", "lucide-package", "lucide-shopping-bag", "lucide-user-round"];
  rows.slice(0, 5).forEach((r, k) => expect(r.querySelector("svg")).toHaveClass(icons[k]));
  expect(document.querySelectorAll("#palette-list .caps")[0]).toHaveTextContent("Opened recently");
  expect(screen.queryByRole("option", { name: /KGH\/2026-27\/(31|99)/ })).not.toBeInTheDocument();
});

test("noteVisit keeps a person's last eight, newest first and each once; storage that refuses or holds junk costs nothing", () => {
  for (let n = 1; n <= 10; n++) noteVisit(1, { to: `/sales/${n}`, label: `Bill ${n}` });
  noteVisit(1, { to: "/sales/5", label: "Bill 5" });
  expect(recentVisits(1).map((v) => v.to)).toEqual(["/sales/5", "/sales/10", "/sales/9", "/sales/8", "/sales/7", "/sales/6", "/sales/4", "/sales/3"]);
  expect(recentVisits(2)).toEqual([]);
  localStorage.setItem("gst3.recent.1", "{not json");
  expect(recentVisits(1)).toEqual([]);
  vi.spyOn(Object.getPrototypeOf(localStorage) as Storage, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
  expect(() => noteVisit(1, { to: "/sales/1", label: "Bill 1" })).not.toThrow();
});

/** The server for the whole app: this person's preferences (Expert on a phone), one firm, and a search that finds Meena. */
function serve() {
  api.defaults.adapter = ((config) => answer(config, config.url?.startsWith("preferences/") ? { data: { phoneMode: "expert" } }
    : config.url?.startsWith("businesses/") ? { results: config.params?.search ? [] : [{ id: 3, name: "KIRAN GOLD HOUSE (SANDBOX)", gst_number: "08AAAAA0000A1Z5", state_name: "RAJASTHAN" }] }
      : config.url?.startsWith("customers/") ? { results: [{ id: 7, name: "Meena Jain", mobile_number: "9414126508", gst_number: "" }] }
        : { results: [] })) as AxiosAdapter;
}
function inApp(router: DataRouter) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AuthContext.Provider value={stubAuth()}><ToastProvider><RouterProvider router={router} /></ToastProvider></AuthContext.Provider></QueryClientProvider>);
  return router;
}
/** Past the page's guard against the second tap of a double tap (300 ms), with Date faked. */
const afterADoubleTap = () => act(() => { vi.advanceTimersByTime(400); });

test("the page frame notes a record stayed on, under its page's title; not a list, a form, a tool or a page passed through", async () => {
  serve();
  const router = inApp(createMemoryRouter([{ element: <AppLayout />, children: [
    { path: "/sales", element: <Page title="Bills">the list</Page> },
    { path: "/sales/new", element: <Page title="New bill">the form</Page> },
    { path: "/sales/paper", element: <Page title="Bills from the paper book">the paper book</Page> },
    { path: "/sales/:id", element: <Page title="KGH/2026-27/32">the bill</Page> },
    { path: "/customers/:id", element: <Page title="Meena Jain">the customer</Page> },
    { path: "/customers/:id/statement", element: <Page title="Statement">the statement</Page> },
  ] }], { initialEntries: ["/sales"] }));
  await screen.findByRole("heading", { level: 1, name: "Bills" });
  const visit = async (to: string, stay = 450) => { await act(async () => { await router.navigate(to); }); await wait(stay); };
  await visit("/sales/new");
  await visit("/sales/paper");
  await visit("/customers/7/statement");
  expect(recentVisits(1)).toEqual([]);
  await visit("/sales/32");
  expect(recentVisits(1)).toEqual([{ to: "/sales/32", label: "KGH/2026-27/32" }]);
  await visit("/customers/7", 150);
  await visit("/sales?month=2026-09");
  expect(recentVisits(1)).toEqual([{ to: "/sales/32", label: "KGH/2026-27/32" }]);
  await visit("/customers/7");
  await visit("/sales/32");
  expect(recentVisits(1)).toEqual([{ to: "/sales/32", label: "KGH/2026-27/32" }, { to: "/customers/7", label: "Meena Jain" }]);
});

test("the page the app opens on counts as a visit", async () => {
  serve();
  inApp(createMemoryRouter([{ element: <AppLayout />, children: [{ path: "/customers/:id", element: <Page title="Meena Jain">the customer</Page> }] }], { initialEntries: ["/customers/7"] }));
  await screen.findByRole("heading", { level: 1, name: "Meena Jain" });
  await wait(450);
  expect(recentVisits(1)).toEqual([{ to: "/customers/7", label: "Meena Jain" }]);
});

test("on a desktop, the header's Search and Ctrl K open search; choosing a page closes it, opens the page and focuses its title", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  serve();
  const router = inApp(createMemoryRouter([{ element: <AppLayout />, children: [
    { path: "/sales", element: <Page title="Bills">the list</Page> },
    { path: "/customers", element: <Page title="Customers">the customers</Page> },
  ] }], { initialEntries: ["/sales"] }));
  await screen.findByRole("heading", { level: 1, name: "Bills" });
  const button = screen.getByRole("button", { name: "Search (Ctrl K)" });
  afterADoubleTap();
  await userEvent.click(button);
  const dialog = await screen.findByRole("dialog", { name: "Search" });
  await waitFor(() => expect(within(dialog).getByRole("combobox")).toHaveFocus());
  await userEvent.keyboard("meena");
  expect(await screen.findByRole("option", { name: /^Meena Jain/ })).toBeInTheDocument();
  // Esc goes back to where you were
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(button).toHaveFocus();
  // and the next search starts afresh
  await userEvent.keyboard("{Control>}k{/Control}");
  const box = within(screen.getByRole("dialog", { name: "Search" })).getByRole("combobox");
  await waitFor(() => expect(box).toHaveFocus());
  expect(box).toHaveValue("");
  expect(screen.queryByRole("option", { name: /^Meena Jain/ })).not.toBeInTheDocument();
  await userEvent.keyboard("customers{Enter}");
  const h1 = await screen.findByRole("heading", { level: 1, name: "Customers" });
  expect(router.state.location.pathname).toBe("/customers");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(() => expect(h1).toHaveFocus());
});

test("on a phone, Search sits at the right end of the Expert header, after the page's own buttons, and opens the same search", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  (window as unknown as { __phone?: boolean }).__phone = true;
  serve();
  const router = inApp(createMemoryRouter([{ element: <AppLayout />, children: [
    { path: "/", element: <Page title="Today" phoneActions={<IconButton label="Bright screen for sunlight" icon={Sun} />}>home</Page> },
    { path: "/customers/:id", element: <Page title="Meena Jain">the customer</Page> },
  ] }], { initialEntries: ["/"] }));
  const header = (await screen.findByRole("heading", { level: 1, name: "Today" })).closest("header")!;
  expect(within(header).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Bright screen for sunlight", "Search"]);
  afterADoubleTap();
  await userEvent.click(within(header).getByRole("button", { name: "Search" }));
  const dialog = await screen.findByRole("dialog", { name: "Search" });
  await waitFor(() => expect(within(dialog).getByRole("combobox")).toHaveFocus());
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(within(header).getByRole("button", { name: "Search" })).toHaveFocus();
  // a record found from the phone opens like any other page
  afterADoubleTap();
  await userEvent.click(within(header).getByRole("button", { name: "Search" }));
  await userEvent.keyboard("meena");
  afterADoubleTap();
  await userEvent.click(await screen.findByRole("option", { name: /^Meena Jain/ }));
  expect(await screen.findByRole("heading", { level: 1, name: "Meena Jain" })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/customers/7");
});

test("a page with Back keeps its header to itself, and so do forms (no tabs) and Easy", async () => {
  (window as unknown as { __phone?: boolean }).__phone = true;
  serve();
  const router = inApp(createMemoryRouter([{ element: <AppLayout />, children: [
    { path: "/sales", element: <Page title="Bills">the list</Page> },
    { path: "/sales/7", element: <Page title="Bill 7" back="/sales" phoneActions={<IconButton label="More for this bill" icon={MoreHorizontal} />}>the bill</Page> },
    { path: "/sales/new", handle: { hideNav: true }, element: <Page title="New bill">the form</Page> },
    { path: "/e", element: <Page title="Easy home">easy</Page> },
  ] }], { initialEntries: ["/sales"] }));
  const header = (await screen.findByRole("heading", { level: 1, name: "Bills" })).closest("header")!;
  expect(within(header).getByRole("button", { name: "Search" })).toBeInTheDocument();
  for (const [path, title] of [["/sales/7", "Bill 7"], ["/sales/new", "New bill"], ["/e", "Easy home"]]) {
    await act(async () => { await router.navigate(path); });
    const h = (await screen.findByRole("heading", { level: 1, name: title })).closest("header")!;
    expect(within(h).queryByRole("button", { name: "Search" }), path).not.toBeInTheDocument();
  }
});
