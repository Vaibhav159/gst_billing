import type { ReactNode } from "react";
import { act, renderHook, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { toCustomer } from "@/core/api/customers";
import { useKeepDraft, useUnfinishedBills } from "@/core/api/drafts";
import { __setNetState } from "@/core/api/network";
import { AuthContext } from "@/core/auth/AuthProvider";
import { __resetDeviceDrafts, keepOnDevice, keptDraft } from "@/core/deviceDrafts";
import { refuse, wireDetail } from "@/core/sales/fixtures";
import { toBillDetail } from "@/core/sales/wire";
import { ToastProvider } from "@/core/ui";
import { stubAuth, testQueryClient } from "@/test/render";
import { LINE_COLS } from "./lines";
import { startCopy, startEdit, startNew, startRemake, toDraftData, type Start } from "./model";
import { useBillForm } from "./useBillForm";
import { ACCOUNTANT, ANIL, formServer, fakeToday, mountForm, RING, STAFF, TODAY } from "./testing";

// whole flows through the form, a step at a time: a busy runner takes longer than vitest's 5 s for one
vi.setConfig({ testTimeout: 20_000 });

beforeEach(() => { localStorage.clear(); __resetDeviceDrafts(); });
afterEach(() => { vi.useRealTimers(); act(() => __setNetState("online")); });
/** Past a debounce (the number's check, the customer search) at once. */
const settle = () => act(async () => { vi.advanceTimersByTime(400); });
const summary = () => screen.getByRole("complementary", { name: "Bill summary" });

test("a counter bill by keyboard: the customer box has the first keys, Enter picks, then product, weight and rate; the bill adds up to the paisa", async () => {
  const user = fakeToday();
  formServer();
  mountForm("/sales/new");
  const customer = await screen.findByRole("combobox", { name: /Customer/ });
  expect(screen.getByRole("heading", { level: 1, name: "New sales bill" })).toBeInTheDocument();
  await waitFor(() => expect(customer).toHaveFocus());
  await user.keyboard("Anil");
  await settle();
  await screen.findByRole("option", { name: /^Anil Gupta/ });
  await user.keyboard("{Enter}");
  const product = screen.getByRole("combobox", { name: "Line 1 product" });
  expect(product).toHaveFocus();
  await user.keyboard("ring");
  await user.keyboard("{Enter}");
  expect(screen.getByRole("textbox", { name: "Line 1 weight in grams" })).toHaveFocus();
  await user.keyboard("4.5{Enter}");
  expect(screen.getByRole("textbox", { name: "Line 1 rate per gram" })).toHaveFocus();
  await user.keyboard("6500{Enter}");
  expect(screen.getByRole("combobox", { name: "Line 2 product" })).toHaveFocus();
  const row1 = product.closest("[data-line]") as HTMLElement;
  expect(row1).toHaveTextContent("HSN 711319 · GST 3%");
  expect(row1).toHaveTextContent("₹29,250.00+ GST 3% ₹877.50");
  const s = summary();
  expect(within(s).getByText("Taxable value").parentElement).toHaveTextContent("₹29,250.00");
  expect(within(s).getByText("CGST 1.5%").parentElement).toHaveTextContent("₹438.75");
  expect(within(s).getByText("SGST 1.5%").parentElement).toHaveTextContent("₹438.75");
  expect(within(s).getByText("Thirty Thousand One Hundred Twenty Seven Rupees and Fifty Paise Only")).toBeInTheDocument();
  expect(screen.getByLabelText("Bill number")).toHaveValue("34");
  expect(screen.getByText(/^Saved as KGH\/2026-27\/34\. Next free number for Kiran in FY 2026‑27/)).toBeInTheDocument();
  const checks = within(s).getByRole("list", { name: "Checks on this bill" });
  expect(checks).toHaveTextContent("Bill number KGH/2026-27/34 is free");
  expect(checks).toHaveTextContent("No GSTIN needed: Anil Gupta buys as a person (B2C)");
  expect(checks).toHaveTextContent("Local sale · CGST + SGST: sold at the counter in Rajasthan");
  expect(checks).toHaveTextContent("How it was paid: asked when you check and save");
});

test("Check and save with problems counts them, marks each under its field, and takes you to the first", async () => {
  const user = fakeToday();
  formServer();
  mountForm("/sales/new");
  const customer = await screen.findByRole("combobox", { name: /Customer/ });
  await waitFor(() => expect(customer).toHaveFocus());
  await user.click(screen.getByRole("textbox", { name: "Line 1 weight in grams" }));
  await user.keyboard("{Control>}s{/Control}");
  expect(within(summary()).getByRole("alert")).toHaveTextContent("2 things to fix before saving. Each is marked under its field.");
  expect(screen.getByText("Choose who this bill is for. Pick Walk-in customer for a counter sale.")).toBeInTheDocument();
  expect(screen.getByText("Add at least one item: pick a product, then type its weight.")).toBeInTheDocument();
  expect(customer).toHaveFocus();
});

test("a typed number is checked as you type: its shape at once, whether it's free once the server says; the next free one is a click back", async () => {
  const user = fakeToday();
  formServer();
  mountForm("/sales/new");
  const number = await screen.findByLabelText("Bill number");
  await waitFor(() => expect(number).toHaveValue("34"));
  await user.clear(number);
  await user.type(number, "A B");
  expect(screen.getByText("Use only letters, digits, \"-\" and \"/\" (GST rule 46). Spaces and other marks aren't allowed.")).toBeInTheDocument();
  await user.clear(number);
  await user.type(number, "31");
  await settle();
  expect(await screen.findByText("KGH/2026-27/31 is already used in FY 2026-27 by Anil Gupta's bill of 08 Oct 2026. The next free number is KGH/2026-27/34.")).toBeInTheDocument();
  await user.clear(number);
  await user.type(number, "40");
  await settle();
  expect(await screen.findByText("Saved as KGH/2026-27/40. Numbers 34 to 39 would be skipped. GSTR-1 lists skipped numbers, so only do this on purpose.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Use the next free one" }));
  expect(number).toHaveValue("34");
});

