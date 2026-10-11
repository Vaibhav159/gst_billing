// Tests only (not *.test.tsx, so vitest doesn't run it, and nothing in the app imports it): the bill form in a data
// router with the app's providers and the firm scope, and a fake server answering everything the form asks, the
// contract's way. Today is 08 Oct 2026, as in the prototype's sample data.
import { act, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { createMemoryRouter, Outlet, RouterProvider, useLocation, type RouteObject } from "react-router";
import { invalidateSales } from "@/core/api/sales";
import { AuthContext, type Me } from "@/core/auth/AuthProvider";
import { RoleContext } from "@/core/auth/role";
import { salesServer, wireDetail, wireFacets, wirePage, type Call, type Route } from "@/core/sales/fixtures";
import { ScopeProvider } from "@/core/scope";
import { ToastProvider } from "@/core/ui";
import { stubAuth, testQueryClient } from "@/test/render";
import NewBillPage from "./BillFormPage";
import EditBillPage from "./EditBillPage";

export const TODAY = "2026-10-08";
/**
 * Fakes the clock (timers and Date) at 08 Oct 2026, 10:00 in India; the clock still moves with real time. Returns a
 * userEvent that moves it too. intervals: setInterval too, where a test holds a query to never asking on a timer
 * (TanStack's refetchInterval runs on it).
 */
export function fakeToday({ intervals = false }: { intervals?: boolean } = {}) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", ...(intervals ? (["setInterval", "clearInterval"] as const) : [])], shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-10-08T10:00:00+05:30"));
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}
/**
 * Lets what's on its way land (answers, the cache telling the page, a dialog's focus): a little faked time, inside act,
 * twice, since what one answer draws can ask for more.
 */
