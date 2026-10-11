// Plan 1E's bodies for deliver and useShareBill: the PDF goes with the bill. On a computer the chat opens within the
// press and the PDF downloads beside it; on a phone the share sheet takes the PDF, or asks for one more press.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { queryClient } from "@/core/api/query";
import { billFile, useSendBankChoice, type PdfFile } from "@/core/print/make";
import { ShareHost } from "@/core/print/ShareHost";
import { refuse, salesServer, wireDetail, wireRow, type Route } from "@/core/sales/fixtures";
import { toBillRow } from "@/core/sales/wire";
import { Menu } from "@/core/ui";
import { renderApp } from "@/test/render";
import { useBillDialogs } from "./BillDialogs";
import { deliver, useShareBill } from "./deliver";
import { SendCell } from "./SendCell";
import { useBillMenu } from "./useBillMenu";

vi.mock("@/core/print/make", async (real) => ({
  ...(await real<typeof import("@/core/print/make")>()),
  billFile: vi.fn(async (): Promise<PdfFile> => ({ blob: new Blob(["%PDF-1.3"], { type: "application/pdf" }), name: "KGH_2026-27_31.pdf", sheets: 1 })),
}));

const SETTINGS = { copies: "all", show_bank: false, share_message: "", updated_at: null, updated_by: null };
const INPUT = { billId: 412, invoiceNumber: "KGH/2026-27/31", mobile: "98290 41122", message: "Namaste Anil Gupta", isPhone: false };
const SENT = { at: "2026-10-08T12:09:00+05:30", last_at: "2026-10-08T12:09:00+05:30", count: 1, via: "whatsapp", to: "" };
function serve(routes: Route[] = []) {
  return salesServer([...routes, ["GET", "sales/412/", () => wireDetail()], ["GET", "shop-settings/", () => SETTINGS], ["POST", "audit-logs/log/", () => ({ ok: true })]]);
}
/** A phone whose share sheet takes files; active: whether the press that asked still counts. */
function phoneSheet(active = true) {
  const share = vi.fn(async () => {});
  Object.assign(navigator, { share, canShare: () => true, userActivation: { isActive: active, hasBeenActive: true } });
  return share;
}
/**
 * From here on a press counts only while its click is being dispatched, as a browser's does: it ends once the click's
 * handlers have run (a microtask queued as it starts), whatever stops the click on its way (a list row's cell does).
 */
const undo: (() => void)[] = [];
function pressesCountInTheClickOnly() {
  let pressing = false;
  const start = () => { pressing = true; queueMicrotask(() => { pressing = false; }); };
  window.addEventListener("click", start, true);
  undo.push(() => window.removeEventListener("click", start, true));
  Object.assign(navigator, { userActivation: { get isActive() { return pressing; }, hasBeenActive: true } });
}
const phone = (on: boolean) => { (window as unknown as { __phone?: boolean }).__phone = on; };
function ShareButton() {
  const shareBill = useShareBill();
  return <button type="button" onClick={() => shareBill({ id: 412, invoice_number: "KGH/2026-27/31" })}>share it</button>;
}
/** A bill's menu, as a list row or the bill's page shows it. */
function BillMenu() {
  const menu = useBillMenu();
  const d = useBillDialogs();
  return <><Menu title="Bill" items={menu(toBillRow(wireRow()), d.open, { shareIt: true })} trigger={(p) => <button type="button" {...p}>Actions</button>} />{d.element}</>;
}
/** The app's client asks once more, a second after a failure (core/api/query): the clock steps past it instead of waiting. */
async function pastTheRetry() {
  await act(() => vi.advanceTimersByTimeAsync(1000));
}

// WhatsApp's tab, opened (window.open answers null for one the browser stopped)
let chat: { opener: unknown };
beforeEach(() => {
  chat = { opener: {} };
  vi.spyOn(window, "open").mockImplementation(() => chat as Window);
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:pdf"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(billFile).mockClear();
  vi.useRealTimers();
  queryClient.clear();
  undo.splice(0).forEach((u) => u());
  phone(false);
  Object.assign(navigator, { share: undefined, canShare: undefined, userActivation: undefined });
});