test("offline before the next number has come, the number box asks for the paper bill's own, and says why it's empty", async () => {
  const user = fakeToday();
  // the next number never answers: the device goes offline once everything else has
  formServer([["GET", "sales/next-number/", () => new Promise(() => {})]]);
  mountForm("/sales/new");
  const number = await screen.findByLabelText("Bill number");
  expect(screen.getByText("Looking up the next number…")).toBeInTheDocument();
  await settle();
  act(() => __setNetState("offline"));
  expect(screen.getByText("Type the number written on the paper bill. The app can't look up the next free number offline.")).toBeInTheDocument();
  expect(number).not.toHaveAttribute("aria-invalid");
  // nothing typed is no mistake yet; Check and save says what's missing
  await user.keyboard("{Control>}s{/Control}");
  expect(screen.getByText("Type the number written on the paper bill.")).toBeInTheDocument();
  expect(number).toHaveAttribute("aria-invalid", "true");
});

test("a filed month is refused by name, with the months that can take the bill; Today puts it back", async () => {
  const user = fakeToday();
  formServer();
  mountForm("/sales/new");
  const day = await screen.findByLabelText("Date");
  await user.clear(day);
  await user.type(day, "28 Aug");
  await user.tab();
  expect(await screen.findByText("August 2026 is filed and locked for KIRAN GOLD HOUSE, so no bill can go into it. Pick a date in September or October, or have the owner unlock August 2026 in GST returns first.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Today" }));
  expect(day).toHaveValue("08 Oct 2026");
  expect(screen.getByText("Thursday · goes into October 2026's GSTR-1")).toBeInTheDocument();
});

test("a counter sale is taxed where it's handed over; Delivered to another state makes it IGST there", async () => {
  const user = fakeToday();
  formServer();
  mountForm("/sales/new");
  const customer = await screen.findByRole("combobox", { name: /Customer/ });
  await waitFor(() => expect(customer).toHaveFocus());
  await user.keyboard("Ramesh");
  await settle();
  await screen.findByRole("option", { name: /^Ramesh Patel/ });
  await user.keyboard("{Enter}");
  expect(screen.getByText("Local sale · CGST + SGST")).toBeInTheDocument();
  expect(screen.getByText("sold at the counter in Rajasthan")).toBeInTheDocument();
  expect(screen.getByText("Handed over here, so CGST + SGST in Rajasthan, even for a buyer from Gujarat")).toBeInTheDocument();
  await user.click(screen.getByRole("switch", { name: "Delivered to another state" }));
  expect(screen.getByLabelText("Delivered to")).toHaveValue("24");
  expect(screen.getByText("Inter-state · IGST")).toBeInTheDocument();
  expect(screen.getByText("delivered to Gujarat")).toBeInTheDocument();
});

