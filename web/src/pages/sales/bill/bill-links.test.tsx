import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onlineManager, QueryClientProvider, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createMemoryRouter, Route, RouterProvider, Routes, useLocation } from "react-router";
import { __setNetState } from "@/core/api/network";
import { salesKeys } from "@/core/api/sales";
import { AuthContext } from "@/core/auth/AuthProvider";
import { RoleContext } from "@/core/auth/role";
import { refuse, salesServer, wireDetail, wirePage, wireRow } from "@/core/sales/fixtures";
import { ToastProvider } from "@/core/ui";
import { renderApp, stubAuth, testQueryClient } from "@/test/render";
import BillPage from "../BillPage";
import V2NumberLink from "../V2NumberLink";
import { businessSlug } from "./BillByNumber";

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}</p>; }
const mount = (path: string) => renderApp(
  <Routes>
    <Route path="/sales/:id" element={<><BillPage /><Where /></>} />
    <Route path="/billing/invoice/:bizSlug/:fy/:slug" element={<><V2NumberLink /><Where /></>} />
    <Route path="/purchases/:id" element={<Where />} />
  </Routes>, { path });
const KIRAN = { business: 3, business_name: "KIRAN GOLD HOUSE (SANDBOX)" };
const MEERA = { business: 2, business_name: "MEERA ORNAMENTS (SANDBOX)" };

test("v2's link by firm, year and number opens the bill it names, among bills that share the number", async () => {
  const { calls } = salesServer([
    ["GET", "sales/", () => wirePage([wireRow({ id: 512, invoice_number: "040", fy: "2025-26", ...KIRAN }), wireRow({ id: 600, invoice_number: "040", fy: "2025-26", ...MEERA })])],
    ["GET", "sales/512/", () => ({})],
  ]);
  mount("/billing/invoice/kiran-gold-house-sandbox/2025-26/040");
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/sales/512"));
  expect(calls.find((c) => c.url === "sales/")?.params).toEqual({ number: "040", fy: "2025-26", page: 1, page_size: 20 });
});

test("a firm's id in the link asks that firm only; a number on several bills asks which one", async () => {
  const { calls } = salesServer([
    ["GET", "sales/", (c) => wirePage(c.params.business_id === 3 ? [wireRow({ id: 512, invoice_number: "KGH-31", ...KIRAN })]
      : [wireRow({ id: 512, invoice_number: "KGH-31", ...KIRAN }), wireRow({ id: 613, invoice_number: "KGH-31", invoice_date: "2025-11-02", fy: "2025-26", ...MEERA, customer: { id: 9, name: "Walk-in Customer", gst_number: "", mobile_number: "", type: "walkin" } })])],
    ["GET", "sales/512/", () => ({})],
  ]);
  const view = mount("/billing/invoice/3/2026-27/KGH-31");
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/sales/512"));
  expect(calls.find((c) => c.url === "sales/")?.params).toMatchObject({ business_id: 3, number: "KGH-31", fy: "2026-27" });
  view.unmount();
  // v2's /billing/invoice/KGH-31 arrives as /sales/KGH-31 (part 0's redirect): a number, not an id
  mount("/sales/KGH-31");
  const list = await screen.findByRole("list", { name: "Bills with this number" });
  expect(screen.getByRole("heading", { level: 1, name: "Bill KGH-31" })).toBeInTheDocument();
  expect(within(list).getByRole("link", { name: /^KGH-31 KIRAN GOLD HOUSE \(SANDBOX\) · 08 Oct 2026 · Anil Gupta/ })).toHaveAttribute("href", "/sales/512");
  expect(within(list).getByRole("link", { name: /^KGH-31 MEERA ORNAMENTS \(SANDBOX\) · 02 Nov 2025 · Walk-in Customer/ })).toHaveAttribute("href", "/sales/613");
});

