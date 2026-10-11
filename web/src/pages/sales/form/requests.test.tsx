// Regression coverage from the final review request probe: no unused reads or intermediate dates.
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { __resetDrafts, type DraftData } from "@/core/api/drafts";
import { __setNetState } from "@/core/api/network";
import { __resetDeviceDrafts } from "@/core/deviceDrafts";
import { wireDetail, type Route } from "@/core/sales/fixtures";
import { ANIL, formServer, fakeToday, mountForm, settle } from "./testing";

vi.setConfig({ testTimeout: 30_000 });
beforeEach(() => { localStorage.clear(); __resetDeviceDrafts(); __resetDrafts(); });
afterEach(() => { cleanup(); vi.useRealTimers(); act(() => __setNetState("online")); });

async function openForm(path: string) {
  let view!: ReturnType<typeof mountForm>;
  await act(async () => { view = mountForm(path); });
  await settle();
  return view;
}

const RAKESHS: DraftData = {
  v: 1, firmId: 3, customer: { ...ANIL, customer_type: "person", businesses: [3] } as DraftData["customer"], date: "2026-10-08", number: "", numberTyped: false, paper: false, posOverride: null,
  payment: null, notes: "", replaces: null,
  lines: [{ productId: 6, name: "Gold Necklace 22K", hsn: "711319", gst: "3", unit: "gms", qty: 18.2, rate: "6400", note: "", custom: false }],
};
const rakeshs = { id: "5d1c2a8e-0b7f-4a8e-9c3a-1f2e3d4c5b6a", business: 3, started_by: { id: 2, name: "Rakesh Soni" }, data: RAKESHS, created_at: "2026-10-08T09:20:00+05:30", updated_at: "2026-10-08T09:25:00+05:30" };
const draftRoutes: Route[] = [
  ["GET", "drafts/", () => ({ results: [rakeshs] })],
  ["PUT", /^drafts\/[0-9a-f-]+\/$/, ({ url, body }) => ({ id: url.split("/")[1], business: 3, started_by: { id: 1, name: "K" }, data: (body as { data: unknown }).data, created_at: "2026-10-08T10:00:00+05:30", updated_at: "2026-10-08T10:00:02+05:30" })],
  ["DELETE", /^drafts\/[0-9a-f-]+\/$/, () => ""],
];

test("opening a new bill", async () => {
  fakeToday();
  const { calls } = formServer(draftRoutes);
  await openForm("/sales/new");
  const customer = await screen.findByRole("combobox", { name: /Customer/ });
  await waitFor(() => expect(customer).toHaveFocus());
  await settle(); await settle();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(calls.filter((c) => c.url === "shop-settings/")).toHaveLength(1);
  expect(calls.filter((c) => c.url !== "shop-settings/")).toHaveLength(8);
});

test("opening an unfinished bill (?draft=)", async () => {
  fakeToday();
  const { calls } = formServer(draftRoutes);
  await openForm(`/sales/new?draft=${rakeshs.id}`);
  await screen.findByText(/Finishing an unfinished bill/);
  await settle(); await settle();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(calls.filter((c) => c.url === "shop-settings/")).toHaveLength(1);
  expect(calls.filter((c) => c.url !== "shop-settings/")).toHaveLength(10);
});

test("opening a paper bill from the saved panel's Next paper bill", async () => {
  fakeToday();
  const { calls } = formServer(draftRoutes);
  await openForm("/sales/new?paper=1&firm=3&date=2026-09-29&number=35");
  await screen.findByRole("heading", { level: 1, name: "Bill from the paper book" });
  await settle(); await settle();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(calls.filter((c) => c.url === "shop-settings/")).toHaveLength(1);
  expect(calls.filter((c) => c.url !== "shop-settings/")).toHaveLength(10);
});

test("opening an edit", async () => {
  fakeToday();
  const { calls } = formServer([["GET", "sales/412/", () => wireDetail()], ...draftRoutes]);
  await openForm("/sales/412/edit");
  await screen.findByRole("heading", { level: 1, name: "Edit KGH/2026-27/31" });
  await settle(); await settle();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(calls.filter((c) => c.url === "shop-settings/")).toHaveLength(1);
  expect(calls.filter((c) => c.url !== "shop-settings/")).toHaveLength(8);
});