test("a line removed says so with Undo, which puts it back; Ctrl Enter adds a line and its product box takes the keys", async () => {
  const user = fakeToday();
  formServer();
  mountForm("/sales/new");
  await screen.findByRole("combobox", { name: /Customer/ });
  await user.click(screen.getByRole("combobox", { name: "Line 1 product" }));
  await user.keyboard("neck{Enter}");
  await user.keyboard("{Control>}{Enter}{/Control}");
  expect(screen.getByRole("combobox", { name: "Line 2 product" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Remove line 1, Gold Necklace 22K" }));
  // past the remove's own step that puts the cursor on the next line
  await settle();
  expect(screen.getByText("Removed Gold Necklace 22K")).toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "Line 2 product" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /^Undo/ }));
  expect(screen.getByRole("combobox", { name: "Line 1 product" })).toHaveValue("Gold Necklace 22K");
  // the toast that offered Undo has gone: the form has settled
  await settle();
});

test("a new customer is added without leaving the bill: typed in the customer box, saved in the sheet, picked, and the items are next", async () => {
  const user = fakeToday();
  const { calls } = formServer([["POST", "customers/", ({ body }) => ({ ...ANIL, ...(body as object), id: 31, address: "", city: "", mobile_number: "" })]]);
  mountForm("/sales/new");
  const customer = await screen.findByRole("combobox", { name: /Customer/ });
  await waitFor(() => expect(customer).toHaveFocus());
  await user.keyboard("Kamal Jain");
  await settle();
  await screen.findByRole("option", { name: /New customer “Kamal Jain”/ });
  await user.keyboard("{Enter}");
  const sheet = await screen.findByRole("dialog", { name: "New customer" });
  await settle();
  expect(within(sheet).getByLabelText(/Name on the bill/)).toHaveValue("Kamal Jain");
  // the cursor goes straight to the items: never back through the customer box, whose list would open on the way
  const passed = vi.fn();
  customer.addEventListener("focus", passed);
  await user.click(within(sheet).getByRole("button", { name: "Save and use on this bill" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "New customer" })).not.toBeInTheDocument());
  expect(calls.find((c) => c.method === "POST" && c.url === "customers/")?.body).toMatchObject({ name: "Kamal Jain", state_name: "RAJASTHAN" });
  expect(screen.getByRole("combobox", { name: /Customer/ })).toHaveValue("Kamal Jain");
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Line 1 product" })).toHaveFocus());
  await settle();
  expect(passed).not.toHaveBeenCalled();
  expect(screen.queryByRole("listbox", { name: "Customers" })).not.toBeInTheDocument();
});

