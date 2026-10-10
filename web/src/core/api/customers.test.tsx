import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { serve, type Call, type Reply } from "@/test/server";
import {
  customerKeys, customerListParams, customerSaveErrors, deleteRefusal, fetchAllCustomers, searchTerm, toCustomer, toCustomerPage, toStatement, useCustomer,
  useCustomerCount, useCustomerList, useCustomerSearch, useDeleteCustomer, useItaxBills, useRecentCustomers, useSaveCustomer, useStatement, useWalkin,
  type CustomerListFilters,
} from "./customers";

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { qc, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> };
}
const ANIL = { id: 7, name: "Anil Gupta", address: "15 Demo Road", gst_number: "", businesses: [3], pan_number: null, mobile_number: "9829041122", email: null, state_name: "RAJASTHAN", created_at: "2025-08-04T11:00:00+05:30", customer_type: "", city: "Udaipur", type: "person", pan: "" };
const FILTERS: CustomerListFilters = { firmId: 3, from: "2026-04-01", to: "2026-10-08", q: "", gst: "any", state: "", usualFirm: null, sort: "recent" };
/** A page of customers/ as the server answers it (contract §0.3). */
const page = (results: unknown[], next: string | null = null) => ({ count: results.length, next, previous: null, results });

afterEach(() => { vi.restoreAllMocks(); });

test("a customer reads the same whatever the server left out: the type and PAN are worked out as the server does", () => {
  expect(toCustomer(ANIL)).toMatchObject({ id: 7, pan_number: "", email: "", type: "person", businesses: [3] });
  const older = toCustomer({ id: 9, name: "Kulkarni Jewellers", gst_number: "27xtzps7585p1zb" });
  expect(older).toMatchObject({ gst_number: "27XTZPS7585P1ZB", type: "business", pan: "XTZPS7585P", customer_type: "", businesses: [] });
  expect(toCustomer({ id: 1, name: "Walk-in Customer", customer_type: "walkin" }).type).toBe("walkin");
  // a PAN v2 kept as it was typed
  expect(toCustomer({ id: 11, name: "Mahesh Soni", pan_number: "abcde1234f" })).toMatchObject({ pan_number: "ABCDE1234F", pan: "ABCDE1234F", type: "person" });
});

test("the list asks for this year's figures in the firm picked, 20 at a time, and money comes back in paise", async () => {
  expect(customerListParams({ ...FILTERS, q: "98290 41122", gst: "no", state: "RAJASTHAN", usualFirm: 4, sort: "sales" })).toEqual({
    figures: 1, page_size: 20, start_date: "2026-04-01", end_date: "2026-10-08", ordering: "-sales", figures_business_id: 3,
    search: "9829041122", has_gstin: 0, state_name: "RAJASTHAN", business_id: 4,
  });
  const calls = serve({
    "GET customers/": (c: Call) => ({ status: 200, data: {
      count: 21, next: c.params.page === 1 ? "next" : null,
      results: [{ ...ANIL, id: Number(c.params.page) * 100, figures: { bills: 14, total: "87083.21", cancelled: 1, udhaar_bills: 2, udhaar_total: "1000.50", last_bill: { id: 412, invoice_number: "KGH/2026-27/31", invoice_date: "2026-10-08", total_amount: "87083.21", business: 3 } } }],
      summary: { customers: 21, bills: 30, total: "100.00", cancelled: 1, udhaar_bills: 2, udhaar_total: "1000.50" },
    } }),
  });
  const { wrapper: w } = wrapper();
  const { result } = renderHook(() => useCustomerList(FILTERS), { wrapper: w });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  const first = result.current.data!.pages[0];
  expect(first.rows[0].figures).toMatchObject({ total: 8708321, udhaar_total: 100050, last_bill: { total_amount: 8708321, invoice_number: "KGH/2026-27/31" } });
  expect(first.summary).toMatchObject({ customers: 21, total: 10000 });
  await act(async () => { await result.current.fetchNextPage(); });
  expect(calls.map((c) => c.params.page)).toEqual([1, 2]);
  expect(calls[0].params).toMatchObject({ figures: 1, figures_business_id: 3, ordering: "-last_bill" });
});