test("a number that's only on a purchase opens the purchase; a number on nothing says so", async () => {
  const { calls } = salesServer([
    ["GET", "sales/", () => wirePage([])],
    ["GET", "invoices/", (c) => ({ count: 1, next: null, previous: null, results: c.params.invoice_number === "UBS-0850"
      ? [{ id: 77, invoice_number: "UBS-0850", invoice_date: "2026-05-02", type_of_invoice: "inward", business: 3, business_name: KIRAN.business_name }]
      : [{ id: 78, invoice_number: "ZZ-10", invoice_date: "2026-05-02", type_of_invoice: "inward", business: 3, business_name: KIRAN.business_name }] })],
  ]);
  const view = mount("/billing/invoice/3/2026-27/UBS-0850");
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/purchases/77"));
  // the link's year as v2's date filter (Ruling 1B-19)
  expect(calls.find((c) => c.url === "invoices/")?.params).toEqual({ invoice_number: "UBS-0850", type_of_invoice: "inward", business_id: 3, start_date: "2026-04-01", end_date: "2027-03-31", page_size: 20 });
  view.unmount();
  mount("/billing/invoice/3/2026-27/ZZ-1");
  expect(await screen.findByText("No bill has this number")).toBeInTheDocument();
  // the firm is named as the app's firm list has it
  expect(screen.getByText("No sales bill of KIRAN GOLD HOUSE has the number “ZZ-1” in FY 2026-27. It may have been renumbered or deleted; search for it, or look in the Audit log.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Search every year" })).toHaveAttribute("href", "/sales?q=ZZ-1&month=years");
});

test("an id that v2 knows as a purchase opens the purchase; any other missing id is missing", async () => {
  salesServer([
    ["GET", "sales/77/", () => refuse(404, { detail: "No Invoice matches the given query." })],
    ["GET", "invoices/77/", () => ({ id: 77, invoice_number: "UBS-0850", type_of_invoice: "inward" })],
    ["GET", "sales/999/", () => refuse(404, { detail: "No Invoice matches the given query." })],
    ["GET", "invoices/999/", () => refuse(404, { detail: "Not found." })],
  ]);
  const view = mount("/sales/77");
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/purchases/77"));
  view.unmount();
  mount("/sales/999");
  expect(await screen.findByText("This bill isn't here")).toBeInTheDocument();
});

/* ── Beyond the brief: failures (part 0's rule, Ruling 1B-11), and purchases by the link's firm and year ── */

afterEach(() => { act(() => { __setNetState("online"); onlineManager.setOnline(true); }); });

/** The page's cache, to ask again from outside, as a reconnect does. */
let cache: QueryClient;
function Grab() { cache = useQueryClient(); return null; }
const INWARD = (id: number, over: Record<string, unknown> = {}) => ({
  id, invoice_number: "UBS-0850", invoice_date: "2026-05-02", type_of_invoice: "inward", business: 3, business_name: KIRAN.business_name,
  customer_name: "Shree Bullion", total_amount: "45000.00", ...over,
});
const page = (results: unknown[]) => ({ count: results.length, next: null, previous: null, results });

test("a number link that can't be looked up says so, and Try again asks again; offline before anything came, it says so", async () => {
  let down = true;
  const { calls } = salesServer([
    ["GET", "sales/", () => (down ? refuse(500, {}) : wirePage([wireRow({ id: 512, invoice_number: "KGH-31", ...KIRAN })]))],
    ["GET", "sales/512/", () => ({})],
  ]);
  const view = mount("/sales/KGH-31");
  expect(await screen.findByText("Couldn't load this bill")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Bill KGH-31" })).toBeInTheDocument();
  down = false;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/sales/512"));
  // the number was looked up twice: the failure, then Try again. The bill page that opened asks sales/ for the customer's
  // other bills on its own, at a time a busy machine decides (before or after this line), so only lookups by number count
  expect(calls.filter((c) => c.url === "sales/" && c.params.number === "KGH-31")).toHaveLength(2);
  view.unmount();
  act(() => { __setNetState("offline"); onlineManager.setOnline(false); });
  mount("/billing/invoice/3/2026-27/KGH-31");
  expect(await screen.findByText("You're offline")).toBeInTheDocument();
  act(() => { __setNetState("online"); onlineManager.setOnline(true); });
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/sales/512"));
});

test("bills to pick from stay when asking for them again fails, and the page says so; Try again asks again", async () => {
  let down = false;
  const { calls } = salesServer([["GET", "sales/", () => (down ? refuse(500, {}) : wirePage([
    wireRow({ id: 512, invoice_number: "KGH-31", ...KIRAN }), wireRow({ id: 613, invoice_number: "KGH-31", invoice_date: "2025-11-02", fy: "2025-26", ...MEERA }),
  ]))]]);
  renderApp(<><Grab /><Routes><Route path="/sales/:id" element={<BillPage />} /></Routes></>, { path: "/sales/KGH-31" });
  const list = await screen.findByRole("list", { name: "Bills with this number" });
  down = true;
  await act(async () => { await cache.invalidateQueries({ queryKey: ["sales"] }); });
  expect(await screen.findByText("Couldn't refresh the bills with this number")).toBeInTheDocument();
  expect(within(list).getAllByRole("link")).toHaveLength(2);
  down = false;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByText("Couldn't refresh the bills with this number")).not.toBeInTheDocument());
  expect(calls.filter((c) => c.url === "sales/")).toHaveLength(3);
});

