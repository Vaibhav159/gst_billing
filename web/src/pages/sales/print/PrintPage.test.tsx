import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onlineManager, QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { __setNetState } from "@/core/api/network";
import { billQuery, type BillOutcome } from "@/core/api/sales";
import { AuthContext, type Me } from "@/core/auth/AuthProvider";
import { RoleContext } from "@/core/auth/role";
import { billFile } from "@/core/print/make";
import { printBill } from "@/core/print/model";
import { firmWith } from "@/core/print/testing";
import { refuse, salesServer, wireBin, wireDetail, type Route as ServerRoute } from "@/core/sales/fixtures";
import { toBillDetail } from "@/core/sales/wire";
import { ToastProvider } from "@/core/ui";
import { renderApp, stubAuth, testQueryClient } from "@/test/render";
import PrintPage from "./PrintPage";

// the PDF itself is core/print's (and its own tests'): here it's a stand-in made at once
vi.mock("@/core/print/make", async (real) => ({
  ...(await real<typeof import("@/core/print/make")>()),
  billFile: vi.fn(async (d: Parameters<typeof printBill>[0], o: { copies: string; showBank: boolean }) => ({
    blob: new Blob(["%PDF-1.3"], { type: "application/pdf" }), name: printBill(d, o).file, sheets: o.copies === "all" ? 3 : 1,
  })),
}));

const SETTINGS = { copies: "original", show_bank: true, share_message: "Namaste {customer}, your bill {number} for {total} from {firm} is attached. Thank you!", updated_at: null, updated_by: null };
const STAFF: Partial<Me> = { role: "staff", permissions: ["view", "bill.create", "bill.send", "customer.edit"] };
const VIEWER: Partial<Me> = { role: "viewer", permissions: ["view", "reports.export"] };
const SENT = { at: "2026-10-08T12:09:00+05:30", last_at: "2026-10-08T12:09:00+05:30", count: 1, via: "whatsapp", to: "" };

function serve(extra: ServerRoute[] = [], detail: Record<string, unknown> = {}) {
  return salesServer([
    ...extra,
    ["GET", "sales/412/", () => wireDetail(detail)],
    ["GET", "shop-settings/", () => SETTINGS],
    ["POST", "audit-logs/log/", () => ({ ok: true })],
  ]);
}
function open(path = "/sales/412/print", me?: Partial<Me>) {
  return renderApp(<Routes><Route path="/sales/:id/print" element={<PrintPage />} /></Routes>, { path, me });
}
/** As open, with a cache the test holds, so it can ask again from outside (after a send, an edit elsewhere, a reconnect). */
function openWith(qc: QueryClient, path = "/sales/412/print") {
  return render(
    <QueryClientProvider client={qc}><AuthContext.Provider value={stubAuth()}><RoleContext.Provider value="owner">
      <MemoryRouter initialEntries={[path]}><ToastProvider><Routes><Route path="/sales/:id/print" element={<PrintPage />} /></Routes></ToastProvider></MemoryRouter>
    </RoleContext.Provider></AuthContext.Provider></QueryClientProvider>,
  );
}
const papers = () => screen.getAllByRole("document", { name: /^Bill KGH\/2026-27\/31 on paper/ });
const phone = (on: boolean) => { (window as unknown as { __phone?: boolean }).__phone = on; };

