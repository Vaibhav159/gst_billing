import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onlineManager, QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { __setNetState } from "@/core/api/network";
import { billQuery, type BillOutcome } from "@/core/api/sales";
import { AuthContext } from "@/core/auth/AuthProvider";
import { RoleContext } from "@/core/auth/role";
import { makeBillPdf } from "@/core/print/make";
import { buyerWith, firmWith, rows } from "@/core/print/testing";
import { refuse, salesServer, wireBin, wireDetail, wireRow, type Call } from "@/core/sales/fixtures";
import { toBillDetail, toBillRow } from "@/core/sales/wire";
import { ToastProvider } from "@/core/ui";
import { renderApp, stubAuth, testQueryClient } from "@/test/render";
import BatchPrint from "./BatchPrint";

vi.mock("@/core/print/make", async (real) => ({
  ...(await real<typeof import("@/core/print/make")>()),
  makeBillPdf: vi.fn(async () => new Blob(["%PDF-1.3"], { type: "application/pdf" })),
}));

const MEERA = { name: "MEERA ORNAMENTS", address: "3 Sandbox Bazaar, Udaipur, Rajasthan", gst_number: "08AAKFS4821M1ZQ", state_name: "RAJASTHAN", state_code: "08", pan_number: "AAKFS4821M",
  mobile_number: "9000000002", email: "", bank_name: "", bank_account_number: "", bank_ifsc_code: "", bank_branch_name: "", invoice_prefix: "MO", signature_url: null, frozen: true };
function serve() {
  return salesServer([
    ["GET", "sales/412/", () => wireDetail()],
    ["GET", "sales/413/", () => wireDetail({ id: 413, invoice_number: "KGH/2026-27/32", counter: 32, total_amount: "12000.00" })],
    ["GET", "sales/501/", () => wireDetail({ id: 501, business: 2, business_name: "MEERA ORNAMENTS", invoice_number: "MO/2026-27/7", counter: 7, firm: MEERA, total_amount: "5000.00" })],
    ["GET", "sales/205/", () => refuse(404, { detail: "This bill was deleted.", code: "deleted", binned: wireBin() })],
    ["GET", "shop-settings/", () => ({ copies: "original", show_bank: true, share_message: "", updated_at: null, updated_by: null })],
    ["POST", "audit-logs/log/", () => ({ ok: true })],
  ]);
}
const open = (ids: string) => renderApp(<Routes><Route path="/sales/batch" element={<BatchPrint />} /></Routes>, { path: `/sales/batch?ids=${ids}` });
const papers = () => screen.getAllByRole("document");