test("an item that isn't in Products fills its line, with its HSN and GST rate to change there", async () => {
  const user = fakeToday();
  formServer();
  mountForm("/sales/new", { me: STAFF });
  await screen.findByRole("combobox", { name: /Customer/ });
  await user.click(screen.getByRole("combobox", { name: "Line 1 product" }));
  await user.keyboard("silver idol");
  await user.click(await screen.findByRole("option", { name: /An item that isn't in Products: “silver idol”/ }));
  const sheet = await screen.findByRole("dialog", { name: "An item that isn't in Products" });
  act(() => { vi.advanceTimersByTime(400); });
  await user.type(within(sheet).getByLabelText(/^HSN code/), "7114");
  await user.selectOptions(within(sheet).getByLabelText(/^GST rate/), "3");
  await user.selectOptions(within(sheet).getByLabelText("Unit"), "pcs");
  await user.click(within(sheet).getByRole("button", { name: "Use on this bill" }));
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Line 1 quantity in pieces" })).toHaveFocus());
  expect(screen.getByRole("combobox", { name: "Line 1 product" })).toHaveValue("silver idol");
  expect(screen.getByRole("textbox", { name: "Line 1 HSN code" })).toHaveValue("7114");
});

test("an item kept in Products: the sheet stays while the save is on its way (Esc and its Close wait for it), then the line takes the product", async () => {
  const user = fakeToday();
  let answer = () => {};
  const { calls } = formServer([["POST", "products/", ({ body }) => new Promise((ok) => {
    const b = body as Record<string, unknown>;
    answer = () => ok({ id: 12, name: b.name, hsn_code: b.hsn_code, gst_tax_rate: b.gst_tax_rate, default_unit: b.default_unit, description: b.description, usage_count: 0 });
  })]]);
  mountForm("/sales/new");
  await screen.findByRole("combobox", { name: /Customer/ });
  await user.click(screen.getByRole("combobox", { name: "Line 1 product" }));
  await user.keyboard("silver idol");
  await user.click(await screen.findByRole("option", { name: /An item that isn't in Products: “silver idol”/ }));
  const sheet = await screen.findByRole("dialog", { name: "An item that isn't in Products" });
  act(() => { vi.advanceTimersByTime(400); });
  await user.type(within(sheet).getByLabelText(/^HSN code/), "7114");
  await user.selectOptions(within(sheet).getByLabelText(/^GST rate/), "3");
  await user.click(within(sheet).getByRole("button", { name: "Save and use on this bill" }));
  expect(within(sheet).getByRole("button", { name: "Saving…" })).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await user.click(within(sheet).getByRole("button", { name: "Close" }));
  await settle();
  expect(screen.getByRole("dialog", { name: "An item that isn't in Products" })).toBeInTheDocument();
  expect(within(sheet).getByRole("button", { name: "Back" })).toBeDisabled();
  await act(async () => { answer(); });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "An item that isn't in Products" })).not.toBeInTheDocument());
  expect(calls.filter((c) => c.method === "POST" && c.url === "products/")).toHaveLength(1);
  expect(screen.getByRole("combobox", { name: "Line 1 product" })).toHaveValue("silver idol");
  expect(screen.getByRole("combobox", { name: "Line 1 product" }).closest("[data-line]")).toHaveTextContent("HSN 7114 · GST 3%");
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Line 1 weight in grams" })).toHaveFocus());
});

test("a product whose GST rate isn't one of the slabs (v2's 0.07) gets its line's GST rate to choose, which stays while it's fixed", async () => {
  const user = fakeToday();
  formServer([["GET", "products/", () => ({ count: 2, next: null, previous: null, results: [
    { id: 10, name: "Silver Payal", hsn_code: "711411", gst_tax_rate: "0.07", default_unit: "gms", description: "", usage_count: 2 }, RING,
  ] })]]);
  mountForm("/sales/new");
  await screen.findByRole("combobox", { name: /Customer/ });
  const product = screen.getByRole("combobox", { name: "Line 1 product" });
  await user.click(product);
  await user.keyboard("payal{Enter}10{Enter}100{Enter}");
  // 7% is no slab: the box asks for one, rather than showing the first slab as if it were chosen
  const rate = screen.getByRole("combobox", { name: "Line 1 GST rate" });
  expect(rate).toHaveDisplayValue("GST rate: choose");
  expect(screen.getByRole("textbox", { name: "Line 1 HSN code" })).toHaveValue("711411");
  const checks = () => within(summary()).getByRole("list", { name: "Checks on this bill" });
  expect(checks()).toHaveTextContent("Line 1 needs a GST rate");
  // and nothing is worked out at 7%, which the server refuses
  expect(summary()).toHaveTextContent("GST isn't worked out for Silver Payal until its rate is chosen.");
  expect(within(summary()).queryByText("CGST 3.5%")).not.toBeInTheDocument();
  expect(product.closest("[data-line]")).not.toHaveTextContent("GST 7%");
  await user.selectOptions(rate, "3");
  expect(screen.getByRole("combobox", { name: "Line 1 GST rate" })).toHaveValue("3");
  expect(checks()).toHaveTextContent("Every line has an HSN code and a GST rate (3%)");
  expect(within(summary()).getByText("CGST 1.5%").parentElement).toHaveTextContent("₹15.00");
  // another product whose HSN and rate are fine: the boxes go
  await user.clear(product);
  await user.keyboard("ring{Enter}");
  expect(screen.queryByRole("combobox", { name: "Line 1 GST rate" })).not.toBeInTheDocument();
  expect(product.closest("[data-line]")).toHaveTextContent("HSN 711319 · GST 3%");
});

test("a copy and a cancelled bill made again start filled in, and say where they came from", async () => {
  fakeToday();
  formServer([["GET", "sales/412/", () => wireDetail({ status: "cancelled", cancel_reason: "Wrong weight", payment_mode: "bank" })]]);
  const view = mountForm("/sales/new?remake=412");
  expect(await screen.findByText("Making KGH/2026-27/31 again")).toBeInTheDocument();
  expect(screen.getByText(/It was cancelled \(“Wrong weight”\)/)).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "UPI / bank" })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("combobox", { name: "Line 2 product" })).toHaveValue("Gold Pendant 22K");
  // the number its paper bill takes has come: the form has settled
  await waitFor(() => expect(screen.getByLabelText("Bill number")).toHaveValue("34"));
  view.unmount();
  mountForm("/sales/new?from=412");
  expect(await screen.findByText("Copied from KGH/2026-27/31")).toBeInTheDocument();
  expect(screen.getByText("Anil Gupta's bill of 08 Oct 2026. Check the weights and rates; the date, number and payment are new.")).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "UPI / bank" })).toHaveAttribute("aria-checked", "false");
  expect(screen.getByLabelText("Date")).toHaveValue("08 Oct 2026");
  await waitFor(() => expect(screen.getByLabelText("Bill number")).toHaveValue("34"));
});