test("a counter bill typed and saved, then what follows", async () => {
  const user = fakeToday();
  const { calls } = formServer(draftRoutes);
  const { router } = await openForm("/sales/new");
  const customer = await screen.findByRole("combobox", { name: /Customer/ });
  await waitFor(() => expect(customer).toHaveFocus());
  await settle(); await settle();
  await user.keyboard("Anil");
  await act(async () => { vi.advanceTimersByTime(400); });
  await screen.findByRole("option", { name: /^Anil Gupta/ });
  await user.keyboard("{Enter}");
  await settle();
  await user.keyboard("ring{Enter}4.5{Enter}6500");
  await settle(); await settle();
  // the number typed by hand, digit by digit
  const number = screen.getByLabelText("Bill number");
  await user.clear(number);
  await user.type(number, "35");
  await act(async () => { vi.advanceTimersByTime(400); });
  await settle();
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  await user.keyboard("{Control>}s{/Control}");
  await settle();
  const dialog = await screen.findByRole("dialog");
  await act(async () => { vi.advanceTimersByTime(400); });
  await user.click(within(dialog).getByRole("radio", { name: "Cash" }));
  await act(async () => { vi.advanceTimersByTime(400); });
  const savingAt = calls.length;
  await user.click(within(dialog).getByRole("button", { name: "Save bill" }));
  await settle(); await settle();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(router.state.location.pathname).toBe("/sales/501");
  // A saved sale refreshes Records' shared firm queries, including the mounted slim list.
  expect(calls.slice(savingAt).map((c) => `${c.method} ${c.url}`)).toEqual(["POST sales/", "GET firms/"]);
});

test("leaving a new bill with a change not kept yet", async () => {
  const user = fakeToday();
  const { calls } = formServer(draftRoutes);
  const { router } = await openForm("/sales/new");
  const customer = await screen.findByRole("combobox", { name: /Customer/ });
  await waitFor(() => expect(customer).toHaveFocus());
  await settle(); await settle();
  await user.keyboard("Anil");
  await act(async () => { vi.advanceTimersByTime(400); });
  await screen.findByRole("option", { name: /^Anil Gupta/ });
  await user.keyboard("{Enter}");
  await settle();
  const at = calls.length;
  await act(async () => { await router.navigate("/sales"); });
  await settle(); await settle();
  expect(calls.slice(at).filter((c) => c.method === "PUT")).toHaveLength(1);
});

test("typing a paper bill's date with a four-digit year", async () => {
  const user = fakeToday();
  const { calls } = formServer(draftRoutes);
  await openForm("/sales/new?paper=1&firm=3&date=2026-09-29&number=35");
  await screen.findByRole("heading", { level: 1, name: "Bill from the paper book" });
  await settle(); await settle();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  const at = calls.length;
  const box = screen.getByRole("textbox", { name: /Date on the paper bill/ });
  await user.clear(box);
  await user.type(box, "28/09/2026");
  await settle(); await settle();
  await act(async () => { vi.advanceTimersByTime(400); });
  await settle();
  expect(calls.slice(at)).toHaveLength(2);
  expect(calls.slice(at).every((c) => c.params.invoice_date === "2026-09-28")).toBe(true);
});

test("a cleared paper date asks for neither the book nor a number", async () => {
  const user = fakeToday();
  const { calls } = formServer(draftRoutes);
  await openForm("/sales/new?paper=1&firm=3&date=2026-09-29&number=35");
  const customer = await screen.findByRole("combobox", { name: /Customer/ });
  await waitFor(() => expect(customer).toHaveFocus());
  await settle();
  const at = calls.length;
  await user.clear(screen.getByRole("textbox", { name: /Date on the paper bill/ }));
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(calls.slice(at).filter((c) => c.url.startsWith("sales/"))).toEqual([]);
});
