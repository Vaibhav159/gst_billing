import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onlineManager, QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { __setNetState } from "@/core/api/network";
import { queryClient } from "@/core/api/query";
import { billQuery, type BillOutcome } from "@/core/api/sales";
import { AuthContext, type Me } from "@/core/auth/AuthProvider";
import { RoleContext } from "@/core/auth/role";
import { billFile, type PdfFile } from "@/core/print/make";
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

describe.each([[false, "desktop"], [true, "phone"]] as const)("the buyer's address note on %s (%s)", (on, _device) => {
  const namedText = "A bill of ₹50,000 or more to a buyer without a GSTIN needs the buyer's address (CGST Rule 46(f)). Add Anil Gupta's address.";
  const walkinText = "A bill of ₹50,000 or more to a buyer without a GSTIN needs the buyer's name and address (CGST Rule 46(f)). Put the bill in the buyer's name, with their address, not Walk-in.";
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-11T12:00:00+05:30"));
    phone(on);
  });

  test.each([["person", namedText], ["walkin", walkinText]] as const)("shows the %s flag's own text above the preview, outside the printed paper and PDF", async (type, text) => {
    const customer = { ...(wireDetail().customer as Record<string, unknown>), type, address: "", ...(type === "walkin" ? { name: "Walk-in Customer", mobile_number: "" } : {}) };
    const itax = [{ kind: "b2c_address", short: "Name and address needed", text }];
    const detail = { customer, itax };
    serve([], detail);
    open();
    const note = await screen.findByText(text);
    const paper = papers()[0];
    expect(note.compareDocumentPosition(paper) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(paper).not.toHaveTextContent(text);
    const printed = document.querySelector("[data-print-copy]")!;
    expect(printed).not.toHaveTextContent(text);
    expect(printed.parentElement).toBe(document.body);
    // Ctrl P prints this separate tree alone; the PDF uses the unchanged paper model.
    expect(printBill(toBillDetail(wireDetail(detail)), { showBank: true })).toEqual(
      printBill(toBillDetail(wireDetail({ ...detail, itax: [] })), { showBank: true }),
    );
  });

  test("leaves the note out when the bill has no b2c_address flag", async () => {
    serve();
    open();
    await screen.findByRole("document", { name: "Bill KGH/2026-27/31 on paper, original copy" });
    expect(screen.queryByText(/CGST Rule 46\(f\)/)).not.toBeInTheDocument();
  });

  test("leaves the note out on a cancelled bill even if an old flag is present", async () => {
    serve([], { status: "cancelled", itax: [{ kind: "b2c_address", short: "Name and address needed", text: namedText }] });
    open();
    await screen.findByRole("document", { name: "Bill KGH/2026-27/31 on paper, original copy" });
    expect(screen.queryByText(namedText)).not.toBeInTheDocument();
  });
});

test.each([[401, false], [403, false], [401, true], [403, true]] as const)("a refused read (%s, cached %s) never offers a futile Try again", async (status, cached) => {
  let refused = !cached;
  serve([["GET", "sales/412/", () => refused ? refuse(status, { detail: "You can't read this bill." }) : wireDetail()]]);
  const qc = testQueryClient();
  openWith(qc);
  if (cached) {
    await screen.findByRole("document", { name: "Bill KGH/2026-27/31 on paper, original copy" });
    refused = true;
    await act(async () => { await qc.invalidateQueries({ queryKey: billQuery(412).queryKey }); });
  }
  await screen.findByText(cached ? "Couldn't refresh this bill" : "Couldn't load this bill");
  expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
});

test("the desktop explains and announces why PDF, Print and Share wait for the first PDF", async () => {
  serve();
  let resolve!: (file: PdfFile) => void;
  vi.mocked(billFile).mockReturnValueOnce(new Promise<PdfFile>((done) => { resolve = done; }));
  const updates: MutationRecord[] = [];
  const observer = new MutationObserver((records) => updates.push(...records));
  observer.observe(document.body, { subtree: true, childList: true });
  open();
  const pdf = await screen.findByRole("button", { name: "PDF" });
  const status = screen.getByRole("status", { name: "PDF progress" });
  try {
    await waitFor(() => expect(updates.some((record) => record.target === status && [...record.addedNodes].some((node) => node.textContent === "Making the PDF…"))).toBe(true));
  } finally { observer.disconnect(); }
  expect(status).toHaveTextContent("Making the PDF…");
  for (const name of ["PDF", "Print", "Share"]) {
    expect(screen.getByRole("button", { name })).toBeDisabled();
    expect(screen.getByRole("button", { name })).toHaveAccessibleDescription("Making the PDF…");
  }
  await waitFor(() => expect(billFile).toHaveBeenCalled());
  await act(async () => resolve({ blob: new Blob(["%PDF-1.3"]), name: "bill.pdf", sheets: 1 }));
  expect(pdf).toBeEnabled();
  expect(status).toBeEmptyDOMElement();
});