// jsdom has no object URLs and no downloads: a file handed out is a link clicked with its name
beforeEach(() => {
  vi.spyOn(window, "open").mockImplementation(() => null);
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:pdf"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.mocked(billFile).mockClear(); vi.useRealTimers(); phone(false); });

test("it opens on the shop's defaults, the Original with bank details, and the tab and the file name say which bill", async () => {
  serve();
  open();
  expect(await screen.findByRole("document", { name: "Bill KGH/2026-27/31 on paper, original copy" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Print and share" })).toBeInTheDocument();
  expect(papers()).toHaveLength(1);
  expect(papers()[0]).toHaveTextContent("Company's Bank Details");
  expect(screen.getByText("Marked “ORIGINAL FOR RECIPIENT”. Chosen each time you print.")).toBeInTheDocument();
  expect(screen.getByText("KGH_2026-27_31.pdf")).toBeInTheDocument();
  await waitFor(() => expect(document.title).toBe("Print KGH/2026-27/31 · GST Billing"));
  await waitFor(() => expect(billFile).toHaveBeenCalledWith(expect.objectContaining({ id: 412 }), { copies: "original", showBank: true }));
  expect(screen.queryByRole("button", { name: /Make these the default/ })).not.toBeInTheDocument();
  // the papers again at full size, outside the app, for the browser's own print (Ctrl P)
  expect(document.querySelectorAll("[data-print-copy] [data-paper]")).toHaveLength(1);
});

test("All three copies: three sheets, each marked and each full-size view named after its paper; the owner makes the choice the default", async () => {
  const { calls } = serve([["PUT", "shop-settings/", ({ body }) => ({ ...SETTINGS, ...(body as object) })]]);
  open();
  await userEvent.click(await screen.findByRole("radio", { name: "All three" }));
  expect(papers().map((p) => p.getAttribute("aria-label"))).toEqual([
    "Bill KGH/2026-27/31 on paper, original copy", "Bill KGH/2026-27/31 on paper, duplicate copy", "Bill KGH/2026-27/31 on paper, triplicate copy",
  ]);
  expect(screen.getByText(/^3 A4 pages · named by its number/)).toBeInTheDocument();
  expect(document.querySelectorAll("[data-print-copy] [data-paper]")).toHaveLength(3);
  await userEvent.click(screen.getAllByRole("button", { name: "See it full size" })[1]);
  expect(screen.getByRole("region", { name: "Bill KGH/2026-27/31, duplicate copy, at full size" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("switch", { name: "Bank details on the bill" }));
  expect(papers()[0]).not.toHaveTextContent("Company's Bank Details");
  await userEvent.click(screen.getByRole("button", { name: "Make these the default for every bill" }));
  await waitFor(() => expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ copies: "all", show_bank: false }));
  expect(await screen.findByText("Saved as the default")).toBeInTheDocument();
});

test("counter staff choose copies for this print; making them the default is the owner's", async () => {
  serve();
  open("/sales/412/print", STAFF);
  await userEvent.click(await screen.findByRole("radio", { name: "Duplicate" }));
  expect(screen.getByText("For this print only. Only the owner can set the print defaults. Ask the owner if you need it.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Make these the default/ })).not.toBeInTheDocument();
});

test("Print opens the PDF in a tab and goes into the audit log; PDF downloads it", async () => {
  const { calls } = serve();
  open();
  const print = await screen.findByRole("button", { name: "Print" });
  await waitFor(() => expect(print).toBeEnabled());
  await userEvent.click(print);
  expect(window.open).toHaveBeenCalledWith("blob:pdf", "_blank");
  // the browser stopped the tab (window.open answered null): it says so
  expect(await screen.findByText("The PDF didn't open")).toBeInTheDocument();
  vi.mocked(window.open).mockReturnValue({ addEventListener: () => {} } as unknown as Window);
  await userEvent.click(print);
  await waitFor(() => expect(calls.filter((c) => c.url === "audit-logs/log/").map((c) => c.body)).toEqual([
    { action: "printed", entity: "invoice", entity_id: 412, entity_name: "#KGH/2026-27/31 - Anil Gupta", details: "Printed: original copy" },
  ]));
  await userEvent.click(screen.getByRole("button", { name: "PDF" }));
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  expect(await screen.findByText("Downloaded KGH_2026-27_31.pdf")).toBeInTheDocument();
  await waitFor(() => expect(calls.filter((c) => c.url === "audit-logs/log/")).toHaveLength(2));
});

test("a walk-in with no number: printing comes first; a cancelled bill isn't sent; a viewer is told why not", async () => {
  serve([], { customer: { id: 9, name: "Walk-in Customer", type: "walkin", address: "", city: "", state_name: "RAJASTHAN", state_code: "08", gst_number: "", gstin_valid: null, pan_number: "", pan: "", mobile_number: "", email: "" } });
  const { unmount } = open();
  expect(await screen.findByText("A walk-in has no number on record, so printing comes first.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send to a WhatsApp number" })).toBeInTheDocument();
  unmount();
  serve([], { status: "cancelled" });
  const second = open();
  expect(await screen.findByText(/This bill is cancelled, so it isn.t sent/)).toBeInTheDocument();
  second.unmount();
  serve();
  open("/sales/412/print", VIEWER);
  expect(await screen.findByText("Sending marks the bill sent. Only the owner and counter staff can send bills. Ask the owner if you need it. PDF, Print and Share still work.")).toBeInTheDocument();
});

test("a bill that isn't here, and a deleted one, say so", async () => {
  salesServer([["GET", "sales/999/", () => refuse(404, { detail: "No Invoice matches the given query." })], ["GET", "sales/205/", () => refuse(404, { detail: "This bill was deleted.", code: "deleted", binned: wireBin() })]]);
  const a = open("/sales/999/print");
  expect(await screen.findByText("This bill isn't here")).toBeInTheDocument();
  a.unmount();
  open("/sales/205/print");
  expect(await screen.findByText("This bill was deleted")).toBeInTheDocument();
});

test("a phone: the options sheet holds copies and bank details; Share hands the PDF to the share sheet", async () => {
  phone(true);
  const share = vi.fn(async () => {});
  Object.assign(navigator, { share, canShare: () => true });
  try {
    serve();
    open();
    const shareButton = await screen.findByRole("button", { name: "Share" });
    await waitFor(() => expect(shareButton).toBeEnabled());
    await userEvent.click(shareButton);
    await waitFor(() => expect(share).toHaveBeenCalledWith({ files: [expect.objectContaining({ name: "KGH_2026-27_31.pdf", type: "application/pdf" })], title: "KGH/2026-27/31" }));
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    await userEvent.click(screen.getByRole("button", { name: "Options" }));
    act(() => { vi.advanceTimersByTime(400); });
    const dialog = screen.getByRole("dialog", { name: "Print options" });
    await userEvent.selectOptions(within(dialog).getByLabelText("Copies"), "triplicate");
    expect(papers().map((p) => p.getAttribute("aria-label"))).toEqual(["Bill KGH/2026-27/31 on paper, triplicate copy"]);
  } finally {
    Object.assign(navigator, { share: undefined, canShare: undefined });
  }
});

/* ── The rulings that amend the brief ─────────────────── */

test("a bill on screen whose refresh fails, a 404 too, stays and says so; Try again asks again through the client, as the bill's own page does", async () => {
  let answer = () => wireDetail();
  const { calls } = salesServer([["GET", "sales/412/", () => answer()], ["GET", "shop-settings/", () => SETTINGS]]);
  const qc = testQueryClient();
  openWith(qc);
  expect(await screen.findByRole("document", { name: "Bill KGH/2026-27/31 on paper, original copy" })).toBeInTheDocument();
  // asked again (after a send, a reconnect…), and the bill is gone meanwhile: what's on screen stays, with a word
  answer = () => refuse(404, { detail: "No Invoice matches the given query." });
  await act(async () => { await qc.invalidateQueries({ queryKey: billQuery(412).queryKey }); });
  expect(await screen.findByText("Couldn't refresh this bill")).toBeInTheDocument();
  expect(screen.getByText("That isn't there any more. This is what was last loaded.")).toBeInTheDocument();
  expect(papers()).toHaveLength(1);
  expect(screen.queryByText("This bill isn't here")).not.toBeInTheDocument();
  answer = () => wireDetail();
  const asked = vi.spyOn(qc, "refetchQueries");
  const before = calls.filter((c) => c.url === "sales/412/").length;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByText("Couldn't refresh this bill")).not.toBeInTheDocument());
  expect(asked).toHaveBeenCalledWith({ queryKey: billQuery(412).queryKey });
  expect(calls.filter((c) => c.url === "sales/412/")).toHaveLength(before + 1);
});

test("Send waits for the shop's WhatsApp message, and the second click of a double click sends nothing: the first turns it into Send again in place", async () => {
  let settle: (s: unknown) => void = () => {};
  let sent: typeof SENT | null = null;
  const { calls } = serve([
    ["GET", "shop-settings/", () => new Promise((resolve) => { settle = resolve; })],
    ["POST", "sales/412/sent/", () => { sent = SENT; return { id: 412, sent }; }],
    ["GET", "sales/412/", () => wireDetail({ sent })],
  ]);
  open();
  const send = await screen.findByRole("button", { name: "Send on WhatsApp" });
  expect(send).toBeDisabled();
  expect(send).toHaveAttribute("title", "Getting the shop's WhatsApp message");
  await act(async () => { settle(SETTINGS); });
  await waitFor(() => expect(send).toBeEnabled());
  fireEvent.click(send, { detail: 2 });
  expect(window.open).not.toHaveBeenCalled();
  fireEvent.click(send, { detail: 1 });
  expect(window.open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/wa\.me\/919829041122\?text=Namaste%20Anil%20Gupta/), "_blank", "noopener");
  expect(await screen.findByRole("button", { name: "Send again" })).toBeInTheDocument();
  expect(calls.filter((c) => c.url === "sales/412/sent/")).toHaveLength(1);
});

test("a paper bill never presses for a send: its copy is offered beside Print and Share, never as the main step, on a desktop and a phone", async () => {
  serve([], { paper: true });
  const { unmount } = open();
  expect(await screen.findByRole("button", { name: "Send a copy on WhatsApp" })).toHaveAttribute("data-variant", "secondary");
  unmount();
  phone(true);
  serve([], { paper: true });
  open();
  expect(await screen.findByRole("button", { name: "Share" })).toHaveAttribute("data-variant", "primary");
  expect(screen.getByRole("button", { name: "Send" })).toHaveAttribute("data-variant", "secondary");
});

test("the PDF follows the bill on screen: a refresh that changed what prints makes it again; one that changed nothing that prints keeps the one made (Ruling 1E-8)", async () => {
  let detail = wireDetail({ firm: firmWith({ signature_url: "/api/media/signatures/3.png?s=abc" }) });
  salesServer([["GET", "sales/412/", () => detail], ["GET", "shop-settings/", () => SETTINGS]]);
  const qc = testQueryClient();
  openWith(qc);
  await waitFor(() => expect(billFile).toHaveBeenCalledTimes(1));
  // sent meanwhile, and the signature's link signed afresh: the bill changed, but not what it prints
  detail = { ...detail, sent: SENT, firm: firmWith({ signature_url: "/api/media/signatures/3.png?s=def" }) };
  await act(async () => { await qc.invalidateQueries({ queryKey: billQuery(412).queryKey }); });
  expect(await screen.findByRole("button", { name: "Send again" })).toBeInTheDocument();
  expect(billFile).toHaveBeenCalledTimes(1);
  // changed elsewhere: its note
  detail = { ...detail, notes: "Hallmarked by BIS" };
  await act(async () => { await qc.invalidateQueries({ queryKey: billQuery(412).queryKey }); });
  await waitFor(() => expect(billFile).toHaveBeenCalledTimes(2));
  expect(vi.mocked(billFile).mock.calls[1][0]).toMatchObject({ id: 412, notes: "Hallmarked by BIS" });
});

test("offline: a print page with no bill yet says so, and the bill comes when the internet is back; a PDF that can't be made says why and offers Try again", async () => {
  serve();
  vi.mocked(billFile).mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module")); // react-pdf's code didn't come
  onlineManager.setOnline(false);
  act(() => __setNetState("offline"));
  try {
    open();
    expect(await screen.findByText("You're offline")).toBeInTheDocument();
    expect(screen.getByText("This bill can't load without the internet. Nothing you saved is lost; it shows again when you're back online.")).toBeInTheDocument();
    act(() => { onlineManager.setOnline(true); });
    expect(await screen.findByRole("document", { name: "Bill KGH/2026-27/31 on paper, original copy" })).toBeInTheDocument();
    expect(await screen.findByText("The PDF wasn't made")).toBeInTheDocument();
    expect(screen.getByText("Something stopped it part way. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print" })).toBeDisabled();
    // the connection drops: the words say why
    act(() => __setNetState("offline"));
    expect(screen.getByText("You're offline, so the PDF wasn't made. It needs the internet; try again when you're back.")).toBeInTheDocument();
    act(() => __setNetState("online"));
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Print" })).toBeEnabled());
    expect(billFile).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("The PDF wasn't made")).not.toBeInTheDocument();
  } finally {
    onlineManager.setOnline(true);
    act(() => __setNetState("online"));
  }
});

test("offline with the bill here but not the shop's defaults: the PDF is made with the choices on screen, never left waiting for them", async () => {
  serve();
  const qc = testQueryClient();
  const here: BillOutcome = { kind: "bill", bill: toBillDetail(wireDetail()) };
  qc.setQueryData(billQuery(412).queryKey, here);
  onlineManager.setOnline(false);
  act(() => __setNetState("offline"));
  try {
    openWith(qc);
    expect(await screen.findByRole("document", { name: "Bill KGH/2026-27/31 on paper, original copy" })).toBeInTheDocument();
    await waitFor(() => expect(billFile).toHaveBeenCalledWith(expect.objectContaining({ id: 412 }), { copies: "original", showBank: true }));
  } finally {
    onlineManager.setOnline(true);
    act(() => __setNetState("online"));
  }
});