test("a purchase of another year than the link's, or of another firm than the one it names, isn't opened", async () => {
  let rows = [INWARD(70, { invoice_date: "2025-05-02" })];
  salesServer([["GET", "sales/", () => wirePage([])], ["GET", "invoices/", () => page(rows)]]);
  const view = mount("/billing/invoice/3/2026-27/UBS-0850");
  expect(await screen.findByText("No bill has this number")).toBeInTheDocument();
  view.unmount();
  rows = [INWARD(71, { business: 2, business_name: MEERA.business_name })];
  mount("/billing/invoice/kiran-gold-house-sandbox/2026-27/UBS-0850");
  expect(await screen.findByText("No bill has this number")).toBeInTheDocument();
});

test("a number on several purchases, and on no sale, asks which one", async () => {
  salesServer([["GET", "sales/", () => wirePage([])], ["GET", "invoices/", () => page([
    INWARD(77, { invoice_number: "INV-101" }), INWARD(79, { invoice_number: "INV-101", invoice_date: "2026-06-11", customer_name: "Mehta Chains", total_amount: "12500.50" }),
  ])]]);
  mount("/sales/INV-101");
  const list = await screen.findByRole("list", { name: "Purchases with this number" });
  expect(screen.getByRole("heading", { level: 1, name: "Bill INV-101" })).toBeInTheDocument();
  expect(screen.getByText("2 purchases have this number")).toBeInTheDocument();
  expect(within(list).getByRole("link", { name: /^INV-101 KIRAN GOLD HOUSE \(SANDBOX\) · 02 May 2026 · Shree Bullion ₹45,000\.00/ })).toHaveAttribute("href", "/purchases/77");
  expect(within(list).getByRole("link", { name: /^INV-101 KIRAN GOLD HOUSE \(SANDBOX\) · 11 Jun 2026 · Mehta Chains ₹12,500\.50/ })).toHaveAttribute("href", "/purchases/79");
});

test("a purchase lookup that fails says so, with Try again, rather than that no bill has the number", async () => {
  let down = true;
  const { calls } = salesServer([["GET", "sales/", () => wirePage([])], ["GET", "invoices/", () => (down ? refuse(500, {}) : page([INWARD(77)]))]]);
  mount("/billing/invoice/3/2026-27/UBS-0850");
  expect(await screen.findByText("Couldn't load this bill")).toBeInTheDocument();
  expect(screen.queryByText("No bill has this number")).not.toBeInTheDocument();
  down = false;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/purchases/77"));
  expect(calls.filter((c) => c.url === "invoices/")).toHaveLength(2);
});

test("an id v2 couldn't say anything about says so, with Try again, rather than that the bill isn't here", async () => {
  let down = true;
  const { calls } = salesServer([
    ["GET", "sales/77/", () => refuse(404, { detail: "No Invoice matches the given query." })],
    ["GET", "invoices/77/", () => (down ? refuse(500, {}) : { id: 77, invoice_number: "UBS-0850", type_of_invoice: "inward" })],
  ]);
  mount("/sales/77");
  expect(await screen.findByText("Couldn't load this bill")).toBeInTheDocument();
  expect(screen.queryByText("This bill isn't here")).not.toBeInTheDocument();
  down = false;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/purchases/77"));
  expect(calls.filter((c) => c.url === "invoices/77/")).toHaveLength(2);
});

