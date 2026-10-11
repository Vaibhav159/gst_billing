import { act, cleanup, screen } from "@testing-library/react";
import { useLocation } from "react-router";
import { toCustomer } from "@/core/api/customers";
import { __resetDrafts, type DraftData, type UnfinishedBill } from "@/core/api/drafts";
import { __setNetState } from "@/core/api/network";
import { __resetDeviceDrafts, keptDraft } from "@/core/deviceDrafts";
import { wireDetail } from "@/core/sales/fixtures";
import { toBillDetail } from "@/core/sales/wire";
import { handClock, pass } from "@/test/clock";
import { renderApp } from "@/test/render";
import { startDraft, startEdit, startNew, startRemake, toDraftData, type FormState, type Start } from "./model";
import { ANIL, formServer, TODAY, wireBook } from "./testing";
import { useBillForm, type BillFormApi, type BillFormOptions } from "./useBillForm";
import { useDraftKeeping, type DraftKeepingOptions } from "./useDraftKeeping";

const EARLIER = "2026-09-24";
const paths = { draft: (id: string) => `/e/new/items?draft=${id}`, saved: (id: number) => `/e/saved/${id}` };
const options: BillFormOptions = { paths, paperByDate: true };
const keepWhen = (f: FormState) => f.lines.some((line) => (line.qty ?? 0) > 0);
let F: BillFormApi;

function Probe({ start, opts, draftOpts }: { start: Start; opts?: BillFormOptions; draftOpts?: DraftKeepingOptions }) {
  F = useBillForm(start, "easy-test", opts);
  useDraftKeeping(F, "easy-test", draftOpts);
  const location = useLocation();
  return <><output data-testid="where">{location.pathname}{location.search}</output><output data-testid="saved">{F.savedTo}</output></>;
}
function mount(start = startNew({ firmId: 3, firmSource: "mine", today: TODAY }), opts: BillFormOptions | undefined = options, draftOpts: DraftKeepingOptions = { keepWhen }) {
  return renderApp(<Probe start={start} opts={opts} draftOpts={draftOpts} />, { path: "/e/new/items" });
}
function server() {
  return formServer([
    ["GET", "drafts/", () => ({ results: [] })],
    ["PUT", /^drafts\/[0-9a-f-]+\/$/, ({ url, body }) => ({
      id: url.split("/")[1], business: 3, started_by: { id: 1, name: "Kailash Mehta" }, data: (body as { data: DraftData }).data,
      created_at: "2026-10-08T10:00:00+05:30", updated_at: "2026-10-08T10:00:02+05:30",
    })],
    ["GET", "sales/paper-book/", ({ params }) => wireBook({ month: params.month, next: { counter: 38, invoice_number: "KGH/2026-27/38", invoice_date: "2026-09-29" } })],
  ]);
}
function fill() {
  act(() => F.set({ customer: toCustomer(ANIL), payment: "cash", lines: [{ ...F.f.lines[0], productId: 5, name: "Gold Ring 22K", hsn: "711319", gst: "3", qty: 4.5, rate: "6500" }] }));
}
beforeEach(() => {
  localStorage.clear(); __resetDeviceDrafts(); __resetDrafts();
  handClock(new Date("2026-10-08T10:00:00+05:30"));
});
afterEach(async () => { cleanup(); await pass(); vi.useRealTimers(); act(() => __setNetState("online")); });

test("Easy waits for a positive weight, keeps the current step's address, then persists a cleared weight", async () => {
  const { calls } = server(); mount(); await pass(100);
  act(() => F.setCustomer(toCustomer(ANIL)));
  await pass(1500);
  expect(F.draftId).toBeNull();
  act(() => F.setLine(F.f.lines[0].key, { name: "Gold Ring 22K", productId: 5 }));
  await pass(1500);
  act(() => window.dispatchEvent(new Event("pagehide")));
  expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  expect(screen.getByTestId("where")).toHaveTextContent("/e/new/items");
  act(() => F.setLine(F.f.lines[0].key, { qty: 4.5 }));
  await pass(1300);
  expect(F.draftId).not.toBeNull();
  expect(screen.getByTestId("where")).toHaveTextContent(`/e/new/items?draft=${F.draftId}`);
  expect(keptDraft(F.draftId!)?.data.lines[0].qty).toBe(4.5);
  act(() => F.setLine(F.f.lines[0].key, { qty: null }));
  await pass(1300);
  expect(keptDraft(F.draftId!)?.data.lines[0].qty).toBeNull();
});

test("address false keeps the draft without replacing the address", async () => {
  server(); mount(undefined, options, { keepWhen, address: false }); await pass(100); fill(); await pass(1300);
  expect(F.draftId).not.toBeNull();
  expect(screen.getByTestId("where").textContent).toBe("/e/new/items");
  expect(keptDraft(F.draftId!)?.data.lines[0].qty).toBe(4.5);
});

test("default draft options still keep a customer and use the Expert address", async () => {
  server(); mount(undefined, {}, {}); await pass(100);
  act(() => F.setCustomer(toCustomer(ANIL))); await pass(1300);
  expect(F.draftId).not.toBeNull();
  expect(screen.getByTestId("where")).toHaveTextContent(`/sales/new?draft=${F.draftId}`);
});

