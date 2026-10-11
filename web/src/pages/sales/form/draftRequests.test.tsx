import { act, cleanup, screen } from "@testing-library/react";
import { __resetDrafts, type DraftData } from "@/core/api/drafts";
import { __setNetState } from "@/core/api/network";
import { __resetDeviceDrafts, keepOnDevice } from "@/core/deviceDrafts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const deviceDraftsSource = readFileSync(resolve(__dirname, "../../../core/deviceDrafts.ts"), "utf8");
import { wireDetail, type Route } from "@/core/sales/fixtures";
import { ANIL, fakeToday, formServer, mountForm, settle } from "./testing";

const ID = "5d1c2a8e-0b7f-4a8e-9c3a-1f2e3d4c5b6a";
const DATA: DraftData = {
  v: 1, firmId: 3, customer: { ...ANIL, customer_type: "person", type: "person" }, date: "2026-10-08", number: "", numberTyped: false,
  paper: false, posOverride: null, payment: null, notes: "", replaces: null,
  lines: [{ productId: 6, name: "Gold Necklace 22K", hsn: "711319", gst: "3", unit: "gms", qty: 18.2, rate: "6400", note: "", custom: false }],
};
const row = { id: ID, business: 3, started_by: { id: 2, name: "Rakesh Soni" }, data: DATA, created_at: "2026-10-08T09:20:00+05:30", updated_at: "2026-10-08T09:25:00+05:30" };
const draftRoutes: Route[] = [
  ["GET", "drafts/", () => ({ results: [row] })],
  ["PUT", `drafts/${ID}/`, () => row],
];

beforeEach(() => { localStorage.clear(); __resetDeviceDrafts(); __resetDrafts(); fakeToday(); });
afterEach(() => { cleanup(); vi.useRealTimers(); act(() => __setNetState("online")); });

test.each(["none", "synced", "unsent"] as const)("opening an unfinished bill asks for the shop's list once (%s on this device)", async (copy) => {
  if (copy !== "none") keepOnDevice({ ...row, synced: copy === "synced", syncedAt: 1 });
  const { calls } = formServer(draftRoutes);
  mountForm(`/sales/new?draft=${ID}`);
  await screen.findByText(/Finishing an unfinished bill/);
  await settle(); await settle();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(calls.filter((c) => c.url === "drafts/")).toHaveLength(1);
});

test.each(["none", "synced", "unsent"] as const)("editing a saved bill doesn't read or sync drafts (%s on this device)", async (copy) => {
  if (copy !== "none") keepOnDevice({ ...row, synced: copy === "synced", syncedAt: 1 });
  const { calls } = formServer([["GET", "sales/412/", () => wireDetail()], ...draftRoutes]);
  mountForm("/sales/412/edit");
  await screen.findByRole("heading", { level: 1, name: "Edit KGH/2026-27/31" });
  await settle(); await settle();
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(calls.filter((c) => c.url.startsWith("drafts/"))).toEqual([]);
});

test("device storage has no reverse import of the drafts API", () => {
  expect(/from ["']@\/core\/api\/drafts["']/.test(deviceDraftsSource)).toBe(false);
});
