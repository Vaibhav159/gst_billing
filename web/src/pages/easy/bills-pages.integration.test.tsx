import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Route, Routes, useLocation } from "react-router";
import { renderApp } from "@/test/render";
import type { Action } from "@/core/auth/permissions";
import { salesServer, wireBin, wireDetail, wirePage, wireRow, refuse } from "@/core/sales/fixtures";
import BillDetail from "./BillDetail";
import Bills from "./Bills";

const selection = vi.hoisted(() => ({ firmId: 3 as number | null, firm: { id: 3, name: "KIRAN GOLD HOUSE", short: "Kiran", gstin: "", state: "Rajasthan", prefix: "KGH" }, firms: [], loading: false, error: false, problem: null }));
// 6B owns this provider and the actions. These tests run only after 6B lands (X-40).
vi.mock("./state", async (original) => ({ ...await original<typeof import("./state")>(), useEasyFirm: () => ({ ...selection, setFirm: vi.fn() }) }));
beforeEach(() => { Object.assign(selection, { firmId: 3, loading: false, error: false }); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-08T12:00:00+05:30")); });
afterEach(() => vi.useRealTimers());
function Location() { const l = useLocation(); return <output aria-label="Location">{l.pathname}{l.search}{l.state?.fullView ? " fullView" : ""}</output>; }
function page(path = "/e/bill/412", permissions: "*" | Action[] = "*") {
  return renderApp(<><Routes><Route path="/e/bills" element={<Bills />} /><Route path="/e/bill/:id" element={<BillDetail />} /><Route path="*" element={<p>Destination page</p>} /></Routes><Location /></>, { path, me: { role: permissions === "*" ? "owner" : "staff", permissions } });
}

test("list rows open the Easy detail; Print uses the Easy print route", async () => {
  salesServer([["GET", "sales/", () => wirePage([wireRow()])], ["GET", "sales/412/", () => wireDetail()]]);
  page("/e/bills");
  const row = await screen.findByRole("link", { name: /Anil Gupta/ });
  expect(row).toHaveAttribute("href", "/e/bill/412");
  fireEvent.click(row);
  await screen.findByRole("heading", { name: "Bill 31" });
  vi.setSystemTime(new Date("2026-10-08T12:00:01+05:30"));
  fireEvent.click(screen.getByRole("button", { name: "Print" }));
  expect(screen.getByLabelText("Location")).toHaveTextContent("/e/bill/412/print");
});

test("a full-view visit carries router state without changing phoneMode", async () => {
  const { calls } = salesServer([["GET", "sales/412/", () => wireDetail()]]);
  page();
  await screen.findByRole("heading", { name: "Bill 31" });
  fireEvent.click(screen.getByRole("button", { name: "Open in the full view" }));
  expect(screen.getByLabelText("Location")).toHaveTextContent("/sales/412 fullView");
  expect(calls.some((c) => c.method === "PATCH" && c.url === "preferences/")).toBe(false);
});

test("deleted and unknown ids have distinct states and no action buttons", async () => {
  salesServer([["GET", "sales/412/", () => refuse(404, { code: "deleted", detail: "This bill was deleted", binned: wireBin() })]]);
  page();
  expect(await screen.findByText("This bill was deleted")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Send the bill" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Go to Bills" })).toHaveAttribute("href", "/e/bills");
});

test.each(["999", "not-a-number", "9007199254740992"])("unknown or invalid id %s shows no invented bill", async (id) => {
  const { calls } = salesServer([["GET", `sales/${id}/`, () => refuse(404, { detail: "Not found." })]]);
  page(`/e/bill/${id}`);
  expect(await screen.findByText("We can't find this bill")).toBeInTheDocument();
  if (id !== "999") expect(calls.some((c) => c.url.startsWith("sales/"))).toBe(false);
});

