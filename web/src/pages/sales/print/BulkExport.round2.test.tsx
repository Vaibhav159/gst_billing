import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { onlineManager, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { __setNetState } from "@/core/api/network";
import { billQuery } from "@/core/api/sales";
import { makeBillPdf } from "@/core/print/make";
import { ScopeProvider } from "@/core/scope";
import { FIRM, OTHER_FIRM, refuse, salesServer, wireDetail, wirePage, wireRow, type Call } from "@/core/sales/fixtures";
import { renderApp } from "@/test/render";
import BulkExport from "./BulkExport";
import { zipFiles } from "./zip";

vi.mock("@/core/print/make", async (real) => ({
  ...(await real<typeof import("@/core/print/make")>()),
  makeBillPdf: vi.fn(async () => new Blob(["%PDF-1.3"], { type: "application/pdf" })),
}));
vi.mock("./zip", async (real) => ({
  ...(await real<typeof import("./zip")>()),
  zipFiles: vi.fn(async (files: AsyncIterable<{ name: string; blob: Blob }>) => {
    for await (const file of files) { void file; }
    return new Blob(["PK"], { type: "application/zip" });
  }),
}));
const rowsOf = (count: number) => Array.from({ length: count }, (_, i) => wireRow({ id: i + 1, counter: i + 1, invoice_number: `KGH/2026-27/${i + 1}` }));
function serve(rows = rowsOf(3), detail?: (c: Call) => unknown) {
  return salesServer([
    ["GET", "businesses/", () => ({ results: [{ ...FIRM, invoice_prefix: "KGH" }, { ...OTHER_FIRM, invoice_prefix: "MO" }] })],
    ["GET", "sales/", () => wirePage(rows)],
    ["GET", /^sales\/\d+\/$/, detail ?? (({ url }) => wireDetail(rows.find((r) => url === `sales/${r.id}/`)))],
    ["GET", "shop-settings/", () => ({ copies: "original", show_bank: true, share_message: "", updated_at: null, updated_by: null })],
    ["POST", "audit-logs/log/", () => ({ ok: true })],
  ]);
}
let qc: QueryClient;
function Cache() { qc = useQueryClient(); return null; }
const open = () => renderApp(<ScopeProvider><Cache /><BulkExport /></ScopeProvider>, { path: "/sales/export?firm=3&month=2026-10", me: { role: "viewer", permissions: ["view"] } });
async function ready(n = 3) {
  await screen.findByRole("table", { name: "Files that will be made" });
  act(() => vi.setSystemTime(new Date("2026-10-08T10:00:01+05:30")));
  await waitFor(() => expect(screen.getByRole("button", { name: `Print ${n}` })).toBeEnabled());
}
const billAsks = (calls: Call[]) => calls.filter((c) => /^sales\/\d+\/$/.test(c.url)).map((c) => c.url);

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-10-08T10:00:00+05:30"));
  vi.spyOn(window, "open").mockImplementation(() => ({ addEventListener: () => {} }) as unknown as Window);
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:round2"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  vi.mocked(makeBillPdf).mockReset().mockResolvedValue(new Blob(["%PDF-1.3"], { type: "application/pdf" }));
  vi.mocked(zipFiles).mockClear();
});
afterEach(() => { cleanup(); qc?.clear(); vi.restoreAllMocks(); vi.useRealTimers(); act(() => { __setNetState("online"); onlineManager.setOnline(true); }); });

