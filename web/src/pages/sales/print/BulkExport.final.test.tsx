import type { ComponentProps } from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { notifyManager, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { makeBillPdf } from "@/core/print/make";
import { ScopeProvider } from "@/core/scope";
import { FIRM, OTHER_FIRM, refuse, salesServer, wireDetail, wirePage, wireRow, type Call } from "@/core/sales/fixtures";
import type { BillRow } from "@/core/sales/types";
import { renderApp } from "@/test/render";
import BulkExport from "./BulkExport";

vi.mock("@/core/print/make", async (real) => ({
  ...(await real<typeof import("@/core/print/make")>()),
  makeBillPdf: vi.fn(async () => new Blob(["pdf"], { type: "application/pdf" })),
}));
const ui = vi.hoisted(() => ({ smallTable: false }));
vi.mock("@/core/ui", async (real) => {
  const kit = await real<typeof import("@/core/ui")>();
  return { ...kit, Table: (props: ComponentProps<typeof kit.Table>) => ui.smallTable ? <table aria-label={props.label} /> : <kit.Table {...props} /> };
});
const zipped = vi.hoisted(() => ({ names: [] as string[] }));
vi.mock("./zip", () => ({ zipFiles: vi.fn(async (files: AsyncIterable<{ name: string; blob: Blob }>) => {
  zipped.names = [];
  for await (const file of files) zipped.names.push(file.name);
  return new Blob(["PK"], { type: "application/zip" });
}) }));
const rowsOf = (count: number) => Array.from({ length: count }, (_, i) => wireRow({ id: i + 1, counter: i + 1, invoice_number: `KGH/2026-27/${i + 1}` }));
const settings = { copies: "original", show_bank: true, share_message: "", updated_at: null, updated_by: null };
function serve(rows = rowsOf(3), overrides: { detail?: (c: Call) => unknown; settings?: () => unknown; list?: (c: Call) => unknown; firms?: unknown[] } = {}) {
  return salesServer([
    ["GET", "businesses/", () => ({ results: overrides.firms ?? [{ ...FIRM, invoice_prefix: "LIVE" }] })],
    ["GET", "sales/", overrides.list ?? (() => wirePage(rows))],
    ["GET", /^sales\/\d+\/$/, overrides.detail ?? (({ url }) => wireDetail(rows.find((r) => url === `sales/${r.id}/`)))],
    ["GET", "shop-settings/", overrides.settings ?? (() => settings)],
  ]);
}
let qc: QueryClient;
function Cache() { qc = useQueryClient(); return null; }
const open = (path = "/sales/export?firm=3&month=2026-10") => renderApp(<ScopeProvider><Cache /><BulkExport /></ScopeProvider>, { path });
async function ready(n = 3) {
  await screen.findByRole("table", { name: "Files that will be made" }, { timeout: 20000 });
  act(() => vi.setSystemTime(new Date("2026-10-08T10:00:01+05:30")));
  await waitFor(() => expect(screen.getByRole("button", { name: `Print ${n}` })).toBeEnabled(), { timeout: 20000 });
}
function handClock() { const now = Date.now(); vi.useRealTimers(); vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], now }); }
const detailCalls = (calls: Call[]) => calls.filter((c) => /^sales\/\d+\/$/.test(c.url));
beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask);
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-10-08T10:00:00+05:30"));
  vi.mocked(makeBillPdf).mockReset().mockResolvedValue(new Blob(["pdf"]));
  zipped.names = [];
  ui.smallTable = false;
});
afterEach(() => { cleanup(); qc?.clear(); vi.restoreAllMocks(); vi.useRealTimers(); notifyManager.setScheduler((cb) => setTimeout(cb, 0)); });

test("a mistyped 2020 From date asks for at most 301 rows and skips every summary", async () => {
  ui.smallTable = true;
  const rows = rowsOf(600);
  const received: { rows: number; summary: unknown; ids: unknown[] }[] = [];
  serve(rows, { list: ({ params }) => {
    if (params.start_date !== "2020-04-01") return wirePage([]);
    const size = Number(params.page_size);
    const offset = (Number(params.page) - 1) * size;
    const page = rows.slice(offset, offset + size);
    received.push({ rows: page.length, summary: params.summary, ids: page.map((r) => r.id) });
    return wirePage(page, { count: rows.length, next: offset + size < rows.length ? "next" : null });
  } });
  open(); await screen.findByText("No bills match");
  fireEvent.click(screen.getByRole("radio", { name: "Dates" }));
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2020-04-01" } });
  await ready(30);
  expect(received.every((p) => p.summary === 0)).toBe(true);
  expect(received.reduce((n, p) => n + p.rows, 0)).toBeLessThanOrEqual(301);
  expect(received.flatMap((p) => p.ids)).toEqual(Array.from({ length: 301 }, (_, i) => i + 1));
  expect(screen.getByLabelText("From")).toHaveAttribute("min", "2025-04-01");
  expect(screen.getByText(/More than 300 bills match/)).toBeInTheDocument();
}, 20000);

test("Dates starts no earlier than the previous FY", async () => {
  serve(); open(); await ready();
  fireEvent.click(screen.getByRole("radio", { name: "Dates" }));
  expect(screen.getByLabelText("From")).toHaveAttribute("min", "2025-04-01");
});

