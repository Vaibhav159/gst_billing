import { useState } from "react";
import { useLocation } from "react-router";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { __setNetState } from "@/core/api/network";
import { queryClient } from "@/core/api/query";
import { billFile } from "@/core/print/make";
import { ShareHost } from "@/core/print/ShareHost";
import { pastTheGuard } from "@/core/print/testing";
import { refuse, salesServer, wireDetail, wireRow, type Route } from "@/core/sales/fixtures";
import { toBillRow } from "@/core/sales/wire";
import { renderApp } from "@/test/render";
import { useSendBill, useSendReady, type SendableBill, type SendOptions } from "./useSendBill";
import { WhatsAppDialog } from "./WhatsAppDialog";

vi.mock("@/core/print/make", async (real) => ({
  ...(await real<typeof import("@/core/print/make")>()),
  billFile: vi.fn(async () => ({ blob: new Blob(["%PDF-1.3"], { type: "application/pdf" }), name: "bill.pdf", sheets: 1 })),
}));
const CUSTOMERS = [
  { id: 9, name: "Walk-in Customer", type: "walkin", mobile_number: "" },
  { id: 8, name: "Meena Jain", type: "person", mobile_number: "" },
  { id: 10, name: "Ramesh Soni", type: "person", mobile_number: "0294 2410122" },
];
const WALKIN = toBillRow(wireRow({ customer: CUSTOMERS[0] }));
const SENT = { id: 412, sent: { at: "2026-10-08T12:09:00+05:30", last_at: "2026-10-08T12:09:00+05:30", count: 1, via: "share", to: "" } };
function serve(routes: Route[] = []) {
  return salesServer([...routes,
    ["GET", "shop-settings/", () => ({ copies: "original", show_bank: false, share_message: "Namaste {customer} ji, bill {number} for {total}.", updated_at: null, updated_by: null })],
    ["GET", "sales/412/", () => wireDetail({ customer: CUSTOMERS[0] })],
    ["POST", "sales/412/sent/", () => SENT],
  ]);
}
function Harness({ bill = WALKIN, options = {} }: { bill?: SendableBill; options?: SendOptions }) {
  const send = useSendBill();
  const ready = useSendReady();
  const [ask, setAsk] = useState(false);
  const [result, setResult] = useState("");
  return <><ShareHost /><button disabled={!ready} onClick={() => void send(bill, { ...options, onNeedNumber: () => setAsk(true) }).then((ok) => setResult(ok ? "Recorded" : "Not recorded"))}>Send the bill</button><output>{result}</output><WhatsAppDialog bill={ask ? bill : null} onClose={() => setAsk(false)} /></>;
}
async function send() {
  const button = screen.getByRole("button", { name: "Send the bill" });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
}
let share: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T11:00:00+05:30"));
  (window as unknown as { __phone: boolean }).__phone = true;
  share = vi.fn(async () => {});
  Object.assign(navigator, { share, canShare: () => true, userActivation: { isActive: true, hasBeenActive: true } });
  vi.spyOn(window, "open").mockReturnValue({} as Window);
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:pdf"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(billFile).mockClear();
  vi.useRealTimers();
  queryClient.clear();
  act(() => __setNetState("online"));
  (window as unknown as { __phone: boolean }).__phone = false;
  Object.assign(navigator, { share: undefined, canShare: undefined, userActivation: undefined });
});

test.each(CUSTOMERS)("a supported phone shares $name's PDF without asking for a mobile", async (customer) => {
  const { calls } = serve([["GET", "sales/412/", () => wireDetail({ customer })]]);
  renderApp(<Harness bill={toBillRow(wireRow({ customer }))} />, { path: "/e/saved/412" });
  await send();
  expect(await screen.findByText("Recorded")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(share).toHaveBeenCalledWith({ files: [expect.objectContaining({ name: "bill.pdf", type: "application/pdf" })], title: "KGH/2026-27/31", text: expect.stringContaining("₹87,083.21") });
  expect(calls.filter((c) => c.url.endsWith("/sent/")).map((c) => c.body)).toEqual([{ via: "share", to: "" }]);
  expect(calls.some((c) => c.url.startsWith("customers/"))).toBe(false);
  expect(window.open).not.toHaveBeenCalled();
});

test.each(["phone without file support", "desktop with file support", "file support check throws"])("the WhatsApp fallback asks for a number: %s", async (mode) => {
  const { calls } = serve();
  if (mode === "desktop with file support") (window as unknown as { __phone: boolean }).__phone = false;
  else Object.assign(navigator, { canShare: mode === "file support check throws" ? () => { throw new Error("unsupported"); } : () => false });
  renderApp(<Harness />);
  await send();
  expect(await screen.findByLabelText("WhatsApp number")).toBeInTheDocument();
  expect(share).not.toHaveBeenCalled();
  expect(window.open).not.toHaveBeenCalled();
  expect(calls.some((c) => c.url.endsWith("/sent/"))).toBe(false);
  await userEvent.type(screen.getByLabelText("WhatsApp number"), "9829041122{Enter}");
  await waitFor(() => expect(calls.filter((c) => c.url.endsWith("/sent/")).map((c) => c.body)).toEqual([{ via: "whatsapp", to: "9829041122" }]));
  expect(window.open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/wa\.me\/919829041122\?text=/), "_blank");
});