/* ── Review fix 1: purchases beside sales, past v2's first rows (Rulings 1B-19, 1B-20); history; the firm slug ── */

test("a link's number is looked up among sales and purchases at once: one bill of either kind opens; a sale and a purchase are both offered; a purchase lookup that fails beside one sale opens the sale", async () => {
  let sales: Record<string, unknown>[] = [];
  let purchases: unknown[] = [];
  let down = false;
  const { calls } = salesServer([
    ["GET", "sales/", () => wirePage(sales)],
    ["GET", "invoices/", () => (down ? refuse(500, {}) : page(purchases))],
    ["GET", "sales/512/", () => ({})],
  ]);
  const SALE = wireRow({ id: 512, invoice_number: "245", invoice_date: "2025-09-12", fy: "2025-26", ...KIRAN });
  const BUY = INWARD(77, { invoice_number: "245", invoice_date: "2025-08-30" });
  // one sale only
  sales = [SALE];
  let view = mount("/billing/invoice/3/2025-26/245");
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/sales/512"));
  expect(calls.filter((c) => c.url === "invoices/")).toHaveLength(1);
  view.unmount();
  // one purchase only
  sales = [];
  purchases = [BUY];
  view = mount("/billing/invoice/3/2025-26/245");
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/purchases/77"));
  view.unmount();
  // a sale and a purchase of the firm and year: one list, each row saying which it is
  sales = [SALE];
  view = mount("/billing/invoice/3/2025-26/245");
  const list = await screen.findByRole("list", { name: "Bills with this number" });
  expect(screen.getByText("2 bills have this number")).toBeInTheDocument();
  expect(screen.getByText("Pick the one you want: sales and purchases can share a number.")).toBeInTheDocument();
  expect(within(list).getByRole("link", { name: /^245 Sale KIRAN GOLD HOUSE \(SANDBOX\) · 12 Sep 2025 · Anil Gupta/ })).toHaveAttribute("href", "/sales/512");
  expect(within(list).getByRole("link", { name: /^245 Purchase KIRAN GOLD HOUSE \(SANDBOX\) · 30 Aug 2025 · Shree Bullion/ })).toHaveAttribute("href", "/purchases/77");
  view.unmount();
  // the purchase lookup fails beside one sale: the sale opens
  down = true;
  mount("/billing/invoice/3/2025-26/245");
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/sales/512"));
});

test("a short number's purchase past v2's first rows is still found: when v2 has more, the rest are asked for once", async () => {
  // v2 matches "12" anywhere in a number, newest first: 24 newer bills (112, 212…) come before the purchase "12"
  const all = [...Array.from({ length: 24 }, (_, i) => INWARD(100 + i, { invoice_number: `${i + 1}12` })), INWARD(77, { invoice_number: "12" })];
  const { calls } = salesServer([
    ["GET", "sales/", () => wirePage([])],
    ["GET", "invoices/", (c) => ({ count: all.length, next: null, previous: null, results: all.slice(0, Number(c.params.page_size)) })],
  ]);
  mount("/billing/invoice/3/2026-27/12");
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/purchases/77"));
  expect(calls.filter((c) => c.url === "invoices/").map((c) => c.params.page_size)).toEqual([20, 25]);
});

test("over 1,000 purchases with numbers like the link's: the page says it can't tell, never that no bill has the number", async () => {
  const { calls } = salesServer([
    ["GET", "sales/", () => wirePage([])],
    ["GET", "invoices/", () => ({ count: 1500, next: "page 2", previous: null, results: Array.from({ length: 20 }, (_, i) => INWARD(100 + i, { invoice_number: `${i}1${i}` })) })],
  ]);
  mount("/billing/invoice/3/2026-27/1");
  expect(await screen.findByText("Too many bills to check")).toBeInTheDocument();
  expect(screen.getByText("Over 1,000 purchases of KIRAN GOLD HOUSE in FY 2026-27 have numbers like “1”, too many to check here, so this page can't tell which bill the link means. Search for it, or look in the Audit log.")).toBeInTheDocument();
  expect(screen.queryByText("No bill has this number")).not.toBeInTheDocument();
  expect(calls.filter((c) => c.url === "invoices/")).toHaveLength(1);
});

