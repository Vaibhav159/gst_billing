import { pass } from "@/test/clock";
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { AuthContext } from "@/core/auth/AuthProvider";
import { billQuery, type BillOutcome } from "@/core/api/sales";
import { salesServer, wireBin, wireDetail, wireRow } from "@/core/sales/fixtures";
import { toBillDetail, toBillRow, toBinRow } from "@/core/sales/wire";
import { ToastProvider } from "@/core/ui";
import { stubAuth, testQueryClient } from "@/test/render";
import { BillPreview } from "./BillPreview";

const props = { index: 0, total: 10, onClose: vi.fn(), onMove: vi.fn(), openDialog: vi.fn(), send: vi.fn() };
/** over: what a bill's row and answer say besides the contract's example (its status, its customer), by its id. */
function setup(over: (id: number) => Record<string, unknown> = () => ({})) {
  const qc = testQueryClient();
  const { calls } = salesServer([["GET", /^sales\/\d+\/$/, (c) => { const id = Number(c.url.split("/")[1]); return wireDetail({ id, invoice_number: String(id), ...over(id) }); }]]);
  function Preview({ id }: { id: number }) {
    return <QueryClientProvider client={qc}><AuthContext.Provider value={stubAuth()}><MemoryRouter><ToastProvider>
      <BillPreview {...props} id={id} row={toBillRow(wireRow({ id, invoice_number: String(id), ...over(id) }))} />
    </ToastProvider></MemoryRouter></AuthContext.Provider></QueryClientProvider>;
  }
  return { qc, calls, Preview };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

test("a preview draws its row at once and reads the bill only after 200 ms without another move", async () => {
  const { calls, Preview } = setup();
  const { rerender } = render(<Preview id={412} />);
  expect(screen.getByRole("complementary", { name: "Preview of bill 412" })).toBeInTheDocument();
  await pass(199, 3);
  expect(calls.filter((c) => /^sales\/\d+\/$/.test(c.url))).toHaveLength(0);
  for (let id = 413; id <= 421; id++) {
    rerender(<Preview id={id} />);
    expect(screen.getByRole("complementary", { name: `Preview of bill ${id}` })).toBeInTheDocument();
    await pass(20, 3);
  }
  await pass(179, 3);
  expect(calls.filter((c) => /^sales\/\d+\/$/.test(c.url))).toHaveLength(0);
  await pass(1, 3);
  expect(calls.filter((c) => /^sales\/\d+\/$/.test(c.url)).map((c) => c.url)).toEqual(["sales/421/"]);
  expect(screen.getByText("12.345 gms × ₹6,512.50/gms")).toBeInTheDocument();
});

test("switching previews never draws the previous bill while the next read is waiting", async () => {
  const { Preview } = setup();
  const { rerender } = render(<Preview id={412} />);
  await pass(200, 3);
  expect(screen.getByText("12.345 gms × ₹6,512.50/gms")).toBeInTheDocument();
  rerender(<Preview id={413} />);
  expect(screen.getByRole("complementary", { name: "Preview of bill 413" })).toBeInTheDocument();
  expect(screen.queryByText("12.345 gms × ₹6,512.50/gms")).not.toBeInTheDocument();
});

test("cached details and a delete answer update the current preview even while its read is waiting", async () => {
  const { qc, calls, Preview } = setup();
  const bill: BillOutcome = { kind: "bill", bill: toBillDetail(wireDetail({ invoice_number: "412" })) };
  qc.setQueryData(billQuery(412).queryKey, bill);
  render(<Preview id={412} />);
  expect(screen.getByText("12.345 gms × ₹6,512.50/gms")).toBeInTheDocument();
  const deleted: BillOutcome = { kind: "deleted", binned: toBinRow(wireBin({ original_id: 412 })) };
  act(() => { qc.setQueryData(billQuery(412).queryKey, deleted); });
  await pass(0, 3);
  expect(screen.getByText(/^This bill was deleted\./)).toBeInTheDocument();
  expect(calls.filter((c) => /^sales\/\d+\/$/.test(c.url))).toHaveLength(0);
});

test("returning quickly to a stale bill waits for a fresh 200 ms pause", async () => {
  const { qc, calls, Preview } = setup();
  const { rerender } = render(<Preview id={412} />);
  await pass(200, 3);
  await act(async () => { await qc.invalidateQueries({ queryKey: billQuery(412).queryKey, refetchType: "none" }); });
  rerender(<Preview id={413} />);
  await pass(20, 3);
  rerender(<Preview id={412} />);
  await pass(199, 3);
  expect(calls.filter((c) => /^sales\/\d+\/$/.test(c.url)).map((c) => c.url)).toEqual(["sales/412/"]);
  await pass(1, 3);
  expect(calls.filter((c) => /^sales\/\d+\/$/.test(c.url)).map((c) => c.url)).toEqual(["sales/412/", "sales/412/"]);
});

test("a body that scrolls with nothing to focus inside (a walk-in's cancelled bill) takes the keyboard as a region, as a dialog's does (Ruling 1D-18)", async () => {
  // jsdom lays nothing out: what Tab reaches is drawn, and the preview's scrolling body is taller than its box
  const was = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent")!;
  const sized = HTMLElement.prototype as unknown as Record<string, unknown>;
  Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get() { return (this as HTMLElement).parentElement; } });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get() { return (this as HTMLElement).classList.contains("overflow-y-auto") ? 900 : 0; } });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return (this as HTMLElement).classList.contains("overflow-y-auto") ? 500 : 0; } });
  // 412 is a walk-in's cancelled bill, 413 Anil Gupta's
  const cancelled = { status: "cancelled", cancel_reason: "Test bill" };
  const walkIn = { ...cancelled, customer: { ...(wireDetail().customer as object), id: 9, name: "Walk-in Customer", type: "walkin", mobile_number: "" } };
  const { Preview } = setup((id) => (id === 412 ? walkIn : cancelled));
  try {
    // a walk-in's name is no link: nothing in the body for Tab (Send is in the foot), so the body takes it
    const { rerender } = render(<Preview id={412} />);
    await pass(200);
    const body = screen.getByRole("region", { name: "Details of bill 412" });
    expect(body).toHaveAttribute("tabindex", "0");
    expect(body).toHaveTextContent("Total when issued");
    // the next bill's body is measured afresh: a customer's name is a link Tab reaches, which scrolls the body, so it's no region
    rerender(<Preview id={413} />);
    await pass(200);
    expect(screen.getByRole("link", { name: "Anil Gupta" })).toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    rerender(<Preview id={412} />);
    await pass(200);
    expect(screen.getByRole("region", { name: "Details of bill 412" })).toHaveAttribute("tabindex", "0");
  } finally {
    Object.defineProperty(HTMLElement.prototype, "offsetParent", was);
    delete sized.scrollHeight;
    delete sized.clientHeight;
  }
});
