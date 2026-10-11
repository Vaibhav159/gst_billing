import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { __setNetState } from "@/core/api/network";
import { billQuery, type BillOutcome } from "@/core/api/sales";
import { makeBillPdf } from "@/core/print/make";
import { ScopeProvider } from "@/core/scope";
import { FIRM, OTHER_FIRM, refuse, salesServer, wireDetail, wirePage, wireRow, type Call } from "@/core/sales/fixtures";
import { toBillDetail } from "@/core/sales/wire";
import { renderApp } from "@/test/render";
import BulkExport from "./BulkExport";
import { zipFiles } from "./zip";

vi.mock("@/core/print/make", async (real) => ({
  ...(await real<typeof import("@/core/print/make")>()),
  makeBillPdf: vi.fn(async () => new Blob(["%PDF-1.3"], { type: "application/pdf" })),
}));
const zipped = vi.hoisted(() => ({ files: [] as { name: string; blob: Blob }[] }));
vi.mock("./zip", async (real) => ({
  ...(await real<typeof import("./zip")>()),
  zipFiles: vi.fn(async (files: AsyncIterable<{ name: string; blob: Blob }> | { name: string; blob: Blob }[]) => {
    zipped.files = [];
    for await (const f of files) zipped.files.push(f);
    return new Blob(["PK"], { type: "application/zip" });
  }),
}));
const ROWS = [
  wireRow({ id: 501, business: 2, business_name: "MEERA ORNAMENTS", invoice_number: "MO/2026-27/7", counter: 7, invoice_date: "2026-10-02", total_amount: "5000.00" }),
  wireRow({ id: 412 }),
  wireRow({ id: 388, invoice_number: "KGH/2026-27/31", invoice_date: "2026-10-01", customer: { id: 8, name: "Hemant Dave", gst_number: "", mobile_number: "", type: "person" }, total_amount: "1000.00" }),
];
function serve(rows = ROWS, detail?: (c: Call) => unknown, list?: (c: Call) => unknown, settings?: () => unknown) {
  return salesServer([
    ["GET", "businesses/", () => ({ results: [{ ...FIRM, invoice_prefix: "KGH" }, { ...OTHER_FIRM, invoice_prefix: "MO" }] })],
    ["GET", "sales/", list ?? (() => wirePage(rows))],
    ["GET", /^sales\/\d+\/$/, detail ?? (({ url }) => {
      const r = rows.find((x) => x.id === Number(url.split("/")[1]))!;
      return wireDetail({ ...r, firm: { ...(wireDetail().firm as object), name: r.business_name, invoice_prefix: r.business === 2 ? "MO" : "KGH" } });
    })],
    ["GET", "shop-settings/", settings ?? (() => ({ copies: "original", show_bank: true, share_message: "", updated_at: null, updated_by: null }))],
    ["POST", "audit-logs/log/", () => ({ ok: true })],
  ]);
}
let qc: QueryClient;
function Cache() { qc = useQueryClient(); return null; }
const open = (path = "/sales/export?firm=all&month=2026-10") => renderApp(<ScopeProvider><Cache /><BulkExport /></ScopeProvider>, { path, me: { role: "viewer", permissions: ["view"] } });
async function ready(n = 3) {
  await screen.findByRole("table", { name: "Files that will be made" });
  act(() => vi.setSystemTime(new Date("2026-10-08T10:00:01+05:30")));
  await waitFor(() => expect(screen.getByRole("button", { name: `Print ${n}` })).toBeEnabled());
}
const billAsks = (calls: Call[]) => calls.filter((c) => /^sales\/\d+\/$/.test(c.url)).map((c) => c.url);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-10-08T10:00:00+05:30"));
  vi.spyOn(window, "open").mockImplementation(() => ({ addEventListener: () => {} }) as unknown as Window);
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  vi.mocked(makeBillPdf).mockReset().mockResolvedValue(new Blob(["%PDF-1.3"], { type: "application/pdf" }));
  vi.mocked(zipFiles).mockClear();
});
afterEach(() => { cleanup(); qc?.clear(); vi.restoreAllMocks(); vi.useRealTimers(); act(() => __setNetState("online")); });