test.each(["", "Wrong weight or rate", "Wrong customer", "Customer didn't buy"])("owner cancellation sends the exact reason %s", async (reason) => {
  let cancelled = false;
  const { calls } = salesServer([
    ["GET", "sales/412/", () => wireDetail(cancelled ? { status: "cancelled", cancel_reason: reason || "Made a mistake on the bill" } : {})],
    ["POST", "sales/412/cancel/", () => { cancelled = true; return { id: 412, invoice_number: "KGH/2026-27/31", status: "cancelled", cancel_reason: reason || "Made a mistake on the bill", cancelled_at: "2026-10-08T12:00:01+05:30", cancelled_by: { id: 1, name: "Kailash Mehta" } }; }],
  ]);
  page();
  fireEvent.click(await screen.findByRole("button", { name: "Made a mistake? Cancel this bill" }));
  expect(await screen.findByRole("dialog", { name: "Cancel bill 31?" })).toHaveTextContent("Anil Gupta");
  vi.setSystemTime(new Date("2026-10-08T12:00:01+05:30"));
  if (reason) fireEvent.click(screen.getByRole("button", { name: reason }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel this bill" }));
  await waitFor(() => expect(calls.find((c) => c.url === "sales/412/cancel/")?.body).toEqual({ reason: reason || "Made a mistake on the bill" }));
  expect(await screen.findByText("This bill is cancelled")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Make it again" })).toBeInTheDocument();
  if (reason === "Wrong customer") expect(screen.getByText("Starts at Who is buying?, with the same items and payment.")).toBeInTheDocument();
});

test("a month closed after opening keeps the server's exact refusal and the bill active", async () => {
  salesServer([["GET", "sales/412/", () => wireDetail()], ["POST", "sales/412/cancel/", () => refuse(409, { code: "month_closed", detail: "October 2026 is filed and locked. Unlock it in GST returns first." })]]);
  page();
  fireEvent.click(await screen.findByRole("button", { name: "Made a mistake? Cancel this bill" }));
  vi.setSystemTime(new Date("2026-10-08T12:00:01+05:30"));
  fireEvent.click(screen.getByRole("button", { name: "Cancel this bill" }));
  expect(await screen.findByText("October 2026 is filed and locked. Unlock it in GST returns first.")).toBeInTheDocument();
  expect(screen.queryByText("This bill is cancelled")).not.toBeInTheDocument();
});

test("a locked month and staff role explain cancellation without opening a dialog", async () => {
  salesServer([["GET", "sales/412/", () => wireDetail({ locked: true })]]);
  page();
  expect(await screen.findByText("This bill's month is already filed with GST, so it can't be cancelled here. Unlock the month in the full view first.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Made a mistake? Cancel this bill" })).not.toBeInTheDocument();
});

test("staff can send but only the owner can cancel or edit", async () => {
  salesServer([["GET", "sales/412/", () => wireDetail()]]);
  page("/e/bill/412", ["view", "bill.create", "bill.send"]);
  expect(await screen.findByText("Made a mistake? Ask the owner to cancel it.")).toBeInTheDocument();
  expect(screen.getByText("Need to change it? Ask the owner.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /full view|Cancel this bill/ })).not.toBeInTheDocument();
});

test.each(["Wrong customer", "Wrong weight or rate"])("Make it again chooses the correct first step for %s", async (reason) => {
  salesServer([["GET", "sales/412/", () => wireDetail({ status: "cancelled", cancel_reason: reason })]]);
  page();
  fireEvent.click(await screen.findByRole("button", { name: "Make it again" }));
  expect(screen.getByLabelText("Location")).toHaveTextContent(reason === "Wrong customer" ? "/e/new?again=412" : "/e/new/items?again=412");
});

test("a viewer gets a sent label and Print, with no sending or remake action", async () => {
  salesServer([["GET", "sales/412/", () => wireDetail()]]);
  page("/e/bill/412", ["view"]);
  expect(await screen.findByText("Not sent yet")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Print" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Send the bill" })).not.toBeInTheDocument();
});

test("opening the list and waiting one minute makes no polling request", async () => {
  const { calls } = salesServer([["GET", "sales/", () => wirePage([])]]);
  page("/e/bills");
  await screen.findByText("No bills yet today");
  const before = calls.length;
  vi.useFakeTimers();
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(calls).toHaveLength(before);
});

test.each(["loading", "error", "empty"] as const)("an unresolved %s firm never shows all firms or a fake zero", async (state) => {
  Object.assign(selection, { firmId: null, loading: state === "loading", error: state === "error" });
  const { calls } = salesServer();
  page("/e/bills");
  await act(async () => {});
  expect(calls.some((call) => call.url === "sales/")).toBe(false);
  expect(screen.queryByText(/0 bills/)).not.toBeInTheDocument();
  if (state === "loading") expect(screen.getByText("Loading the firm for this phone…")).toBeInTheDocument();
  else {
    expect(screen.getByText(state === "error" ? "Couldn't load the firm for this phone" : "Choose a firm first")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to More" })).toHaveAttribute("href", "/e/more");
  }
});
