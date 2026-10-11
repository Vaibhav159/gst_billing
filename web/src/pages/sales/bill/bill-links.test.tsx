import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onlineManager, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Route, Routes, useLocation } from "react-router";
import { __setNetState } from "@/core/api/network";
import { refuse, salesServer, wirePage, wireRow } from "@/core/sales/fixtures";
import { renderApp } from "@/test/render";
import BillPage from "../BillPage";
import V2NumberLink from "../V2NumberLink";

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
  expect(calls.find((c) => c.url === "invoices/")?.params).toEqual({ invoice_number: "UBS-0850", type_of_invoice: "inward", business_id: 3, page_size: 20 });
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
  expect(calls.filter((c) => c.url === "sales/")).toHaveLength(2);
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