test("the month's bills, firm by firm, every file named first; duplicates renamed; firm=all overrides the usual firm", async () => {
  localStorage.setItem("gst3.scope.1", "3");
  const { calls } = serve();
  open();
  await ready();
  const table = screen.getByRole("table", { name: "Files that will be made" });
  expect(calls.find((c) => c.url === "sales/")?.params).toEqual({ month: "2026-10", status: "active", ordering: "number", page: 1, page_size: 200 });
  expect(within(table).getAllByRole("row").slice(1).map((r) => r.textContent)).toEqual([
    expect.stringContaining("KGH_2026-27_31.pdfKGH/2026-27/31Hemant Dave01 Oct 2026"),
    expect.stringContaining("KGH_2026-27_31_2.pdfrenamedKGH/2026-27/31Anil Gupta08 Oct 2026"),
    expect.stringContaining("MO_2026-27_7.pdfMO/2026-27/7Anil Gupta02 Oct 2026"),
  ]);
  expect(screen.getByText("One number is used twice, so a file was renamed")).toBeInTheDocument();
  expect(screen.getByText(/3 bills.*3 files, every name different/)).toHaveTextContent("3 bills make 3 files, every name different");
  expect(screen.getByRole("checkbox", { name: /^MEERA ORNAMENTS/ })).toHaveAccessibleName(/1 bill in October 2026/);
  await userEvent.click(screen.getByRole("checkbox", { name: /^MEERA ORNAMENTS/ }));
  expect(within(table).getAllByRole("row")).toHaveLength(3);
});

test("zip makes Originals one at a time under the shown names; Save the zip delivers within its own press and logs", async () => {
  const { calls } = serve();
  open();
  await ready();
  await userEvent.click(screen.getAllByRole("checkbox", { name: "Tick KGH/2026-27/31" })[0]);
  await ready(2);
  vi.mocked(makeBillPdf).mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Download as zip" }));
  expect(await screen.findByText("2 PDFs made")).toBeInTheDocument();
  expect(vi.mocked(makeBillPdf).mock.calls.map(([bills, copies]) => [bills[0].number, copies])).toEqual([["KGH/2026-27/31", "original"], ["MO/2026-27/7", "original"]]);
  expect(zipped.files.map((f) => f.name)).toEqual(["KGH_2026-27_31.pdf", "MO_2026-27_7.pdf"]);
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  expect(calls.filter((c) => c.url === "audit-logs/log/")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Save the zip" }));
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
  await waitFor(() => expect(calls.find((c) => c.url === "audit-logs/log/")?.body).toMatchObject({ action: "exported", entity_id: 0, entity_name: "Bulk PDFs (2 bills)", details: expect.stringContaining("Sales_PDFs_Oct2026_KGH-MO.zip") }));
  expect(billAsks(calls)).toHaveLength(3);
});

test("Print is prepared with the chosen copies and opens immediately on the press; a blocked tab isn't logged", async () => {
  const { calls } = serve();
  open();
  await ready();
  await userEvent.click(screen.getByRole("radio", { name: "All three copies" }));
  await ready();
  expect(vi.mocked(makeBillPdf).mock.lastCall?.[1]).toBe("all");
  const count = vi.mocked(makeBillPdf).mock.calls.length;
  vi.mocked(window.open).mockReturnValueOnce(null);
  fireEvent.click(screen.getByRole("button", { name: "Print 3" }));
  expect(window.open).toHaveBeenCalledWith("blob:x", "_blank");
  expect(screen.getByText("The PDF didn't open")).toBeInTheDocument();
  expect(calls.filter((c) => c.url === "audit-logs/log/")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Print 3" }));
  expect(window.open).toHaveBeenCalledTimes(2);
  expect(makeBillPdf).toHaveBeenCalledTimes(count);
  await waitFor(() => expect(calls.find((c) => c.url === "audit-logs/log/")?.body).toMatchObject({ entity_id: 0, entity_name: "Batch print (3 bills)", details: expect.stringContaining("9 pages · three copies each") }));
});

test("unreadable details block every PDF, name the bill, and Try again refetches only that bill", async () => {
  let failed = true;
  const { calls } = serve(ROWS, ({ url }) => {
    const r = ROWS.find((x) => x.id === Number(url.split("/")[1]))!;
    if (r.id === 388 && failed) refuse(500, {});
    return wireDetail(r);
  });
  open();
  const note = await screen.findByText(/KGH\/2026-27\/31 didn't load/);
  expect(note).toBeInTheDocument();
  expect(makeBillPdf).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Print 3" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Download as zip" })).toBeDisabled();
  const asked = vi.spyOn(qc!, "refetchQueries");
  failed = false;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await ready();
  expect(asked.mock.calls).toEqual([[{ queryKey: billQuery(388).queryKey }]]);
  expect(billAsks(calls)).toEqual(["sales/388/", "sales/412/", "sales/501/", "sales/388/"]);
});

test("offline, a new job makes nothing", async () => {
  serve(); open(); await ready();
  act(() => __setNetState("offline"));
  vi.mocked(makeBillPdf).mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Download as zip" }));
  expect(await screen.findByText("You're offline, so nothing was made")).toBeInTheDocument();
  expect(makeBillPdf).not.toHaveBeenCalled();
  expect(zipFiles).not.toHaveBeenCalled();
});