test("the list waits for the firm to be known: nothing is asked while firmId is null, then it asks for that firm", async () => {
  const calls = serve({ "GET customers/": page([ANIL]) });
  const { wrapper: w } = wrapper();
  const firmNotKnown: CustomerListFilters = { ...FILTERS, firmId: null };
  const { result, rerender } = renderHook((f: CustomerListFilters) => useCustomerList(f), { wrapper: w, initialProps: firmNotKnown });
  // a list that's going to ask is "fetching" from its first render; this one isn't
  expect(result.current.fetchStatus).toBe("idle");
  rerender(FILTERS);
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(calls.map((c) => c.params.figures_business_id)).toEqual([3]);
});

test("a query that can't ask yet (no firm or customer known) has a key of its own and asks nothing, even on Try again", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {}); // TanStack's note that a query with nothing to ask was told to fetch
  const calls = serve({ "GET customers/": page([ANIL]), "GET customers/7/statement/": {}, "GET customers/null/": ANIL, "GET sales/": page([]) });
  const { qc, wrapper: w } = wrapper();
  // every firm's answers are in the cache already: a query that isn't ready must not show them as its own
  qc.setQueryData(customerKeys.list(customerListParams({ ...FILTERS, firmId: "all" })), { pages: [toCustomerPage(page([ANIL]))], pageParams: [1] });
  qc.setQueryData(customerKeys.recent("all"), [{ ...toCustomer(ANIL), figures: null }]);
  qc.setQueryData(customerKeys.statement(7, {}), toStatement({}));
  const list = renderHook(() => useCustomerList({ ...FILTERS, firmId: null }), { wrapper: w });
  const recent = renderHook(() => useRecentCustomers(null), { wrapper: w });
  const statement = renderHook(() => useStatement(7, null), { wrapper: w });
  // nor do a customer and their income-tax flags before there's a customer
  const one = renderHook(() => useCustomer(null), { wrapper: w });
  const itax = renderHook(() => useItaxBills(null), { wrapper: w });
  expect([list.result.current.data, recent.result.current.data, statement.result.current.data]).toEqual([undefined, undefined, undefined]);
  await act(async () => { await Promise.all([list, recent, statement, one, itax].map((h) => h.result.current.refetch())); });
  expect(calls).toEqual([]);
});

test("a new search keeps the rows on screen until its answer comes", async () => {
  let answer = (_r: Reply) => {};
  const calls = serve({ "GET customers/": (c: Call) => (c.params.search ? new Promise<Reply>((r) => { answer = r; }) : { status: 200, data: page([ANIL]) }) });
  const { wrapper: w } = wrapper();
  const { result, rerender } = renderHook((f: CustomerListFilters) => useCustomerList(f), { wrapper: w, initialProps: FILTERS });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  rerender({ ...FILTERS, q: "rekha" });
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(result.current.isPlaceholderData).toBe(true);
  expect(result.current.data!.pages[0].rows.map((r) => r.name)).toEqual(["Anil Gupta"]);
  answer({ status: 200, data: page([{ ...ANIL, id: 30, name: "Rekha Soni" }]) });
  await waitFor(() => expect(result.current.isPlaceholderData).toBe(false));
  expect(result.current.data!.pages[0].rows.map((r) => r.name)).toEqual(["Rekha Soni"]);
});

test("a new firm or year never shows the last one's money while its own figures load", async () => {
  // firm 3's figures for this year answer; every other ask is held
  serve({ "GET customers/": (c: Call) => (c.params.figures_business_id === 3 && c.params.end_date === FILTERS.to ? { status: 200, data: page([ANIL]) } : new Promise<Reply>(() => {})) });
  const { wrapper: w } = wrapper();
  const { result, rerender } = renderHook((f: CustomerListFilters) => useCustomerList(f), { wrapper: w, initialProps: FILTERS });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  const others: CustomerListFilters[] = [{ ...FILTERS, firmId: 4 }, { ...FILTERS, firmId: "all" }, { ...FILTERS, from: "2025-04-01", to: "2026-03-31" }, { ...FILTERS, to: "2026-09-30" }];
  for (const other of others) {
    rerender(other);
    expect(result.current.data, JSON.stringify(other)).toBeUndefined();
    rerender(FILTERS);
    expect(result.current.data!.pages[0].rows.map((r) => r.name)).toEqual(["Anil Gupta"]);
  }
});

