import { useState } from "react";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { __setNetState } from "@/core/api/network";
import { useBillDetail } from "@/core/api/sales";
import type { Me } from "@/core/auth/AuthProvider";
import { todayIST } from "@/core/format";
import { refuse, salesServer, wireDetail, wireRow } from "@/core/sales/fixtures";
import type { BillRow } from "@/core/sales/types";
import { toBillRow } from "@/core/sales/wire";
import { renderApp } from "@/test/render";
import { SendCell } from "./SendCell";
import { useSendBill } from "./useSendBill";
import { WhatsAppDialog } from "./WhatsAppDialog";

const row = (over: Record<string, unknown> = {}) => toBillRow(wireRow(over));
const WALKIN = { id: 9, name: "Walk-in Customer", gst_number: "", mobile_number: "", type: "walkin" };
const MEENA = { id: 8, name: "Meena Jain", gst_number: "", mobile_number: "", type: "person" };
const VIEWER: Partial<Me> = { role: "viewer", permissions: ["view", "reports.export"] };
/** The server's answer to Meena Jain's bill sent to the number typed for it. */
const SENT_TO_TYPED = { id: 412, sent: { at: "2026-10-08T12:09:00+05:30", last_at: "2026-10-08T12:09:00+05:30", count: 1, via: "whatsapp", to: "9829041122" } };
// India's clock reads 11:00 on 8 Oct 2026, the contract's day: nothing here waits on real time (Ruling 1B-10)
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-08T11:00:00+05:30")); });
// a browser opens WhatsApp in a new tab: here window.open only records what it was asked
beforeEach(() => { vi.spyOn(window, "open").mockImplementation(() => null); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); act(() => __setNetState("online")); });

/** A send that may need a number: the WhatsApp dialog opens when it does, as on the bill page. */
function Harness({ bill }: { bill: BillRow }) {
  const send = useSendBill();
  const [ask, setAsk] = useState(false);
  return <><button type="button" onClick={() => void send(bill, { onNeedNumber: () => setAsk(true) })}>send it</button><WhatsAppDialog bill={ask ? bill : null} onClose={() => setAsk(false)} /></>;
}
/** What the bill's page shows of its customer's number: a bill's customer is always the live one (contract §0.2). */
function NumberOnBill({ id }: { id: number }) {
  const b = useBillDetail(id).data;
  return <p>{b ? `On the bill: ${b.customer.mobile_number || "no number"}` : "Loading the bill"}</p>;
}

test("each bill's Send cell: On paper, Sent with when, Print for a walk-in, a Send button; a cancelled bill has none", () => {
  salesServer();
  const today = todayIST();
  renderApp(<>
    <SendCell bill={row({ id: 1, invoice_number: "A/1", paper: true })} />
    <SendCell bill={row({ id: 2, invoice_number: "A/2", sent: { at: `${today}T12:09:00+05:30`, last_at: `${today}T15:00:00+05:30`, count: 3, via: "whatsapp", to: "" } })} />
    <SendCell bill={row({ id: 3, invoice_number: "A/3", customer: WALKIN })} />
    <SendCell bill={row({ id: 4, invoice_number: "A/4" })} />
    <SendCell bill={row({ id: 5, invoice_number: "A/5", status: "cancelled" })} />
    <SendCell bill={row({ id: 6, invoice_number: "A/6", customer: { id: 10, name: "Ramesh Soni", gst_number: "", mobile_number: "0294 2410122", type: "person" } })} />
  </>);
  expect(screen.getByText("On paper")).toBeInTheDocument();
  // a bill entered later from the paper book: the customer has it, so nothing asks for it to be sent
  expect(screen.queryByRole("button", { name: /A\/1/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sent at 12:09. Options for A/2" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Print A/3 (no phone number to send it to)" })).toHaveAttribute("href", "/sales/3/print");
  expect(screen.getByRole("button", { name: "Send A/4 on WhatsApp" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /A\/5/ })).not.toBeInTheDocument();
  // a landline on record can't take WhatsApp: Print, as for no number
  expect(screen.getByRole("link", { name: "Print A/6 (no phone number to send it to)" })).toBeInTheDocument();
});