test("a failed PDF is named and retry makes only it, retaining its previewed duplicate filename", async () => {
  serve(); open(); await ready();
  vi.mocked(makeBillPdf).mockImplementation(async (bills) => {
    if (bills[0].id === 412) throw new Error("could not draw");
    return new Blob(["pdf"]);
  });
  fireEvent.click(screen.getByRole("button", { name: "Download as zip" }));
  expect(await screen.findByText("Made 2 of 3. 1 bill couldn't be made")).toBeInTheDocument();
  expect(screen.getByText(/These couldn't be made just now: KGH\/2026-27\/31/)).toBeInTheDocument();
  vi.mocked(makeBillPdf).mockReset().mockResolvedValue(new Blob(["pdf"]));
  fireEvent.click(screen.getByRole("button", { name: "Try it again" }));
  expect(await screen.findByText("1 PDF made")).toBeInTheDocument();
  expect(makeBillPdf).toHaveBeenCalledOnce();
  expect(zipped.files.map((f) => f.name)).toEqual(["KGH_2026-27_31_2.pdf"]);
});

test("Stop ends after the current PDF and never offers an unfinished zip", async () => {
  serve(); open(); await ready();
  let finish!: (b: Blob) => void;
  vi.mocked(makeBillPdf).mockClear().mockImplementationOnce(() => new Promise((done) => { finish = done; }));
  fireEvent.click(screen.getByRole("button", { name: "Download as zip" }));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("button", { name: "Stop" }));
  await act(async () => finish(new Blob(["pdf"])));
  expect(await screen.findByText("Stopped after 1 of 3")).toBeInTheDocument();
  expect(makeBillPdf).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "Save the zip" })).not.toBeInTheDocument();
});

test("month list reads every page once, deduplicates page boundaries; date, bill-kind and cancelled filters use salesParams", async () => {
  const { calls } = serve(ROWS, undefined, ({ params }) => params.page === 1 ? { ...wirePage(ROWS.slice(0, 2)), next: "?page=2" } : wirePage(ROWS.slice(1)));
  open(); await ready();
  expect(calls.filter((c) => c.url === "sales/").map((c) => c.params?.page)).toEqual([1, 2]);
  expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(4);
  await userEvent.click(screen.getByRole("radio", { name: "Not sent yet" }));
  await waitFor(() => expect(calls.filter((c) => c.url === "sales/").at(-1)?.params).toMatchObject({ unsent: 1 }));
  await userEvent.click(screen.getByRole("radio", { name: "Udhaar" }));
  await waitFor(() => expect(calls.filter((c) => c.url === "sales/").at(-1)?.params).toMatchObject({ credit: 1 }));
  await userEvent.click(screen.getByRole("checkbox", { name: /Include cancelled bills/ }));
  await waitFor(() => expect(calls.filter((c) => c.url === "sales/").at(-1)?.params).not.toHaveProperty("status"));
  await userEvent.click(screen.getByRole("radio", { name: "Dates" }));
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-03-31" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-04-01" } });
  await waitFor(() => expect(calls.filter((c) => c.url === "sales/").at(-1)?.params).toMatchObject({ start_date: "2026-03-31", end_date: "2026-04-01" }));
  fireEvent.change(screen.getByLabelText("From bill number"), { target: { value: "32" } });
  fireEvent.change(screen.getByLabelText("To bill number"), { target: { value: "7" } });
  expect(screen.getByText("Check the period and numbers")).toBeInTheDocument();
});

test("print caps at 30 and zip at 300, counts the rest and never reads or makes bill 301", async () => {
  const rows = Array.from({ length: 301 }, (_, i) => wireRow({ id: i + 1, counter: i + 1, invoice_number: `KGH/2026-27/${i + 1}` }));
  const { calls } = serve(rows);
  open(); await ready(30);
  expect(screen.getByText(/Print the first 30.*other 271 bills/)).toBeInTheDocument();
  expect(screen.getByText(/Export the first 300.*other 1 bill.*another run/)).toBeInTheDocument();
  expect(vi.mocked(makeBillPdf).mock.lastCall?.[0]).toHaveLength(30);
  expect(billAsks(calls)).toHaveLength(300);
  vi.mocked(makeBillPdf).mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Download as zip" }));
  await waitFor(() => expect(zipped.files).toHaveLength(300), { timeout: 30000 });
  expect(await screen.findByText("300 PDFs made")).toBeInTheDocument();
  expect(makeBillPdf).toHaveBeenCalledTimes(300);
  expect(zipped.files).toHaveLength(300);
  fireEvent.click(screen.getByRole("button", { name: "Save the zip" }));
  await waitFor(() => expect(calls.find((c) => c.url === "audit-logs/log/")?.body).toMatchObject({ details: expect.stringContaining("KGH/2026-27/300") }));
}, 45000); // 300 yielded files and a 301-row preview on the shared two-CPU machine