test("a Print generation failure uses FailNote and keeps Trying visible during a held retry", async () => {
  let finish!: (pdf: Blob) => void;
  vi.mocked(makeBillPdf).mockRejectedValueOnce(new Error("could not draw"));
  serve(); open();
  const title = await screen.findByText("The batch wasn't made");
  const note = title.closest('[role="alert"]');
  expect(note).not.toBeNull();
  vi.mocked(makeBillPdf).mockImplementationOnce(() => new Promise((done) => { finish = done; }));
  fireEvent.click(within(note as HTMLElement).getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  try {
    expect(screen.getByText("The batch wasn't made").closest('[role="alert"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Trying…" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Trying…" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Print 3" })).toBeDisabled();
  } finally { await act(async () => finish(new Blob(["pdf"]))); }
  await ready();
});

test("Print's missing PDF code keeps its reload instruction in the failure note without a separate button", async () => {
  vi.mocked(makeBillPdf).mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module"));
  serve(); open();
  const title = await screen.findByText("The batch wasn't made");
  expect(title.closest('[role="alert"]')).toHaveTextContent("The part of the app that makes PDFs didn't load. Reload the page, then try again.");
  expect(screen.queryByRole("button", { name: "Reload the page" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Print 3" })).toBeDisabled();
});

test.each([
  [404, 4, "were deleted after being picked"],
  [503, 5, "didn't load"],
] as const)("Print names every one of its %i failures, including more than three bills", async (status, count, ending) => {
  const rows = rowsOf(count);
  serve(rows, () => refuse(status, {}));
  open();
  const numbers = rows.map((row) => row.invoice_number);
  const title = `${numbers.slice(0, -1).join(", ")} and ${numbers.at(-1)} ${ending}`;
  const note = await screen.findByText(title);
  expect(note.closest('[role="alert"]')).not.toBeNull();
  expect(screen.queryByText(`${count} bills ${ending}`)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: `Print ${count}` })).toBeDisabled();
  expect(makeBillPdf).not.toHaveBeenCalled();
});

test("a failed refresh keeps cached Print details ready and explains them with StaleNote", async () => {
  let failed = false;
  const rows = rowsOf(1);
  serve(rows, () => { if (failed) refuse(503, {}); return wireDetail(rows[0]); });
  open(); await ready(1);
  const made = vi.mocked(makeBillPdf).mock.calls.length;
  failed = true;
  await act(async () => { await qc.refetchQueries({ queryKey: billQuery(1).queryKey }); });
  expect(screen.getByRole("button", { name: "Print 1" })).toBeEnabled();
  expect(screen.getByText("Couldn't refresh KGH/2026-27/1")).toBeInTheDocument();
  expect(screen.getByText("The app couldn't reach the shop's records just now, so this is what was last loaded.")).toBeInTheDocument();
  expect(screen.queryByText(/didn't load/)).not.toBeInTheDocument();
  expect(makeBillPdf).toHaveBeenCalledTimes(made);
  fireEvent.click(screen.getByRole("button", { name: "Print 1" }));
  expect(window.open).toHaveBeenCalledWith("blob:round2", "_blank");
});

test("typing 50 applies the range once and reads only the final 30 bill details", async () => {
  const { calls } = serve(rowsOf(100));
  open(); await ready(30);
  const before = billAsks(calls).length;
  expect(before).toBe(30);
  const now = Date.now();
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], now });
  const from = screen.getByLabelText("From bill number");
  fireEvent.change(from, { target: { value: "5" } });
  await act(async () => { await vi.advanceTimersByTimeAsync(20); });
  fireEvent.change(from, { target: { value: "50" } });
  expect(from).toHaveValue("50");
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  const afterTyping = billAsks(calls).slice(before);
  expect(afterTyping).toHaveLength(30);
  expect(afterTyping).toEqual(Array.from({ length: 30 }, (_, i) => `sales/${i + 50}/`));
  await act(async () => { await vi.advanceTimersByTimeAsync(20); });
  vi.useRealTimers();
  await waitFor(() => expect(screen.getByRole("button", { name: "Print 30" })).toBeEnabled());
}, 20000);

test("Stop while reading says the zip was stopped, without claiming a partial zip existed", async () => {
  const rows = rowsOf(31);
  let finish!: (detail: unknown) => void;
  serve(rows, ({ url }) => url === "sales/31/" ? new Promise((done) => { finish = done; }) : wireDetail(rows.find((r) => url === `sales/${r.id}/`)));
  open(); await ready(30);
  vi.mocked(makeBillPdf).mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Download as zip" }));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  try {
    expect(await screen.findByText("The zip was stopped. Start again to make every ticked bill.")).toBeInTheDocument();
    expect(screen.queryByText(/partial zip was discarded/)).not.toBeInTheDocument();
    expect(makeBillPdf).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Save the zip" })).not.toBeInTheDocument();
  } finally { await act(async () => finish(wireDetail(rows[30]))); }
});

test("going offline while reading a zip says nothing was made even after finished reads", async () => {
  const rows = rowsOf(40);
  let finish!: (detail: unknown) => void;
  const { calls } = serve(rows, ({ url }) => url === "sales/35/" ? new Promise((done) => { finish = done; }) : wireDetail(rows.find((r) => url === `sales/${r.id}/`)));
  open(); await ready(30);
  vi.mocked(makeBillPdf).mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Download as zip" }));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(screen.getByText("Reading bills:")).toHaveTextContent("Reading bills: 34 of 40");
  act(() => __setNetState("offline"));
  await act(async () => finish(wireDetail(rows[34])));
  expect(await screen.findByText("You're offline, so nothing was made")).toBeInTheDocument();
  expect(screen.queryByText(/the zip stopped after/)).not.toBeInTheDocument();
  expect(billAsks(calls)).toHaveLength(35);
  expect(makeBillPdf).not.toHaveBeenCalled();
  expect(zipFiles).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Save the zip" })).not.toBeInTheDocument();
});

test("Stop after a file was made says the partial zip was discarded and names every ticked bill", async () => {
  serve(); open(); await ready();
  let finish!: (pdf: Blob) => void;
  vi.mocked(makeBillPdf).mockClear().mockImplementationOnce(() => new Promise((done) => { finish = done; }));
  fireEvent.click(screen.getByRole("button", { name: "Download as zip" }));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  await act(async () => finish(new Blob(["pdf"])));
  expect(await screen.findByText("The partial zip was discarded. Start again to make every ticked bill.")).toBeInTheDocument();
  expect(makeBillPdf).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "Save the zip" })).not.toBeInTheDocument();
});