test("a statement is asked for its period and firm, with money in paise; null params ask nothing", async () => {
  const calls = serve({
    "GET customers/7/statement/": {
      customer: { id: 7, name: "Anil Gupta", type: "person", mobile_number: "9829041122", gst_number: "", pan: "", city: "Udaipur", state_name: "RAJASTHAN" },
      start_date: "2026-04-01", end_date: "2026-10-08", business: null,
      bills: [{ id: 412, business: 3, business_name: "KIRAN GOLD HOUSE", invoice_number: "KGH/2026-27/31", invoice_date: "2026-10-08", payment_mode: "credit", taxable: "84546.81", tax: "2536.40", total_amount: "87083.21", status: "active", cancel_reason: "", paid: "udhaar", itax: [] }],
      totals: { bills: 1, billed: "87083.21", taxable: "84546.81", tax: "2536.40", cancelled: 0, paid_at_billing: { bills: 0, total: "0.00" }, udhaar: { bills: 1, total: "87083.21" }, not_recorded: { bills: 0, total: "0.00" } },
      months: [{ month: "2026-10", bills: 1, total: "87083.21" }],
    },
  });
  const { wrapper: w } = wrapper();
  const { result } = renderHook(() => useStatement(7, { start_date: "2026-04-01", end_date: "2026-10-08" }), { wrapper: w });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(calls[0].params).toEqual({ start_date: "2026-04-01", end_date: "2026-10-08" });
  expect(result.current.data!.bills[0]).toMatchObject({ total_amount: 8708321, paid: "udhaar", status: "active" });
  expect(result.current.data!.totals.udhaar).toEqual({ bills: 1, total: 8708321 });
  const none = renderHook(() => useStatement(7, null), { wrapper: w });
  expect(none.result.current.fetchStatus).toBe("idle");
});

test("the income-tax flags come from the bills list: this customer's flagged bills, every firm and year", async () => {
  const calls = serve({ "GET sales/": { count: 1, next: null, results: [{ id: 388, invoice_number: "KGH/2026-27/18", invoice_date: "2026-09-10", total_amount: "265740.48", itax: [{ kind: "pan", short: "PAN missing", text: "A bill over ₹2,00,000 needs the buyer's PAN (Rule 114B). Add Anil Gupta's PAN." }] }] } });
  const { wrapper: w } = wrapper();
  const { result } = renderHook(() => useItaxBills(7), { wrapper: w });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(calls[0].params).toEqual({ customer_id: 7, itax: 1, ordering: "-date", page_size: 200 });
  expect(result.current.data).toEqual([{ id: 388, invoice_number: "KGH/2026-27/18", invoice_date: "2026-09-10", total_amount: 26574048, itax: [expect.objectContaining({ kind: "pan" })] }]);
});

test("search asks from 2 characters, a phone typed in groups as its digits, with each customer's last bill in any firm", async () => {
  const calls = serve({ "GET customers/": page([{ ...ANIL, figures: { bills: 14, total: "87083.21", cancelled: 0, udhaar_bills: 0, udhaar_total: "0.00", last_bill: null } }]) });
  const { wrapper: w } = wrapper();
  expect(renderHook(() => useCustomerSearch(" 9 "), { wrapper: w }).result.current.fetchStatus).toBe("idle");
  expect(renderHook(() => useCustomerSearch("Anil", { enabled: false }), { wrapper: w }).result.current.fetchStatus).toBe("idle");
  const { result } = renderHook(() => useCustomerSearch("+91 98290 41122", { size: 5 }), { wrapper: w });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  // one request: the two above, still showing, never asked
  expect(calls.map((c) => c.params)).toEqual([{ search: "9829041122", figures: 1, page_size: 5 }]);
  expect(result.current.data).toMatchObject([{ id: 7, name: "Anil Gupta", figures: { total: 8708321 } }]);
});