// jsdom has no object URLs and no downloads: a file handed out is a link clicked with its name. window.open answers with
// the tab it opened (Print's PDF, WhatsApp's chat), or null for one the browser stopped
beforeEach(() => {
  vi.spyOn(window, "open").mockImplementation(() => ({ addEventListener: () => {} }) as unknown as Window);
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:pdf"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
// (a send's PDF reads the bill and the settings through the app's own cache: plan 1E Task 6)
// Unmount before clearing calls: cleanup can flush a pending PDF effect from the previous test.
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.mocked(billFile).mockClear(); vi.useRealTimers(); phone(false); queryClient.clear(); });

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
}, 15_000); // three papers and four presses: past 5 s on a busy 2-CPU machine (it passes alone)

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
  vi.mocked(window.open).mockReturnValueOnce(null);
  await userEvent.click(print);
  expect(window.open).toHaveBeenCalledWith("blob:pdf", "_blank");
  // the browser stopped the tab (window.open answered null): it says so
  expect(await screen.findByText("The PDF didn't open")).toBeInTheDocument();
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
  expect(window.open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/wa\.me\/919829041122\?text=Namaste%20Anil%20Gupta/), "_blank");
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
  salesServer([["GET", "sales/412/", () => detail], ["GET", "shop-settings/", () => SETTINGS], ["POST", "audit-logs/log/", () => ({ ok: true })]]);
  const qc = testQueryClient();
  openWith(qc);
  const pdf = await screen.findByRole("button", { name: "PDF" });
  // An invocation only starts generation; refresh after the page actually holds the made file.
  await waitFor(() => expect(pdf).toBeEnabled());
  expect(billFile).toHaveBeenCalledTimes(1);
  const first = (await vi.mocked(billFile).mock.results[0].value).blob;
  // sent meanwhile, and the signature's link signed afresh: the bill changed, but not what it prints
  detail = { ...detail, sent: SENT, firm: firmWith({ signature_url: "/api/media/signatures/3.png?s=def" }) };
  await act(async () => { await qc.invalidateQueries({ queryKey: billQuery(412).queryKey }); });
  expect(await screen.findByRole("button", { name: "Send again" })).toBeInTheDocument();
  expect(billFile).toHaveBeenCalledTimes(1);
  await userEvent.click(pdf);
  expect(URL.createObjectURL).toHaveBeenLastCalledWith(first);
  // changed elsewhere: its note
  detail = { ...detail, notes: "Hallmarked by BIS" };
  await act(async () => { await qc.invalidateQueries({ queryKey: billQuery(412).queryKey }); });
  await waitFor(() => { expect(billFile).toHaveBeenCalledTimes(2); expect(pdf).toBeEnabled(); });
  expect(vi.mocked(billFile).mock.calls[1][0]).toMatchObject({ id: 412, notes: "Hallmarked by BIS" });
  const replacement = (await vi.mocked(billFile).mock.results[1].value).blob;
  expect(replacement).not.toBe(first);
  await userEvent.click(pdf);
  expect(URL.createObjectURL).toHaveBeenLastCalledWith(replacement);
});

