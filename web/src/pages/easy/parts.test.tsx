import { useState } from "react";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router";
import { pastTheGuard } from "@/core/print/testing";
import { salesServer, wireDetail, wireRow } from "@/core/sales/fixtures";
import { toBillDetail, toBillRow } from "@/core/sales/wire";
import type { PaymentMode } from "@/core/sales/types";
import { renderApp } from "@/test/render";
import * as sending from "@/pages/sales/actions/useSendBill";
import { BillRows, CancelBill, EasyPage, MakeAgain, NewBillButton, PaperBill, PayChoice, PrintButton, SaveProblem, SendBig, SendTo } from "./parts";
const BILL = toBillDetail(wireDetail());
function Location() { const l = useLocation(); return <output>{l.pathname}{l.search}</output>; }
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-08T11:00:00+05:30")); salesServer(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

test("payment order, disabled choices, roving focus and error description", async () => {
  function Pay() { const [value, setValue] = useState<PaymentMode | null>(null); return <><h2 id="easy-paid-t">How did they pay?</h2><p id="pay-error">Choose how they paid.</p><PayChoice value={value} onChange={setValue} invalid describedBy="pay-error" disabled={{ bank: true }} /></>; }
  renderApp(<Pay />);
  expect(screen.getByRole("radiogroup", { name: "How did they pay?" })).toHaveAttribute("aria-describedby", "pay-error");
  const radios = screen.getAllByRole("radio");
  expect(radios.map(r => r.textContent)).toEqual(["Cash", "UPIor bank", "Udhaarpays later", "Part cashrest UPI"]);
  expect(radios[0]).toHaveAttribute("tabindex", "0");
  await userEvent.click(radios[0]); await userEvent.keyboard("{ArrowRight}");
  expect(radios[2]).toBeChecked(); expect(radios[1]).toBeDisabled();
  await userEvent.keyboard("{ArrowLeft}"); expect(radios[0]).toBeChecked();
});
test("page keeps labelled Back, sticky header and document title", async () => {
  renderApp(<><EasyPage title="Who is buying?" back="/e" subtitle="Step 1 of 2">A customer</EasyPage><Location /></>, { path: "/e/new" });
  expect(screen.getByRole("heading", { name: "Who is buying?" })).toHaveAttribute("data-page-title");
  expect(screen.getByRole("banner")).toHaveAttribute("data-phone-header");
  expect(document.title).toBe("Who is buying? · GST Billing");
  await userEvent.click(screen.getByRole("button", { name: "Back" })); expect(screen.getByText("/e")).toBeInTheDocument();
});
test("paper uses server taxable amounts, slabs and exact total without making", () => {
  renderApp(<PaperBill bill={BILL} />);
  const paper = screen.getByRole("figure", { name: "Bill 31 as the customer gets it" });
  for (const text of ["TAX INVOICE", "80,396.81", "CGST 1.5% + SGST 1.5%", "2,536.40", "₹87,083.21"]) expect(paper).toHaveTextContent(text);
  expect(paper).not.toHaveTextContent("Making charges");
});
test("list keeps cancelled, empty and numberless bills apart and links to Easy", () => {
  const rows = [toBillRow(wireRow({ id: 1, status: "cancelled" })), toBillRow(wireRow({ id: 2, line_count: 0 })), toBillRow(wireRow({ id: 3, customer: { id: 9, name: "Walk-in Customer", type: "walkin", mobile_number: "" } }))];
  renderApp(<BillRows bills={rows} withDate />);
  for (const text of ["Cancelled", "No items", "Not sent"]) expect(screen.getByText(text)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Walk-in Customer/ })).toHaveAttribute("href", "/e/bill/3");
});
test("send blocks B2B missing HSN with the role's words", () => {
  const bill = { ...BILL, customer: { ...BILL.customer, gst_number: "08ABCPK1234F1Z5" }, lines: [{ ...BILL.lines[0], hsn_code: "" }] };
  const view = renderApp(<SendBig bill={bill} />);
  expect(screen.getByText("Add the missing HSN code before sending.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add it in the full view" })).toBeInTheDocument(); view.unmount();
  renderApp(<SendBig bill={bill} />, { me: { role: "staff", permissions: ["view", "bill.create", "bill.send"] } });
  expect(screen.getByText("The owner adds the missing HSN code before this bill goes out; a shop's bill needs it on every item.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Send the bill" })).not.toBeInTheDocument();
});
test.each(["", "Wrong customer"])("cancel uses exact default or selected reason: %s", async (reason) => {
  const { calls } = salesServer([["POST", "sales/412/cancel/", () => ({ id: 412, status: "cancelled", cancel_reason: reason || "Made a mistake on the bill" })]]);
  renderApp(<CancelBill bill={BILL} />);
  await userEvent.click(screen.getByRole("button", { name: "Made a mistake? Cancel this bill" }));
  const dialog = screen.getByRole("dialog", { name: "Cancel bill 31?" }); await pastTheGuard(dialog);
  if (reason) await userEvent.click(within(dialog).getByRole("button", { name: reason }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel this bill" }));
  expect(calls.find(c => c.url.endsWith("/cancel/"))?.body).toEqual({ reason: reason || "Made a mistake on the bill" });
});
test("Make again keeps source id and starts at the customer when wrong", async () => {
  renderApp(<><MakeAgain bill={{ ...BILL, status: "cancelled", cancel_reason: "Wrong customer" }} /><Location /></>);
  await userEvent.click(screen.getByRole("button", { name: "Make it again" })); expect(screen.getByText("/e/new?again=412")).toBeInTheDocument();
});
test("Print keeps Easy return route and walk-ins pick the chat", async () => {
  renderApp(<><PrintButton bill={BILL} /><SendTo bill={{ ...BILL, customer: { ...BILL.customer, type: "walkin", mobile_number: "" } }} /><Location /></>);
  expect(screen.getByText("Walk-in customer: you pick the chat in WhatsApp.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Print" })); expect(screen.getByText("/e/bill/412/print")).toBeInTheDocument();
});
test("save keeps server refusal words and offline says what is kept", () => {
  const view = renderApp(<SaveProblem error={{ kind: "conflict", message: "Bill 31 is cancelled, so it can't be sent." }} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Bill 31 is cancelled, so it can't be sent."); view.unmount();
  renderApp(<SaveProblem error={{ kind: "offline", message: "You're offline" }} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Not saved yet: you're offline.");
  expect(screen.getByRole("alert")).toHaveTextContent("Your bill is safe on this phone; tap Save again when the internet is back.");
});
test("viewer cannot create or cancel and filed bills cannot cancel", () => {
  const view = renderApp(<><NewBillButton /><CancelBill bill={BILL} /></>, { me: { role: "viewer", permissions: ["view"] } });
  expect(screen.getByRole("button", { name: "New bill" })).toBeDisabled();
  expect(screen.getByText("Made a mistake? Ask the owner to cancel it.")).toBeInTheDocument(); view.unmount();
  renderApp(<CancelBill bill={{ ...BILL, locked: true }} />);
  expect(screen.getByText("This bill's month is already filed with GST, so it can't be cancelled here. Unlock the month in the full view first.")).toBeInTheDocument();
});


test("SendBig shows the offline recording failure inline and retries the shared record callback", async () => {
  let options: sending.SendOptions | undefined;
  const retry = vi.fn(async () => { options?.onRecorded?.(); return true; });
  const send = vi.fn<ReturnType<typeof sending.useSendBill>>(async (_bill, opts) => {
    options = opts;
    opts?.onMarkFailed?.({ kind: "offline", message: "You're offline" }, retry);
    return false;
  });
  vi.spyOn(sending, "useSendBill").mockReturnValue(send);
  vi.spyOn(sending, "useSendReady").mockReturnValue(true);
  renderApp(<SendBig bill={BILL} />);
  await userEvent.click(screen.getByRole("button", { name: "Send the bill" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Not marked as sent: you're offline.");
  expect(screen.getByRole("alert")).toHaveTextContent("If you shared it, WhatsApp delivers it when the internet is back. Tap Mark as sent once you're online.");
  expect(options?.quiet).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Mark as sent" }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("the narrow phone header wraps the title and omits the app mark", () => {
  let resize: ResizeObserverCallback = () => {};
  const NativeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) { resize = callback; }
    observe() {} unobserve() {} disconnect() {}
  };
  try {
    renderApp(<EasyPage title="A long shop name" subtitle="A long subtitle" />);
    act(() => resize([{ contentRect: { width: 320 } } as ResizeObserverEntry], {} as ResizeObserver));
    expect(screen.getByRole("heading")).toHaveClass("line-clamp-2", "break-words");
    expect(screen.getByText("A long subtitle")).toHaveClass("line-clamp-2");
    expect(within(screen.getByRole("banner")).queryByRole("img")).not.toBeInTheDocument();
  } finally { globalThis.ResizeObserver = NativeObserver; }
});


test("the number-dialog fallback keeps inline recording retry and saves the customer's number after retry", async () => {
  const { calls } = salesServer([["PATCH", "customers/7/", () => ({ id: 7, name: "Anil Gupta", mobile_number: "9829041122" })]]);
  let typed: sending.SendOptions | undefined;
  const retry = vi.fn(async () => { typed?.onRecorded?.(); return true; });
  const send = vi.fn<ReturnType<typeof sending.useSendBill>>(async (_bill, opts) => {
    if (!opts?.to) { opts?.onNeedNumber?.(_bill); return false; }
    typed = opts;
    opts.onOpened?.();
    opts.onMarkFailed?.({ kind: "offline", message: "You're offline" }, retry);
    return false;
  });
  vi.spyOn(sending, "useSendBill").mockReturnValue(send);
  vi.spyOn(sending, "useSendReady").mockReturnValue(true);
  renderApp(<SendBig bill={{ ...BILL, customer: { ...BILL.customer, mobile_number: "" } }} />);
  await userEvent.click(screen.getByRole("button", { name: "Send the bill" }));
  await pastTheGuard(await screen.findByRole("dialog"));
  await userEvent.type(screen.getByLabelText("WhatsApp number"), "98290 41122{Enter}");
  expect(await screen.findByRole("alert")).toHaveTextContent("Not marked as sent: you're offline.");
  expect(typed?.quiet).toBe(true);
  expect(calls.some(c => c.url === "customers/7/")).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "Mark as sent" }));
  await waitFor(() => expect(calls.filter(c => c.url === "customers/7/").map(c => c.body)).toEqual([{ mobile_number: "9829041122" }]));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