export async function settle() {
  for (let i = 0; i < 2; i += 1) await act(async () => { await vi.advanceTimersByTimeAsync(50); });
}
/** Whether closing the tab now would ask (the browser's own prompt). */
export function asksOnClose(): boolean {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

const figures = (last: Record<string, unknown> | null) => ({ bills: last ? 1 : 0, total: last ? "87083.21" : "0.00", cancelled: 0, udhaar_bills: 0, udhaar_total: "0.00", last_bill: last });
export const ANIL = { id: 7, name: "Anil Gupta", address: "15 Demo Road", city: "Udaipur", state_name: "RAJASTHAN", gst_number: "", pan_number: "", mobile_number: "9829041122", email: "", businesses: [3], created_at: "", customer_type: "person", type: "person", pan: "" };
export const RAMESH = { ...ANIL, id: 8, name: "Ramesh Patel", address: "", city: "Ahmedabad", state_name: "GUJARAT", mobile_number: "9898012345" };
export const WALKIN = { ...ANIL, id: 1, name: "Walk-in Customer", address: "", city: "", mobile_number: "", customer_type: "walkin", type: "walkin" };
const LAST = { id: 412, invoice_number: "KGH/2026-27/31", invoice_date: "2026-10-08", total_amount: "87083.21", business: 3 };
export const RING = { id: 5, name: "Gold Ring 22K", hsn_code: "711319", gst_tax_rate: "0.0300", default_unit: "gms", description: "", usage_count: 9 };
export const NECKLACE = { id: 6, name: "Gold Necklace 22K", hsn_code: "711319", gst_tax_rate: "0.0300", default_unit: "gms", description: "", usage_count: 4 };
export const DIAMOND = { id: 9, name: "Cut Diamond", hsn_code: "710239", gst_tax_rate: "0.0025", default_unit: "ct", description: "", usage_count: 1 };

/** A bill's lines (a BillDetail's): 40 g of a 22K necklace at ₹6,500, ₹2,67,800.00 with GST, over the income-tax limits. */
export const BIG = [{ id: 1, product_name: "Gold Necklace 22K", hsn_code: "711319", quantity: "40.000", unit: "gms", rate: "6500.000", gst_percent: "3", taxable: "260000.00", cgst: "3900.00", sgst: "3900.00", igst: "0.00", tax: "7800.00", amount: "267800.00", note: "" }];

/** KIRAN's paper book for September: 17 to 29 entered, 30 to 33 are October's, so the next is 34 on 30 Sep. */
export function wireBook(over: Record<string, unknown> = {}) {
  return {
    business: 3, month: "2026-09", fy: "2026-27",
    bills: [{ id: 388, invoice_number: "KGH/2026-27/29", counter: 29, invoice_date: "2026-09-29", customer_name: "Hemant Dave", total_amount: "45210.00", status: "active", paper: true, sent: false }],
    entered: 13, runs: [[17, 29]], missing: [], missing_count: 0, explained: [], twice: [], after: [30, 31, 32, 33], after_months: ["2026-10"],
    next: { counter: 34, invoice_number: "KGH/2026-27/34", invoice_date: "2026-09-29" }, locked: false, gstr1_due: "2026-10-11", ...over,
  };
}
/** The next number in a firm's series on a date: KIRAN uses full numbers, MEERA plain ones. */
export function wireNext(business: number, day: string, counter = business === 3 ? 34 : 9) {
  return { business, fy: "2026-27", invoice_date: day, counter, invoice_number: business === 3 ? `KGH/2026-27/${counter}` : String(counter), full_number: business === 3 };
}
// the fake server's own rule for what a typed number is stored as (the contract's §2.3), kept apart from the client's storedFor
const stored = (business: number, n: string) => (business === 3 && /^\d+$/.test(n) ? `KGH/2026-27/${Number(n)}` : n);

/** What the form asks, answered: `routes` first (they win), then the usual answers. */
export function formServer(routes: Route[] = []) {
  return salesServer([
    ...routes,
    ["GET", "products/", () => ({ count: 3, next: null, previous: null, results: [RING, NECKLACE, DIAMOND] })],
    ["GET", "customers/", ({ params }: Call) => {
      const search = String(params.search ?? "").toLowerCase();
      const rows = params.type === "walkin" ? [WALKIN] : params.ordering === "-last_bill" ? [{ ...ANIL, figures: figures(LAST) }]
        : [ANIL, RAMESH].filter((c) => c.name.toLowerCase().includes(search)).map((c) => ({ ...c, figures: figures(null) }));
      return { count: rows.length, next: null, previous: null, results: rows };
    }],
    ["GET", /^customers\/\d+\/$/, ({ url }: Call) => [ANIL, RAMESH, WALKIN].find((c) => url === `customers/${c.id}/`) ?? ANIL],
    ["GET", "sales/next-number/", ({ params }: Call) => wireNext(Number(params.business_id), String(params.invoice_date))],
    ["GET", "sales/check-number/", ({ params }: Call) => {
      const b = Number(params.business_id);
      const n = stored(b, String(params.invoice_number));
      const taken = n === "KGH/2026-27/31";
      return {
        invoice_number: n, counter: Number(n.match(/(\d+)$/)?.[1] ?? 0), code: taken ? "number_taken" : "", bill: null, binned: null, same_counter: null,
        problem: taken ? "KGH/2026-27/31 is already used in FY 2026-27 by Anil Gupta's bill of 08 Oct 2026. The next free number is KGH/2026-27/34." : "",
        note: n === "KGH/2026-27/40" ? "Numbers 34 to 39 would be skipped. GSTR-1 lists skipped numbers, so only do this on purpose." : "", next: { counter: 34, invoice_number: "KGH/2026-27/34" },
      };
    }],
    ["GET", "sales/paper-book/", ({ params }: Call) => (Number(params.business_id) === 2
      ? wireBook({ business: 2, month: params.month, bills: [], runs: [], entered: 0, after: [], after_months: [], next: { counter: 9, invoice_number: "9", invoice_date: "2026-09-26" } })
      : wireBook({ month: params.month }))],
    ["GET", "sales/", ({ params }: Call) => (params.facets ? { ...wirePage([]), facets: wireFacets() } : wirePage([]))],
    ["PUT", /^sales\/\d+\/$/, ({ url, body }: Call) => {
      const b = body as { business: number; invoice_number: string; invoice_date: string; payment_mode: string };
      return wireDetail({ id: Number(url.split("/")[1]), business: b.business, invoice_number: stored(b.business, b.invoice_number), invoice_date: b.invoice_date, payment_mode: b.payment_mode });
    }],
    ["POST", "sales/", ({ body }: Call) => {
      const b = body as { business: number; invoice_number: string; invoice_date: string; paper?: boolean };
      return wireDetail({ id: 501, business: b.business, invoice_number: stored(b.business, b.invoice_number), invoice_date: b.invoice_date, paper: Boolean(b.paper) });
    }],
  ]);
}

/**
 * Somewhere else in the app where a bill is saved (a route a test adds): its button tells every bill query to ask
 * again, as a save does (invalidateSales).
 */
export function SavedElsewhere() {
  const qc = useQueryClient();
  return <button type="button" onClick={() => invalidateSales(qc)}>Save a bill</button>;
}

/** Where the app is: shown by the stand-in pages beside the form. */
function Where({ name }: { name: string }) {
  const l = useLocation();
  return <p data-testid="where">{`${name} at ${l.pathname}${l.search}`}</p>;
}

/**
 * The bill form's routes in a data router (its leave-guard needs one), with the bill page, the paper book and Sales stood
 * in. client: the cache, for a test to change an answer while a page is open.
 */
export function mountForm(path: string, { me, routes = [] }: { me?: Partial<Me>; routes?: RouteObject[] } = {}) {
  const auth = stubAuth(me);
  const router = createMemoryRouter([{
    element: <ToastProvider><ScopeProvider><Outlet /></ScopeProvider></ToastProvider>,
    children: [
      // the form's own routes, as the app has them (core/router/routes.tsx)
      { path: "/sales/new", element: <NewBillPage />, handle: { hideNav: true } },
      { path: "/sales/:id/edit", element: <EditBillPage />, handle: { hideNav: true } },
      ...routes,
      { path: "/sales/:id", element: <Where name="bill page" /> },
      { path: "/sales/paper", element: <Where name="paper book" /> },
      { path: "/sales", element: <Where name="Sales" /> },
    ],
  }], { initialEntries: [path] });
  // the app's own query defaults (part 0's testQueryClient): no retries, and a save fails at once offline
  const client = testQueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}><RoleContext.Provider value={auth.me?.role ?? null}><RouterProvider router={router} /></RoleContext.Provider></AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { router, client, ...view };
}
export const STAFF: Partial<Me> = { role: "staff", roleLabel: "Counter staff", permissions: ["view", "bill.create", "bill.send", "customer.edit"] };
export const ACCOUNTANT: Partial<Me> = { role: "accountant", roleLabel: "Accountant", permissions: ["view", "reports.export", "customer.edit"] };