test("recent customers are the five the firm billed last, never the walk-in; the walk-in record is the one marked walkin, else none", async () => {
  const WALKIN = { ...ANIL, id: 1, name: "Walk-in Customer", customer_type: "walkin", type: "walkin" };
  const billed = (id: number, last = true) => ({
    ...ANIL, id, name: `Customer ${id}`,
    figures: { bills: 1, total: "500.00", cancelled: 0, udhaar_bills: 0, udhaar_total: "0.00", last_bill: last ? { id: 400 + id, invoice_number: `KGH/2026-27/${id}`, invoice_date: "2026-10-01", total_amount: "500.00", business: 3 } : null },
  });
  // the walk-in has bills too; customer 3 has none in this firm
  const calls = serve({ "GET customers/": (c: Call) => ({ status: 200, data: page(c.params.type === "walkin" ? [WALKIN] : [{ ...billed(1), ...WALKIN }, billed(2), billed(3, false), billed(4), billed(5), billed(6), billed(7), billed(8)]) }) });
  const { wrapper: w } = wrapper();
  expect(renderHook(() => useRecentCustomers(null), { wrapper: w }).result.current.fetchStatus).toBe("idle");
  const recent = renderHook(() => useRecentCustomers(3), { wrapper: w });
  await waitFor(() => expect(recent.result.current.isSuccess).toBe(true));
  expect(calls[0].params).toEqual({ figures: 1, ordering: "-last_bill", page_size: 6, figures_business_id: 3 });
  expect(recent.result.current.data!.map((r) => r.id)).toEqual([2, 4, 5, 6, 7]);
  const walkin = renderHook(() => useWalkin(), { wrapper: w });
  await waitFor(() => expect(walkin.result.current.isSuccess).toBe(true));
  expect(calls[1].params).toEqual({ type: "walkin", page_size: 1 });
  expect(walkin.result.current.data).toMatchObject({ id: 1, name: "Walk-in Customer", type: "walkin" });
  // a server that doesn't know type=walkin answers with its first customer, who isn't the walk-in record
  serve({ "GET customers/": page([ANIL]) });
  const none = renderHook(() => useWalkin(), { wrapper: wrapper().wrapper });
  await waitFor(() => expect(none.result.current.isSuccess).toBe(true));
  expect(none.result.current.data).toBeNull();
});

test("the count asks for one row; an export reads every page the filters match, a thousand at a time", async () => {
  const calls = serve({ "GET customers/": (c: Call) => ({ status: 200, data: c.params.page_size === 1 ? { ...page([ANIL], "next"), count: 29 } : page([{ ...ANIL, id: Number(c.params.page) }], c.params.page === 1 ? "next" : null) }) });
  const { wrapper: w } = wrapper();
  const count = renderHook(() => useCustomerCount(), { wrapper: w });
  await waitFor(() => expect(count.result.current.data).toBe(29));
  const rows = await fetchAllCustomers(customerListParams(FILTERS));
  expect(rows.map((r) => r.id)).toEqual([1, 2]);
  expect(calls.map((c) => [c.params.page, c.params.page_size, c.params.figures_business_id])).toEqual([[undefined, 1, undefined], [1, 1000, 3], [2, 1000, 3]]);
});

test("saving posts a new customer and patches an old one, keeps the answer, and refreshes the lists, the bills and search", async () => {
  const calls = serve({ "POST customers/": { ...ANIL, id: 30, name: "Rekha Soni" }, "PATCH customers/7/": { ...ANIL, pan_number: "ABCDE1234F", pan: "ABCDE1234F" } });
  const { qc, wrapper: w } = wrapper();
  const spy = vi.spyOn(qc, "invalidateQueries");
  const { result } = renderHook(() => useSaveCustomer(), { wrapper: w });
  await act(async () => { await result.current.mutateAsync({ body: { name: "Rekha Soni", mobile_number: "9876543210" } }); });
  await act(async () => { await result.current.mutateAsync({ id: 7, body: { pan_number: "ABCDE1234F" } }); });
  expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST customers/", "PATCH customers/7/"]);
  expect(calls[1].data).toEqual({ pan_number: "ABCDE1234F" });
  expect(qc.getQueryData(["customers", "one", 7])).toMatchObject({ pan: "ABCDE1234F" });
  const predicate = spy.mock.calls[1][0]!.predicate!;
  const q = (key: unknown[]) => ({ queryKey: key }) as never;
  // Ctrl K's search ("search", term) shows customers too
  expect([predicate(q(["sales", "list"])), predicate(q(["customers", "list", {}])), predicate(q(["search", "anil"])), predicate(q(["customers", "one", 7])), predicate(q(["prefs", 1]))])
    .toEqual([true, true, true, false, false]);
});