test("v2's purchases are asked for the link's firm, found by its name in the firm list, and the link's year", async () => {
  const { calls } = salesServer([["GET", "sales/", () => wirePage([])], ["GET", "invoices/", () => page([INWARD(77, { business_name: "KIRAN GOLD HOUSE" })])]]);
  mount("/billing/invoice/kiran-gold-house/2026-27/UBS-0850");
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/purchases/77"));
  expect(calls.find((c) => c.url === "invoices/")?.params).toEqual({ invoice_number: "UBS-0850", type_of_invoice: "inward", business_id: 3, start_date: "2026-04-01", end_date: "2027-03-31", page_size: 20 });
});

test("v2's ?b= names the firm by its id, as v2 read it: a number two firms share opens that firm's bill", async () => {
  const { calls } = salesServer([
    ["GET", "sales/", (c) => wirePage(c.params.business_id === 3 ? [wireRow({ id: 512, invoice_number: "KGH-31", ...KIRAN })]
      : [wireRow({ id: 512, invoice_number: "KGH-31", ...KIRAN }), wireRow({ id: 613, invoice_number: "KGH-31", ...MEERA })])],
    ["GET", "sales/512/", () => ({})],
  ]);
  mount("/sales/KGH-31?b=3");
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/sales/512"));
  expect(calls.find((c) => c.url === "sales/")?.params).toMatchObject({ business_id: 3, number: "KGH-31" });
  expect(calls.find((c) => c.url === "invoices/")?.params).toMatchObject({ business_id: 3, invoice_number: "KGH-31" });
});

test("an old link that settles on a bill or a purchase takes its own place in history, so Back goes where the person was", async () => {
  const SALES: Record<string, Record<string, unknown>[]> = { "KGH-31": [wireRow({ id: 512, invoice_number: "KGH-31", ...KIRAN })], "MOK-7": [wireRow({ id: 700, invoice_number: "MOK-7", ...MEERA })] };
  salesServer([
    ["GET", "sales/", (c) => wirePage(SALES[String(c.params.number)] ?? [])],
    // MOK-7's purchases can't be looked up: its one sale opens
    ["GET", "invoices/", (c) => (c.params.invoice_number === "MOK-7" ? refuse(500, {}) : page(c.params.invoice_number === "UBS-0850" ? [INWARD(77)] : []))],
    ["GET", "sales/512/", () => wireDetail({ id: 512, invoice_number: "KGH-31" })],
    ["GET", "sales/700/", () => wireDetail({ id: 700, invoice_number: "MOK-7" })],
    ["GET", "sales/77/", () => refuse(404, { detail: "No Invoice matches the given query." })],
    ["GET", "invoices/77/", () => ({ id: 77, invoice_number: "UBS-0850", type_of_invoice: "inward" })],
  ]);
  for (const [link, lands] of [
    ["/billing/invoice/3/2026-27/KGH-31", "/sales/512"], ["/sales/UBS-0850", "/purchases/77"], ["/sales/77", "/purchases/77"], ["/billing/invoice/2/2026-27/MOK-7", "/sales/700"],
  ]) {
    const router = createMemoryRouter([
      { path: "/sales", element: <p>Bills</p> },
      { path: "/sales/:id", element: <BillPage /> },
      { path: "/billing/invoice/:bizSlug/:fy/:slug", element: <V2NumberLink /> },
      { path: "/purchases/:id", element: <p>A purchase</p> },
    ], { initialEntries: ["/sales", link], initialIndex: 1 });
    const view = render(
      <QueryClientProvider client={testQueryClient()}><AuthContext.Provider value={stubAuth()}><RoleContext.Provider value="owner">
        <ToastProvider><RouterProvider router={router} /></ToastProvider>
      </RoleContext.Provider></AuthContext.Provider></QueryClientProvider>,
    );
    await waitFor(() => expect(router.state.location.pathname).toBe(lands));
    await act(async () => { await router.navigate(-1); });
    expect(router.state.location.pathname).toBe("/sales");
    view.unmount();
  }
});

