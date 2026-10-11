import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { salesServer, refuse } from "@/core/sales/fixtures";
import { purchaseDetailWire, purchaseBinWire } from "@/core/purchases/fixtures";
import { renderApp } from "@/test/render";
import PurchasePage from "../PurchasePage";

const mount = (path = "/purchases/905", staff = false) => renderApp(<Routes><Route path="/purchases/:id" element={<PurchasePage />} /></Routes>, { path, ...(staff ? { me: { role: "staff" as const, permissions: ["view", "purchase.create", "capture"] } } : {}) });
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true }); vi.setSystemTime(new Date("2026-10-08T12:30:00+05:30")); });
afterEach(() => vi.useRealTimers());

test("late credit comes from the server and keeps the exact total and linked sale", async () => {
  const p = purchaseDetailWire({ invoice_date: "2026-02-18", fy: "2025-26", credit: { month: "2026-10", chosen: "2026-10", late: true, eligible: true, lapsed: false, claimed: "14348.88", state: "open", filed_on: null, deadline: "2026-11-30" }, linked_sale: { id: 31, invoice_number: "MO/2026-27/31", invoice_date: "2026-10-08", total_amount: "492645.00", business_name: "MEERA ORNAMENTS" } });
  salesServer([["GET", "purchases/905/", () => p]]);
  mount();
  expect(await screen.findByText("Credit in October 2026's GSTR-3B")).toBeInTheDocument();
  expect(screen.getByText(/30 Nov 2026.*GSTR-9/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /MO\/2026-27\/31/ })).toHaveAttribute("href", "/sales/31");
  expect(screen.queryByText("Making")).not.toBeInTheDocument();
});

test("Looks right uses checked endpoint, and staff cannot clear the flag", async () => {
  let checked = false;
  const { calls } = salesServer([["GET", "purchases/905/", () => purchaseDetailWire({ needs_review: !checked })], ["POST", "purchases/905/checked/", () => { checked = true; return purchaseDetailWire({ needs_review: false }); }]]);
  mount();
  await userEvent.click(await screen.findByRole("button", { name: "Looks right" }));
  await waitFor(() => expect(calls.some((c) => c.url === "purchases/905/checked/" && c.method === "POST")).toBe(true));
  await waitFor(() => expect(screen.queryByText("Needs a check")).not.toBeInTheDocument());
});

test("filed lock uses the credit month and hides mutation from staff", async () => {
  salesServer([["GET", "purchases/905/", () => purchaseDetailWire({ needs_review: true, locked: true, credit: { month: "2026-09", chosen: "2026-09", late: true, eligible: true, lapsed: false, claimed: "14348.88", state: "filed", filed_on: null, deadline: "2027-11-30" } })]]);
  mount("/purchases/905", true);
  expect(await screen.findByText(/September 2026's GSTR-3B is filed for/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Looks right" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Attach a photo or PDF" })).not.toBeInTheDocument();
});

test("deleted page restores the bin id and refreshes the purchase", async () => {
  let deleted = true;
  const { calls } = salesServer([["GET", "purchases/905/", () => { if (deleted) refuse(404, { detail: "This purchase was deleted.", code: "deleted", binned: purchaseBinWire({ id: 44, original_id: 905 }) }); return purchaseDetailWire(); }], ["POST", "purchases/bin/44/restore/", () => { deleted = false; return purchaseDetailWire(); }]]);
  mount();
  await userEvent.click(await screen.findByRole("button", { name: "Restore it" }));
  await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "purchases/bin/44/restore/")).toBe(true));
  expect(await screen.findByRole("heading", { name: "Tax and total" })).toBeInTheDocument();
});

test("a file upload reports a failure on the page", async () => {
  salesServer([["GET", "purchases/905/", () => purchaseDetailWire({ files: [], has_files: false })], ["POST", "purchases/905/files/", () => refuse(409, { code: "month_closed", detail: "September 2026's GSTR-3B is filed for KIRAN GOLD HOUSE, with this bill's credit in it, so it can't be changed." })]]);
  mount();
  const input = await screen.findByLabelText("Bill photo or PDF");
  fireEvent.change(input, { target: { files: [new File(["photo"], "bill.jpg", { type: "image/jpeg" })] } });
  expect(await screen.findByText(/September 2026's GSTR-3B is filed for/)).toBeInTheDocument();
});

test("a bill before April 2025 is outside the credit ledger and cannot move credit", async () => {
  const { calls } = salesServer([["GET", "purchases/905/", () => purchaseDetailWire({ invoice_date: "2024-03-31", fy: "2023-24", credit: { month: null, chosen: null, late: false, eligible: true, lapsed: false, claimed: "0.00", state: "outside", filed_on: null, deadline: "2024-11-30" } })]]);
  mount();
  expect(await screen.findByText("This bill is before April 2025. Its credit is in the opening balance or lapsed.")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Move.*credit|Change credit month/i })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Claim the credit in")).not.toBeInTheDocument();
  expect(screen.queryByText(/GSTR-3B.*March 2024|March 2024.*GSTR-3B|March 2024 · not filed yet/)).not.toBeInTheDocument();
  expect(screen.getByText("₹0.00")).toBeInTheDocument();
  expect(calls.some(c => c.url === "purchases/credit-months/")).toBe(false);
});

test("the credit_set activity action is shown as Credit moved", async () => {
  salesServer([["GET", "purchases/905/", () => purchaseDetailWire({ history: { created_by: { id: 1, name: "Owner" }, activity: [{ at: "2026-10-08T07:00:00+05:30", by: "Owner", action: "credit_set", details: "August 2026 to October 2026" }] } })]]);
  mount();
  expect(await screen.findByText("Credit moved by Owner")).toBeVisible();
  expect(screen.getByText("August 2026 to October 2026")).toBeVisible();
});

test.each([false, true])("a deleted linked sale is labelled and linked only for the owner (staff %s)", async (staff) => {
  salesServer([["GET", "purchases/905/", () => purchaseDetailWire({ linked_sale: { id: 31, invoice_number: "MO/2026-27/31", invoice_date: "2026-10-08", customer_name: "Kiran Gold House", status: "deleted" } })]]);
  mount("/purchases/905", staff);
  expect(await screen.findByText("Deleted")).toBeVisible();
  expect(screen.getByText("MO/2026-27/31")).toBeVisible();
  const link = screen.queryByRole("link", { name: "MO/2026-27/31" });
  if (staff) expect(link).not.toBeInTheDocument();
  else expect(link).toHaveAttribute("href", "/sales/31");
});