test("cancelling the numberless share records nothing and another press can share", async () => {
  const { calls } = serve();
  share.mockRejectedValueOnce(Object.assign(new Error("closed"), { name: "AbortError" }));
  renderApp(<Harness />);
  await send();
  expect(await screen.findByText("Not recorded")).toBeInTheDocument();
  expect(share).toHaveBeenCalledTimes(1);
  expect(calls.some((c) => c.url.endsWith("/sent/"))).toBe(false);
  await send();
  expect(await screen.findByText("Recorded")).toBeInTheDocument();
  expect(share).toHaveBeenCalledTimes(2);
  expect(calls.filter((c) => c.url.endsWith("/sent/"))).toHaveLength(1);
});

test("a numberless share whose recording fails keeps Mark as sent without reopening the sheet", async () => {
  let tries = 0;
  const { calls } = serve([["POST", "sales/412/sent/", () => ++tries === 1 ? refuse(0, null) : SENT]]);
  renderApp(<Harness />);
  await send();
  await userEvent.click(await screen.findByRole("button", { name: "Mark as sent" }));
  expect(await screen.findByText("KGH/2026-27/31 marked as sent")).toBeInTheDocument();
  expect(calls.filter((c) => c.url.endsWith("/sent/")).map((c) => c.body)).toEqual([{ via: "share", to: "" }, { via: "share", to: "" }]);
  expect(share).toHaveBeenCalledTimes(1);
  expect(window.open).not.toHaveBeenCalled();
});

test("a numberless share still needs the PDF's second press when the first press expires", async () => {
  const { calls } = serve();
  Object.assign(navigator, { userActivation: { isActive: false, hasBeenActive: true } });
  renderApp(<Harness />);
  await send();
  const dialog = await screen.findByRole("dialog", { name: "Your PDF is ready" });
  expect(calls.some((c) => c.url.endsWith("/sent/"))).toBe(false);
  await pastTheGuard(dialog);
  Object.assign(navigator, { userActivation: { isActive: true, hasBeenActive: true } });
  await userEvent.click(screen.getByRole("button", { name: "Share" }));
  expect(await screen.findByText("Recorded")).toBeInTheDocument();
  expect(share).toHaveBeenCalledTimes(1);
});

test("offline, numberless sharing opens nothing and records nothing", async () => {
  const { calls } = serve();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  renderApp(<Harness />);
  act(() => __setNetState("offline"));
  await send();
  expect(await screen.findByText("Not sent: you're offline")).toBeInTheDocument();
  expect(share).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(calls.some((c) => c.url.endsWith("/sent/"))).toBe(false);
});


test("Easy can show its own record failure and retry once without another delivery or toast", async () => {
  let tries = 0;
  const { calls } = serve([["POST", "sales/412/sent/", () => ++tries === 1 ? refuse(0, null) : SENT]]);
  const onMarkFailed = vi.fn<NonNullable<SendOptions["onMarkFailed"]>>();
  const onRecorded = vi.fn();
  renderApp(<Harness options={{ quiet: true, onMarkFailed, onRecorded }} />);
  await send();
  expect(await screen.findByText("Not recorded")).toBeInTheDocument();
  expect(onMarkFailed).toHaveBeenCalledWith(expect.objectContaining({ kind: "unreachable" }), expect.any(Function));
  expect(screen.queryByText("Not marked as sent")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Mark as sent" })).not.toBeInTheDocument();
  const retry = onMarkFailed.mock.calls[0][1]!;
  let results: boolean[] = [];
  await act(async () => { results = await Promise.all([retry(), retry()]); });
  expect(results).toEqual([true, false]);
  expect(onRecorded).toHaveBeenCalledTimes(1);
  expect(share).toHaveBeenCalledTimes(1);
  expect(calls.filter((c) => c.url.endsWith("/sent/")).map((c) => c.body)).toEqual([{ via: "share", to: "" }, { via: "share", to: "" }]);
  expect(screen.queryByText("KGH/2026-27/31 marked as sent")).not.toBeInTheDocument();
});


test("a cancelled bill's record refusal is exposed inline without a Mark as sent retry", async () => {
  const { calls } = serve([["POST", "sales/412/sent/", () => refuse(409, { code: "cancelled", detail: "Bill 31 is cancelled, so it can't be sent." })]]);
  const onMarkFailed = vi.fn<NonNullable<SendOptions["onMarkFailed"]>>();
  renderApp(<Harness options={{ quiet: true, onMarkFailed }} />);
  await send();
  expect(await screen.findByText("Not recorded")).toBeInTheDocument();
  expect(onMarkFailed).toHaveBeenCalledWith(expect.objectContaining({ code: "cancelled", message: "Bill 31 is cancelled, so it can't be sent." }), null);
  expect(calls.filter((c) => c.url.endsWith("/sent/"))).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Mark as sent" })).not.toBeInTheDocument();
});


test("Print instead from Easy's number dialog stays in Easy", async () => {
  function Where() { return <output>{useLocation().pathname}</output>; }
  serve();
  renderApp(<><WhatsAppDialog bill={WALKIN} onClose={() => {}} /><Where /></>, { path: "/e/saved/412" });
  await pastTheGuard(screen.getByRole("dialog"));
  await userEvent.click(screen.getByRole("button", { name: "Print instead" }));
  expect(screen.getByText("/e/bill/412/print")).toBeInTheDocument();
});