test("Easy's chosen day reaches paper numbering, number checks, twins, draft data and the POST", async () => {
  const { calls } = server(); mount(); await pass(100); fill();
  act(() => F.set({ date: EARLIER })); await pass(400);
  expect(F.f).toMatchObject({ date: EARLIER, paper: true });
  expect(F.suggestion).toBe("38");
  expect(calls).toContainEqual(expect.objectContaining({ url: "sales/next-number/", params: expect.objectContaining({ invoice_date: EARLIER }) }));
  expect(calls).toContainEqual(expect.objectContaining({ url: "sales/paper-book/", params: expect.objectContaining({ month: "2026-09" }) }));
  expect(calls).toContainEqual(expect.objectContaining({ url: "sales/", params: expect.objectContaining({ customer_id: 7, start_date: EARLIER, end_date: EARLIER }) }));
  act(() => F.setNumber("39")); await pass(400);
  expect(calls).toContainEqual(expect.objectContaining({ url: "sales/check-number/", params: expect.objectContaining({ invoice_date: EARLIER, invoice_number: "39" }) }));
  act(() => expect(F.openReview()).toEqual({ ok: true }));
  await act(async () => { await F.save(); }); await pass();
  expect(calls.find((c) => c.method === "POST" && c.url === "sales/")?.body).toMatchObject({ invoice_date: EARLIER, paper: true, invoice_number: "39" });
  expect(screen.getByTestId("where")).toHaveTextContent(`/e/new/items?draft=${F.draftId}`);
  expect(screen.getByTestId("saved")).toHaveTextContent("/e/saved/501");
});

test("returning to today clears Easy's paper flag; Expert's date setter leaves its counter flag alone", async () => {
  server(); const view = mount(); await pass(100);
  act(() => F.set({ date: EARLIER })); await pass(400);
  expect(F.paper).toBe(true);
  act(() => F.set((old) => ({ date: old.date === EARLIER ? TODAY : EARLIER }))); await pass(400);
  expect(F.f).toMatchObject({ date: TODAY, paper: false });
  act(() => { F.set((old) => ({ notes: `${old.notes}a` })); F.set((old) => ({ notes: `${old.notes}b` })); });
  expect(F.f.notes).toBe("ab");
  view.unmount(); await pass();
  mount(undefined, {}); await pass(100);
  act(() => F.set({ date: EARLIER })); await pass(400);
  expect(F.f).toMatchObject({ date: EARLIER, paper: false });
});

test("Easy's start and remake accept a chosen date, while omitted dates keep today's Expert defaults", () => {
  expect(startNew({ firmId: 3, firmSource: "mine", today: TODAY, date: EARLIER }).form).toMatchObject({ date: EARLIER, paper: true });
  expect(startNew({ firmId: 3, firmSource: "mine", today: TODAY }).form).toMatchObject({ date: TODAY, paper: false });
  const bill = toBillDetail(wireDetail({ status: "cancelled", invoice_date: EARLIER, paper: true }));
  expect(startRemake(bill, TODAY, EARLIER)).toMatchObject({ replaces: bill.id, form: { date: EARLIER, paper: true } });
  expect(startRemake(bill, TODAY).form).toMatchObject({ date: TODAY, paper: false });
});

test("resuming an earlier-day draft preserves its date, paper flag and typed number through the save", async () => {
  const { calls } = server();
  const start = startRemake(toBillDetail(wireDetail({ status: "cancelled" })), TODAY, EARLIER);
  start.form.number = "39"; start.form.numberTyped = true;
  const row: UnfinishedBill = { id: "5d1c2a8e-0b7f-4a8e-9c3a-1f2e3d4c5b6a", business: 3, started_by: { id: 1, name: "Kailash Mehta" }, data: toDraftData(start.form, start.replaces), created_at: "2026-10-08T10:00:00+05:30", updated_at: "2026-10-08T10:00:00+05:30", onDevice: false };
  mount(startDraft(row)); await pass(500);
  expect(F.f).toMatchObject({ date: EARLIER, paper: true, number: "39", numberTyped: true });
  expect(F.start.bookDate).toBe(false);
  act(() => expect(F.openReview()).toEqual({ ok: true }));
  await act(async () => { await F.save(); }); await pass();
  expect(calls.find((c) => c.method === "POST" && c.url === "sales/")?.body).toMatchObject({ invoice_date: EARLIER, paper: true, draft_id: row.id, replaces: 412 });
});

test("saved paths receive edit mode, while the default stays the Expert saved destination", async () => {
  server();
  const saved = vi.fn((id: number, mode: "new" | "edit") => `/e/saved/${id}?mode=${mode}`);
  const start = startEdit(toBillDetail(wireDetail()));
  const view = mount(start, { paths: { saved } }); await pass(100);
  act(() => F.set({ notes: "Adjusted" }));
  act(() => expect(F.openReview()).toEqual({ ok: true }));
  await act(async () => { await F.save(); }); await pass();
  expect(saved).toHaveBeenCalledWith(412, "edit");
  expect(F.savedTo).toBe("/e/saved/412?mode=edit");
  view.unmount(); await pass();
  mount(start, {}); await pass(100);
  act(() => F.set({ notes: "Changed again" }));
  act(() => expect(F.openReview()).toEqual({ ok: true }));
  await act(async () => { await F.save(); }); await pass();
  expect(F.savedTo).toBe("/sales/412?saved=edit");
});