test("a computer: WhatsApp's chat opens within the press, before anything waits; the Original's PDF downloads beside it", async () => {
  serve();
  const sent = deliver(INPUT);
  expect(window.open).toHaveBeenCalledWith(`https://wa.me/919829041122?text=${encodeURIComponent("Namaste Anil Gupta")}`, "_blank");
  // opened as 1C's chat link opens one, so a tab the browser stopped shows; then cut off from the app
  expect(chat.opener).toBeNull();
  expect(await sent).toEqual({ via: "whatsapp", file: "KGH_2026-27_31.pdf" });
  expect(billFile).toHaveBeenCalledWith(expect.objectContaining({ id: 412 }), { copies: "original", showBank: false });
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
});

test("a phone: the share sheet takes the PDF with the message; closing it sends nothing", async () => {
  serve();
  const share = phoneSheet();
  expect(await deliver({ ...INPUT, isPhone: true })).toEqual({ via: "share", file: "KGH_2026-27_31.pdf" });
  expect(share).toHaveBeenCalledWith({ files: [expect.objectContaining({ name: "KGH_2026-27_31.pdf" })], title: "KGH/2026-27/31", text: "Namaste Anil Gupta" });
  expect(window.open).not.toHaveBeenCalled();
  share.mockRejectedValueOnce(Object.assign(new Error("closed"), { name: "AbortError" }));
  expect(await deliver({ ...INPUT, isPhone: true })).toBeNull();
});

test("a phone whose press ran out while the PDF was made asks for one more press, then shares; Not now sends nothing", async () => {
  serve();
  const share = phoneSheet(false);
  renderApp(<ShareHost />);
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  const first = deliver({ ...INPUT, isPhone: true });
  const dialog = await screen.findByRole("dialog", { name: "Your PDF is ready" });
  expect(dialog).toHaveTextContent("KGH_2026-27_31.pdf took a moment to make");
  act(() => { vi.advanceTimersByTime(400); });
  Object.assign(navigator, { userActivation: { isActive: true, hasBeenActive: true } });
  await userEvent.click(screen.getByRole("button", { name: "Share" }));
  expect(await first).toEqual({ via: "share", file: "KGH_2026-27_31.pdf" });
  expect(share).toHaveBeenCalledTimes(1);
  Object.assign(navigator, { userActivation: { isActive: false, hasBeenActive: true } });
  const second = deliver({ ...INPUT, isPhone: true });
  await screen.findByRole("dialog", { name: "Your PDF is ready" });
  act(() => { vi.advanceTimersByTime(400); });
  await userEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(await second).toBeNull();
});

test("a PDF that couldn't be made: a computer's chat still opens and says so; a phone sends nothing and says why", async () => {
  const { calls } = salesServer([["GET", "sales/412/", () => refuse(500, {})], ["GET", "shop-settings/", () => SETTINGS]]);
  renderApp(<ShareHost />);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
  const computer = deliver(INPUT);
  await waitFor(() => expect(calls.filter((c) => c.url === "sales/412/")).toHaveLength(1));
  await pastTheRetry();
  expect(await computer).toEqual({ via: "whatsapp", file: null });
  expect(window.open).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("WhatsApp opened without it. Download it from Print and share, then attach it there.")).toBeInTheDocument();
  phoneSheet();
  const onPhone = deliver({ ...INPUT, isPhone: true });
  await waitFor(() => expect(calls.filter((c) => c.url === "sales/412/")).toHaveLength(3));
  await pastTheRetry();
  expect(await onPhone).toBeNull();
  expect(await screen.findByText("The bill wasn't sent")).toBeInTheDocument();
  expect(screen.getByText("Something stopped the PDF part way. Nothing was marked as sent. Try again in a minute.")).toBeInTheDocument();
  expect(window.open).toHaveBeenCalledTimes(1);
});

