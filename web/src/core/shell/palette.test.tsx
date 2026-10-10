import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, type AxiosAdapter } from "axios";
import { Sun } from "lucide-react";
import { createMemoryRouter, Route, RouterProvider, Routes, type DataRouter, type RouteObject } from "react-router";
import { api } from "@/core/api/client";
import { __setNetState } from "@/core/api/network";
import { AuthContext } from "@/core/auth/AuthProvider";
import { appRoutes } from "@/core/router/routes";
import { IconButton, Page, ToastProvider } from "@/core/ui";
import { renderApp, stubAuth } from "@/test/render";
import { AppLayout } from "./AppLayout";
import { Palette } from "./Palette";
import { noteVisit, recentVisits } from "./recent";

const calls: string[] = [];
/** search/quick/'s answer for "meena" (billing/api/search.py): her row, carrying her latest bills; no bill numbers or products match. */
const MEENA = {
  customers: [{ id: 7, name: "Meena Jain", mobile_number: "9414126508", gst_number: "", state_name: "RAJASTHAN",
    recent_invoices: [{ id: 32, invoice_number: "KGH/2026-27/32", invoice_date: "2026-10-08", total_amount: "38412.50", type_of_invoice: "outward", business_id: 3 }] }],
  invoices: [], products: [],
};
beforeEach(() => {
  localStorage.clear(); calls.length = 0;
  api.defaults.adapter = ((config) => {
    calls.push(String(config.url) + "?" + new URLSearchParams(config.params).toString());
    const data = config.url?.startsWith("search/quick/") ? MEENA : { results: [] };
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
  // one request, for the word as it rested: search/quick/ (Ruling 49), not a list per kind
  expect(calls.filter((c) => c.startsWith("search/"))).toEqual(["search/quick/?q=meena"]);
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

/* ── Beyond the brief: the server search, how the rows read, Opened recently, and the shells' ways in ── */

afterEach(() => { act(() => { __setNetState("online"); onlineManager.setOnline(true); }); vi.restoreAllMocks(); vi.useRealTimers(); (window as unknown as { __phone?: boolean }).__phone = false; });

const wait = (ms: number) => act(() => new Promise<void>((r) => { setTimeout(r, ms); }));
const answer = (config: Parameters<AxiosAdapter>[0], data: unknown) => Promise.resolve({ status: 200, statusText: "", headers: {}, config, data });
const NOTHING = { customers: [], invoices: [], products: [] };
type Held = { q: string; signal?: AbortSignal; reply(data: unknown): void };
/** A server that holds each search until the test replies (the firm list answers at once, with none). */
function holdingServer(): Held[] {
  const held: Held[] = [];
  api.defaults.adapter = ((config) => {
    if (!config.url?.startsWith("search/quick/")) return answer(config, { results: [] });
    return new Promise((resolve) => {
      held.push({ q: (config.params as { q: string }).q, signal: config.signal as AbortSignal | undefined, reply: (data) => resolve({ status: 200, statusText: "", headers: {}, config, data }) });
    });
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
  await waitFor(() => expect(held).toHaveLength(1));
  expect(held[0].q).toBe("94");
  expect(held[0].signal?.aborted).toBe(false);
  await userEvent.type(box, "1");
  await waitFor(() => expect(held).toHaveLength(2));
  expect(held[0].signal?.aborted).toBe(true);
  expect(held[1].q).toBe("941");
  expect(held[1].signal?.aborted).toBe(false);
  // a space at the end is the same search
  await userEvent.type(box, " ");
  await wait(300);
  expect(held).toHaveLength(2);
});

test("a phone number typed in groups is asked for as its digits, and its rows show; a bill's year keeps its hyphen", async () => {
  mount();
  const box = screen.getByRole("combobox");
  await userEvent.type(box, "98290 41122");
  // the rows are for what's in the box, so they show: the stale-rows check reads the same digits
  expect(await screen.findByRole("option", { name: /^Meena Jain/ })).toBeInTheDocument();
  expect(calls.filter((c) => c.startsWith("search/"))).toEqual(["search/quick/?q=9829041122"]);
  await userEvent.clear(box);
  await userEvent.type(box, "2026-27");
  await waitFor(() => expect(calls.filter((c) => c.startsWith("search/"))).toEqual(["search/quick/?q=9829041122", "search/quick/?q=2026-27"]));
});

test("a term searched in the last 30 s comes back without asking again", async () => {
  mount();
  const box = screen.getByRole("combobox");
  await userEvent.type(box, "meena");
  expect(await screen.findByRole("option", { name: /^Meena Jain/ })).toBeInTheDocument();
  await userEvent.clear(box);
  await wait(300); // long enough for the box's emptiness to count
  await userEvent.type(box, "meena");
  expect(await screen.findByRole("option", { name: /^Meena Jain/ })).toBeInTheDocument();
  await wait(300);
  expect(calls.filter((c) => c.startsWith("search/"))).toEqual(["search/quick/?q=meena"]);
});

test("an older search's rows never stand in for what's typed now", async () => {
  const held = holdingServer();
  mount();
  const box = screen.getByRole("combobox");
  await userEvent.type(box, "meena");
  await waitFor(() => expect(held).toHaveLength(1));
  await act(async () => { held[0].reply(MEENA); });
  expect(await screen.findByRole("option", { name: /^Meena Jain/ })).toBeInTheDocument();
  await userEvent.type(box, "x");
  expect(screen.queryByRole("option", { name: /^Meena Jain/ })).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Searching…");
  await waitFor(() => expect(held).toHaveLength(2));
  await act(async () => { held[1].reply(NOTHING); });
  expect(await screen.findByText(/^Nothing matches “meenax”/)).toBeInTheDocument();
});

test("each record says what it is: a mobile in two groups, else as typed, else the GSTIN, else Customer; a product's HSN and GST; a firm's GSTIN", async () => {
  api.defaults.adapter = ((config) => answer(config, config.url?.startsWith("search/quick/") ? {
    customers: [
      { id: 1, name: "Anil Gupta", mobile_number: "9829041122", gst_number: "08AAAAA0000A1Z5", state_name: "", recent_invoices: [] },
      { id: 2, name: "Anil & Sons", mobile_number: "0141 2345678", gst_number: "", state_name: "", recent_invoices: [] },
      { id: 3, name: "Anil Traders", mobile_number: "", gst_number: "08CCCCC0000C1Z5", state_name: "", recent_invoices: [] },
      { id: 4, name: "Anil Kumar", mobile_number: "", gst_number: "", state_name: "", recent_invoices: [] },
    ],
    invoices: [],
    products: [
      { id: 5, name: "Anklet", hsn_code: "7113", gst_tax_rate: "0.0300" }, { id: 6, name: "Anklet, kids", hsn_code: "7113", gst_tax_rate: "0.0300" },
      { id: 7, name: "Anklet, silver", hsn_code: "7113", gst_tax_rate: "0.0300" }, { id: 8, name: "Anklet, toe", hsn_code: "7113", gst_tax_rate: "0.0300" },
    ],
  } : config.url?.startsWith("businesses/") ? { results: [
    { id: 3, name: "ANIL JEWELLERS", gst_number: "08BBBBB0000B1Z5", state_name: "RAJASTHAN" },
    { id: 4, name: "KIRAN GOLD HOUSE", gst_number: "08DDDDD0000D1Z5", state_name: "RAJASTHAN" },
    { id: 5, name: "ANIL GOLD", gst_number: "", state_name: "RAJASTHAN" }, { id: 6, name: "ANIL SILVER", gst_number: "", state_name: "RAJASTHAN" },
    { id: 7, name: "ANIL GEMS", gst_number: "", state_name: "RAJASTHAN" },
  ] } : { results: [] })) as AxiosAdapter;
  renderApp(<Routes><Route path="*" element={<Palette open onClose={() => {}} />} /><Route path="/firms/3" element={<p>firm 3</p>} /></Routes>);
  const box = screen.getByRole("combobox");
  await userEvent.type(box, "anil");
  expect(await screen.findByRole("option", { name: "Anil Gupta 98290 41122" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Anil & Sons 0141 2345678" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Anil Traders 08CCCCC0000C1Z5" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Anil Kumar Customer" })).toBeInTheDocument();
  // three products at most
  expect(screen.getAllByRole("option", { name: /^Anklet.* HSN 7113 · GST 3%$/ })).toHaveLength(3);
  expect(screen.queryByRole("option", { name: /^Anklet, toe/ })).not.toBeInTheDocument();
  // firms are the app's own list, matched here by name or GSTIN: no request for them
  expect(screen.getByRole("option", { name: "ANIL JEWELLERS 08BBBBB0000B1Z5" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /KIRAN/ })).not.toBeInTheDocument();
  expect(screen.getAllByRole("option", { name: /^ANIL / })).toHaveLength(3);
  expect([...document.querySelectorAll("#palette-list .caps")].map((h) => h.textContent)).toEqual(["Customers", "Products", "Firms"]);
  await userEvent.clear(box);
  await userEvent.type(box, "08ddd");
  expect(await screen.findByRole("option", { name: "KIRAN GOLD HOUSE 08DDDDD0000D1Z5" })).toBeInTheDocument();
  await userEvent.clear(box);
  await userEvent.type(box, "anil");
  await userEvent.click(await screen.findByRole("option", { name: "ANIL JEWELLERS 08BBBBB0000B1Z5" }));
  expect(await screen.findByText("firm 3")).toBeInTheDocument();
});

test("sales bills: by number and from each customer found, sales only, each once, newest first, five at most", async () => {
  const bill = (id: number, number: string, day: string, type = "outward") => ({ id, invoice_number: number, invoice_date: day, total_amount: "1000.00", type_of_invoice: type, business_id: 3 });
  api.defaults.adapter = ((config) => answer(config, config.url?.startsWith("search/quick/") ? {
    invoices: [
      { ...bill(40, "KGH/2026-27/40", "2026-10-09"), customer_name: "Meena Jain" },
      { ...bill(132, "KGH/2025-26/132", "2025-11-02"), customer_name: "Mohan Lal" },
      { ...bill(9, "KGH-P/9", "2026-10-10", "inward"), customer_name: "Jaipur Gem Exporters" },
    ],
    customers: [
      { id: 7, name: "Meena Jain", mobile_number: "", gst_number: "", state_name: "", recent_invoices: [bill(40, "KGH/2026-27/40", "2026-10-09"), bill(32, "KGH/2026-27/32", "2026-10-08"), bill(30, "KGH/2026-27/30", "2026-09-01")] },
      { id: 8, name: "Mohan Lal", mobile_number: "", gst_number: "", state_name: "", recent_invoices: [bill(33, "KGH/2026-27/33", "2026-10-08"), bill(21, "KGH-P/21", "2026-10-05", "inward"), bill(20, "KGH/2025-26/20", "2025-04-01")] },
    ],
    products: [],
  } : { results: [] })) as AxiosAdapter;
  mount();
  await userEvent.type(screen.getByRole("combobox"), "kgh");
  await screen.findByRole("option", { name: /^KGH\/2026-27\/40/ });
  const bills = screen.getAllByRole("option").filter((o) => /^KGH/.test(o.textContent ?? ""));
  expect(bills.map((o) => o.textContent?.split("Mohan")[0].split("Meena")[0])).toEqual(["KGH/2026-27/40", "KGH/2026-27/33", "KGH/2026-27/32", "KGH/2026-27/30", "KGH/2025-26/132"]);
  // a customer's own bill names that customer
  expect(screen.getByRole("option", { name: "KGH/2026-27/33 Mohan Lal · 08 Oct 2026 · ₹1,000.00" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /KGH-P/ })).not.toBeInTheDocument();
});

test("a product from a server that doesn't send its rate shows its HSN alone, never “GST NaN%”", async () => {
  api.defaults.adapter = ((config) => answer(config, config.url?.startsWith("search/quick/") ? { ...NOTHING, products: [{ id: 5, name: "Anklet", hsn_code: "7113" }] } : { results: [] })) as AxiosAdapter;
  mount();
  await userEvent.type(screen.getByRole("combobox"), "ank");
  expect(await screen.findByRole("option", { name: "Anklet HSN 7113" })).toBeInTheDocument();
});

test("a finished search that finds nothing says so, with what to try", async () => {
  api.defaults.adapter = ((config) => answer(config, config.url?.startsWith("search/quick/") ? NOTHING : { results: [] })) as AxiosAdapter;
  mount();
  await userEvent.type(screen.getByRole("combobox"), "zzz");
  expect(await screen.findByText("Nothing matches “zzz”. Try a phone number, or a bill number like 31 or KGH/2026-27/31.")).toHaveAttribute("role", "status");
  expect(screen.queryByRole("option")).not.toBeInTheDocument();
});

test("when the server can't be searched it says what wasn't, firms still show, never “Nothing matches”, and Try again asks again", async () => {
  let down = true;
  const asked: string[] = [];
  api.defaults.adapter = ((config) => {
    if (config.url?.startsWith("businesses/")) return answer(config, { results: [{ id: 4, name: "MEENA ORNAMENTS", gst_number: "08BBBBB0000B1Z5", state_name: "RAJASTHAN" }] });
    asked.push((config.params as { q: string }).q);
    return down ? Promise.reject(new AxiosError("Network Error", "ERR_NETWORK", config)) : answer(config, MEENA);
  }) as AxiosAdapter;
  const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  mount();
  // the browser's word, once the app listens for it: a query that waits for the network would wait here
  act(() => { window.dispatchEvent(new Event("offline")); });
  const box = screen.getByRole("combobox");
  await userEvent.type(box, "meena");
  // offline it still asks, and says so at once: it doesn't wait for the network to come back
  expect(await screen.findByText("You're offline, so customers, bills and products can't be searched.")).toHaveAttribute("role", "status");
  expect(screen.getByRole("option", { name: /^MEENA ORNAMENTS/ })).toBeInTheDocument();
  onLine.mockReturnValue(true);
  act(() => { window.dispatchEvent(new Event("online")); });
  await userEvent.type(box, "{Backspace}");
  expect(await screen.findByText("The app couldn't reach the shop's records just now, so customers, bills and products weren't searched.")).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /^MEENA ORNAMENTS/ })).toBeInTheDocument();
  expect(screen.queryByText(/Nothing matches/)).not.toBeInTheDocument();
  // once each: no retry behind the person's back
  expect(asked).toEqual(["meena", "meen"]);
  down = false;
  await wait(400); // past the dialog's guard against the tail of the tap that opened it
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(box).toHaveFocus();
  expect(await screen.findByRole("option", { name: /^Meena Jain/ })).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  expect(asked).toEqual(["meena", "meen", "meen"]);
});

test("typing finds the actions and pages it names, as far as the role allows", async () => {
  holdingServer(); // records never come: only what typing matches here
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
    : config.url?.startsWith("businesses/") ? { results: [{ id: 3, name: "KIRAN GOLD HOUSE (SANDBOX)", gst_number: "08AAAAA0000A1Z5", state_name: "RAJASTHAN" }] }
      : config.url?.startsWith("search/quick/") ? MEENA : {})) as AxiosAdapter;
}
function inApp(router: DataRouter) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AuthContext.Provider value={stubAuth()}><ToastProvider><RouterProvider router={router} /></ToastProvider></AuthContext.Provider></QueryClientProvider>);
  return router;
}
const shell = (pages: RouteObject[], at: string) => inApp(createMemoryRouter([{ element: <AppLayout />, children: pages }], { initialEntries: [at] }));
/** Past the page's guard against the second tap of a double tap (300 ms), with Date faked. */
const afterADoubleTap = () => act(() => { vi.advanceTimersByTime(400); });

test("the page frame notes a record stayed on, under its page's title; not a list, a form, a tool or a page passed through", async () => {
  serve();
  const router = shell([
    { path: "/sales", element: <Page title="Bills">the list</Page> },
    { path: "/sales/new", element: <Page title="New bill">the form</Page> },
    { path: "/sales/paper", element: <Page title="Bills from the paper book">the paper book</Page> },
    { path: "/sales/:id", element: <Page title="KGH/2026-27/32">the bill</Page> },
    { path: "/customers/:id", element: <Page title="Meena Jain">the customer</Page> },
    { path: "/customers/:id/statement", element: <Page title="Statement">the statement</Page> },
  ], "/sales");
  await screen.findByRole("heading", { level: 1, name: "Bills" });
  // the clock moves only when the test says, so a short stay is short however busy the machine
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const visit = async (to: string, stay = 450) => { await act(async () => { await router.navigate(to); }); act(() => { vi.advanceTimersByTime(stay); }); };
  await visit("/sales/new");
  await visit("/sales/paper");
  await visit("/customers/7/statement");
  expect(recentVisits(1)).toEqual([]);
  await visit("/sales/32", 399);
  expect(recentVisits(1)).toEqual([]);
  act(() => { vi.advanceTimersByTime(1); });
  expect(recentVisits(1)).toEqual([{ to: "/sales/32", label: "KGH/2026-27/32" }]);
  await visit("/customers/7", 399);
  await visit("/sales?month=2026-09");
  expect(recentVisits(1)).toEqual([{ to: "/sales/32", label: "KGH/2026-27/32" }]);
  await visit("/customers/7");
  await visit("/sales/32");
  expect(recentVisits(1)).toEqual([{ to: "/sales/32", label: "KGH/2026-27/32" }, { to: "/customers/7", label: "Meena Jain" }]);
});

test("the page the app opens on counts as a visit", async () => {
  serve();
  shell([{ path: "/customers/:id", element: <Page title="Meena Jain">the customer</Page> }], "/customers/7");
  await screen.findByRole("heading", { level: 1, name: "Meena Jain" });
  // (its timer started with the page, so only "it comes" is asked here: the stay test above pins the 400 ms)
  await waitFor(() => expect(recentVisits(1)).toEqual([{ to: "/customers/7", label: "Meena Jain" }]));
});

test("on a desktop, the header's Search and Ctrl K open search; choosing a page closes it, opens the page and focuses its title", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  serve();
  const router = shell([
    { path: "/sales", element: <Page title="Bills">the list</Page> },
    { path: "/customers", element: <Page title="Customers">the customers</Page> },
  ], "/sales");
  await screen.findByRole("heading", { level: 1, name: "Bills" });
  const button = screen.getByRole("button", { name: "Search (Ctrl K)" });
  afterADoubleTap();
  await userEvent.click(button);
  const dialog = await screen.findByRole("dialog", { name: "Search" });
  expect(within(dialog).getByRole("combobox")).toHaveFocus();
  await userEvent.keyboard("meena");
  expect(await screen.findByRole("option", { name: /^Meena Jain/ })).toBeInTheDocument();
  // Esc goes back to where you were
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(button).toHaveFocus();
  // and the next search starts afresh, ready to type in at once
  await userEvent.keyboard("{Control>}k{/Control}");
  const box = within(screen.getByRole("dialog", { name: "Search" })).getByRole("combobox");
  expect(box).toHaveFocus();
  expect(box).toHaveValue("");
  expect(screen.queryByRole("option", { name: /^Meena Jain/ })).not.toBeInTheDocument();
  await userEvent.keyboard("customers{Enter}");
  const h1 = await screen.findByRole("heading", { level: 1, name: "Customers" });
  expect(router.state.location.pathname).toBe("/customers");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(() => expect(h1).toHaveFocus());
});

test("on a phone, Today carries Search last in its header, after its own buttons; it opens the same search, and a record found opens with focus on its title", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  (window as unknown as { __phone?: boolean }).__phone = true;
  serve();
  const router = shell([
    { path: "/", element: <Page title="Today" phoneSearch phoneActions={<IconButton label="Bright screen for sunlight" icon={Sun} />}>home</Page> },
    { path: "/customers/:id", element: <Page title="Meena Jain" back="/customers">the customer</Page> },
  ], "/");
  const header = (await screen.findByRole("heading", { level: 1, name: "Today" })).closest("header")!;
  expect(within(header).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Bright screen for sunlight", "Search customers and bills"]);
  const search = within(header).getByRole("button", { name: "Search customers and bills" });
  afterADoubleTap();
  await userEvent.click(search);
  const dialog = await screen.findByRole("dialog", { name: "Search" });
  expect(within(dialog).getByRole("combobox")).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(search).toHaveFocus();
  afterADoubleTap();
  await userEvent.click(search);
  await userEvent.keyboard("meena");
  afterADoubleTap();
  await userEvent.click(await screen.findByRole("option", { name: /^Meena Jain/ }));
  const h1 = await screen.findByRole("heading", { level: 1, name: "Meena Jain" });
  expect(router.state.location.pathname).toBe("/customers/7");
  await waitFor(() => expect(h1).toHaveFocus());
});

test("on a phone only Today carries Search: not Bills, Customers or More, and not where a page asks for it in Easy or on a form", async () => {
  (window as unknown as { __phone?: boolean }).__phone = true;
  serve();
  const router = inApp(createMemoryRouter(appRoutes, { initialEntries: ["/"] }));
  let header = (await screen.findByRole("heading", { level: 1, name: "Dashboard" })).closest("header")!;
  expect(within(header).getByRole("button", { name: "Search customers and bills" })).toBeInTheDocument();
  for (const [path, title] of [["/sales", "Bills"], ["/customers", "Customers"], ["/more", "More"]]) {
    await act(async () => { await router.navigate(path); });
    header = (await screen.findByRole("heading", { level: 1, name: title })).closest("header")!;
    expect(within(header).queryByRole("button", { name: /^Search/ }), path).not.toBeInTheDocument();
  }
  // the shell gives it only to Expert pages beside the tabs
  const asks = shell([
    { path: "/sales/new", handle: { hideNav: true }, element: <Page title="New bill" phoneSearch>the form</Page> },
    { path: "/e", element: <Page title="Easy home" phoneSearch>easy</Page> },
  ], "/sales/new");
  for (const [path, title] of [["/sales/new", "New bill"], ["/e", "Easy home"]]) {
    await act(async () => { await asks.navigate(path); });
    header = (await screen.findByRole("heading", { level: 1, name: title })).closest("header")!;
    expect(within(header).queryByRole("button", { name: /^Search/ }), path).not.toBeInTheDocument();
  }
});