test("an id v2 knows as a sale, which the bill page couldn't find, isn't here", async () => {
  salesServer([
    ["GET", "sales/88/", () => refuse(404, { detail: "No Invoice matches the given query." })],
    ["GET", "invoices/88/", () => ({ id: 88, invoice_number: "KGH-88", type_of_invoice: "outward" })],
  ]);
  mount("/sales/88");
  expect(await screen.findByText("This bill isn't here")).toBeInTheDocument();
  expect(screen.getByText("No sales bill has the id “88”. It may have been deleted; deleted bills can be restored from the Audit log.")).toBeInTheDocument();
});

test.each([
  ["KIRAN GOLD HOUSE (SANDBOX)", "kiran-gold-house-sandbox"], // brackets
  ["S.K. Jewellers", "s-k-jewellers"], // dots
  ["Mehta & Sons", "mehta-sons"], // an ampersand
  ["SHREE   GANESH  JEWELLERS", "shree-ganesh-jewellers"], // repeated spaces
  ["...Pyarchand Ratanlal!!", "pyarchand-ratanlal"], // punctuation at either end
  ["22K Gold Mart", "22k-gold-mart"], // digits stay
  ["श्री गणेश ज्वेलर्स", ""], // no Latin letters or digits at all: v2 then wrote the firm's id
])("v2's firm slug of %j is %j", (name, slug) => {
  expect(businessSlug(name)).toBe(slug);
});

/* ── 1B Task 11, commit A: several sales, and the purchases unknown (Ruling 1B-22) ── */

const TWO_SALES = () => wirePage([wireRow({ id: 512, invoice_number: "KGH-31", ...KIRAN }), wireRow({ id: 613, invoice_number: "KGH-31", invoice_date: "2025-11-02", fy: "2025-26", ...MEERA })]);