test("someone who can't make bills is told who can, and led to the customer's bills", async () => {
  fakeToday();
  formServer();
  mountForm("/sales/new?customer=7", { me: ACCOUNTANT });
  expect(await screen.findByText("You can't make bills")).toBeInTheDocument();
  expect(screen.getByText(/Signed in as accountant\. Only the owner and counter staff can make bills\. Ask the owner if you need it\./)).toBeInTheDocument();
  expect(await screen.findByRole("link", { name: "Anil Gupta's bills" })).toHaveAttribute("href", "/sales?customer=7&all=1");
});

test("copying a paper bill: the paper book's next number and date, Same as last bill, Day before and Day after; another firm follows its own book", async () => {
  const user = fakeToday();
  formServer();
  mountForm("/sales/new");
  await screen.findByRole("combobox", { name: /Customer/ });
  // the switch asks for the paper book, whose answer (and the date it brings the date box) can land as the click ends:
  // inside act, so that lands in it too
  await act(async () => { await user.click(screen.getByRole("switch", { name: "Copying a paper bill" })); });
  expect(screen.getByRole("heading", { level: 1, name: "Bill from the paper book" })).toBeInTheDocument();
  expect(screen.getByText("Its number and date are the paper bill's. Nothing goes on WhatsApp: the customer has the paper bill.")).toBeInTheDocument();
  const number = await screen.findByLabelText("Number on the paper bill");
  await waitFor(() => expect(number).toHaveValue("34"));
  const day = screen.getByLabelText("Date on the paper bill");
  await waitFor(() => expect(day).toHaveValue("29 Sep 2026"));
  expect(screen.getByRole("link", { name: "The paper book" })).toHaveAttribute("href", "/sales/paper?firm=3&month=2026-09");
  await user.click(screen.getByRole("button", { name: "Day before" }));
  expect(day).toHaveValue("28 Sep 2026");
  await user.click(screen.getByRole("button", { name: "Same as last bill" }));
  expect(day).toHaveValue("29 Sep 2026");
  await user.click(screen.getByRole("button", { name: "Day after" }));
  expect(day).toHaveValue("30 Sep 2026");
  expect(within(summary()).getByRole("list", { name: "Checks on this bill" })).toHaveTextContent("KGH/2026-27/34 from the paper bill is free in FY 2026-27");
  await user.selectOptions(screen.getByLabelText("Firm"), "2");
  await waitFor(() => expect(number).toHaveValue("9"));
  expect(day).toHaveValue("30 Sep 2026");
  await user.click(screen.getByRole("switch", { name: "Copying a paper bill" }));
  expect(screen.getByLabelText("Date")).toHaveValue("08 Oct 2026");
  // back to a counter bill: MEERA's next number for today has come
  await waitFor(() => expect(screen.getByLabelText("Bill number")).toHaveValue("9"));
});