test("Share the PDF: the shop's default copies; downloaded on a computer, and logged as the print page's PDF is", async () => {
  const { calls } = serve();
  renderApp(<ShareButton />);
  await userEvent.click(screen.getByText("share it"));
  expect(await screen.findByText("KGH_2026-27_31.pdf downloaded")).toBeInTheDocument();
  expect(billFile).toHaveBeenCalledWith(expect.objectContaining({ id: 412 }), { copies: "all", showBank: false });
  expect(window.open).not.toHaveBeenCalled();
  await waitFor(() => expect(calls.filter((c) => c.url === "audit-logs/log/").map((c) => c.body)).toEqual([
    { action: "exported", entity: "invoice", entity_id: 412, entity_name: "#KGH/2026-27/31 - Anil Gupta", details: "PDF downloaded: all three copies" },
  ]));
});

test("Share the PDF on a phone hands it to the share sheet, and sends nothing", async () => {
  const { calls } = serve();
  const share = phoneSheet();
  phone(true);
  renderApp(<ShareButton />);
  await userEvent.click(screen.getByText("share it"));
  await waitFor(() => expect(share).toHaveBeenCalledWith({ files: [expect.objectContaining({ name: "KGH_2026-27_31.pdf" })], title: "KGH/2026-27/31" }));
  expect(calls.some((c) => c.url.endsWith("/sent/") || c.url === "audit-logs/log/")).toBe(false);
});

/* ── The rulings that amend the brief ─────────────────── */

test("a WhatsApp tab the browser stopped is no send: nothing is made or marked as sent, it says what to do, and Send can be pressed again", async () => {
  const { calls } = serve([["POST", "sales/412/sent/", () => ({ id: 412, sent: SENT })]]);
  vi.mocked(window.open).mockReturnValueOnce(null);
  renderApp(<><ShareHost /><SendCell bill={toBillRow(wireRow())} /></>);
  const send = screen.getByRole("button", { name: "Send KGH/2026-27/31 on WhatsApp" });
  await waitFor(() => expect(send).toBeEnabled());
  await userEvent.click(send);
  expect(await screen.findByText("WhatsApp didn't open")).toBeInTheDocument();
  expect(screen.getByText("The browser stopped the new tab, so nothing was marked as sent. Allow pop-ups for this app, then send it again.")).toBeInTheDocument();
  expect(billFile).not.toHaveBeenCalled();
  expect(calls.some((c) => c.url === "sales/412/sent/")).toBe(false);
  // pop-ups allowed: the same Send sends
  await userEvent.click(send);
  await waitFor(() => expect(calls.filter((c) => c.url === "sales/412/sent/")).toHaveLength(1));
  expect(await screen.findByText("KGH/2026-27/31 sent")).toBeInTheDocument();
});

test("once WhatsApp's chat has opened nothing throws: a PDF that wasn't made still records the send, and a download that failed comes back without the file", async () => {
  const { calls } = serve([["POST", "sales/412/sent/", () => ({ id: 412, sent: SENT })]]);
  renderApp(<><ShareHost /><SendCell bill={toBillRow(wireRow())} /></>);
  // react-pdf's code didn't come
  vi.mocked(billFile).mockRejectedValueOnce(new TypeError("Failed to fetch dynamically imported module"));
  const send = screen.getByRole("button", { name: "Send KGH/2026-27/31 on WhatsApp" });
  await waitFor(() => expect(send).toBeEnabled());
  await userEvent.click(send);
  await waitFor(() => expect(calls.filter((c) => c.url === "sales/412/sent/")).toHaveLength(1));
  expect(await screen.findByText("KGH/2026-27/31 sent")).toBeInTheDocument();
  expect(screen.getByText("WhatsApp opens a chat with Anil Gupta (+91 98290 41122), with the bill's message typed in.")).toBeInTheDocument();
  expect(screen.getByText("The PDF wasn't made")).toBeInTheDocument();
  expect(screen.queryByText("The bill wasn't sent")).not.toBeInTheDocument();
  // the browser wouldn't take the download
  vi.mocked(URL.createObjectURL).mockImplementationOnce(() => { throw new Error("no file here"); });
  let got: unknown;
  await act(async () => { got = await deliver(INPUT); });
  expect(got).toEqual({ via: "whatsapp", file: null });
  expect(await screen.findByText("The PDF didn't download")).toBeInTheDocument();
  expect(screen.getAllByText("WhatsApp opened without it. Download it from Print and share, then attach it there.")).toHaveLength(2);
});