test("cap advice for one ticked firm gives its numeric continuation without asking to pick a firm", async () => {
  serve(rowsOf(301)); open(); await ready(30);
  for (const [action, cap] of [["Print", 30], ["Export", 300]] as const) {
    const advice = screen.getByText(new RegExp(`^${action} the first ${cap}`));
    expect(advice).toHaveTextContent(`set the bill numbers from ${cap + 1}`);
    expect(advice).not.toHaveTextContent(/pick KIRAN GOLD HOUSE|Clear the number range before picking any later firm/);
  }
}, 20000);

test.each([["Print", 30], ["Export", 300]] as const)("%s cap advice identifies a bill with no numeric counter by number and date", async (action, cap) => {
  const rows = Array.from({ length: cap + 1 }, (_, i) => wireRow({ id: i + 1, counter: null, invoice_number: `KGH/MANUAL/${i + 1}`, invoice_date: i === cap ? "2026-10-07" : "2026-10-01" }));
  serve(rows); open(); await ready(30);
  const advice = screen.getByText(new RegExp(`^${action} the first ${cap}`));
  expect(advice).toHaveTextContent(`KGH/MANUAL/${cap + 1}`);
  expect(advice).toHaveTextContent("07 Oct 2026");
  expect(advice).not.toHaveTextContent(/set the bill numbers from/);
}, 20000);

test("Stop during a PDF-only retry discards its zip without an unhandled read interruption", async () => {
  const { calls } = serve();
  open(); await ready();
  vi.mocked(makeBillPdf).mockImplementation(async (papers) => {
    if (papers[0].id === 2) throw new Error("could not draw");
    return new Blob(["pdf"]);
  });
  fireEvent.click(screen.getByRole("button", { name: "Download as zip" }));
  await screen.findByText("Made 2 of 3. 1 bill couldn't be made");
  const reads = billAsks(calls);
  let finish!: (pdf: Blob) => void;
  vi.mocked(makeBillPdf).mockReset().mockImplementationOnce(() => new Promise((done) => { finish = done; }));
  fireEvent.click(screen.getByRole("button", { name: "Try it again" }));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(billAsks(calls)).toEqual(reads);
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  await act(async () => finish(new Blob(["pdf"])));
  expect(await screen.findByText("The partial zip was discarded. Start again to make every ticked bill.")).toBeInTheDocument();
  expect(makeBillPdf).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "Save the zip" })).not.toBeInTheDocument();
});