test("a paper bill from its link: its number and date; a number used already says so; Close goes back to the paper book", async () => {
  const user = fakeToday();
  formServer();
  const first = mountForm("/sales/new?paper=1&firm=3&date=2026-09-30&number=31");
  // Close, before anything is typed, goes back to the paper book the bill came from
  await screen.findByLabelText("Number on the paper bill");
  await user.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(first.router.state.location.pathname + first.router.state.location.search).toBe("/sales/paper?firm=3&month=2026-09"));
  first.unmount();
  mountForm("/sales/new?paper=1&firm=3&date=2026-09-30&number=31");
  const number = await screen.findByLabelText("Number on the paper bill");
  expect(number).toHaveValue("31");
  expect(screen.getByLabelText("Date on the paper bill")).toHaveValue("30 Sep 2026");
  await settle();
  expect(await screen.findByText("KGH/2026-27/31 is already used in FY 2026-27 by Anil Gupta's bill of 08 Oct 2026. The next free number is KGH/2026-27/34.")).toBeInTheDocument();
  await user.clear(number);
  await user.type(number, "35");
  await settle();
  expect(await screen.findByText("Saved as KGH/2026-27/35.")).toBeInTheDocument();
});

test("on a computer each line sits on one row under the column names, beside a 360 px summary: until it measures, a box reads as wide (Ruling 1E-3)", async () => {
  fakeToday();
  formServer();
  mountForm("/sales/new");
  const product = await screen.findByRole("combobox", { name: "Line 1 product" });
  // jsdom lays nothing out, so useBoxWidth answers 1400: the lines' one-row layout from 700 px, the wide summary from 1240 px
  expect(product.closest("[data-line]")).toHaveClass(LINE_COLS);
  const items = screen.getByRole("group", { name: "Items on the bill" });
  expect(within(items).getByText("Weight or qty")).toBeInTheDocument();
  expect(within(items).getByText("Before GST")).toBeInTheDocument();
  expect(summary().parentElement).toHaveStyle({ gridTemplateColumns: "minmax(0,1fr) 360px" });
  expect(screen.getByLabelText("Firm").closest(".grid")).toHaveClass("grid-cols-3");
  await waitFor(() => expect(screen.getByLabelText("Bill number")).toHaveValue("34"));
});

/* ── The hook on its own: saves, an edit and the place of supply ── */

