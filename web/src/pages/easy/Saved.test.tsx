import { fireEvent, screen } from "@testing-library/react";
import { toBillDetail } from "@/core/sales/wire";
import { wireDetail } from "@/core/sales/fixtures";
import type { PaymentMode } from "@/core/sales/types";
import { renderApp } from "@/test/render";
import { serve } from "@/test/server";
import { SavedBody, type SavedBodyProps } from "./Saved";

const props = (extra: Partial<SavedBodyProps> = {}): SavedBodyProps => ({
  bill: toBillDetail(wireDetail()), paymentWords: "paid in cash", canCreate: true, canSend: true, onNew: vi.fn(),
  paper: <p>Paper copy slot</p>, sendTo: <p>Goes to slot</p>, send: <p>Send status slot</p>,
  print: <p>Print slot</p>, cancel: <p>Cancel slot</p>, again: <p>Make again slot</p>, ...extra,
});

test("saved header names the counter, exact server total and customer; existing shared parts compose in place", () => {
  const p = props();
  const { container } = renderApp(<SavedBody {...p} />);
  const title = screen.getByRole("heading", { level: 1, name: "Bill 31 saved" });
  expect(title).toHaveAttribute("data-page-title", "");
  expect(title).toHaveAttribute("tabindex", "-1");
  expect(screen.getByText("₹87,083.21")).toBeInTheDocument();
  expect(screen.getByText(/Anil Gupta ·/)).toHaveTextContent("paid in cash");
  expect(container.querySelector(".anim-ring")).toHaveStyle({ width: "84px", height: "84px" });
  for (const slot of ["Paper copy slot", "Goes to slot", "Send status slot", "Print slot", "Cancel slot"]) expect(screen.getByText(slot)).toBeInTheDocument();
  expect(screen.queryByText("Make again slot")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Make another bill" })).toHaveAttribute("data-variant", "outline");
});

test.each<[PaymentMode, string]>([
  ["cash", "paid in cash"], ["bank", "paid by UPI"], ["credit", "billed on udhaar, to be paid later"],
  ["mixed", "paid part in cash, part by UPI"], ["", "payment not recorded"],
])("saved payment %s uses Easy's words", (mode, words) => {
  renderApp(<SavedBody {...props({ bill: toBillDetail(wireDetail({ payment_mode: mode })), paymentWords: words })} />);
  expect(screen.getByText(/Anil Gupta ·/)).toHaveTextContent(words);
});

test("sent or unable-to-send bills make the next bill primary; starting it stays a callback with no network", () => {
  const calls = serve({});
  const p = props({ bill: toBillDetail(wireDetail({ sent: { at: "2026-10-08T10:44:00+05:30", last_at: "2026-10-08T10:44:00+05:30", count: 1, via: "share", to: "" } })) });
  const first = renderApp(<SavedBody {...p} />);
  expect(screen.getByRole("button", { name: "Make another bill" })).toHaveAttribute("data-variant", "primary");
  fireEvent.click(screen.getByRole("button", { name: "Make another bill" }));
  expect(p.onNew).toHaveBeenCalledTimes(1);
  expect(calls).toEqual([]);
  first.unmount();
  renderApp(<SavedBody {...props({ canSend: false })} />);
  expect(screen.getByRole("button", { name: "Make another bill" })).toHaveAttribute("data-variant", "primary");
  expect(screen.queryByText("Goes to slot")).not.toBeInTheDocument();
});

test("viewer gets the shared send label and print, with no recipient editor or new bill", () => {
  renderApp(<SavedBody {...props({ canCreate: false, canSend: false })} />);
  expect(screen.getByRole("heading", { name: "Bill 31 saved" })).toBeInTheDocument();
  expect(screen.getByText("Send status slot")).toBeInTheDocument();
  expect(screen.getByText("Print slot")).toBeInTheDocument();
  expect(screen.queryByText("Goes to slot")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Make another bill" })).not.toBeInTheDocument();
});

test("cancelled keeps paper and cancellation note, replaces ordinary actions with the supplied remake", () => {
  renderApp(<SavedBody {...props({ bill: toBillDetail(wireDetail({ status: "cancelled", cancel_reason: "Wrong customer" })) })} />);
  expect(screen.getByRole("heading", { level: 1, name: "Bill 31 cancelled" })).toBeInTheDocument();
  expect(screen.getByText("It stays in Bills marked Cancelled and keeps its number for the GST list.")).toBeInTheDocument();
  for (const slot of ["Paper copy slot", "Make again slot", "Cancel slot"]) expect(screen.getByText(slot)).toBeInTheDocument();
  for (const slot of ["Goes to slot", "Send status slot", "Print slot"]) expect(screen.queryByText(slot)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Make another bill" })).not.toBeInTheDocument();
});

test("a bill with no numeric counter keeps its full saved paper number", () => {
  renderApp(<SavedBody {...props({ bill: toBillDetail(wireDetail({ counter: null, invoice_number: "OLD/A" })) })} />);
  expect(screen.getByRole("heading", { name: "Bill OLD/A saved" })).toBeInTheDocument();
});

test("an unsent paper bill is never asked to be sent: Print and Make another bill lead, Send waits behind a quiet button", () => {
  renderApp(<SavedBody {...props({ bill: toBillDetail(wireDetail({ paper: true, invoice_date: "2026-09-30" })) })} />);
  const another = screen.getByRole("button", { name: "Make another bill" });
  expect(another).toHaveAttribute("data-variant", "primary");
  for (const slot of ["Goes to slot", "Send status slot"]) expect(screen.queryByText(slot)).not.toBeInTheDocument();
  const print = screen.getByText("Print slot");
  const quiet = screen.getByRole("button", { name: "Send the bill" });
  expect(quiet).toHaveAttribute("data-variant", "ghost");
  expect(print.compareDocumentPosition(quiet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(another.compareDocumentPosition(quiet) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(quiet);
  for (const slot of ["Goes to slot", "Send status slot"]) expect(screen.getByText(slot)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Send the bill" })).not.toBeInTheDocument();
});

test("a paper bill already sent shows its shared send status; a viewer's unsent paper bill shows no send line", () => {
  const sent = { at: "2026-10-08T10:44:00+05:30", last_at: "2026-10-08T10:44:00+05:30", count: 1, via: "share" as const, to: "" };
  const first = renderApp(<SavedBody {...props({ bill: toBillDetail(wireDetail({ paper: true, sent })) })} />);
  expect(screen.getByText("Send status slot")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Send the bill" })).not.toBeInTheDocument();
  first.unmount();
  renderApp(<SavedBody {...props({ canSend: false, canCreate: false, bill: toBillDetail(wireDetail({ paper: true })) })} />);
  expect(screen.getByText("Print slot")).toBeInTheDocument();
  expect(screen.queryByText("Send status slot")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Send the bill" })).not.toBeInTheDocument();
});
