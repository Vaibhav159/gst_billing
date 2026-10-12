import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderApp } from "@/test/render";
import { salesServer, wireDetail, wireRow, refuse } from "@/core/sales/fixtures";
import { toBillRow } from "@/core/sales/wire";
import type { BillRow } from "@/core/sales/types";
import { SendToday } from "./HomeBody";
const mocks = vi.hoisted(() => ({ send: vi.fn(), collect: vi.fn(), files: true }));
vi.mock("@/core/print/files", () => ({ canShareFiles: () => mocks.files }));
vi.mock("@/pages/sales/actions/useSendBill", () => ({ useSendBill: () => mocks.send, useSendReady: () => true }));
beforeEach(() => { Object.assign(window, { __phone: true }); mocks.files = true; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-08T18:00:00+05:30")); mocks.send.mockReset(); mocks.collect.mockReset(); mocks.collect.mockResolvedValue([toBillRow(wireRow())]); });
afterEach(() => { Object.assign(window, { __phone: false }); vi.useRealTimers(); });
const settleGuard = () => act(() => vi.setSystemTime(new Date(Date.now() + 400)));
it("no Send appears until the shared snapshot resolves; the 51st row can be sent", async () => {
  let finish!: (value: BillRow[]) => void;
  mocks.collect.mockImplementation(() => new Promise<BillRow[]>((resolve) => { finish = resolve; }));
  const s = salesServer([["GET", "sales/51/", () => wireDetail({ id: 51, counter: 51 })]]);
  mocks.send.mockImplementation(async (_b, options) => { options.onRecorded(); return true; });
  renderApp(<SendToday fetchUnsent={mocks.collect} firmId={3} today="2026-10-08" onClose={() => {}} />);
  await screen.findByRole("heading", { name: "Send today's bills" });
  expect(screen.queryByRole("button", { name: /Send bill/ })).not.toBeInTheDocument();
  await waitFor(() => expect(finish).toBeDefined());
  await act(async () => { finish(Array.from({ length: 51 }, (_, i) => toBillRow(wireRow({ id: i + 1, counter: i + 1 })))); });
  const button = await screen.findByRole("button", { name: "Send bill 51 to Anil Gupta" });
  settleGuard(); await act(async () => fireEvent.click(button));
  expect(mocks.send).toHaveBeenCalledOnce();
  expect(mocks.send.mock.calls[0][0]).toMatchObject({ id: 51 });
  expect(s.calls.map((c) => c.url)).toEqual(["sales/51/"]);
  expect(await screen.findByText("Sent")).toBeVisible();
});
it("a bill cancelled since the list opened is skipped, with no share", async () => {
  salesServer([["GET", "sales/412/", () => wireDetail({ status: "cancelled" })]]);
  renderApp(<SendToday fetchUnsent={mocks.collect} firmId={3} today="2026-10-08" onClose={() => {}} />);
  const button = await screen.findByRole("button", { name: "Send bill 31 to Anil Gupta" }); settleGuard();
  await act(async () => fireEvent.click(button));
  expect(await screen.findByText("No longer waiting to be sent")).toBeVisible(); expect(mocks.send).not.toHaveBeenCalled();
});
it("a failed recheck stays actionable and never shares the stale bill", async () => {
  salesServer([["GET", "sales/412/", () => refuse(503, { detail: "Try again in a minute." })]]);
  renderApp(<SendToday fetchUnsent={mocks.collect} firmId={3} today="2026-10-08" onClose={() => {}} />);
  const button = await screen.findByRole("button", { name: "Send bill 31 to Anil Gupta" }); settleGuard();
  await act(async () => fireEvent.click(button));
  expect(await screen.findByRole("alert")).toBeVisible(); expect(button).toBeEnabled(); expect(mocks.send).not.toHaveBeenCalled();
});
it("a share dismissed by the person is never labelled Sent", async () => {
  salesServer([["GET", "sales/412/", () => wireDetail()]]);
  mocks.send.mockResolvedValue(false);
  renderApp(<SendToday fetchUnsent={mocks.collect} firmId={3} today="2026-10-08" onClose={() => {}} />);
  const button = await screen.findByRole("button", { name: "Send bill 31 to Anil Gupta" }); settleGuard();
  await act(async () => fireEvent.click(button));
  expect(screen.queryByText("Sent")).not.toBeInTheDocument(); expect(button).toBeEnabled();
});

it("a closed send list never starts sharing after a delayed detail read", async () => {
  let finish!: (value: unknown) => void;
  salesServer([["GET", "sales/412/", () => new Promise((resolve) => { finish = resolve; })]]);
  const view = renderApp(<SendToday fetchUnsent={mocks.collect} firmId={3} today="2026-10-08" onClose={() => {}} />);
  const button = await screen.findByRole("button", { name: "Send bill 31 to Anil Gupta" }); settleGuard();
  fireEvent.click(button); await waitFor(() => expect(finish).toBeDefined()); view.unmount();
  await act(async () => finish(wireDetail())); expect(mocks.send).not.toHaveBeenCalled();
});
it("the link fallback rechecks first and sends synchronously from the second press", async () => {
  mocks.files = false; mocks.send.mockResolvedValue(true);
  const s = salesServer([["GET", "sales/412/", () => wireDetail()]]);
  renderApp(<SendToday fetchUnsent={mocks.collect} firmId={3} today="2026-10-08" onClose={() => {}} />);
  const button = await screen.findByRole("button", { name: "Send bill 31 to Anil Gupta" }); settleGuard();
  await act(async () => fireEvent.click(button)); expect(mocks.send).not.toHaveBeenCalled();
  expect(await screen.findByText("Bill 31 checked. Tap Send again to open WhatsApp.")).toBeVisible();
  fireEvent.click(button); expect(mocks.send).toHaveBeenCalledOnce();
  expect(s.calls.filter((c) => c.url === "sales/412/")).toHaveLength(1);
  expect(await screen.findByText("Sent")).toBeVisible();
});
