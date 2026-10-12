import { useState } from "react";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderApp } from "@/test/render";
import { __setNetState } from "@/core/api/network";
import { refuse, salesServer, wireDetail, wireRow } from "@/core/sales/fixtures";
import { toBillRow } from "@/core/sales/wire";
import { SendToday } from "./HomeBody";

const mocks = vi.hoisted(() => ({ deliver: vi.fn() }));
vi.mock("@/pages/sales/actions/deliver", () => ({ deliver: mocks.deliver }));
vi.mock("@/core/print/files", () => ({ canShareFiles: () => true }));
const fetchUnsent = async () => [toBillRow(wireRow())];
const recorded = { id: 412, sent: { at: "2026-10-08T18:01:00+05:30", last_at: "2026-10-08T18:01:00+05:30", count: 1, via: "share", to: "" } };
function List() {
  const [open, setOpen] = useState(true);
  return <><button onClick={() => setOpen(true)}>Open send list</button><SendToday open={open} fetchUnsent={fetchUnsent} firmId={3} today="2026-10-08" onClose={() => setOpen(false)} /></>;
}
beforeEach(() => {
  Object.assign(window, { __phone: true }); __setNetState("online");
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-08T18:00:00+05:30"));
  mocks.deliver.mockReset().mockResolvedValue({ via: "share", file: "bill.pdf" });
});
afterEach(() => { Object.assign(window, { __phone: false }); vi.useRealTimers(); });
async function sendBill() {
  const button = await screen.findByRole("button", { name: "Send bill 31 to Anil Gupta" });
  await waitFor(() => expect(button).toBeEnabled());
  act(() => vi.setSystemTime(new Date(Date.now() + 400)));
  fireEvent.click(button);
  return button;
}
async function closeList() {
  act(() => vi.setSystemTime(new Date(Date.now() + 400)));
  const buttons = within(screen.getByRole("dialog")).getAllByRole("button", { name: "Close" });
  buttons.at(-1)!.focus();
  await userEvent.keyboard("{Enter}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
}

it("a failed recording stays shared across closing and reopening; keyboard retry records without sharing again", async () => {
  let attempts = 0;
  let finish!: (value: typeof recorded) => void;
  const server = salesServer([["GET", "sales/412/", () => wireDetail()], ["POST", "sales/412/sent/", () => {
    if (++attempts === 1) return refuse(503, { detail: "Try again in a minute." });
    return new Promise((resolve) => { finish = resolve; });
  }]]);
  renderApp(<List />);
  const originalSend = await sendBill();
  expect(await screen.findByText("Not marked as sent")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Send bill 31/ })).not.toBeInTheDocument();
  expect(within(screen.getByRole("dialog")).getByText(/Shared\..*Mark as sent/)).toBeVisible();
  expect(screen.queryByText("Sent", { exact: true })).not.toBeInTheDocument();
  expect(screen.queryByText("No bills left to send in this list.")).not.toBeInTheDocument();
  fireEvent.click(originalSend);
  expect(mocks.deliver).toHaveBeenCalledOnce();

  await closeList();
  fireEvent.click(screen.getByRole("button", { name: "Open send list" }));
  expect(await screen.findByText("Anil Gupta")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Send bill 31/ })).not.toBeInTheDocument();
  await closeList();
  const retry = screen.getByRole("button", { name: "Mark as sent" });
  retry.focus(); await userEvent.keyboard("{Enter}");
  fireEvent.click(retry);
  await waitFor(() => expect(attempts).toBe(2));
  expect(mocks.deliver).toHaveBeenCalledOnce();
  await act(async () => finish(recorded));
  expect(await screen.findByText("KGH/2026-27/31 marked as sent")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Open send list" }));
  expect(await screen.findByText("Sent", { exact: true })).toBeVisible();
  expect(screen.getByText("No bills left to send in this list.")).toBeVisible();
  expect(server.calls.filter((c) => c.method === "POST").map((c) => c.body)).toEqual([{ via: "share", to: "" }, { via: "share", to: "" }]);
  expect(mocks.deliver).toHaveBeenCalledOnce();
});

it("a non-retryable recording refusal never restores Send or claims Sent", async () => {
  salesServer([["GET", "sales/412/", () => wireDetail()], ["POST", "sales/412/sent/", () => refuse(409, { detail: "KGH/2026-27/31 is cancelled, so it can't be sent.", code: "cancelled" })]]);
  renderApp(<List />);
  await sendBill();
  expect(await screen.findByText("Not marked as sent")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Mark as sent" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Send bill 31/ })).not.toBeInTheDocument();
  expect(screen.queryByText("Sent", { exact: true })).not.toBeInTheDocument();
  expect(mocks.deliver).toHaveBeenCalledOnce();
});

it("a dismissed share remains available and records nothing", async () => {
  mocks.deliver.mockResolvedValue(null);
  const server = salesServer([["GET", "sales/412/", () => wireDetail()]]);
  renderApp(<List />);
  const button = await sendBill();
  await waitFor(() => expect(mocks.deliver).toHaveBeenCalledOnce());
  await waitFor(() => expect(button).toBeEnabled());
  expect(screen.queryByText("Sent", { exact: true })).not.toBeInTheDocument();
  expect(server.calls.filter((c) => c.method === "POST")).toEqual([]);
});

it("reopening rechecks a previously skipped bill whose customer number was corrected", async () => {
  let corrected = false;
  salesServer([["GET", "sales/412/", () => corrected ? wireDetail() : wireDetail({ customer: { id: 7, name: "Anil Gupta", type: "person", mobile_number: "", gst_number: "" } })],
    ["POST", "sales/412/sent/", () => recorded]]);
  renderApp(<List />);
  await sendBill();
  expect(await screen.findByText("No longer waiting to be sent")).toBeVisible();
  expect(mocks.deliver).not.toHaveBeenCalled();
  await closeList();
  corrected = true;
  fireEvent.click(screen.getByRole("button", { name: "Open send list" }));
  await sendBill();
  expect(await screen.findByText("Sent", { exact: true })).toBeVisible();
  expect(mocks.deliver).toHaveBeenCalledOnce();
});