test("several sales have the number and the purchases couldn't be checked: the sales are offered, with a line saying so; Try again asks v2 again", async () => {
  let down = true;
  let answerNow = () => {};
  const { calls } = salesServer([["GET", "sales/", TWO_SALES], ["GET", "invoices/", () => (down ? refuse(500, {})
    : new Promise((resolve) => { answerNow = () => resolve(page([INWARD(77, { invoice_number: "KGH-31" })])); }))]]);
  mount("/sales/KGH-31");
  const list = await screen.findByRole("list", { name: "Bills with this number" });
  expect(within(list).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/sales/512", "/sales/613"]);
  expect(screen.getByText("The app couldn't check purchases just now, so this list has only the sales with this number.")).toBeInTheDocument();
  expect(screen.queryByText("Couldn't load this bill")).not.toBeInTheDocument();
  down = false;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  // while the purchases are asked again the sales stay on offer, the line with them, its Try again busy (Review fix 1)
  await waitFor(() => expect(calls.filter((c) => c.url === "invoices/")).toHaveLength(2));
  expect(within(screen.getByRole("list", { name: "Bills with this number" })).getAllByRole("link")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Try again" })).toHaveAttribute("aria-busy", "true");
  await act(async () => { answerNow(); });
  // the purchase joins the sales, each row saying which it is, and the line goes
  expect(await screen.findByRole("link", { name: /^KGH-31 Purchase KIRAN GOLD HOUSE \(SANDBOX\) · 02 May 2026 · Shree Bullion/ })).toHaveAttribute("href", "/purchases/77");
  expect(within(screen.getByRole("list", { name: "Bills with this number" })).getAllByRole("link")).toHaveLength(3);
  expect(screen.queryByText(/couldn't check purchases/)).not.toBeInTheDocument();
  expect(calls.filter((c) => c.url === "invoices/")).toHaveLength(2);
});

test("several sales have the number and over 1,000 purchases have numbers like it: the sales are offered, with a line saying so", async () => {
  salesServer([["GET", "sales/", TWO_SALES], ["GET", "invoices/", () => ({ count: 1500, next: "page 2", previous: null, results: [] })]]);
  mount("/sales/KGH-31");
  const list = await screen.findByRole("list", { name: "Bills with this number" });
  expect(within(list).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/sales/512", "/sales/613"]);
  expect(screen.getByText("Over 1,000 purchases have numbers like “KGH-31”, too many to check here, so this list has only the sales with this number.")).toBeInTheDocument();
  expect(screen.queryByText("Too many bills to check")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
});

test("several sales and the purchases unknown: a failed refresh of the sales says so above the line, and the sales stay; a cancelled one says so", async () => {
  let salesDown = false;
  salesServer([
    ["GET", "sales/", () => (salesDown ? refuse(500, {}) : wirePage([wireRow({ id: 512, invoice_number: "KGH-31", ...KIRAN }), wireRow({ id: 613, invoice_number: "KGH-31", invoice_date: "2025-11-02", fy: "2025-26", status: "cancelled", ...MEERA })]))],
    ["GET", "invoices/", () => refuse(500, {})],
  ]);
  renderApp(<><Grab /><Routes><Route path="/sales/:id" element={<BillPage />} /></Routes></>, { path: "/sales/KGH-31" });
  const list = await screen.findByRole("list", { name: "Bills with this number" });
  expect(within(list).getByRole("link", { name: /^KGH-31 MEERA ORNAMENTS \(SANDBOX\) · 02 Nov 2025 · Anil Gupta · cancelled/ })).toHaveAttribute("href", "/sales/613");
  salesDown = true;
  await act(async () => { await cache.invalidateQueries({ queryKey: salesKeys.page("all", { number: "KGH-31" }, 20) }); });
  const stale = await screen.findByText("Couldn't refresh the bills with this number");
  const line = screen.getByText("The app couldn't check purchases just now, so this list has only the sales with this number.");
  expect(stale.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(screen.getByRole("list", { name: "Bills with this number" })).getAllByRole("link")).toHaveLength(2);
});

/* ── 1B Task 12, commit A: a failed purchase lookup still in the cache ── */

test("a purchase lookup that failed on an earlier visit is asked again before the one sale with the number opens, and a purchase found then is offered beside it", async () => {
  let n = 0;
  let answerNow = () => {};
  const { calls } = salesServer([
    ["GET", "sales/", () => wirePage([wireRow({ id: 512, invoice_number: "KGH-31", ...KIRAN })])],
    ["GET", "sales/512/", () => wireDetail({ id: 512, invoice_number: "KGH-31" })],
    // the first lookup fails; the next finds a purchase with the number too, once the test lets it answer
    ["GET", "invoices/", () => (++n === 1 ? refuse(500, {}) : new Promise((resolve) => { answerNow = () => resolve(page([INWARD(77, { invoice_number: "KGH-31" })])); }))],
  ]);
  const router = createMemoryRouter([
    { path: "/sales/:id", element: <BillPage /> },
    { path: "/purchases/:id", element: <p>A purchase</p> },
  ], { initialEntries: ["/sales/KGH-31"] });
  render(
    <QueryClientProvider client={testQueryClient()}><AuthContext.Provider value={stubAuth()}><RoleContext.Provider value="owner">
      <ToastProvider><RouterProvider router={router} /></ToastProvider>
    </RoleContext.Provider></AuthContext.Provider></QueryClientProvider>,
  );
  // the first visit: the purchases can't be checked, so the one sale with the number opens
  await waitFor(() => expect(router.state.location.pathname).toBe("/sales/512"));
  // the link is followed again while the failed lookup is still kept: the purchases are asked again before anything opens
  await act(async () => { await router.navigate("/sales/KGH-31"); });
  await waitFor(() => expect(calls.filter((c) => c.url === "invoices/")).toHaveLength(2));
  expect(router.state.location.pathname).toBe("/sales/KGH-31");
  await act(async () => { answerNow(); });
  // a purchase has the number too: both are offered, each row saying which it is
  const list = await screen.findByRole("list", { name: "Bills with this number" });
  expect(within(list).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/sales/512", "/purchases/77"]);
  expect(router.state.location.pathname).toBe("/sales/KGH-31");
});
