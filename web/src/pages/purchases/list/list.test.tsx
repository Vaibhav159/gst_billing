import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { ScopeProvider } from "@/core/scope";
import { salesServer } from "@/core/sales/fixtures";
import { purchasePageWire, purchaseRowWire } from "@/core/purchases/fixtures";
import { renderApp } from "@/test/render";
import PurchaseList from "../PurchaseList";

vi.mock("@/core/purchases/export", () => ({ purchaseExport: vi.fn(async () => {}) }));
const mount = (path = "/purchases", viewer = false) => renderApp(<ScopeProvider><Routes><Route path="/purchases" element={<PurchaseList />} /><Route path="/purchases/:id" element={<p>Opened the purchase</p>} /></Routes></ScopeProvider>, { path, ...(viewer ? { me: { role: "viewer" as const, permissions: ["view"] } } : {}) });
beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true }); vi.setSystemTime(new Date("2026-10-08T12:30:00+05:30")); });
afterEach(() => vi.useRealTimers());

test("uses the linked firm and credit month and the whole-filter summary", async () => {
  const page = { ...purchasePageWire([purchaseRowWire()]), summary: { bills: 81, taxable: "1000.00", cgst: "15.00", sgst: "15.00", igst: "0.00", tax: "30.00", total_amount: "1030.00", credit: "30.00" } };
  const { calls } = salesServer([["GET", "purchases/", () => page]]);
  mount("/purchases?firm=3&credit=2026-10");
  expect(await screen.findByText(/81 purchase bills/)).toBeInTheDocument();
  const call = calls.find((c) => c.url === "purchases/");
  expect(call?.params).toMatchObject({ business_id: 3, credit_month: "2026-10" });
  expect(call?.params).not.toHaveProperty("fy");
  expect(screen.getByRole("combobox", { name: "Credit claimed in" })).toHaveValue("2026-10");
});

test("checks and dates ask the server, keeping month and date scopes exclusive", async () => {
  const { calls } = salesServer([["GET", "purchases/", () => purchasePageWire([purchaseRowWire()])]]);
  mount();
  await userEvent.click(await screen.findByRole("button", { name: /Same bill twice/ }));
  await waitFor(() => expect(calls.filter((c) => c.url === "purchases/").at(-1)?.params.dups).toBe(1));
  await userEvent.click(screen.getByRole("button", { name: "From – to" }));
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-01" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-09-15" } });
  act(() => vi.setSystemTime(Date.now() + 400));
  await userEvent.click(screen.getByRole("button", { name: "Show these dates" }));
  await waitFor(() => expect(calls.filter((c) => c.url === "purchases/").at(-1)?.params).toMatchObject({ start_date: "2026-09-01", end_date: "2026-09-15", dups: 1 }));
});

test("selection names exact totals; Space ticks and Enter opens a row", async () => {
  salesServer([["GET", "purchases/", () => purchasePageWire([purchaseRowWire()])]]);
  mount();
  const row = (await screen.findByRole("checkbox", { name: /Tick UBS/ })).closest("tr")!;
  act(() => row.focus());
  fireEvent.keyDown(row, { key: " " });
  expect(screen.getByText("1 purchase bill ticked")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Ticked purchases" })).getByRole("button", { name: "For the CA" })).toBeInTheDocument();
  fireEvent.keyDown(row, { key: "Enter" });
  expect(await screen.findByText("Opened the purchase")).toBeInTheDocument();
});

test("viewer can export but sees no create or delete action", async () => {
  salesServer([["GET", "purchases/", () => purchasePageWire([purchaseRowWire()])]]);
  mount("/purchases", true);
  await screen.findByRole("checkbox", { name: /Tick UBS/ });
  expect(screen.getByRole("button", { name: "Export" })).toBeEnabled();
  expect(screen.queryByRole("link", { name: "Add purchase" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Actions for purchase/ }));
  expect(screen.queryByRole("menuitem", { name: /Delete|Edit/ })).not.toBeInTheDocument();
});

test("phone lists keep supplier navigation and credit filters in the sheet", async () => {
  Object.assign(window, { __phone: true });
  salesServer([["GET", "purchases/", () => purchasePageWire([purchaseRowWire()])]]);
  mount();
  expect(await screen.findByRole("link", { name: "Suppliers" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Filters" }));
  expect(within(screen.getByRole("dialog")).getByRole("combobox", { name: "Credit claimed in" })).toBeInTheDocument();
  Object.assign(window, { __phone: false });
});

test("Credit not allowed asks the server for eligible 0 and the row carries the badge", async () => {
  const { calls } = salesServer([["GET", "purchases/", () => purchasePageWire([purchaseRowWire({ credit: { month: "2026-10", chosen: null, late: false, eligible: false, lapsed: false, claimed: "0.00", state: "open", filed_on: null, deadline: "2027-11-30" } })])]]);
  mount();
  expect(await screen.findAllByText("Credit not allowed", { selector: "span *, span" })).not.toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: /^Credit not allowed/ }));
  await waitFor(() => expect(calls.filter((c) => c.url === "purchases/").at(-1)?.params).toMatchObject({ eligible: 0 }));
});

test("the phone Add keeps the firm in view, as the desktop button does", async () => {
  Object.assign(window, { __phone: true });
  salesServer([["GET", "purchases/", () => purchasePageWire([purchaseRowWire()])]]);
  mount("/purchases?firm=3");
  expect(await screen.findByRole("link", { name: "Add" })).toHaveAttribute("href", "/purchases/new?firm=3");
  Object.assign(window, { __phone: false });
});