test("a zip waits for bank settings before it can be made", async () => {
  let settings!: (s: unknown) => void;
  serve(ROWS, undefined, undefined, () => new Promise((done) => { settings = done; }));
  open();
  await screen.findByRole("table");
  await waitFor(() => expect(settings).toBeTypeOf("function"));
  expect(screen.getByRole("button", { name: "Download as zip" })).toBeDisabled();
  expect(makeBillPdf).not.toHaveBeenCalled();
  await act(async () => settings({ copies: "original", show_bank: false, share_message: "" }));
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Download as zip" }));
  await screen.findByText("3 PDFs made");
  expect(vi.mocked(makeBillPdf).mock.calls.every(([papers]) => papers.every((p) => p.firm.bank === null))).toBe(true);
});

test("a line lost during the zip stops after the current file, says so and retries the whole unfinished zip", async () => {
  serve(); open(); await ready();
  let finish!: (b: Blob) => void;
  vi.mocked(makeBillPdf).mockClear().mockImplementationOnce(() => new Promise((done) => { finish = done; }));
  fireEvent.click(screen.getByRole("button", { name: "Download as zip" }));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  act(() => __setNetState("offline"));
  await act(async () => finish(new Blob(["pdf"])));
  expect(await screen.findByText("You're offline, so the zip stopped after 1 of 3")).toBeInTheDocument();
  expect(makeBillPdf).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "Save the zip" })).not.toBeInTheDocument();
  act(() => __setNetState("online"));
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("3 PDFs made");
});

test("a ready zip is discarded when a cached bill changes, or a new selection replaces it", async () => {
  serve(); open(); await ready();
  fireEvent.click(screen.getByRole("button", { name: "Download as zip" }));
  await screen.findByRole("button", { name: "Save the zip" });
  const updated: BillOutcome = { kind: "bill", bill: toBillDetail(wireDetail({ total_amount: "87084.21" })) };
  act(() => qc.setQueryData(billQuery(412).queryKey, updated));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Save the zip" })).not.toBeInTheDocument());
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Download as zip" }));
  await screen.findByRole("button", { name: "Save the zip" });
  fireEvent.click(screen.getByRole("checkbox", { name: /^MEERA ORNAMENTS/ }));
  expect(screen.queryByRole("button", { name: "Save the zip" })).not.toBeInTheDocument();
  await ready(2);
});

test("a zip writer failure offers all the bills to try again, with no broken archive to save", async () => {
  serve(); open(); await ready();
  vi.mocked(zipFiles).mockRejectedValueOnce(new Error("could not write archive"));
  fireEvent.click(screen.getByRole("button", { name: "Download as zip" }));
  await screen.findByText("Made 0 of 3. 3 bills couldn't be made");
  expect(screen.queryByRole("button", { name: "Save the zip" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try these 3 again" }));
  expect(await screen.findByText("3 PDFs made")).toBeInTheDocument();
});

test("PDF code that cannot load says to reload instead of retrying a missing module", async () => {
  serve(); open(); await ready();
  vi.mocked(makeBillPdf).mockRejectedValue(new TypeError("Failed to fetch dynamically imported module"));
  fireEvent.click(screen.getByRole("button", { name: "Download as zip" }));
  await screen.findByText("Made 0 of 3. 3 bills couldn't be made");
  expect(screen.getByText(/The part of the app that makes PDFs didn't load/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reload the app" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Try these 3 again" })).not.toBeInTheDocument();
});

test("changing the selection during a held PDF discards the old job; unmount discards its result too", async () => {
  serve(); const view = open(); await ready();
  let finish!: (b: Blob) => void;
  vi.mocked(makeBillPdf).mockImplementationOnce(() => new Promise((done) => { finish = done; }));
  fireEvent.click(screen.getByRole("button", { name: "Download as zip" }));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  fireEvent.click(screen.getByRole("checkbox", { name: /^MEERA ORNAMENTS/ }));
  await act(async () => finish(new Blob(["old pdf"])));
  await ready(2);
  expect(screen.queryByRole("button", { name: "Save the zip" })).not.toBeInTheDocument();
  expect(screen.queryByText("3 PDFs made")).not.toBeInTheDocument();
  finish = undefined!;
  vi.mocked(makeBillPdf).mockImplementationOnce(() => new Promise((done) => { finish = done; }));
  fireEvent.click(screen.getByRole("button", { name: "Download as zip" }));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  view.unmount();
  await act(async () => finish(new Blob(["old pdf"])));
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
});