beforeEach(() => {
  vi.spyOn(window, "open").mockImplementation(() => ({ addEventListener: () => {} }) as unknown as Window);
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:pdf"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.mocked(makeBillPdf).mockClear(); vi.useRealTimers(); });

test("three bills from two firms: in the order ticked, firm by firm in words; Print sends one PDF of every page and is logged", async () => {
  const { calls } = serve();
  open("412,413,501");
  expect(await screen.findByRole("heading", { level: 1, name: "Batch print · 3 bills" })).toBeInTheDocument();
  expect(screen.getByText("3 bills from 2 firms: KIRAN GOLD HOUSE (2) and MEERA ORNAMENTS (1) · 3 A4 pages · ₹1,04,083.21")).toBeInTheDocument();
  expect(papers().map((p) => p.getAttribute("aria-label"))).toEqual([
    "Bill KGH/2026-27/31 on paper, original copy", "Bill KGH/2026-27/32 on paper, original copy", "Bill MO/2026-27/7 on paper, original copy",
  ]);
  expect(screen.getByText(/MEERA ORNAMENTS has no account saved, so its bills print without one/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("radio", { name: "All three" }));
  expect(papers()).toHaveLength(9);
  const print = screen.getByRole("button", { name: "Print all 9 pages" });
  await waitFor(() => expect(print).toBeEnabled());
  expect(vi.mocked(makeBillPdf).mock.lastCall?.[0].map((b) => b.number)).toEqual(["KGH/2026-27/31", "KGH/2026-27/32", "MO/2026-27/7"]);
  expect(vi.mocked(makeBillPdf).mock.lastCall?.[1]).toBe("all");
  await userEvent.click(print);
  expect(window.open).toHaveBeenCalledWith("blob:pdf", "_blank");
  await waitFor(() => expect(calls.find((c) => c.url === "audit-logs/log/")?.body).toEqual({
    action: "printed", entity: "invoice", entity_id: 0, entity_name: "Batch print (3 bills)",
    details: "3 bills from 2 firms: KIRAN GOLD HOUSE (KGH/2026-27/31, KGH/2026-27/32) and MEERA ORNAMENTS (MO/2026-27/7) · 9 pages · three copies each",
  }));
}, 15_000); // the file's first: nine papers twice, and the page's code coming in: past 5 s on a busy 2-CPU machine (it passes alone)

test("One combined PDF downloads it, named for the day", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-10-08T10:00:00+05:30"));
  serve();
  open("412,501");
  const combined = await screen.findByRole("button", { name: "One combined PDF" });
  await waitFor(() => expect(combined).toBeEnabled());
  await userEvent.click(combined);
  expect(await screen.findByText("Downloaded Sales_2_bills_08Oct.pdf")).toBeInTheDocument();
});

test("a bill deleted after it was picked is left out with a note; × leaves one out; nothing picked says so", async () => {
  serve();
  const view = open("412,205");
  expect(await screen.findByText("1 bill left out")).toBeInTheDocument();
  expect(papers()).toHaveLength(1);
  await userEvent.click(within(screen.getByRole("complementary", { name: "Batch print options" })).getByRole("button", { name: "Leave KGH/2026-27/31 out" }));
  expect(screen.getByText("Every bill is left out")).toBeInTheDocument();
  view.unmount();
  open("");
  expect(await screen.findByText("No bills picked")).toBeInTheDocument();
});

/* ── The rulings that amend the brief ─────────────────── */

const SETTINGS = { copies: "original", show_bank: true, share_message: "", updated_at: null, updated_by: null };
/** As open, with a cache the test holds: it can hold bills already, be asked again from outside, and be watched. */
function openWith(qc: QueryClient, ids: string) {
  return render(
    <QueryClientProvider client={qc}><AuthContext.Provider value={stubAuth()}><RoleContext.Provider value="owner">
      <MemoryRouter initialEntries={[`/sales/batch?ids=${ids}`]}><ToastProvider><Routes><Route path="/sales/batch" element={<BatchPrint />} /></Routes></ToastProvider></MemoryRouter>
    </RoleContext.Provider></AuthContext.Provider></QueryClientProvider>,
  );
}
const options = () => within(screen.getByRole("complementary", { name: "Batch print options" }));
/** The papers again, at full size, for the browser's own print (Ctrl P). */
const printCopy = () => [...document.querySelectorAll("[data-print-copy] [data-paper]")];
const billAsks = (calls: { url: string }[]) => calls.filter((c) => /^sales\/\d+\/$/.test(c.url)).map((c) => c.url);
/** KGH/2026-27/31, already on this device (opened a moment ago). */
const HERE: BillOutcome = { kind: "bill", bill: toBillDetail(wireDetail()) };

test("for the browser's own print every paper stacks at full size, and each full-size view is named after its paper: bill, copy and page (Ruling 1); nothing is rounded, and a buyer's PAN shows only where there is one", async () => {
  salesServer([
    ["GET", "sales/412/", () => wireDetail()],
    // two A4 pages, to a buyer with a PAN and no GSTIN
    ["GET", "sales/413/", () => wireDetail({ id: 413, invoice_number: "KGH/2026-27/32", counter: 32, lines: rows(30), customer: buyerWith({ pan: "AAKFS4821M" }) })],
    ["GET", "shop-settings/", () => ({ ...SETTINGS, copies: "all" })],
  ]);
  open("412,413");
  expect(await screen.findByRole("heading", { level: 1, name: "Batch print · 2 bills" })).toBeInTheDocument();
  // the shop prints all three copies: each bill's together, every page of each
  expect(screen.getByRole("radio", { name: "All three" })).toBeChecked();
  expect(papers().map((p) => p.getAttribute("aria-label"))).toEqual([
    "Bill KGH/2026-27/31 on paper, original copy", "Bill KGH/2026-27/31 on paper, duplicate copy", "Bill KGH/2026-27/31 on paper, triplicate copy",
    "Bill KGH/2026-27/32 on paper, original copy, page 1 of 2", "Bill KGH/2026-27/32 on paper, original copy, page 2 of 2",
    "Bill KGH/2026-27/32 on paper, duplicate copy, page 1 of 2", "Bill KGH/2026-27/32 on paper, duplicate copy, page 2 of 2",
    "Bill KGH/2026-27/32 on paper, triplicate copy, page 1 of 2", "Bill KGH/2026-27/32 on paper, triplicate copy, page 2 of 2",
  ]);
  expect(screen.getByText("Page 7 of 9 · bill 2 of 2, KGH/2026-27/32 · duplicate copy · page 2 of 2")).toBeInTheDocument();
  expect(document.querySelectorAll("[data-print-copy] [data-paper]")).toHaveLength(9);
  const full = screen.getAllByRole("button", { name: "See it full size" });
  await userEvent.click(full[6]);
  expect(screen.getByRole("region", { name: "Bill KGH/2026-27/32, duplicate copy, page 2 of 2, at full size" })).toBeInTheDocument();
  await userEvent.click(full[1]);
  expect(screen.getByRole("region", { name: "Bill KGH/2026-27/31, duplicate copy, at full size" })).toBeInTheDocument();
  // to the paisa (Ruling 1B-12): both bills' ₹87,083.21
  expect(screen.getByText("2 bills from KIRAN GOLD HOUSE · 9 A4 pages · ₹1,74,166.42")).toBeInTheDocument();
  // the PAN only where the buyer has one (Ruling 1A-20)
  expect(papers()[3]).toHaveTextContent("GSTIN/UIN : Unregistered · PAN : AAKFS4821M");
  expect(papers()[0]).toHaveTextContent("GSTIN/UIN : Unregistered");
  expect(papers()[0]).not.toHaveTextContent("· PAN :");
}, 15_000);

test("a bill whose read fails is never dropped silently: it's named, Print and the PDF wait for it, Try again asks again for those alone through the client, and leaving one out prints the rest (Ruling 2)", async () => {
  let kgh32: () => unknown = () => refuse(500, {});
  const { calls } = salesServer([
    ["GET", "sales/412/", () => wireDetail()],
    ["GET", "sales/413/", () => kgh32()],
    ["GET", "sales/501/", () => refuse(503, {})],
    ["GET", "shop-settings/", () => SETTINGS],
    ["POST", "audit-logs/log/", () => ({ ok: true })],
  ]);
  const qc = testQueryClient();
  // a list on this device has 413's number; nothing here has 501's
  qc.setQueryData(["sales", "today", "2026-10-08"], [toBillRow(wireRow({ id: 413, invoice_number: "KGH/2026-27/32", counter: 32 }))]);
  openWith(qc, "412,413,501");
  const note = await screen.findByRole("alert");
  expect(note).toHaveTextContent("KGH/2026-27/32 and 1 more bill didn't load");
  expect(note).toHaveTextContent("The app couldn't reach the shop's records just now, so the batch waits for them. Try again, or leave them out to print the rest.");
  expect(papers()).toHaveLength(1);
  // the browser's own print (Ctrl P) waits for them too: nothing to print but the whole batch
  expect(printCopy()).toHaveLength(0);
  expect(options().getByRole("link", { name: "KGH/2026-27/32" })).toHaveAttribute("href", "/sales/413");
  const print = screen.getByRole("button", { name: "Print 1 page" });
  expect(print).toBeDisabled();
  expect(print).toHaveAttribute("title", "Waiting for the 2 bills that didn't load");
  expect(screen.getByRole("button", { name: "One combined PDF" })).toBeDisabled();
  expect(makeBillPdf).not.toHaveBeenCalled();
  // Try again: those two asked again, through the client, and nothing else
  kgh32 = () => wireDetail({ id: 413, invoice_number: "KGH/2026-27/32", counter: 32, total_amount: "12000.00" });
  const asked = vi.spyOn(qc, "refetchQueries");
  await userEvent.click(within(note).getByRole("button", { name: "Try again" }));
  expect(asked.mock.calls).toEqual([[{ queryKey: billQuery(413).queryKey }], [{ queryKey: billQuery(501).queryKey }]]);
  await waitFor(() => expect(papers()).toHaveLength(2));
  expect(billAsks(calls)).toEqual(["sales/412/", "sales/413/", "sales/501/", "sales/413/", "sales/501/"]);
  expect(screen.getByRole("alert")).toHaveTextContent("1 bill didn't load");
  expect(screen.getByRole("alert")).toHaveTextContent("The app couldn't reach the shop's records just now, so the batch waits for it. Try again, or leave it out to print the rest.");
  expect(screen.getByRole("button", { name: "Print all 2 pages" })).toHaveAttribute("title", "Waiting for the bill that didn't load");
  expect(screen.getByRole("button", { name: "Print all 2 pages" })).toBeDisabled();
  expect(printCopy()).toHaveLength(0);
  // left out, the rest print; the focus goes to the bill now last in the list
  await userEvent.click(options().getByRole("button", { name: "Leave the 3rd bill out (it didn't load)" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(options().getByRole("button", { name: "Leave KGH/2026-27/32 out" })).toHaveFocus();
  await waitFor(() => expect(screen.getByRole("button", { name: "Print all 2 pages" })).toBeEnabled());
  expect(printCopy().map((p) => p.getAttribute("aria-label"))).toEqual(["Bill KGH/2026-27/31 on paper, original copy", "Bill KGH/2026-27/32 on paper, original copy"]);
  expect(vi.mocked(makeBillPdf).mock.lastCall?.[0].map((b) => b.number)).toEqual(["KGH/2026-27/31", "KGH/2026-27/32"]);
});

/** The two bills a test asks for, each its own (KGH/2026-27/31 and /32). */
const twoBills = (c: Call) => (c.url === "sales/413/" ? wireDetail({ id: 413, invoice_number: "KGH/2026-27/32", counter: 32 }) : wireDetail());
/** The device offline for `run`: TanStack holds its requests, and the app says so; back online after, whatever happens. */
async function offline(run: () => Promise<void>) {
  onlineManager.setOnline(false);
  act(() => __setNetState("offline"));
  try {
    await run();
  } finally {
    onlineManager.setOnline(true);
    act(() => __setNetState("online"));
  }
}

test("none of the bills came: why, with Try again for them; offline, that it's offline, and they come by themselves once the internet is back", async () => {
  let answer: (c: Call) => unknown = () => refuse(500, {});
  const { calls } = salesServer([["GET", /^sales\/41[23]\/$/, (c) => answer(c)], ["GET", "shop-settings/", () => SETTINGS]]);
  const qc = testQueryClient();
  const view = openWith(qc, "412,413");
  expect(await screen.findByText("Couldn't load the bills")).toBeInTheDocument();
  answer = twoBills;
  const asked = vi.spyOn(qc, "refetchQueries");
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(asked.mock.calls).toEqual([[{ queryKey: billQuery(412).queryKey }], [{ queryKey: billQuery(413).queryKey }]]);
  expect(await screen.findByRole("heading", { level: 1, name: "Batch print · 2 bills" })).toBeInTheDocument();
  view.unmount();
  await offline(async () => {
    const before = calls.length;
    openWith(testQueryClient(), "412,413");
    expect(await screen.findByText("You're offline")).toBeInTheDocument();
    expect(screen.getByText("The bills can't load without the internet. Nothing you saved is lost; it shows again when you're back online.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(calls.length).toBe(before);
    act(() => { onlineManager.setOnline(true); __setNetState("online"); });
    expect(await screen.findByRole("heading", { level: 1, name: "Batch print · 2 bills" })).toBeInTheDocument();
  });
});

test("offline with one bill this device has: it shows, the other waits for the internet; once it's back the batch stays on screen, choices and all, and Print waits for that bill", async () => {
  let arrive = () => {};
  const { calls } = salesServer([
    ["GET", /^sales\/41[23]\/$/, (c) => new Promise((resolve) => { arrive = () => resolve(twoBills(c)); })],
    ["GET", "shop-settings/", () => SETTINGS],
  ]);
  await offline(async () => {
    const qc = testQueryClient();
    qc.setQueryData(billQuery(412).queryKey, HERE);
    openWith(qc, "412,413");
    const note = await screen.findByRole("alert");
    expect(note).toHaveTextContent("1 bill didn't load");
    expect(note).toHaveTextContent("You're offline, so the batch waits for it. It loads by itself when the internet is back, or leave it out to print the rest.");
    expect(within(note).queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(papers()).toHaveLength(1);
    await userEvent.click(screen.getByRole("radio", { name: "All three" }));
    act(() => { onlineManager.setOnline(true); __setNetState("online"); });
    await waitFor(() => expect(billAsks(calls)).toEqual(["sales/413/"]));
    expect(screen.queryByRole("status", { name: "Loading the bills" })).not.toBeInTheDocument();
    expect(options().getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const print = screen.getByRole("button", { name: "Print all 3 pages" });
    expect(print).toHaveAttribute("title", "Waiting for the bill still loading");
    expect(print).toBeDisabled();
    expect(screen.getByRole("button", { name: "One combined PDF" })).toBeDisabled();
    expect(makeBillPdf).not.toHaveBeenCalled();
    expect(printCopy()).toHaveLength(0);
    await act(async () => arrive());
    await waitFor(() => expect(papers()).toHaveLength(6));
    expect(printCopy()).toHaveLength(6);
    expect(screen.getByRole("radio", { name: "All three" })).toBeChecked();
    await waitFor(() => expect(screen.getByRole("button", { name: "Print all 6 pages" })).toBeEnabled());
    expect(vi.mocked(makeBillPdf).mock.calls.map(([bills, copies]) => [bills.map((b) => b.number), copies])).toEqual([[["KGH/2026-27/31", "KGH/2026-27/32"], "all"]]);
  });
});

test("a bill on screen whose refresh fails stays, and says so with Try again for it alone", async () => {
  let answer = () => wireDetail();
  salesServer([["GET", "sales/412/", () => answer()], ["GET", "sales/501/", () => wireDetail({ id: 501, business: 2, business_name: "MEERA ORNAMENTS", invoice_number: "MO/2026-27/7", firm: MEERA })], ["GET", "shop-settings/", () => SETTINGS]]);
  const qc = testQueryClient();
  openWith(qc, "412,501");
  expect(await screen.findByRole("heading", { level: 1, name: "Batch print · 2 bills" })).toBeInTheDocument();
  answer = () => refuse(500, {});
  await act(async () => { await qc.invalidateQueries({ queryKey: billQuery(412).queryKey }); });
  expect(await screen.findByText("Couldn't refresh KGH/2026-27/31")).toBeInTheDocument();
  expect(screen.getByText("The app couldn't reach the shop's records just now, so this is what was last loaded.")).toBeInTheDocument();
  expect(papers()).toHaveLength(2);
  answer = () => wireDetail();
  const asked = vi.spyOn(qc, "refetchQueries");
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(asked.mock.calls).toEqual([[{ queryKey: billQuery(412).queryKey }]]);
  await waitFor(() => expect(screen.queryByText("Couldn't refresh KGH/2026-27/31")).not.toBeInTheDocument());
});

test("the batch follows the bills on screen: a refresh that changed what prints makes it again; one that changed nothing on paper (a signature's link signed afresh) keeps the one made (Ruling 1E-8)", async () => {
  let detail = wireDetail({ firm: firmWith({ signature_url: "/api/media/signatures/3.png?s=abc" }) });
  salesServer([["GET", "sales/412/", () => detail], ["GET", "sales/501/", () => wireDetail({ id: 501, business: 2, business_name: "MEERA ORNAMENTS", invoice_number: "MO/2026-27/7", firm: MEERA })], ["GET", "shop-settings/", () => SETTINGS]]);
  const qc = testQueryClient();
  openWith(qc, "412,501");
  await waitFor(() => expect(screen.getByRole("button", { name: "Print all 2 pages" })).toBeEnabled());
  expect(makeBillPdf).toHaveBeenCalledTimes(1);
  detail = { ...detail, sent: { at: "2026-10-08T12:09:00+05:30", last_at: "2026-10-08T12:09:00+05:30", count: 1, via: "whatsapp", to: "" }, firm: firmWith({ signature_url: "/api/media/signatures/3.png?s=def" }) };
  await act(async () => { await qc.invalidateQueries({ queryKey: billQuery(412).queryKey }); });
  await waitFor(() => expect(document.querySelector("img[alt^='Signature for']")).toHaveAttribute("src", "/api/media/signatures/3.png?s=def"));
  expect(makeBillPdf).toHaveBeenCalledTimes(1);
  detail = { ...detail, notes: "Hallmarked by BIS" };
  await act(async () => { await qc.invalidateQueries({ queryKey: billQuery(412).queryKey }); });
  await waitFor(() => expect(makeBillPdf).toHaveBeenCalledTimes(2));
  expect(vi.mocked(makeBillPdf).mock.lastCall?.[0][0].note).toBe("Hallmarked by BIS");
});

test("each bill is one request, repeats dropped and none for a bill this device has, and nothing asks again on a timer or when the window comes back (Ruling 3)", async () => {
  const { calls } = serve();
  const qc = testQueryClient();
  qc.setQueryData(billQuery(412).queryKey, HERE);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"], shouldAdvanceTime: true });
  openWith(qc, "412,413,412,501");
  expect(await screen.findByRole("heading", { level: 1, name: "Batch print · 3 bills" })).toBeInTheDocument();
  expect(billAsks(calls)).toEqual(["sales/413/", "sales/501/"]);
  // an hour on the page, and the window left and come back to: nothing more is asked
  await act(async () => { await vi.advanceTimersByTimeAsync(60 * 60_000); });
  act(() => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("focus")); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(billAsks(calls)).toEqual(["sales/413/", "sales/501/"]);
  expect(calls.filter((c) => c.url === "shop-settings/")).toHaveLength(1);
});

test("a batch takes up to 30 bills, in the order picked: it says so, and the rest aren't asked for (Rulings 3 and 1E-16)", async () => {
  const { calls } = salesServer([["GET", /^sales\/\d+\/$/, () => new Promise(() => {})], ["GET", "shop-settings/", () => SETTINGS]]);
  open(Array.from({ length: 33 }, (_, i) => i + 1).join(","));
  expect(await screen.findByText("Pick up to 30 bills")).toBeInTheDocument();
  expect(screen.getByText("You picked 33 bills, so the first 30 are here, in the order you picked them. Print them, then tick the other 3 bills in the sales list.")).toBeInTheDocument();
  expect(screen.getByRole("status", { name: "Loading the bills" })).toBeInTheDocument();
  await waitFor(() => expect(billAsks(calls)).toHaveLength(30));
  expect(billAsks(calls)).toEqual(Array.from({ length: 30 }, (_, i) => `sales/${i + 1}/`));
});

test("Print all and One combined PDF act within the press itself: the PDF was made before it, so nothing waits first (Ruling 4); a tab the browser stopped says so and isn't logged", async () => {
  const { calls } = serve();
  open("412,501");
  const print = await screen.findByRole("button", { name: "Print all 2 pages" });
  await waitFor(() => expect(print).toBeEnabled());
  fireEvent.click(print);
  expect(window.open).toHaveBeenCalledWith("blob:pdf", "_blank");
  fireEvent.click(screen.getByRole("button", { name: "One combined PDF" }));
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  expect(URL.createObjectURL).toHaveBeenLastCalledWith(await vi.mocked(makeBillPdf).mock.results[0].value);
  vi.mocked(window.open).mockReturnValueOnce(null);
  fireEvent.click(print);
  expect(await screen.findByText("The batch didn't open")).toBeInTheDocument();
  expect(screen.getByText("The browser stopped the new tab. Allow pop-ups for this app to print from it, or use One combined PDF.")).toBeInTheDocument();
  await waitFor(() => expect(calls.filter((c) => c.url === "audit-logs/log/").map((c) => (c.body as { action: string }).action)).toEqual(["printed", "exported"]));
  expect(calls.filter((c) => c.url === "audit-logs/log/")[1].body).toEqual({
    action: "exported", entity: "invoice", entity_id: 0, entity_name: "Combined PDF (2 bills)",
    details: "2 bills from 2 firms: KIRAN GOLD HOUSE (KGH/2026-27/31) and MEERA ORNAMENTS (MO/2026-27/7) · 2 pages",
  });
});

test("a batch that couldn't be made says why: the part of the app that makes PDFs not loading says to reload the page, with no Try again (it can't help); anything else offers Try again, at work at once", async () => {
  serve();
  vi.mocked(makeBillPdf).mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module: https://bills.example/assets/react-pdf.browser-Bx1c2.js"));
  const view = open("412");
  const note = (await screen.findByText("The batch wasn't made")).closest<HTMLElement>("[role=alert]")!;
  expect(note).toHaveTextContent("The part of the app that makes PDFs didn't load. Reload the page, then try again.");
  expect(within(note).queryByRole("button")).not.toBeInTheDocument();
  const print = screen.getByRole("button", { name: "Print 1 page" });
  expect(print).toBeDisabled();
  expect(print).toHaveAttribute("title", "The PDF couldn't be made. Reload the page.");
  // offline, the reload waits for the internet
  act(() => __setNetState("offline"));
  expect(note).toHaveTextContent("You're offline, and the part of the app that makes PDFs didn't load. Reload the page once the internet is back.");
  act(() => __setNetState("online"));
  view.unmount();
  // anything else: Try again is at work at once, and keeps the note until the batch is made or fails again
  let failed: (e: Error) => void = () => {};
  let made: (b: Blob) => void = () => {};
  vi.mocked(makeBillPdf)
    .mockRejectedValueOnce(new Error("the font didn't load"))
    .mockReturnValueOnce(new Promise<Blob>((_, reject) => { failed = reject; }))
    .mockReturnValueOnce(new Promise<Blob>((resolve) => { made = resolve; }));
  open("412");
  expect(await screen.findByText("Something stopped it part way. Try again.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Print 1 page" })).toHaveAttribute("title", "The PDF couldn't be made. Try again.");
  act(() => __setNetState("offline"));
  expect(screen.getByText("You're offline, so the batch wasn't made. It needs the internet; try again when you're back.")).toBeInTheDocument();
  act(() => __setNetState("online"));
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByRole("button", { name: "Trying…" })).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("button", { name: "Making the batch…" })).toHaveAttribute("aria-busy", "true");
  await act(async () => failed(new Error("the font didn't load")));
  expect(screen.getByText("Something stopped it part way. Try again.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByRole("button", { name: "Trying…" })).toHaveAttribute("aria-busy", "true");
  await act(async () => made(new Blob(["%PDF-1.3"], { type: "application/pdf" })));
  expect(screen.queryByText("The batch wasn't made")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Print 1 page" })).toBeEnabled();
});

test("a refusal's own words stand as they are; two bills this device has no number for are told apart by their place; with only bills that didn't load kept, Print says just that", async () => {
  salesServer([
    ["GET", "sales/412/", () => wireDetail()],
    ["GET", /^sales\/41[34]\/$/, () => refuse(429, { detail: "Request was throttled." })],
    ["GET", "shop-settings/", () => SETTINGS],
  ]);
  openWith(testQueryClient(), "412,413,414");
  const note = await screen.findByRole("alert");
  expect(note).toHaveTextContent(/^2 bills didn't loadToo many tries\. Wait a minute, then try again\. You can leave them out to print the rest\.Try again$/);
  expect(options().getByText("The 2nd bill picked")).toBeInTheDocument();
  expect(options().getByText("The 3rd bill picked")).toBeInTheDocument();
  expect(options().getByRole("button", { name: "Leave the 2nd bill out (it didn't load)" })).toBeInTheDocument();
  // only the bills that didn't load kept: nothing to print yet, and the words say no more than that
  await userEvent.click(options().getByRole("button", { name: "Leave KGH/2026-27/31 out" }));
  expect(screen.getByRole("button", { name: "Print" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent(/^2 bills didn't loadToo many tries\. Wait a minute, then try again\.Try again$/);
  expect(printCopy()).toHaveLength(0);
});

test("the audit log names every bill, firm by firm, however many the batch holds (its details hold any length)", async () => {
  const bill = (c: Call) => {
    const id = Number(c.url.split("/")[1]);
    return id === 501 ? wireDetail({ id: 501, business: 2, business_name: "MEERA ORNAMENTS", invoice_number: "MO/2026-27/7", firm: MEERA, total_amount: "5000.00" }) : wireDetail({ id, invoice_number: `KGH/2026-27/${id}`, counter: id });
  };
  const { calls } = salesServer([["GET", /^sales\/\d+\/$/, bill], ["GET", "shop-settings/", () => SETTINGS], ["POST", "audit-logs/log/", () => ({ ok: true })]]);
  open("41,42,43,44,45,501");
  const combined = await screen.findByRole("button", { name: "One combined PDF" });
  await waitFor(() => expect(combined).toBeEnabled());
  fireEvent.click(combined);
  await waitFor(() => expect(calls.find((c) => c.url === "audit-logs/log/")?.body).toEqual({
    action: "exported", entity: "invoice", entity_id: 0, entity_name: "Combined PDF (6 bills)",
    details: "6 bills from 2 firms: KIRAN GOLD HOUSE (KGH/2026-27/41, KGH/2026-27/42, KGH/2026-27/43, KGH/2026-27/44, KGH/2026-27/45) and MEERA ORNAMENTS (MO/2026-27/7) · 6 pages",
  }));
  // the screen keeps its short words
  expect(screen.getByText("6 bills from 2 firms: KIRAN GOLD HOUSE (5) and MEERA ORNAMENTS (1) · 6 A4 pages · ₹4,40,416.05")).toBeInTheDocument();
});