function inRouter({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={testQueryClient()}>
    <AuthContext.Provider value={stubAuth()}><MemoryRouter><ToastProvider>{children}</ToastProvider></MemoryRouter></AuthContext.Provider>
  </QueryClientProvider>;
}

test("editing keeps the bill's number unless it's renumbered or the bill moves; what changes is listed, and the save is a PUT", async () => {
  fakeToday();
  const { calls } = formServer();
  const s = startEdit(toBillDetail(wireDetail()));
  const { result } = renderHook(() => useBillForm(s), { wrapper: inRouter });
  await waitFor(() => expect(result.current.firms).toHaveLength(2));
  expect(result.current).toMatchObject({ keep: true, numberText: "KGH/2026-27/31", stored: "KGH/2026-27/31" });
  expect(result.current.checks[0].text).toBe("Keeps its number KGH/2026-27/31");
  const ring = result.current.f.lines[0].key;
  act(() => { result.current.setLine(ring, { qty: 12.5 }); result.current.setPayment("bank"); });
  act(() => { result.current.openReview(); });
  expect(result.current.changes).toEqual([
    ["Paid by", "Cash", "UPI / bank"], ["Gold Ring 22K weight", "12.345 gms", "12.500 gms"], ["Total", "₹87,083.21", "₹88,122.94"],
  ]);
  await act(async () => { await result.current.save(); });
  expect(calls.find((c) => c.method === "PUT")).toMatchObject({ url: "sales/412/", body: expect.objectContaining({ invoice_number: "KGH/2026-27/31", payment_mode: "bank" }) });
  expect(calls.find((c) => c.method === "PUT")?.body).not.toHaveProperty("draft_id");
  expect(result.current.savedTo).toBe("/sales/412?saved=edit");
  act(() => { result.current.setNumber("35"); });
  await act(async () => { vi.advanceTimersByTime(400); });
  await waitFor(() => expect(calls.some((c) => c.url === "sales/check-number/" && c.params.exclude_id === 412)).toBe(true));
  expect(result.current.checks[0].text).toBe("Renumbers KGH/2026-27/31 to KGH/2026-27/35");
  act(() => { result.current.setFirm(2); });
  await waitFor(() => expect(result.current.moved).toBe(true));
  expect(result.current.firmHint).toBe("Moves the bill to MEERA ORNAMENTS as 35. KGH/2026-27/31 is left unused.");
});

test("a registered buyer is placed by the GSTIN; a GSTIN whose state GST's table doesn't have is asked about, never taken as the firm's", async () => {
  fakeToday();
  formServer();
  const s = startNew({ firmId: 3, firmSource: "scope", today: TODAY });
  const { result } = renderHook(() => useBillForm(s), { wrapper: inRouter });
  await waitFor(() => expect(result.current.firms).toHaveLength(2));
  act(() => { result.current.setCustomer(toCustomer({ id: 21, name: "Shah Traders", state_name: "RAJASTHAN", gst_number: "24AAACR5055K1Z5", type: "business" })); });
  expect(result.current).toMatchObject({ pos: "24", tt: { inter: true } });
  act(() => { result.current.setCustomer(toCustomer({ id: 22, name: "Old Andhra Jewellers", state_name: "ANDHRA PRADESH", gst_number: "28AAACR5055K1Z5", type: "business" })); });
  expect(result.current.pos).toBe("");
  expect(result.current.errors.pos).toBe("Choose the state the goods are delivered to.");
  // picked by hand, it's taxed there
  act(() => { result.current.set({ posOverride: "37" }); });
  expect(result.current).toMatchObject({ pos: "37", tt: { inter: true } });
});

/** The form hook for `start`, ready to save: its next number in, paid in cash, the review open. */
async function readyToSave(start: Start) {
  const hook = renderHook(() => ({ form: useBillForm(start), keep: useKeepDraft(), drafts: useUnfinishedBills() }), { wrapper: inRouter });
  await waitFor(() => expect(hook.result.current.form.suggestion).toBe("34"));
  act(() => { hook.result.current.form.setPayment("cash"); });
  act(() => { expect(hook.result.current.form.openReview()).toEqual({ ok: true }); });
  return hook;
}
const COPY = () => startCopy(toBillDetail(wireDetail()), TODAY);
const RAKESH = { id: 2, name: "Rakesh Soni" };

test("a bill saved from an unfinished bill waits for that draft's keep still on its way, sends draft_id, and the next form doesn't list the draft", async () => {
  fakeToday();
  const D = "0e6b1c52-7d3a-4f1e-9b8c-2a4d6f8e0a11";
  let land = () => {};
  const row = (data: unknown) => ({ id: D, business: 3, started_by: RAKESH, data, created_at: "2026-10-08T09:20:00+05:30", updated_at: "2026-10-08T09:25:00+05:30" });
  // the shop's list, as the server answered before the save, still has it
  const { calls } = formServer([
    ["GET", "drafts/", () => ({ results: [row({})] })],
    ["PUT", `drafts/${D}/`, ({ body }) => new Promise((ok) => { land = () => ok(row((body as { data: unknown }).data)); })],
  ]);
  const { result } = await readyToSave({ ...COPY(), draftId: D });
  await waitFor(() => expect(result.current.drafts.bills.map((b) => b.id)).toEqual([D]));
  // the last keep of the draft is on its way as Save is pressed
  act(() => { void result.current.keep(D, 3, toDraftData(result.current.form.f, null)); });
  let saving!: Promise<{ refused: string | null }>;
  act(() => { saving = result.current.form.save(); });
  await act(async () => { vi.advanceTimersByTime(100); });
  expect(calls.some((c) => c.method === "POST")).toBe(false);
  await act(async () => { land(); await saving; });
  expect(calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.url}`)).toEqual([`PUT drafts/${D}/`, "POST sales/"]);
  expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ draft_id: D, business: 3, customer: 7, invoice_number: "34" });
  expect(result.current.form.savedTo).toBe("/sales/501?saved=new");
  // off this device, and off the shop's list the next bill form reads, though the server's last answer still named it
  expect(keptDraft(D)).toBeNull();
  expect(result.current.drafts.bills).toEqual([]);
});

test("a draft a bill was made from already: nothing is made, the server's words come with a link to that bill, and the draft is let go", async () => {
  fakeToday();
  const D = "7c2f9e40-1a3b-4c5d-8e6f-0a1b2c3d4e5f";
  const words = "This unfinished bill was saved as KGH/2026-27/31 already.";
  let bill: unknown = { id: 412, invoice_number: "KGH/2026-27/31", invoice_date: "2026-10-08", customer_name: "Anil Gupta", status: "active" };
  const { calls } = formServer([["POST", "sales/", () => refuse(409, { detail: words, code: "draft_saved", bill })]]);
  keepOnDevice({ id: D, business: 3, data: toDraftData(COPY().form, null), started_by: RAKESH, created_at: "2026-10-08T09:20:00+05:30", updated_at: "2026-10-08T09:25:00+05:30", synced: true });
  const { result } = await readyToSave({ ...COPY(), draftId: D });
  let r: { refused: string | null } | undefined;
  await act(async () => { r = await result.current.form.save(); });
  expect(r).toEqual({ refused: null });
  expect(result.current.form.saveError).toEqual({ kind: "draft_saved", title: "Not saved", body: words, link: { label: "Open KGH/2026-27/31", to: "/sales/412" } });
  expect(result.current.form).toMatchObject({ reviewOpen: true, savedTo: null, draftId: D });
  expect(keptDraft(D)).toBeNull();
  // a try again sends the same draft_id, so it can never make a second bill; a bill that has left Sales has no link
  bill = null;
  await act(async () => { await result.current.form.save(); });
  expect(calls.filter((c) => c.method === "POST").map((c) => (c.body as { draft_id: string }).draft_id)).toEqual([D, D]);
  expect(result.current.form.saveError).toEqual({ kind: "draft_saved", title: "Not saved", body: words });
});

test("a refusal the form can't put under a field (the cancelled bill was made again already: ?remake=412) keeps the review open with the server's words", async () => {
  fakeToday();
  const words = "KGH/2026-27/31 was made again already, as KGH/2026-27/33.";
  const { calls } = formServer([["POST", "sales/", () => refuse(400, { replaces: [words] })]]);
  // how /sales/new?remake=412 starts: the cancelled bill's customer, items and payment
  const { result } = await readyToSave(startRemake(toBillDetail(wireDetail({ status: "cancelled", cancel_reason: "Wrong weight" })), TODAY));
  let r: { refused: string | null } | undefined;
  await act(async () => { r = await result.current.form.save(); });
  expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ replaces: 412 });
  expect(r).toEqual({ refused: null });
  expect(result.current.form.reviewOpen).toBe(true);
  expect(result.current.form.saveError).toEqual({ kind: "failed", title: "Not saved", body: words });
  // nothing was put under a field
  expect(result.current.form.errors).toEqual({});
});

test("a refusal the form can put under a field closes the review and names the field to go to", async () => {
  fakeToday();
  formServer([["POST", "sales/", () => refuse(400, { lines: { "1": { rate: ["Type the rate per piece."] } } })]]);
  const { result } = await readyToSave(COPY());
  const pendant = result.current.form.f.lines[1].key;
  let r: { refused: string | null } | undefined;
  await act(async () => { r = await result.current.form.save(); });
  expect(r).toEqual({ refused: `${pendant}-rate` });
  expect(result.current.form.reviewOpen).toBe(false);
  expect(result.current.form.saveError).toBeNull();
  expect(result.current.form.showErr(`${pendant}-rate`)).toBe("Type the rate per piece.");
});