test("a phone's Send again from a menu acts after the press, so the share sheet asks for one more press; then the send is recorded as shared", async () => {
  const { calls } = serve([["POST", "sales/412/sent/", () => ({ id: 412, sent: { ...SENT, count: 2, via: "share" } })]]);
  const share = phoneSheet();
  pressesCountInTheClickOnly();
  phone(true);
  renderApp(<><ShareHost /><SendCell bill={toBillRow(wireRow({ sent: SENT }))} /></>);
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  await userEvent.click(screen.getByRole("button", { name: /Options for KGH\/2026-27\/31$/ }));
  act(() => { vi.advanceTimersByTime(400); }); // past the menu sheet's guard against the press that opened it
  const again = await screen.findByRole("menuitem", { name: /^Send again on WhatsApp/ });
  await waitFor(() => expect(again).toBeEnabled());
  await userEvent.click(again);
  const dialog = await screen.findByRole("dialog", { name: "Your PDF is ready" });
  expect(share).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(400); });
  await userEvent.click(within(dialog).getByRole("button", { name: "Share" }));
  expect(share).toHaveBeenCalledWith({ files: [expect.objectContaining({ name: "KGH_2026-27_31.pdf" })], title: "KGH/2026-27/31", text: expect.stringContaining("KGH/2026-27/31") });
  await waitFor(() => expect(calls.find((c) => c.url === "sales/412/sent/")?.body).toEqual({ via: "share", to: "" }));
  expect(window.open).not.toHaveBeenCalled();
});

test("a phone's Share the PDF from a bill's menu asks for one more press too, then shares, and sends nothing", async () => {
  const { calls } = serve();
  const share = phoneSheet();
  pressesCountInTheClickOnly();
  phone(true);
  renderApp(<><ShareHost /><BillMenu /></>);
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  await userEvent.click(screen.getByRole("button", { name: "Actions" }));
  act(() => { vi.advanceTimersByTime(400); });
  await userEvent.click(await screen.findByRole("menuitem", { name: /^Share the PDF…/ }));
  const dialog = await screen.findByRole("dialog", { name: "Your PDF is ready" });
  act(() => { vi.advanceTimersByTime(400); });
  await userEvent.click(within(dialog).getByRole("button", { name: "Share" }));
  expect(share).toHaveBeenCalledWith({ files: [expect.objectContaining({ name: "KGH_2026-27_31.pdf" })], title: "KGH/2026-27/31" });
  expect(calls.some((c) => c.url.endsWith("/sent/"))).toBe(false);
});

test("a phone can't send while the shop's settings won't load, as the PDF needs them: it says so; from the print page, which holds the bank choice, it sends", async () => {
  salesServer([["GET", "sales/412/", () => wireDetail()], ["GET", "shop-settings/", () => refuse(500, {})]]);
  const share = phoneSheet();
  renderApp(<ShareHost />);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
  const sent = deliver({ ...INPUT, isPhone: true });
  await pastTheRetry();
  expect(await sent).toBeNull();
  expect(await screen.findByText("The bill wasn't sent")).toBeInTheDocument();
  expect(screen.getByText("The shop's settings didn't load, and the PDF needs them. Nothing was marked as sent. Try again in a minute.")).toBeInTheDocument();
  expect(share).not.toHaveBeenCalled();
  // the print page holds its bank choice for a send, so a send from there reads nothing more from the settings
  function PrintPageHere() { useSendBankChoice(412, true); return null; }
  render(<PrintPageHere />);
  expect(await deliver({ ...INPUT, isPhone: true })).toEqual({ via: "share", file: "KGH_2026-27_31.pdf" });
  expect(billFile).toHaveBeenLastCalledWith(expect.objectContaining({ id: 412 }), { copies: "original", showBank: true });
});
