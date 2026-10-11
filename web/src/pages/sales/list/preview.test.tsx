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

async function pass(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  for (let i = 0; i < 3; i++) await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}
const props = { index: 0, total: 10, onClose: vi.fn(), onMove: vi.fn(), openDialog: vi.fn(), send: vi.fn() };
function setup() {
  const qc = testQueryClient();
  const { calls } = salesServer([["GET", /^sales\/\d+\/$/, (c) => wireDetail({ id: Number(c.url.split("/")[1]), invoice_number: c.url.split("/")[1] })]]);
  function Preview({ id }: { id: number }) {
    return <QueryClientProvider client={qc}><AuthContext.Provider value={stubAuth()}><MemoryRouter><ToastProvider>
      <BillPreview {...props} id={id} row={toBillRow(wireRow({ id, invoice_number: String(id) }))} />
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
  await pass(199);
  expect(calls.filter((c) => /^sales\/\d+\/$/.test(c.url))).toHaveLength(0);
  for (let id = 413; id <= 421; id++) {
    rerender(<Preview id={id} />);
    expect(screen.getByRole("complementary", { name: `Preview of bill ${id}` })).toBeInTheDocument();
    await pass(20);
  }
  await pass(179);
  expect(calls.filter((c) => /^sales\/\d+\/$/.test(c.url))).toHaveLength(0);
  await pass(1);
  expect(calls.filter((c) => /^sales\/\d+\/$/.test(c.url)).map((c) => c.url)).toEqual(["sales/421/"]);
  expect(screen.getByText("12.345 gms × ₹6,512.50/gms")).toBeInTheDocument();
});

test("switching previews never draws the previous bill while the next read is waiting", async () => {
  const { Preview } = setup();
  const { rerender } = render(<Preview id={412} />);
  await pass(200);
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
  await pass(0);
  expect(screen.getByText(/^This bill was deleted\./)).toBeInTheDocument();
  expect(calls.filter((c) => /^sales\/\d+\/$/.test(c.url))).toHaveLength(0);
});

test("returning quickly to a stale bill waits for a fresh 200 ms pause", async () => {
  const { qc, calls, Preview } = setup();
  const { rerender } = render(<Preview id={412} />);
  await pass(200);
  await act(async () => { await qc.invalidateQueries({ queryKey: billQuery(412).queryKey, refetchType: "none" }); });
  rerender(<Preview id={413} />);
  await pass(20);
  rerender(<Preview id={412} />);
  await pass(199);
  expect(calls.filter((c) => /^sales\/\d+\/$/.test(c.url)).map((c) => c.url)).toEqual(["sales/412/"]);
  await pass(1);
  expect(calls.filter((c) => /^sales\/\d+\/$/.test(c.url)).map((c) => c.url)).toEqual(["sales/412/", "sales/412/"]);
});