test("a zip pressed 31 seconds after opening reuses all 30 already loaded bills", async () => {
  const { calls } = serve(rowsOf(31));
  open(); await ready(30);
  act(() => vi.setSystemTime(Date.now() + 31_000));
  handClock();
  fireEvent.click(screen.getByRole("button", { name: "Download as zip" }));
  for (let step = 0; step < 50 && !screen.queryByRole("button", { name: "Save the zip" }); step += 1) await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(screen.getByRole("button", { name: "Save the zip" })).toBeInTheDocument();
  expect(detailCalls(calls)).toHaveLength(31);
  expect(new Set(detailCalls(calls).map((c) => c.url)).size).toBe(31);
});

test("the preview and zip use the frozen prefix and duplicates outside this selection", async () => {
  const rows = [wireRow({ id: 412, invoice_number: "31" })];
  serve(rows, { detail: () => wireDetail({ ...rows[0], firm: { ...(wireDetail().firm as object), invoice_prefix: "FROZEN" },
    duplicates: [{ id: 388, invoice_number: "31", invoice_date: "2026-04-01", total_amount: "100.00", status: "active" }] }) });
  open(); await ready(1);
  expect(within(screen.getByRole("table")).getByText("FROZEN_2026-27_31_2.pdf")).toBeInTheDocument();
  handClock();
  fireEvent.click(screen.getByRole("button", { name: "Download as zip" }));
  for (let step = 0; step < 50 && !screen.queryByRole("button", { name: "Save the zip" }); step += 1) await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(screen.getByRole("button", { name: "Save the zip" })).toBeInTheDocument();
  expect(zipped.names).toEqual(["FROZEN_2026-27_31_2.pdf"]);
});

test("Print starts with all three copies when that is the shop default", async () => {
  serve(rowsOf(1), { settings: () => ({ ...settings, copies: "all" }) });
  open(); await ready(1);
  expect(screen.getByRole("radio", { name: "All three copies" })).toHaveAttribute("aria-checked", "true");
  expect(vi.mocked(makeBillPdf).mock.calls.at(-1)?.[1]).toBe("all");
});

test("a settings failure says that bank details are showing and allows retry", async () => {
  serve(rowsOf(1), { settings: () => refuse(503, {}) });
  open(); await ready(1);
  expect(screen.getByText("The print defaults didn't load")).toBeInTheDocument();
  expect(screen.getByText(/Original copies and bank details/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

test("reading progress announces milestones and keeps Stop outside the live region", async () => {
  const rows = rowsOf(33);
  const release = new Map<number, (x: unknown) => void>();
  serve(rows, { detail: ({ url }) => {
    const id = Number(url.split("/")[1]);
    return id > 30 ? new Promise((done) => release.set(id, done)) : wireDetail(rows[id - 1]);
  } });
  open(); await ready(30);
  fireEvent.click(screen.getByRole("button", { name: "Download as zip" }));
  await waitFor(() => expect(release.has(31)).toBe(true));
  const live = screen.getAllByRole("status").find((node) => /Reading bills:/.test(node.textContent ?? ""))!;
  const text = live.textContent;
  await act(async () => release.get(31)!(wireDetail(rows[30])));
  await waitFor(() => expect(release.has(32)).toBe(true));
  try {
    expect(live.textContent).toBe(text);
    expect(screen.getByRole("button", { name: "Stop" }).closest('[role="status"]')).toBeNull();
  } finally {
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await act(async () => release.get(32)!(wireDetail(rows[31])));
  }
});

test("a completed zip survives a list-only sent/checks update and clears for a number change", async () => {
  serve(rowsOf(1)); open(); await ready(1);
  handClock();
  fireEvent.click(screen.getByRole("button", { name: "Download as zip" }));
  for (let step = 0; step < 50 && !screen.queryByRole("button", { name: "Save the zip" }); step += 1) await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(screen.getByRole("button", { name: "Save the zip" })).toBeInTheDocument();
  handClock();
  await act(async () => { qc.setQueriesData<BillRow[]>({ queryKey: ["sales", "export"] }, (rows) => rows?.map((row) => ({ ...row, checks: ["duplicate"], sent: { at: "2026-10-08T10:01:00+05:30", last_at: "2026-10-08T10:01:00+05:30", count: 1, to: "9829041122", via: "whatsapp" } }))); });
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  expect(screen.getByRole("button", { name: "Save the zip" })).toBeInTheDocument();
  await act(async () => { qc.setQueriesData<BillRow[]>({ queryKey: ["sales", "export"] }, (rows) => rows?.map((row) => ({ ...row, invoice_number: "KGH/2026-27/99" }))); });
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  expect(screen.queryByRole("button", { name: "Save the zip" })).not.toBeInTheDocument();
});


test("a capped list does not claim no bills exist beyond its loaded number range", async () => {
  ui.smallTable = true;
  serve(rowsOf(301)); open(); await ready(30);
  handClock();
  fireEvent.change(screen.getByLabelText("From bill number"), { target: { value: "302" } });
  for (let step = 0; step < 3; step += 1) await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(screen.queryByText("No bills match")).not.toBeInTheDocument();
  expect(screen.getByText("No loaded bills match")).toBeInTheDocument();
});

test("two firms sharing a canonical PDF name are never written into one zip", async () => {
  const rows = [wireRow({ id: 1 }), wireRow({ id: 2, business: 2, business_name: OTHER_FIRM.name })];
  serve(rows, { firms: [FIRM, OTHER_FIRM] });
  open("/sales/export?firm=all&month=2026-10"); await ready(2);
  handClock();
  fireEvent.click(screen.getByRole("button", { name: "Download as zip" }));
  for (let step = 0; step < 10; step += 1) await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(zipped.names).toEqual([]);
  expect(screen.getByText("These bills would share a file name")).toBeInTheDocument();
  expect(screen.getByText(/Pick one firm and make its zip/)).toBeInTheDocument();
});