test("someone who can't send sees Sent or Not sent as words, and a paper bill as On paper, never Not sent", () => {
  salesServer();
  renderApp(<>
    <SendCell bill={row({ id: 4, invoice_number: "A/4" })} />
    <SendCell bill={row({ id: 6, invoice_number: "A/6", sent: { at: `${todayIST()}T12:09:00+05:30`, last_at: "", count: 1, via: "whatsapp", to: "" } })} />
    <SendCell bill={row({ id: 7, invoice_number: "A/7", paper: true })} />
  </>, { me: VIEWER });
  expect(screen.getByText("Not sent")).toBeInTheDocument();
  expect(screen.getByText("Sent")).toBeInTheDocument();
  expect(screen.getByText("On paper")).toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("Send opens the customer's WhatsApp chat with the shop's message, records the send, and says what happened", async () => {
  const { calls } = salesServer([["POST", "sales/412/sent/", () => ({ id: 412, sent: { at: "2026-10-08T12:09:00+05:30", last_at: "2026-10-08T12:09:00+05:30", count: 1, via: "whatsapp", to: "" } })]]);
  renderApp(<SendCell bill={row()} />);
  await userEvent.click(screen.getByRole("button", { name: "Send KGH/2026-27/31 on WhatsApp" }));
  // the bill's exact total, as the PDF prints it: nothing is rounded to the rupee (Ruling 1B-12)
  expect(window.open).toHaveBeenCalledWith(`https://wa.me/919829041122?text=${encodeURIComponent("Namaste Anil Gupta, your bill KGH/2026-27/31 for ₹87,083.21 from KIRAN GOLD HOUSE is attached. Thank you!")}`, "_blank", "noopener");
  await waitFor(() => expect(calls.find((c) => c.url === "sales/412/sent/")?.body).toEqual({ via: "whatsapp", to: "" }));
  expect(await screen.findByText("KGH/2026-27/31 sent")).toBeInTheDocument();
  expect(screen.getByText("WhatsApp opens a chat with Anil Gupta (+91 98290 41122), with the bill's message typed in.")).toBeInTheDocument();
});

test("offline, nothing opens and nothing is marked sent", async () => {
  const { calls } = salesServer();
  // the browser says so too: an answer still on its way (the shop's message) doesn't count as being back online
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  renderApp(<SendCell bill={row()} />);
  act(() => __setNetState("offline"));
  await userEvent.click(screen.getByRole("button", { name: "Send KGH/2026-27/31 on WhatsApp" }));
  expect(await screen.findByText("Not sent: you're offline")).toBeInTheDocument();
  expect(window.open).not.toHaveBeenCalled();
  expect(calls.some((c) => c.url.endsWith("/sent/"))).toBe(false);
});

test("a walk-in asks for a number: a wrong one says so; a right one opens that chat and is kept on the bill only", async () => {
  const { calls } = salesServer([["POST", "sales/33/sent/", () => ({ id: 33, sent: { at: "2026-10-08T12:09:00+05:30", last_at: "2026-10-08T12:09:00+05:30", count: 1, via: "whatsapp", to: "9829041122" } })]]);
  renderApp(<Harness bill={row({ id: 33, invoice_number: "KGH/2026-27/33", total_amount: "17464.29", customer: WALKIN })} />);
  await userEvent.click(screen.getByText("send it"));
  const dialog = await screen.findByRole("dialog", { name: "Send KGH/2026-27/33 on WhatsApp" });
  expect(dialog).toHaveTextContent("A walk-in has no number on record. Type theirs to send the bill to their WhatsApp; it isn't kept as a customer.");
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  const field = screen.getByLabelText("WhatsApp number");
  await userEvent.type(field, "12345{Enter}");
  expect(screen.getByText("Type a 10-digit mobile number, like 98290 41122.")).toBeInTheDocument();
  expect(window.open).not.toHaveBeenCalled();
  await userEvent.clear(field);
  await userEvent.type(field, "98290 41122{Enter}");
  expect(window.open).toHaveBeenCalledWith(`https://wa.me/919829041122?text=${encodeURIComponent("Namaste ji, your bill KGH/2026-27/33 for ₹17,464.29 from KIRAN GOLD HOUSE is attached. Thank you!")}`, "_blank", "noopener");
  await waitFor(() => expect(calls.find((c) => c.url === "sales/33/sent/")?.body).toEqual({ via: "whatsapp", to: "9829041122" }));
  expect(await screen.findByText("WhatsApp opens a chat with +91 98290 41122, with the bill's message typed in.")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(calls.some((c) => c.url.startsWith("customers/"))).toBe(false);
});

test("a customer without a number can keep the one typed: it's saved to their record once the send is recorded, and their bills show it", async () => {
  let saved = false;
  const { calls } = salesServer([
    ["GET", "sales/412/", () => wireDetail({ customer: { ...MEENA, mobile_number: saved ? "9829041122" : "" } })],
    ["POST", "sales/412/sent/", () => ({ id: 412, sent: { at: "2026-10-08T12:09:00+05:30", last_at: "2026-10-08T12:09:00+05:30", count: 1, via: "whatsapp", to: "9829041122" } })],
    ["PATCH", "customers/8/", () => { saved = true; return { id: 8, name: "Meena Jain", mobile_number: "9829041122" }; }],
  ]);
  renderApp(<><Harness bill={row({ customer: MEENA })} /><NumberOnBill id={412} /></>);
  expect(await screen.findByText("On the bill: no number")).toBeInTheDocument();
  await userEvent.click(screen.getByText("send it"));
  expect(await screen.findByRole("dialog", { name: "Send KGH/2026-27/31 on WhatsApp" })).toHaveTextContent("Meena Jain has no mobile number on record.");
  expect(screen.getByRole("checkbox", { name: /Save it to Meena Jain's record/ })).toBeChecked();
  await userEvent.type(screen.getByLabelText("WhatsApp number"), "9829041122{Enter}");
  await waitFor(() => expect(calls.find((c) => c.url === "customers/8/")?.body).toEqual({ mobile_number: "9829041122" }));
  expect(calls.findIndex((c) => c.url === "sales/412/sent/")).toBeLessThan(calls.findIndex((c) => c.url === "customers/8/"));
  // saved through the customers' own save, which refreshes their bills too (Ruling 1B-8)
  expect(await screen.findByText("On the bill: 9829041122")).toBeInTheDocument();
});

test("untick Save and the number goes with this bill only", async () => {
  const { calls } = salesServer([["POST", "sales/412/sent/", () => SENT_TO_TYPED]]);
  renderApp(<Harness bill={row({ customer: MEENA })} />);
  await userEvent.click(screen.getByText("send it"));
  const keep = await screen.findByRole("checkbox", { name: /Save it to Meena Jain's record/ });
  act(() => { vi.advanceTimersByTime(400); }); // past the dialog's guard against a double tap's second tap
  await userEvent.click(keep);
  expect(keep).not.toBeChecked();
  await userEvent.type(screen.getByLabelText("WhatsApp number"), "9829041122{Enter}");
  await waitFor(() => expect(calls.find((c) => c.url === "sales/412/sent/")?.body).toEqual({ via: "whatsapp", to: "9829041122" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(calls.some((c) => c.url.startsWith("customers/"))).toBe(false);
});

test("a number that couldn't be saved to the record says so once the bill has gone, with the number to add later", async () => {
  salesServer([["POST", "sales/412/sent/", () => SENT_TO_TYPED], ["PATCH", "customers/8/", () => refuse(0, null)]]);
  renderApp(<Harness bill={row({ customer: MEENA })} />);
  await userEvent.click(screen.getByText("send it"));
  await userEvent.type(await screen.findByLabelText("WhatsApp number"), "9829041122{Enter}");
  expect(await screen.findByText("Not saved to Meena Jain's record")).toBeInTheDocument();
  expect(screen.getByText("The app couldn't get through. Add +91 98290 41122 to Meena Jain's record in a minute.")).toBeInTheDocument();
  expect(screen.getByText("KGH/2026-27/31 sent")).toBeInTheDocument();
});

test("a send the server refuses says so in its words and marks nothing", async () => {
  salesServer([["POST", "sales/412/sent/", () => refuse(409, { detail: "KGH/2026-27/31 is cancelled, so it can't be sent.", code: "cancelled" })]]);
  renderApp(<SendCell bill={row()} />);
  await userEvent.click(screen.getByRole("button", { name: "Send KGH/2026-27/31 on WhatsApp" }));
  expect(await screen.findByText("The bill wasn't sent")).toBeInTheDocument();
  expect(screen.getByText("KGH/2026-27/31 is cancelled, so it can't be sent.")).toBeInTheDocument();
});