test("a delete refreshes the lists and search; the customer's own entries are marked stale, not asked for again", async () => {
  const calls = serve({ "GET customers/7/": ANIL, "DELETE customers/7/": "" });
  const { qc, wrapper: w } = wrapper();
  // the page being left still shows the customer until it has gone
  const shown = renderHook(() => useCustomer(7), { wrapper: w });
  await waitFor(() => expect(shown.result.current.isSuccess).toBe(true));
  qc.setQueryData(customerKeys.statement(7, {}), toStatement({}));
  qc.setQueryData(customerKeys.one(8), toCustomer({ ...ANIL, id: 8, name: "Meena Jain" }));
  qc.setQueryData(customerKeys.search("anil", 8), [{ ...toCustomer(ANIL), figures: null }]);
  qc.setQueryData(customerKeys.count(), 29);
  qc.setQueryData(["search", "anil"], { customers: [] });
  const spy = vi.spyOn(qc, "invalidateQueries");
  const { result } = renderHook(() => useDeleteCustomer(), { wrapper: w });
  // the delete, and every refresh it starts
  await act(async () => { await result.current.mutateAsync(7); await Promise.all(spy.mock.results.map((r) => r.value)); });
  expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["GET customers/7/", "DELETE customers/7/"]);
  const keys = [customerKeys.search("anil", 8), customerKeys.count(), ["search", "anil"], customerKeys.one(7), customerKeys.statement(7, {}), customerKeys.one(8)];
  expect(keys.map((k) => qc.getQueryState(k)?.isInvalidated)).toEqual([true, true, true, true, true, false]);
});

test("a customer page can show a name it already has from a list while the customer loads", async () => {
  let answer = (_r: Reply) => {};
  // Anil's own answer comes only when the test gives it; Rekha's never comes
  const calls = serve({ "GET customers/7/": () => new Promise<Reply>((r) => { answer = r; }), "GET customers/12/": () => new Promise<Reply>(() => {}) });
  const { qc, wrapper: w } = wrapper();
  qc.setQueryData(["customers", "search", "anil", 8], [{ ...toCustomer(ANIL), figures: null }]);
  qc.setQueryData(["customers", "list", {}], { pages: [{ count: 1, next: null, rows: [{ ...toCustomer({ id: 12, name: "Rekha Soni" }), figures: null }], summary: null }], pageParams: [1] });
  const anil = renderHook(() => useCustomer(7), { wrapper: w });
  const rekha = renderHook(() => useCustomer(12), { wrapper: w });
  await waitFor(() => expect(calls.map((c) => c.url).sort()).toEqual(["customers/12/", "customers/7/"]));
  expect(anil.result.current.data?.name).toBe("Anil Gupta");
  expect(anil.result.current.isPlaceholderData).toBe(true);
  expect(rekha.result.current.data?.name).toBe("Rekha Soni");
  expect(rekha.result.current.isPlaceholderData).toBe(true);
  answer({ status: 200, data: { ...ANIL, pan_number: "ABCDE1234F", pan: "ABCDE1234F" } });
  await waitFor(() => expect(anil.result.current.isPlaceholderData).toBe(false));
  expect(anil.result.current.data).toMatchObject({ name: "Anil Gupta", pan_number: "ABCDE1234F" });
});

test("refusals read as the form's fields; a taken name and a customer with bills in the app's words", () => {
  const refuse = (status: number, data: unknown) => new AxiosError("refused", "ERR_BAD_REQUEST", undefined, null, { status, statusText: "", headers: {}, config: {} as InternalAxiosRequestConfig, data });
  const r = customerSaveErrors(refuse(400, { name: ["customer with this Customer Name already exists."], pan_number: ["A PAN has 10 characters: 5 letters, 4 digits, then a letter (like ABCDE1234F)."], mobile_number: ["Ensure this field has no more than 12 characters."] }), "Mahesh Soni");
  expect(r.problem.kind).toBe("validation");
  expect(r.fields).toEqual({
    name: "There's already a customer called Mahesh Soni. Add the area or the father's name to tell them apart.",
    pan: "A PAN has 10 characters: 5 letters, 4 digits, then a letter (like ABCDE1234F).", phone: "Ensure this field has no more than 12 characters.",
  });
  expect(deleteRefusal(refuse(409, { error: "Cannot delete: 3 invoice(s) still reference this record.", protected: 3 }))).toBe("Has 3 bills. Merge it into the right customer instead.");
  const noReply = new AxiosError("Network Error", "ERR_NETWORK");
  expect(deleteRefusal(noReply)).toBe("Not deleted: the app couldn't get through. Nothing was changed; try again in a minute.");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  expect(deleteRefusal(noReply)).toBe("Not deleted: you're offline. Nothing was changed; try again when the internet is back.");
});

test("search asks for a phone number as its 10 digits, whatever is typed in front of it; part of a number as typed", () => {
  expect(["+91 98290 41122", "098290 41122", "91 98290 41122", "98290-41122", "+91 98290", "0982", "91 982", "Anil"].map(searchTerm))
    .toEqual(["9829041122", "9829041122", "9829041122", "9829041122", "98290", "0982", "91982", "Anil"]);
});
