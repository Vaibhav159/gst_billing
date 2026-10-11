import { tick } from "@/test/clock";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { salesKeys } from "@/core/api/sales";
import { refuse, salesServer, wireBin, wireDetail, wirePage, wireRow } from "@/core/sales/fixtures";
import { toBillDetail } from "@/core/sales/wire";
import { renderApp } from "@/test/render";
import BillPage from "../BillPage";
import { BillPreview } from "../list/BillPreview";
import { OtherBills, Parties } from "./parts";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-08T11:00:00+05:30")); });
afterEach(() => { (window as unknown as { __phone?: boolean }).__phone = false; vi.useRealTimers(); vi.unstubAllGlobals(); });
const mount = (id: number) => renderApp(<main id="app-main"><Routes><Route path="/sales/:id" element={<BillPage />} /></Routes></main>, { path: `/sales/${id}` });

test("Restore leaves focus on the restored bill's title", async () => {
  salesServer([
    ["GET", "sales/205/", () => refuse(404, { detail: "This bill was deleted.", code: "deleted", binned: wireBin() })],
    ["POST", "bin/4/restore/", () => wireDetail({ id: 205, invoice_number: "KGH/2026-27/27" })],
  ]);
  mount(205); await tick(400);
  const restore = screen.getByRole("button", { name: "Restore it" });
  restore.focus(); fireEvent.click(restore); await tick(100); await tick(16);
  expect(screen.queryByText("This bill was deleted")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
});

test("fixing the tax heads leaves focus on the bill's title", async () => {
  salesServer([
    ["GET", "sales/412/", () => wireDetail({ checks: ["heads_mismatch"], igst: "2536.40", cgst: "0.00", sgst: "0.00" })],
    ["POST", "sales/412/fix-heads/", () => wireDetail()],
  ]);
  mount(412); await tick(400);
  const fix = screen.getByRole("button", { name: "Fix the tax heads" });
  fix.focus(); fireEvent.click(fix); await tick(100);
  expect(screen.queryByRole("button", { name: "Fix the tax heads" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
});

test("Other bills asks once when its card enters the viewport, never while it stays below it", async () => {
  let visibility: IntersectionObserverCallback = () => {};
  const disconnect = vi.fn(); const observe = vi.fn();
  vi.stubGlobal("IntersectionObserver", class { constructor(cb: IntersectionObserverCallback) { visibility = cb; } observe = observe; disconnect = disconnect; });
  const { calls } = salesServer([["GET", "sales/", () => wirePage([wireRow(), wireRow({ id: 300 })])]]);
  const view = renderApp(<OtherBills b={toBillDetail(wireDetail())} />); await tick(400);
  expect(calls.filter((c) => c.url === "sales/")).toHaveLength(0);
  expect(observe).toHaveBeenCalledTimes(1);
  act(() => visibility([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver)); await tick();
  expect(calls.filter((c) => c.url === "sales/")).toHaveLength(0);
  act(() => visibility([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)); await tick(1);
  expect(calls.filter((c) => c.url === "sales/")).toHaveLength(1);
  expect(screen.getByRole("link", { name: "All of Anil Gupta's bills" })).toBeInTheDocument();
  expect(disconnect).toHaveBeenCalled(); view.unmount();
});

test("Other bills asks at once without IntersectionObserver, and possessive names ending in s read naturally", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  salesServer([["GET", "sales/", () => wirePage([wireRow(), wireRow({ id: 300 })])]]);
  const b = toBillDetail(wireDetail()); b.customer.name = "Mehta & Sons";
  renderApp(<OtherBills b={b} />); await tick(10);
  expect(screen.getByRole("link", { name: "All of Mehta & Sons' bills" })).toBeInTheDocument();
});

test("fixing the tax heads keeps focus where the user moved while the fix was pending", async () => {
  let resolveFix!: (bill: unknown) => void;
  salesServer([
    ["GET", "sales/412/", () => wireDetail({ checks: ["heads_mismatch"] })],
    ["POST", "sales/412/fix-heads/", () => new Promise((resolve) => { resolveFix = resolve; })],
  ]);
  mount(412); await tick(400);
  const fix = screen.getByRole("button", { name: "Fix the tax heads" });
  fix.focus(); fireEvent.click(fix); await tick();
  const print = screen.getByRole("link", { name: "Print and share" });
  print.focus();
  await act(async () => resolveFix(wireDetail())); await tick(100);
  expect(screen.queryByRole("button", { name: "Fix the tax heads" })).not.toBeInTheDocument();
  expect(print).toHaveFocus();
});

test("the default observer loads Other bills in a bill page test", async () => {
  const { calls } = salesServer([
    ["GET", "sales/412/", () => wireDetail()],
    ["GET", "sales/", () => wirePage([wireRow(), wireRow({ id: 300, invoice_number: "Other bill" })])],
  ]);
  mount(412); await tick(400); await tick(1);
  expect(calls.some((call) => call.url === "sales/" && call.params.customer_id === 7)).toBe(true);
  expect(screen.getByRole("link", { name: /^Other bill/ })).toBeInTheDocument();
});

const SEND_STATUSES: [Record<string, unknown>, string | RegExp, string][] = [
  [{}, "Not sent yet", "text-brand"],
  [{ paper: true }, "On paper", "text-muted"],
  [{ sent: { at: "2026-10-08T10:00:00+05:30", count: 1, via: "whatsapp", to: "" } }, /^Sent /, "text-sale"],
];
test.each(SEND_STATUSES)("the phone draws its sending status as coloured text (%j)", async (over, label, tone) => {
  (window as unknown as { __phone?: boolean }).__phone = true;
  salesServer([["GET", "sales/412/", () => wireDetail(over)]]);
  mount(412); await tick(400);
  const status = screen.getByText(label);
  expect(status).toHaveClass("text-sm", "font-semibold", tone);
  expect(status).not.toHaveClass("rounded-full");
});

test.each(SEND_STATUSES)("the desktop bill page keeps its sending status pill (%j)", async (over, label) => {
  salesServer([["GET", "sales/412/", () => wireDetail(over)]]);
  mount(412); await tick(400);
  expect(screen.getByText(label)).toHaveClass("rounded-full");
});

test.each(SEND_STATUSES)("the desktop preview keeps its sending status pill (%j)", async (over, label) => {
  salesServer([["GET", "sales/412/", () => wireDetail(over)]]);
  const bill = toBillDetail(wireDetail(over));
  renderApp(<BillPreview id={bill.id} row={bill} index={0} total={1} onClose={() => {}} onMove={() => {}} openDialog={() => {}} send={() => {}} />);
  await tick(400);
  expect(within(screen.getByRole("complementary")).getByText(label)).toHaveClass("rounded-full");
});

test("cached Other bills still observes its card and refreshes stale data only after it enters view", async () => {
  let visibility: IntersectionObserverCallback = () => {};
  const observe = vi.fn();
  vi.stubGlobal("IntersectionObserver", class { constructor(cb: IntersectionObserverCallback) { visibility = cb; } observe = observe; disconnect = vi.fn(); });
  const { calls } = salesServer([["GET", "sales/", () => wirePage([wireRow(), wireRow({ id: 301, invoice_number: "Fresh" })])]]);
  const b = toBillDetail(wireDetail());
  function Cached() {
    const qc = useQueryClient();
    qc.setQueryData(salesKeys.page("all", { customer_id: b.customer.id, ordering: "-date" }, 6), {
      count: 2, results: [b, { ...b, id: 300, invoice_number: "Cached" }], summary: { bills: 2, total_amount: b.total_amount * 2, cancelled: 0 },
    }, { updatedAt: Date.now() - 60000 });
    return <OtherBills b={b} />;
  }
  renderApp(<Cached />); await tick(10);
  expect(screen.getByRole("link", { name: /^Cached/ })).toBeInTheDocument();
  expect(observe).toHaveBeenCalledTimes(1);
  expect(calls.filter((c) => c.url === "sales/")).toHaveLength(0);
  act(() => visibility([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)); await tick(10);
  expect(calls.filter((c) => c.url === "sales/")).toHaveLength(1);
  expect(screen.getByRole("link", { name: /^Fresh/ })).toBeInTheDocument();
});

test.each(["", "9829012345"])("a customer without a state or address has no unknown state or leading separator (%s)", (mobile) => {
  const b = toBillDetail(wireDetail()); Object.assign(b.customer, { address: "", city: "", state_code: "", mobile_number: mobile });
  renderApp(<Parties b={b} />);
  const customer = screen.getByText("To").parentElement!;
  expect(customer).not.toHaveTextContent("Unknown state");
  expect(customer).not.toHaveTextContent("()");
  expect(within(customer).queryByText(/^·/)).not.toBeInTheDocument();
});

test("a duplicate bill's customer uses its possessive name", async () => {
  salesServer([["GET", "sales/412/", () => wireDetail({ checks: ["duplicate"], duplicates: [{ id: 388, invoice_number: "KGH/2026-27/31", invoice_date: "2026-09-10", customer_name: "Mehta & Sons", status: "active" }] })]]);
  mount(412); await tick(10);
  expect(screen.getByText(/It shares the number/)).toHaveTextContent("Mehta & Sons' bill");
});
