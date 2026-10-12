import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { __setNetState } from "@/core/api/network";
import { wirePage } from "@/core/sales/fixtures";
import { renderApp } from "@/test/render";
import { serve, type Answer } from "@/test/server";
import Gst, { GstCard } from "./Gst";

const choice = vi.hoisted(() => ({ firmId: 3 as number | null, loading: false, error: false }));
vi.mock("./state", async (original) => ({
  ...await original<typeof import("./state")>(),
  useEasyFirm: () => ({ ...choice, firm: choice.firmId === null ? null : { id: choice.firmId, name: "KIRAN GOLD HOUSE" } }),
}));
const month = {
  business: 3, month: "2026-09", stage: "blocked",
  due: { gstr1: "2026-10-11", gstr3b: "2026-10-20" },
  record: { gstr1: null, gstr3b: null, legacy: false },
  checks: { blockers: [{ kind: "duplicate", text: "Bill number KGH/2026-27/17 is used twice", bills: [], more_bills: 0 }] },
  gstr3b: { output: { total: "10378.76" }, cash: { total: "2120.00" }, carry_on: { total: "0.00" }, opening_missing: true },
};
function server(previous: Answer = month) {
  const sales = wirePage([], { summary: { bills: 3, tax: "8800.71" } });
  return serve({ "GET sales/": sales, "GET gst/month/": previous });
}
function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}:{JSON.stringify(location.state)}</output>;
}
beforeEach(() => {
  choice.firmId = 3; choice.loading = false; choice.error = false;
  (window as Window & { __phone?: boolean }).__phone = true;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T12:00:00+05:30"));
  onlineManager.setOnline(true); __setNetState("online");
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks();
  Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
  onlineManager.setOnline(true); __setNetState("online");
});
test.each(["loading", "error"] as const)("an unresolved firm in %s state sends no GST or sales request", async (state) => {
  choice.firmId = null; choice[state] = true;
  const calls = server(); renderApp(<Gst />, { path: "/e/gst" });
  await act(async () => {});
  expect(calls).toEqual([]);
  expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Share these figures with your CA" })).not.toBeInTheDocument();
  if (state === "error") expect(screen.getByRole("alert")).toHaveTextContent("The firms couldn't load.");
});
test("the Home card and page share their two narrow reads and keep server paise", async () => {
  const calls = server(); renderApp(<><GstCard /><Gst /></>, { path: "/e/gst" });
  expect(await screen.findByText("₹10,378.76")).toBeVisible();
  expect(screen.getByText("Tax in this month's GSTR-3B")).toBeVisible();
  expect(screen.getAllByText("₹8,800.71")).toHaveLength(2);
  expect(calls).toHaveLength(2);
  expect(calls.find(c => c.url === "sales/")?.params).toMatchObject({ business_id: 3, month: "2026-10", page_size: 1 });
  expect(calls.find(c => c.url === "gst/month/")?.params).toEqual({ business_id: 3, month: "2026-09" });
});
test("a pending return shows loading without zero money or a share action", async () => {
  server(() => new Promise(() => {})); renderApp(<Gst />, { path: "/e/gst" });
  await screen.findByText("Loading last month's return…");
  expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Share these figures with your CA" })).not.toBeInTheDocument();
});
test("offline and refused reads stay visible and cannot share fabricated figures", async () => {
  onlineManager.setOnline(false); __setNetState("offline");
  const calls = server(); renderApp(<Gst />, { path: "/e/gst" });
  expect(await screen.findByText(/You're offline/)).toBeVisible();
  expect(calls).toEqual([]);
  expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
  cleanup(); onlineManager.setOnline(true); __setNetState("online");
  server(() => ({ status: 403, data: { detail: "You can't open this return." } }));
  renderApp(<Gst />, { path: "/e/gst" });
  expect(await screen.findByText("You can't open this return.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Share these figures with your CA" })).not.toBeInTheDocument();
});
test.each(["shared", "cancelled", "rejected"] as const)("native GST sharing handles %s without a recipient or writes", async (result) => {
  const share = vi.fn().mockImplementation(() => result === "shared" ? Promise.resolve() : Promise.reject(result === "cancelled" ? new DOMException("Cancelled", "AbortError") : new Error("failed")));
  Object.defineProperty(navigator, "share", { configurable: true, value: share });
  const open = vi.spyOn(window, "open"); const calls = server();
  renderApp(<Gst />, { path: "/e/gst" });
  fireEvent.click(await screen.findByRole("button", { name: "Share these figures with your CA" }));
  await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
  expect(share.mock.calls[0][0]).toEqual({ text: expect.stringContaining("Tax in this month's GSTR-3B ₹10,378.76; left to pay in cash ₹2,120.00.") });
  await waitFor(() => expect(screen.getByRole("button", { name: "Share these figures with your CA" })).toBeEnabled());
  expect(open).not.toHaveBeenCalled();
  expect(calls.every(c => c.method === "GET")).toBe(true);
  if (result === "shared") expect(await screen.findByText("Figures shared with your CA")).toBeVisible();
  if (result === "rejected") expect(await screen.findByText("Figures weren't shared")).toBeVisible();
  if (result === "cancelled") expect(screen.queryByText(/Figures (shared|weren't shared)/)).not.toBeInTheDocument();
});
test("desktop uses recipient-free WhatsApp even with a native share method", async () => {
  (window as Window & { __phone?: boolean }).__phone = false;
  const share = vi.fn(); Object.defineProperty(navigator, "share", { configurable: true, value: share });
  const open = vi.spyOn(window, "open").mockReturnValue({ opener: {} } as Window);
  server(); renderApp(<Gst />, { path: "/e/gst" });
  fireEvent.click(await screen.findByRole("button", { name: "Share these figures with your CA" }));
  await waitFor(() => expect(open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/wa.me\/\?text=/), "_blank"));
  expect(share).not.toHaveBeenCalled();
});
test("fixing a return visits full view with firm and month without a preference write", async () => {
  const calls = server(); renderApp(<><Gst /><Location /></>, { path: "/e/gst" });
  fireEvent.click(await screen.findByRole("button", { name: "Fix it in the full view" }));
  expect(screen.getByTestId("location")).toHaveTextContent('/gst?firm=3&month=2026-09&fix=1:{"fullView":true}');
  expect(calls.every(c => c.method === "GET")).toBe(true);
});