test("offline: a print page with no bill yet says so, and the bill comes when the internet is back; a PDF that can't be made says why and offers Try again", async () => {
  serve();
  vi.mocked(billFile).mockRejectedValueOnce(new Error("the font didn't load"));
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

/* ── Task 5's review leftovers (Task 6, commit A) ── */

test("a PDF made while the firm's signature got no answer is made again once the bill comes back with its link signed afresh, and kept once signed", async () => {
  let detail = wireDetail({ firm: firmWith({ signature_url: "/api/media/signatures/3.png?s=abc" }) });
  salesServer([["GET", "sales/412/", () => detail], ["GET", "shop-settings/", () => SETTINGS], ["POST", "audit-logs/log/", () => ({ ok: true })]]);
  // the first file went without the signature, which may come next time (billFile's `again`)
  const unsigned = new Blob(["%PDF-1.3 unsigned"], { type: "application/pdf" });
  vi.mocked(billFile).mockImplementationOnce(async (d, o) => ({ blob: unsigned, name: printBill(d, o).file, sheets: 1, again: true }));
  const qc = testQueryClient();
  openWith(qc);
  /** A refresh of the bill, once the paper on screen loads the signature by the link it brought. */
  const refreshed = async (s: string) => {
    await act(async () => { await qc.invalidateQueries({ queryKey: billQuery(412).queryKey }); });
    await waitFor(() => expect(document.querySelector("img[alt^='Signature for']")).toHaveAttribute("src", `/api/media/signatures/3.png?s=${s}`));
    await act(async () => {});
  };
  const pdf = await screen.findByRole("button", { name: "PDF" });
  await waitFor(() => expect(pdf).toBeEnabled());
  // asked again with the same link: nothing new to try with, so the file made stays
  await refreshed("abc");
  expect(billFile).toHaveBeenCalledTimes(1);
  await userEvent.click(pdf);
  expect(URL.createObjectURL).toHaveBeenLastCalledWith(unsigned);
  // a refresh brings the link signed afresh (on reconnect, after a send), as the paper on screen loads it: made again
  detail = { ...detail, firm: firmWith({ signature_url: "/api/media/signatures/3.png?s=def" }) };
  await refreshed("def");
  await waitFor(() => expect(billFile).toHaveBeenCalledTimes(2));
  let signed: Blob | undefined;
  await act(async () => { signed = (await vi.mocked(billFile).mock.results[1].value).blob; });
  await userEvent.click(pdf);
  expect(URL.createObjectURL).toHaveBeenLastCalledWith(signed);
  // signed, it's kept however its link is signed next (Ruling 1E-8)
  detail = { ...detail, firm: firmWith({ signature_url: "/api/media/signatures/3.png?s=ghi" }) };
  await refreshed("ghi");
  expect(billFile).toHaveBeenCalledTimes(2);
});

test("a default that couldn't be saved says so in place with Try again, and the choices made stay", async () => {
  serve([["PUT", "shop-settings/", () => refuse(500, {})]]);
  open();
  await userEvent.click(await screen.findByRole("radio", { name: "All three" }));
  await userEvent.click(screen.getByRole("switch", { name: "Bank details on the bill" }));
  await userEvent.click(screen.getByRole("button", { name: "Make these the default for every bill" }));
  const note = (await screen.findByText("Not saved as the default: the app couldn't get through")).closest<HTMLElement>("[role=alert]")!;
  // nothing was typed on this page, so nothing says what was typed is still here
  expect(note).toHaveTextContent(/^Not saved as the default: the app couldn't get throughNothing was changed\. Try again in a minute\.Try again$/);
  expect(screen.getByRole("radio", { name: "All three" })).toBeChecked();
  expect(screen.getByRole("switch", { name: "Bank details on the bill" })).not.toBeChecked();
  expect(papers()).toHaveLength(3);
  expect(within(note).getByRole("button", { name: "Try again" })).toBeEnabled();
});

test("a failed refresh keeps the bill on a phone too, and keeps a deleted bill's page, each saying so", async () => {
  let answer = () => wireDetail();
  let binned = () => refuse(404, { detail: "This bill was deleted.", code: "deleted", binned: wireBin() });
  salesServer([["GET", "sales/412/", () => answer()], ["GET", "sales/205/", () => binned()], ["GET", "shop-settings/", () => SETTINGS]]);
  phone(true);
  const qc = testQueryClient();
  const view = openWith(qc);
  expect(await screen.findByRole("document", { name: "Bill KGH/2026-27/31 on paper, original copy" })).toBeInTheDocument();
  answer = () => refuse(500, {});
  await act(async () => { await qc.invalidateQueries({ queryKey: billQuery(412).queryKey }); });
  expect(await screen.findByText("Couldn't refresh this bill")).toBeInTheDocument();
  expect(screen.getByText("The app couldn't reach the shop's records just now, so this is what was last loaded.")).toBeInTheDocument();
  expect(papers()).toHaveLength(1);
  view.unmount();
  phone(false);
  openWith(qc, "/sales/205/print");
  expect(await screen.findByText("This bill was deleted")).toBeInTheDocument();
  binned = () => refuse(500, {});
  await act(async () => { await qc.invalidateQueries({ queryKey: billQuery(205).queryKey }); });
  expect(await screen.findByText("Couldn't refresh this bill")).toBeInTheDocument();
  expect(screen.getByText("This bill was deleted")).toBeInTheDocument();
});

test("Print and Share act within the press itself: the tab and the share sheet open before anything waits", async () => {
  serve();
  const share = vi.fn(async () => {});
  Object.assign(navigator, { share, canShare: () => true });
  try {
    open();
    const print = await screen.findByRole("button", { name: "Print" });
    await waitFor(() => expect(print).toBeEnabled());
    vi.mocked(window.open).mockReturnValue({ addEventListener: () => {} } as unknown as Window);
    fireEvent.click(print);
    expect(window.open).toHaveBeenCalledWith("blob:pdf", "_blank");
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(share).toHaveBeenCalledWith({ files: [expect.objectContaining({ name: "KGH_2026-27_31.pdf" })], title: "KGH/2026-27/31" });
  } finally {
    Object.assign(navigator, { share: undefined, canShare: undefined });
  }
});

test("Share where the share sheet takes no files downloads the PDF instead, and logs it as PDF does", async () => {
  const { calls } = serve();
  open();
  const share = await screen.findByRole("button", { name: "Share" });
  await waitFor(() => expect(share).toBeEnabled());
  await userEvent.click(share);
  expect(await screen.findByText("KGH_2026-27_31.pdf downloaded")).toBeInTheDocument();
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(calls.filter((c) => c.url === "audit-logs/log/").map((c) => c.body)).toEqual([
    { action: "exported", entity: "invoice", entity_id: 412, entity_name: "#KGH/2026-27/31 - Anil Gupta", details: "PDF downloaded: original copy" },
  ]));
});

test("Try again on a PDF that wasn't made is at work at once, until the PDF is made; on a phone, Share shows the PDF on its way", async () => {
  serve();
  const later = () => { let made: (f: PdfFile) => void = () => {}; return { promise: new Promise<PdfFile>((r) => { made = r; }), made: (f: PdfFile) => made(f) }; };
  const FILE = { blob: new Blob(["%PDF-1.3"], { type: "application/pdf" }), name: "KGH_2026-27_31.pdf", sheets: 1 };
  const second = later();
  vi.mocked(billFile).mockRejectedValueOnce(new Error("the font didn't load")).mockReturnValueOnce(second.promise);
  const view = open();
  expect(await screen.findByText("The PDF wasn't made")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  // the note stays, busy, while the PDF is made again; the buttons wait for it
  expect(screen.getByRole("button", { name: "Trying…" })).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("button", { name: "Print" })).toHaveAttribute("title", "Making the PDF…");
  await waitFor(() => expect(billFile).toHaveBeenCalledTimes(2));
  await act(async () => { second.made(FILE); });
  expect(screen.queryByText("The PDF wasn't made")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Print" })).toBeEnabled();
  view.unmount();
  phone(true);
  const third = later();
  vi.mocked(billFile).mockReturnValueOnce(third.promise);
  open();
  const shareButton = await screen.findByRole("button", { name: "Share" });
  expect(shareButton).toHaveAttribute("aria-busy", "true");
  // (made once the shop's defaults are in: the PDF asked for, then made)
  await waitFor(() => expect(billFile).toHaveBeenCalledTimes(3));
  await act(async () => { third.made(FILE); });
  expect(shareButton).not.toHaveAttribute("aria-busy");
  expect(shareButton).toBeEnabled();
});

test("on a phone, a bill sent before whose customer now has no mobile reads Resend, and its name says so (WCAG 2.5.3)", async () => {
  phone(true);
  serve([], { sent: SENT, customer: { ...(wireDetail().customer as object), mobile_number: "" } });
  open();
  expect(await screen.findByRole("button", { name: "Resend to a WhatsApp number" })).toHaveTextContent(/^Resend$/);
});

/* ── A send and a share carry the PDF (Task 6) ── */

test("Send from here: WhatsApp opens at once, the Original's PDF downloads beside it, and the send is recorded", async () => {
  const { calls } = serve([["POST", "sales/412/sent/", () => ({ id: 412, sent: { at: "2026-10-08T12:09:00+05:30", last_at: "2026-10-08T12:09:00+05:30", count: 1, via: "whatsapp", to: "" } })]]);
  open();
  await userEvent.click(await screen.findByRole("radio", { name: "All three" }));
  await userEvent.click(screen.getByRole("switch", { name: "Bank details on the bill" }));
  await userEvent.click(screen.getByRole("button", { name: "Send on WhatsApp" }));
  expect(window.open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/wa\.me\/919829041122\?text=Namaste%20Anil%20Gupta/), "_blank");
  await waitFor(() => expect(calls.find((c) => c.url === "sales/412/sent/")?.body).toEqual({ via: "whatsapp", to: "" }));
  // the customer gets the Original, with the bank details as this page shows them
  expect(billFile).toHaveBeenLastCalledWith(expect.objectContaining({ id: 412 }), { copies: "original", showBank: false });
  expect(await screen.findByText("KGH_2026-27_31.pdf downloads and WhatsApp opens a chat with Anil Gupta (+91 98290 41122). Attach the PDF there.")).toBeInTheDocument();
});

test("on a computer, Send downloads the Original this page made, rather than making it again", async () => {
  const { calls } = serve([["POST", "sales/412/sent/", () => ({ id: 412, sent: SENT })]]);
  open();
  const send = await screen.findByRole("button", { name: "Send on WhatsApp" });
  await waitFor(() => expect(screen.getByRole("button", { name: "PDF" })).toBeEnabled());
  await waitFor(() => expect(send).toBeEnabled());
  const made = (await vi.mocked(billFile).mock.results[0].value).blob;
  await userEvent.click(send);
  await waitFor(() => expect(calls.filter((c) => c.url === "sales/412/sent/")).toHaveLength(1));
  expect(URL.createObjectURL).toHaveBeenCalledWith(made);
  expect(billFile).toHaveBeenCalledTimes(1);
});

test("on a phone, Send hands the share sheet the Original made before the press, so it opens within the press itself", async () => {
  // the shop prints all three copies, so the page makes those, then the Original a send carries
  const { calls } = serve([["GET", "shop-settings/", () => ({ ...SETTINGS, copies: "all" })], ["POST", "sales/412/sent/", () => ({ id: 412, sent: { ...SENT, via: "share" } })]]);
  phone(true);
  const share = vi.fn(async () => {});
  // a press counts only while its click is being dispatched, as a browser's does: it ends once the click's handlers have run
  let pressing = false;
  const start = () => { pressing = true; queueMicrotask(() => { pressing = false; }); };
  window.addEventListener("click", start, true);
  Object.assign(navigator, { share, canShare: () => true, userActivation: { get isActive() { return pressing; }, hasBeenActive: true } });
  try {
    open();
    await waitFor(() => expect(billFile).toHaveBeenCalledWith(expect.objectContaining({ id: 412 }), { copies: "original", showBank: true }));
    expect(billFile).toHaveBeenCalledWith(expect.objectContaining({ id: 412 }), { copies: "all", showBank: true });
    await act(async () => { await Promise.all(vi.mocked(billFile).mock.results.map((r) => r.value)); });
    const send = screen.getByRole("button", { name: "Send" });
    await waitFor(() => expect(send).toBeEnabled());
    await userEvent.click(send);
    expect(share).toHaveBeenCalledWith({ files: [expect.objectContaining({ name: "KGH_2026-27_31.pdf" })], title: "KGH/2026-27/31", text: expect.stringContaining("KGH/2026-27/31") });
    await waitFor(() => expect(calls.find((c) => c.url === "sales/412/sent/")?.body).toEqual({ via: "share", to: "" }));
    expect(billFile).toHaveBeenCalledTimes(2);
    expect(window.open).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("click", start, true);
    Object.assign(navigator, { share: undefined, canShare: undefined, userActivation: undefined });
  }
});

test("v2's Share PDF link (…/print?share=1) arrives with Share ready: it takes focus once the PDF is made, and nothing shares without a press", async () => {
  serve();
  const share = vi.fn(async () => {});
  Object.assign(navigator, { share, canShare: () => true });
  try {
    const view = open("/sales/412/print?share=1");
    const button = await screen.findByRole("button", { name: "Share" });
    await waitFor(() => expect(button).toHaveFocus());
    expect(button).toBeEnabled();
    expect(share).not.toHaveBeenCalled();
    view.unmount();
    // an ordinary visit leaves the focus where it is
    open();
    const plain = await screen.findByRole("button", { name: "Share" });
    await waitFor(() => expect(plain).toBeEnabled());
    expect(plain).not.toHaveFocus();
  } finally {
    Object.assign(navigator, { share: undefined, canShare: undefined });
  }
});

/* ── Task 6's review leftovers (Task 7, commit A) ── */

test("on a phone, the options sheet's Download PDF and Print show the PDF on its way, then hand it out once it's made", async () => {
  serve();
  phone(true);
  let made: (f: PdfFile) => void = () => {};
  vi.mocked(billFile).mockReturnValueOnce(new Promise<PdfFile>((resolve) => { made = resolve; }));
  open();
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  await userEvent.click(await screen.findByRole("button", { name: "Options" }));
  act(() => { vi.advanceTimersByTime(400); }); // past the sheet's guard against the press that opened it
  const dialog = screen.getByRole("dialog", { name: "Print options" });
  const buttons = [within(dialog).getByRole("button", { name: "Download PDF" }), within(dialog).getByRole("button", { name: "Print" })];
  await waitFor(() => expect(billFile).toHaveBeenCalledTimes(1));
  for (const b of buttons) {
    expect(b).toHaveAttribute("aria-busy", "true");
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("title", "Making the PDF…");
  }
  await act(async () => made({ blob: new Blob(["%PDF-1.3"], { type: "application/pdf" }), name: "KGH_2026-27_31.pdf", sheets: 1 }));
  for (const b of buttons) {
    expect(b).not.toHaveAttribute("aria-busy");
    expect(b).toBeEnabled();
  }
  await userEvent.click(buttons[0]);
  expect(await screen.findByText("Downloaded KGH_2026-27_31.pdf")).toBeInTheDocument();
});

test("a quiet remake that fails keeps the unsigned PDF made before it, rather than saying the PDF wasn't made", async () => {
  let detail = wireDetail({ firm: firmWith({ signature_url: "/api/media/signatures/3.png?s=abc" }) });
  salesServer([["GET", "sales/412/", () => detail], ["GET", "shop-settings/", () => SETTINGS], ["POST", "audit-logs/log/", () => ({ ok: true })]]);
  const unsigned = new Blob(["%PDF-1.3 unsigned"], { type: "application/pdf" });
  vi.mocked(billFile)
    .mockImplementationOnce(async (d, o) => ({ blob: unsigned, name: printBill(d, o).file, sheets: 1, again: true }))
    .mockRejectedValueOnce(new Error("the signature's server failed again"));
  const qc = testQueryClient();
  openWith(qc);
  const pdf = await screen.findByRole("button", { name: "PDF" });
  await waitFor(() => expect(pdf).toBeEnabled());
  // the bill comes back with the signature's link signed afresh: made again quietly, and that fails
  detail = { ...detail, firm: firmWith({ signature_url: "/api/media/signatures/3.png?s=def" }) };
  await act(async () => { await qc.invalidateQueries({ queryKey: billQuery(412).queryKey }); });
  await waitFor(() => expect(billFile).toHaveBeenCalledTimes(2));
  await act(async () => { await vi.mocked(billFile).mock.results[1].value.catch(() => {}); });
  expect(screen.queryByText("The PDF wasn't made")).not.toBeInTheDocument();
  expect(pdf).toBeEnabled();
  await userEvent.click(pdf);
  expect(URL.createObjectURL).toHaveBeenLastCalledWith(unsigned);
  expect(await screen.findByText("Downloaded KGH_2026-27_31.pdf")).toBeInTheDocument();
});

/* ── Task 7's review (fix round 1) ── */

test("a PDF whose maker's code didn't load (the app changed since the page opened) says to reload the page, with no Try again: it can't help", async () => {
  serve();
  vi.mocked(billFile).mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module: https://bills.example/assets/react-pdf.browser-Bx1c2.js"));
  open();
  const note = (await screen.findByText("The PDF wasn't made")).closest<HTMLElement>("[role=alert]")!;
  expect(note).toHaveTextContent("The part of the app that makes PDFs didn't load. Reload the page, then try again.");
  expect(within(note).queryByRole("button")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Print" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Print" })).toHaveAttribute("title", "The PDF couldn't be made. Reload the page.");
  // offline, the reload waits for the internet
  act(() => __setNetState("offline"));
  expect(note).toHaveTextContent("You're offline, and the part of the app that makes PDFs didn't load. Reload the page once the internet is back.");
  act(() => __setNetState("online"));
});
