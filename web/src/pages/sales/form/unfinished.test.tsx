import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { __resetDrafts, type DraftData, type UnfinishedBill } from "@/core/api/drafts";
import { __setNetState } from "@/core/api/network";
import { __resetDeviceDrafts, keepOnDevice, keptDraft, keptDrafts } from "@/core/deviceDrafts";
import { refuse, wireDetail, type Route } from "@/core/sales/fixtures";
import { toBillDetail } from "@/core/sales/wire";
import { BillForm } from "./BillFormPage";
import { startDraft, startEdit, type Start } from "./model";
import { ANIL, asksOnClose, formServer, fakeToday, mountForm, settle } from "./testing";

// whole flows through the form, a step at a time: a busy runner takes longer than vitest's 5 s for one
vi.setConfig({ testTimeout: 20_000 });

beforeEach(() => { localStorage.clear(); __resetDeviceDrafts(); __resetDrafts(); });
// the form goes first: with it still there, the network coming back would start a sync after the test
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); act(() => __setNetState("online")); });

const where = (router: { state: { location: { pathname: string; search: string } } }) => router.state.location.pathname + router.state.location.search;
const LALIT = { ...ANIL, id: 11, name: "Lalit Jain" };
const RAKESH = { id: 2, name: "Rakesh Soni" };
const RAKESHS: DraftData = {
  v: 1, firmId: 3, customer: { ...LALIT, customer_type: "person", businesses: [3] } as DraftData["customer"], date: "2026-10-08", number: "", numberTyped: false, paper: false, posOverride: null,
  payment: null, notes: "Waiting for the bangles to be weighed", replaces: null,
  lines: [{ productId: 6, name: "Gold Necklace 22K", hsn: "711319", gst: "3", unit: "gms", qty: 18.2, rate: "6400", note: "", custom: false }],
};
const rakeshs = { id: "5d1c2a8e-0b7f-4a8e-9c3a-1f2e3d4c5b6a", business: 3, started_by: RAKESH, data: RAKESHS, created_at: "2026-10-08T09:20:00+05:30", updated_at: "2026-10-08T09:25:00+05:30" };
/** The server's answer for a draft a bill was made from already (contract §4, Rulings 1D-6 and 1D-8). */
const SAVED_AS = {
  detail: "This unfinished bill was saved as KGH/2026-27/31 already.", code: "draft_saved",
  bill: { id: 412, invoice_number: "KGH/2026-27/31", invoice_date: "2026-10-08", customer_name: "Lalit Jain", status: "active" },
};
const offline = () => new AxiosError("Network Error", "ERR_NETWORK");

/**
 * The shop's unfinished bills on the server: kept, listed and deleted as the contract says (§4). A bill saved with a
 * draft_id takes the draft off the list and keeps a note of it; a PUT or a save of that draft then answers 409
 * draft_saved. hold(m) keeps that method's answers back until release(m).
 */
function draftsOnServer(start: typeof rakeshs[] = []) {
  const rows = new Map(start.map((d) => [d.id, d]));
  const saved = new Set<string>();
  let down = false;
  let listFails = false;
  const gates: Record<string, { wait: Promise<void>; open: () => void } | undefined> = {};
  const gate = async (m: string) => { await gates[m]?.wait; };
  const routes: Route[] = [
    ["GET", "drafts/", async () => {
      if (down) throw offline();
      if (listFails) refuse(500, { detail: "Server error" });
      await gate("GET");
      return { results: [...rows.values()] };
    }],
    ["PUT", /^drafts\/[0-9a-f-]+\/$/, async ({ url, body }) => {
      if (down) throw offline();
      await gate("PUT");
      const id = url.split("/")[1];
      if (saved.has(id)) refuse(409, SAVED_AS);
      const b = body as { business: number; data: DraftData };
      const row = { id, business: b.business, started_by: rows.get(id)?.started_by ?? { id: 1, name: "Kailash Mehta" }, data: b.data, created_at: rows.get(id)?.created_at ?? "2026-10-08T10:00:00+05:30", updated_at: "2026-10-08T10:00:02+05:30" };
      rows.set(id, row);
      return row;
    }],
    ["DELETE", /^drafts\/[0-9a-f-]+\/$/, ({ url }) => { if (down) throw offline(); rows.delete(url.split("/")[1]); return null; }],
    ["POST", "sales/", async ({ body }) => {
      await gate("POST");
      const b = body as { business: number; invoice_number: string; invoice_date: string; draft_id: string | null };
      if (b.draft_id && saved.has(b.draft_id)) refuse(409, SAVED_AS);
      if (b.draft_id) { rows.delete(b.draft_id); saved.add(b.draft_id); }
      return wireDetail({ id: 501, business: b.business, invoice_number: `KGH/2026-27/${b.invoice_number}`, invoice_date: b.invoice_date });
    }],
  ];
  return {
    rows, routes,
    setDown: (v: boolean) => { down = v; },
    /** The shop's list answers 500 while the internet is fine. */
    failList: () => { listFails = true; },
    /** A counter saved this draft as a bill: it's off the list, and the server remembers. */
    savedAsBill: (id: string) => { rows.delete(id); saved.add(id); },
    hold: (m: string) => { let open = () => {}; const wait = new Promise<void>((r) => { open = r; }); gates[m] = { wait, open: () => { gates[m] = undefined; open(); } }; },
    release: (m: string) => gates[m]?.open(),
  };
}

/** Picks Anil Gupta in the customer box by keyboard. */
async function pickAnil(user: ReturnType<typeof fakeToday>) {
  const customer = await screen.findByRole("combobox", { name: /Customer/ });
  await waitFor(() => expect(customer).toHaveFocus());
  await user.keyboard("Anil");
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  await screen.findByRole("option", { name: /^Anil Gupta/ });
  await user.keyboard("{Enter}");
}
const puts = (calls: { method: string }[]) => calls.filter((c) => c.method === "PUT");
/**
 * Opens an unfinished bill (a click, or a link): the form waits for the shop's fresh answer before it's drawn, so that
 * answer is held, then let land inside act, and the form isn't drawn between a test's steps.
 */
async function arrive(server: ReturnType<typeof draftsOnServer>, go: () => Promise<unknown>) {
  server.hold("GET");
  await go();
  await act(async () => { server.release("GET"); await vi.advanceTimersByTimeAsync(50); });
  await settle();
}
const status = () => within(screen.getByRole("complementary", { name: "Bill summary" }));

test("a new bill keeps itself as a draft 1.2 s after the last change: on this device at once, on the shop's list, and the address names it", async () => {
  const user = fakeToday();
  const server = draftsOnServer();
  const { calls } = formServer(server.routes);
  const { router } = mountForm("/sales/new");
  await settle();
  expect(await screen.findByText("Kept as a draft once you start")).toBeInTheDocument();
  await pickAnil(user);
  expect(screen.getByText("Keeping the draft…")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
  await waitFor(() => expect(screen.getByText("Kept as a draft at 10:00")).toBeInTheDocument());
  const put = calls.find((c) => c.method === "PUT");
  expect(put?.body).toMatchObject({ business: 3, data: { v: 1, firmId: 3, customer: { id: 7, name: "Anil Gupta" }, numberTyped: false, number: "", lines: [] } });
  const id = put!.url.split("/")[1];
  expect(where(router)).toBe(`/sales/new?draft=${id}`);
  // the same form, not a new one: what was picked stays
  expect(screen.getByRole("combobox", { name: /Customer/ })).toHaveValue("Anil Gupta");
  expect(keptDraft(id)).toMatchObject({ synced: true, data: { customer: { id: 7 } } });
});

test("leaving keeps it and says where to find it; Open brings it back as it was, saying who started it", async () => {
  const user = fakeToday();
  const server = draftsOnServer();
  formServer(server.routes);
  const { router } = mountForm("/sales/new");
  await settle();
  await pickAnil(user);
  await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
  await screen.findByText("Kept as a draft at 10:00");
  await act(async () => { await router.navigate("/sales"); });
  expect(screen.getByTestId("where")).toHaveTextContent("Sales at /sales");
  expect(await screen.findByText("Bill kept as a draft")).toBeInTheDocument();
  expect(screen.getByText("New bill lists it until it's finished. Open it now?")).toBeInTheDocument();
  await arrive(server, () => user.click(screen.getByRole("button", { name: "Open" })));
  expect(screen.getByText("Finishing an unfinished bill")).toBeInTheDocument();
  expect(screen.getByText("Started at 10:00 by Kailash Mehta. It keeps saving as you go.")).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: /Customer/ })).toHaveValue("Anil Gupta");
});

test("someone else's unfinished bill shows on a new bill with who started it, and Open picks it up as it was", async () => {
  const user = fakeToday();
  const server = draftsOnServer([rakeshs]);
  formServer(server.routes);
  const { router } = mountForm("/sales/new");
  await settle();
  const list = await screen.findByRole("list", { name: "Unfinished bills" });
  expect(list).toHaveTextContent("Lalit Jain's unfinished bill in Kiran · started 09:20 by Rakesh");
  await arrive(server, () => user.click(within(list).getByRole("button", { name: "Open Lalit Jain's unfinished bill" })));
  expect(screen.getByText("Started at 09:20 by Rakesh Soni. It keeps saving as you go.")).toBeInTheDocument();
  expect(where(router)).toBe(`/sales/new?draft=${rakeshs.id}`);
  expect(screen.getByRole("combobox", { name: "Line 1 product" })).toHaveValue("Gold Necklace 22K");
  expect(screen.getByLabelText("Note on the bill")).toHaveValue("Waiting for the bangles to be weighed");
  // the one being finished isn't offered again
  expect(screen.queryByRole("list", { name: "Unfinished bills" })).not.toBeInTheDocument();
});

test("a new bill lists three of the shop's other unfinished bills, newest first, then Show all", async () => {
  const user = fakeToday();
  const at = (h: number) => `2026-10-08T0${h}:00:00+05:30`;
  const others = [5, 6, 7, 8].map((h, i) => ({ ...rakeshs, id: `5d1c2a8e-0b7f-4a8e-9c3a-1f2e3d4c5b6${i}`, data: { ...RAKESHS, customer: { ...RAKESHS.customer!, name: `Customer ${h}` } }, created_at: at(h), updated_at: at(h) }));
  formServer(draftsOnServer(others).routes);
  mountForm("/sales/new");
  await settle();
  const list = await screen.findByRole("list", { name: "Unfinished bills" });
  expect(within(list).getAllByRole("button", { name: /^Open / }).map((b) => b.getAttribute("aria-label"))).toEqual([
    "Open Customer 8's unfinished bill", "Open Customer 7's unfinished bill", "Open Customer 6's unfinished bill",
  ]);
  await user.click(within(list).getByRole("button", { name: "Show all 4 unfinished bills" }));
  expect(within(list).getAllByRole("button", { name: /^Open / })).toHaveLength(4);
  expect(within(list).queryByRole("button", { name: /^Show all/ })).not.toBeInTheDocument();
});

const fromRakeshs = () => startDraft({ ...rakeshs, onDevice: false } as UnfinishedBill);
/** The bill form as /sales/new puts it together (BillForm: its draft keeping, its leave-guard and the review), from `start`. */
function mountSaving(start: Start) {
  return mountForm("/form", { routes: [{ path: "/form", element: <BillForm start={start} formKey="saving-form" /> }] });
}
/**
 * Paid in cash, Check and save (Ctrl S), then Save in the review. The review's guard against the key that opened it is
 * passed on the clock alone, so no timer (the draft's 1.2 s) runs meanwhile.
 */
async function save(user: ReturnType<typeof fakeToday>) {
  await waitFor(() => expect(screen.getByLabelText("Bill number")).toHaveValue("34"));
  await user.click(screen.getByRole("radio", { name: "Cash" }));
  await user.keyboard("{Control>}s{/Control}");
  const dialog = await screen.findByRole("dialog", { name: "Check the bill before saving" });
  vi.setSystemTime(Date.now() + 400);
  await user.click(within(dialog).getByRole("button", { name: "Save bill" }));
  await settle();
  return dialog;
}
const savingIn = (dialog: HTMLElement) => within(dialog).getByRole("button", { name: "Saving…" });

test("saving from an unfinished bill sends its draft_id and takes the draft with it: the last change goes in the bill, nothing keeps it again, and the next new bill doesn't list it (Ruling 1D-4/F6, F18)", async () => {
  const user = fakeToday();
  const server = draftsOnServer([rakeshs]);
  const { calls } = formServer(server.routes);
  const { router } = mountSaving(fromRakeshs());
  await settle();
  await screen.findByText("Finishing an unfinished bill");
  // the shop's list, read as the form opened, has it
  await waitFor(() => expect(calls.some((c) => c.method === "GET" && c.url === "drafts/")).toBe(true));
  // a change made just before the save: not kept yet when Save is pressed
  await user.type(screen.getByLabelText("Note on the bill"), " today");
  expect(status().getByText("Keeping the draft…")).toBeInTheDocument();
  server.hold("POST");
  const dialog = await save(user);
  // the save takes the change: nothing waits to be kept
  expect(savingIn(dialog)).toBeInTheDocument();
  expect(status().queryByText("Keeping the draft…")).not.toBeInTheDocument();
  // and nothing is kept while the save is on its way, however long it takes
  await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
  expect(puts(calls)).toEqual([]);
  await act(async () => { server.release("POST"); await vi.advanceTimersByTimeAsync(50); });
  await waitFor(() => expect(where(router)).toBe("/sales/501?saved=new"));
  expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ draft_id: rakeshs.id, customer: 11, notes: "Waiting for the bangles to be weighed today" });
  await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
  expect(puts(calls)).toEqual([]);
  expect(keptDraft(rakeshs.id)).toBeNull();
  // the next new bill: its list comes from the cache before the shop answers, and the saved draft isn't on it
  server.hold("GET");
  await act(async () => { await router.navigate("/sales/new"); });
  expect(await screen.findByText("Kept as a draft once you start")).toBeInTheDocument();
  await settle();
  expect(screen.queryByText(/Lalit Jain's unfinished bill/)).not.toBeInTheDocument();
  expect(screen.queryByText("Bill kept as a draft")).not.toBeInTheDocument();
  await act(async () => { server.release("GET"); await vi.advanceTimersByTimeAsync(50); });
  expect(calls.filter((c) => c.method === "GET" && c.url === "drafts/").length).toBeGreaterThan(1);
  expect(screen.queryByText(/Lalit Jain's unfinished bill/)).not.toBeInTheDocument();
});

test("a save that waits behind the draft's last keep, still on its way, says so in the review and the status (Task 1's review)", async () => {
  const user = fakeToday();
  const server = draftsOnServer([rakeshs]);
  const { calls } = formServer(server.routes);
  const { router } = mountSaving(fromRakeshs());
  await settle();
  await screen.findByText("Finishing an unfinished bill");
  server.hold("PUT");
  await user.type(screen.getByLabelText("Note on the bill"), " today");
  await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
  await waitFor(() => expect(puts(calls)).toHaveLength(1));
  expect(status().getByText("Keeping the draft…")).toBeInTheDocument();
  const dialog = await save(user);
  expect(within(dialog).getByRole("status")).toHaveTextContent("Saving once the draft's last change reaches the shop's list…");
  expect(savingIn(dialog)).toBeInTheDocument();
  expect(status().getByText("Saving once the draft's last change reaches the shop's list…")).toBeInTheDocument();
  expect(calls.some((c) => c.method === "POST")).toBe(false);
  await act(async () => { server.release("PUT"); await vi.advanceTimersByTimeAsync(50); });
  await waitFor(() => expect(where(router)).toBe("/sales/501?saved=new"));
  expect(calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.url}`)).toEqual([`PUT drafts/${rakeshs.id}/`, "POST sales/"]);
});

test.each([
  ["with a link to that bill", SAVED_AS.bill, true],
  ["alone when that bill has left Sales (its bill: null)", null, false],
] as const)("a save answered 409 draft_saved: the review says so in the server's words, %s; keeping stops, and the status says so too (Ruling 1D-8)", async (_, bill, linked) => {
  const user = fakeToday();
  const server = draftsOnServer([rakeshs]);
  const { calls } = formServer([["POST", "sales/", () => refuse(409, { ...SAVED_AS, bill })], ...server.routes]);
  mountSaving(fromRakeshs());
  await settle();
  await screen.findByText("Finishing an unfinished bill");
  // another counter saves it as a bill meanwhile
  server.savedAsBill(rakeshs.id);
  const dialog = await save(user);
  expect(within(dialog).getByRole("alert")).toHaveTextContent(`Not saved${SAVED_AS.detail}`);
  // saving again can't make it, so there's no Try again: that bill is the way on, else only back to the form (Ruling 1D-12)
  expect(within(dialog).queryByRole("button", { name: /^(Try again|Save)/ })).not.toBeInTheDocument();
  if (linked) {
    const open = within(dialog).getByRole("link", { name: "Open KGH/2026-27/31" });
    expect(open).toHaveAttribute("href", "/sales/412");
    expect(open).toHaveAttribute("data-variant", "primary");
    expect(open).toHaveFocus();
  } else {
    expect(within(dialog).queryByRole("link")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Go back and edit" })).toHaveFocus();
  }
  await waitFor(() => expect(status().getByText(SAVED_AS.detail)).toBeInTheDocument());
  expect(screen.getByText(`Started at 09:20 by Rakesh Soni. ${SAVED_AS.detail}`)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Discard draft" })).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Go back and edit" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Check the bill before saving" })).not.toBeInTheDocument());
  await user.type(screen.getByLabelText("Note on the bill"), " today");
  expect(status().queryByText("Keeping the draft…")).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
  expect(puts(calls)).toEqual([]);
  expect(keptDraft(rakeshs.id)).toBeNull();
});

test("a draft another counter saved as a bill meanwhile: the keep's answer says so in the server's words, and nothing more is kept (Ruling 1D-8)", async () => {
  const user = fakeToday();
  const server = draftsOnServer([rakeshs]);
  const { calls } = formServer(server.routes);
  const { router } = mountForm(`/sales/new?draft=${rakeshs.id}`);
  await settle();
  await screen.findByText("Finishing an unfinished bill");
  server.savedAsBill(rakeshs.id);
  const note = screen.getByLabelText("Note on the bill");
  await user.type(note, " today");
  await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
  await waitFor(() => expect(status().getByText(SAVED_AS.detail)).toBeInTheDocument());
  expect(keptDraft(rakeshs.id)).toBeNull();
  // the banner above the form says so too: it no longer keeps saving, and there's no draft to discard
  expect(screen.getByText(`Started at 09:20 by Rakesh Soni. ${SAVED_AS.detail}`)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Discard draft" })).not.toBeInTheDocument();
  await user.type(note, ", weighed");
  expect(status().queryByText("Keeping the draft…")).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
  expect(puts(calls)).toHaveLength(1);
  // leaving neither asks nor says it was kept as a draft: there's none to keep
  await act(async () => { await router.navigate("/sales"); });
  expect(screen.getByTestId("where")).toHaveTextContent("Sales at /sales");
  expect(screen.queryByText("Bill kept as a draft")).not.toBeInTheDocument();
});

test("Discard draft removes it from the shop's list and goes to Sales; Undo keeps it again", async () => {
  const user = fakeToday();
  const server = draftsOnServer([rakeshs]);
  const { calls } = formServer(server.routes);
  const { router } = mountForm(`/sales/new?draft=${rakeshs.id}`);
  await settle();
  await screen.findByText("Finishing an unfinished bill");
  await settle();
  await user.click(screen.getByRole("button", { name: "Discard draft" }));
  await waitFor(() => expect(where(router)).toBe("/sales"));
  expect(calls.some((c) => c.method === "DELETE" && c.url === `drafts/${rakeshs.id}/`)).toBe(true);
  expect(server.rows.has(rakeshs.id)).toBe(false);
  expect(await screen.findByText("Draft discarded")).toBeInTheDocument();
  expect(screen.queryByText("Bill kept as a draft")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /^Undo/ }));
  await waitFor(() => expect(server.rows.get(rakeshs.id)?.data.notes).toBe("Waiting for the bangles to be weighed"));
});

test("an unfinished bill that isn't there any more says so, and the form is a new, empty bill", async () => {
  fakeToday();
  formServer(draftsOnServer().routes);
  mountForm("/sales/new?draft=0b7f4a8e-5d1c-4a8e-9c3a-1f2e3d4c5b6a");
  await settle();
  expect(await screen.findByText("That unfinished bill isn't here any more")).toBeInTheDocument();
  expect(screen.getByText("It was saved as a bill or discarded. This is a new, empty bill.")).toBeInTheDocument();
});

test("a list cached before the unfinished bill was made can't say it's gone: the form asks the shop again and opens it (Ruling 1D-4)", async () => {
  fakeToday();
  const server = draftsOnServer();
  const { calls } = formServer(server.routes);
  const { router } = mountForm("/sales/new");
  await settle();
  await screen.findByText("Kept as a draft once you start");
  await waitFor(() => expect(calls.some((c) => c.method === "GET" && c.url === "drafts/")).toBe(true));
  // Rakesh starts one on another counter a moment later, and its link is opened here
  server.rows.set(rakeshs.id, rakeshs);
  await arrive(server, () => act(async () => { await router.navigate(`/sales/new?draft=${rakeshs.id}`); }));
  expect(screen.getByText("Finishing an unfinished bill")).toBeInTheDocument();
  expect(screen.getByText("Started at 09:20 by Rakesh Soni. It keeps saving as you go.")).toBeInTheDocument();
  expect(screen.queryByText("That unfinished bill isn't here any more")).not.toBeInTheDocument();
});

/**
 * The shop's list can't be read once a bill form has loaded (the firms and the list are in the cache): its request
 * fails, or the browser is offline and it waits for the network. Each gives back a way to undo it.
 */
const UNREAD: [string, (server: ReturnType<typeof draftsOnServer>) => () => void, string][] = [
  // a 500 while the internet is fine: nothing says when, so it says what to wait for
  ["fails", (server) => { server.failList(); return () => {}; }, "open that one again once the list loads."],
  ["waits for the network", () => { act(() => __setNetState("offline")); onlineManager.setOnline(false); return () => onlineManager.setOnline(true); }, "open that one again when the internet is back."],
];
/** A new bill, loaded; then the shop's list can't be read, and the link to an unfinished bill is opened. */
async function openUnread(unread: (typeof UNREAD)[number][1], before: () => void = () => {}) {
  const server = draftsOnServer();
  formServer(server.routes);
  const view = mountForm("/sales/new");
  await settle();
  await screen.findByText("Kept as a draft once you start");
  act(before);
  const back = unread(server);
  await act(async () => { await view.router.navigate(`/sales/new?draft=${rakeshs.id}`); });
  await settle();
  return () => { view.unmount(); back(); };
}

test.each(UNREAD)("a synced unfinished bill reopened while the shop's list %s opens from this device's copy, never as gone (Ruling 1D-4)", async (_, unread) => {
  fakeToday();
  // sent before the list this page read, and not on it: only a list that can be read now could say it's gone
  const done = await openUnread(unread, () => keepOnDevice({ ...rakeshs, synced: true, syncedAt: Date.now() - 60_000 }));
  try {
    expect(await screen.findByText("Finishing an unfinished bill")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /Customer/ })).toHaveValue("Lalit Jain");
    expect(screen.queryByText("That unfinished bill isn't here any more")).not.toBeInTheDocument();
  } finally {
    done();
  }
});

test.each(UNREAD)("a draft neither on this device nor on a list it can read (the list %s) gets the form's own words, never \"isn't here any more\" (Ruling 1D-4)", async (_, unread, when) => {
  fakeToday();
  const done = await openUnread(unread);
  try {
    expect(await screen.findByText("That unfinished bill didn't open")).toBeInTheDocument();
    expect(screen.getByText(`This device has no copy of it, and the shop's list didn't load. This is a new, empty bill; ${when}`)).toBeInTheDocument();
    expect(screen.queryByText("That unfinished bill isn't here any more")).not.toBeInTheDocument();
  } finally {
    done();
  }
});

test("offline, the bill is kept on this device and says so; back online, a sync sends it and the form offers to save it now", async () => {
  const user = fakeToday();
  const server = draftsOnServer();
  formServer(server.routes);
  mountForm("/sales/new");
  await settle();
  await pickAnil(user);
  server.setDown(true);
  act(() => __setNetState("offline"));
  expect(screen.getByText("You're offline: carry on with the bill")).toBeInTheDocument();
  expect(screen.getByText("It's kept on this device as an unfinished bill. Save it when the internet is back; nothing saves by itself.")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
  await waitFor(() => expect(screen.getByText("Kept on this device at 10:00; it reaches the shop's list when the internet is back")).toBeInTheDocument());
  expect(server.rows.size).toBe(0);
  server.setDown(false);
  act(() => __setNetState("online"));
  expect(await screen.findByText("Back online · Save Anil Gupta's bill now")).toBeInTheDocument();
  await waitFor(() => expect(server.rows.size).toBe(1));
  await waitFor(() => expect(screen.getByText(/^Kept as a draft at/)).toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: "Later" }));
  expect(screen.queryByText("Back online · Save Anil Gupta's bill now")).not.toBeInTheDocument();
});

test("a browser that refuses storage: the form says the bill is kept for this visit only, never on this device (Task 1's review)", async () => {
  const user = fakeToday();
  vi.spyOn(Object.getPrototypeOf(localStorage) as Storage, "setItem").mockImplementation(() => { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); });
  const server = draftsOnServer();
  formServer(server.routes);
  mountForm("/sales/new");
  await settle();
  await pickAnil(user);
  server.setDown(true);
  act(() => __setNetState("offline"));
  expect(screen.getByText("This browser doesn't store unfinished bills, so this one lasts only while this page is open. Save it when the internet is back; nothing saves by itself.")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
  await waitFor(() => expect(screen.getByText("Kept for this visit only at 10:00; it reaches the shop's list when the internet is back")).toBeInTheDocument());
  expect(screen.queryByText(/on this device/)).not.toBeInTheDocument();
});

test("offline where the browser refuses storage, the review says the bill is kept for this visit only, never on this device (Task 1's review)", async () => {
  const user = fakeToday();
  vi.spyOn(Object.getPrototypeOf(localStorage) as Storage, "setItem").mockImplementation(() => { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); });
  const { calls } = formServer(draftsOnServer([rakeshs]).routes);
  mountSaving(fromRakeshs());
  await settle();
  act(() => __setNetState("offline"));
  const dialog = await save(user);
  const note = within(dialog).getAllByRole("alert")[0];
  expect(note).toHaveTextContent("You're offline: this bill can't be saved yet");
  expect(note).toHaveTextContent("This browser doesn't store unfinished bills, so this one lasts only while this page is open. Save it when the internet is back.");
  expect(dialog).not.toHaveTextContent(/on this device/);
  expect(within(dialog).getByRole("button", { name: "Save bill" })).toBeDisabled();
  expect(calls.some((c) => c.method === "POST")).toBe(false);
});

test("a bill kept on this device before the session ran out comes back on its own address, from this device (part 0 carry)", async () => {
  fakeToday();
  // the shop's list can't be reached; this device kept the bill before the sign-in page took over
  keepOnDevice({ ...rakeshs, synced: false });
  formServer([["GET", "drafts/", () => { throw offline(); }], ["PUT", /^drafts\//, () => { throw offline(); }]]);
  mountForm(`/sales/new?draft=${rakeshs.id}`);
  await settle();
  expect(await screen.findByText("Finishing an unfinished bill")).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: /Customer/ })).toHaveValue("Lalit Jain");
  expect(screen.getByText(/^Kept on this device at/)).toBeInTheDocument();
  expect(keptDrafts().map((d) => d.id)).toEqual([rakeshs.id]);
});

test("leaving a new bill never asks: a change not kept yet is kept at once, on this device first, and the toast says where (Ruling 1D-10)", async () => {
  const user = fakeToday();
  const server = draftsOnServer();
  formServer(server.routes);
  const { router } = mountForm("/sales/new");
  await settle();
  await pickAnil(user);
  expect(screen.getByText("Keeping the draft…")).toBeInTheDocument();
  expect(keptDrafts()).toEqual([]);
  // closing the tab now doesn't ask either
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(false);
  await act(async () => { await router.navigate("/sales"); });
  await settle();
  expect(screen.queryByRole("dialog", { name: "Leave without saving?" })).not.toBeInTheDocument();
  expect(where(router)).toBe("/sales");
  const [kept] = keptDrafts();
  expect(kept).toMatchObject({ data: { customer: { id: 7, name: "Anil Gupta" } } });
  expect(screen.getByText("Bill kept as a draft")).toBeInTheDocument();
  await waitFor(() => expect(server.rows.get(kept.id)?.data.customer?.id).toBe(7));
});

/** The page going away without React's cleanup: the tab closing or reloading, or a phone switching to another app. */
const AWAY: [string, () => () => void][] = [
  ["the tab closes or reloads", () => { window.dispatchEvent(new Event("pagehide")); return () => {}; }],
  ["a phone switches to another app", () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    return () => { delete (document as { visibilityState?: unknown }).visibilityState; };
  }],
];

test.each(AWAY)("when %s, a change not kept yet is kept at once, on this device first, and named in the address should the page come back (Ruling 1D-10)", async (_, away) => {
  const user = fakeToday();
  const server = draftsOnServer();
  const { calls } = formServer(server.routes);
  const { router } = mountForm("/sales/new");
  await settle();
  await pickAnil(user);
  expect(keptDrafts()).toEqual([]);
  let back = () => {};
  act(() => { back = away(); });
  try {
    const [kept] = keptDrafts();
    expect(kept).toMatchObject({ data: { customer: { id: 7 } } });
    await settle();
    expect(where(router)).toBe(`/sales/new?draft=${kept.id}`);
    expect(puts(calls)).toHaveLength(1);
    // the 1.2 s then pass: it isn't kept twice
    await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
    expect(puts(calls)).toHaveLength(1);
  } finally {
    back();
  }
});

test("leaving a change to a saved bill still asks (Ruling 1D-10)", async () => {
  const user = fakeToday();
  formServer(draftsOnServer().routes);
  const { router } = mountForm("/edit", { routes: [{ path: "/edit", element: <BillForm start={startEdit(toBillDetail(wireDetail()))} formKey="edit" /> }] });
  await settle();
  await user.type(screen.getByLabelText("Note on the bill"), "Weighed again");
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  await act(async () => { await router.navigate("/sales"); });
  await settle();
  expect(screen.getByRole("dialog", { name: "Leave without saving?" })).toHaveTextContent("Your changes to this bill aren't saved. Leave and lose them?");
});

test("a move within /sales/new keeps the last change at once without asking: Alt N's new bill, and another unfinished bill opened from the list (F18)", async () => {
  const user = fakeToday();
  const server = draftsOnServer([rakeshs]);
  formServer(server.routes);
  const { router } = mountForm("/sales/new");
  await settle();
  await screen.findByRole("list", { name: "Unfinished bills" });
  await pickAnil(user);
  expect(keptDrafts().map((d) => d.id)).toEqual([]);
  // Alt N: a new bill, at the same address, so the leave-guard (which compares pathnames) doesn't ask
  await act(async () => { await router.navigate("/sales/new"); });
  expect(screen.queryByRole("dialog", { name: "Leave without saving?" })).not.toBeInTheDocument();
  expect(await screen.findByText("Bill kept as a draft")).toBeInTheDocument();
  await settle();
  const anils = keptDrafts().find((d) => d.data.customer?.id === 7);
  expect(anils).toBeDefined();
  expect(await screen.findByRole("button", { name: "Open Anil Gupta's unfinished bill" })).toBeInTheDocument();
  // a note typed on the new bill, then Lalit's unfinished bill opened from the list before it's kept
  await user.click(screen.getByLabelText("Note on the bill"));
  await user.keyboard("Ring for Meena");
  expect(keptDrafts().some((d) => d.data.notes === "Ring for Meena")).toBe(false);
  await arrive(server, () => user.click(screen.getByRole("button", { name: "Open Lalit Jain's unfinished bill" })));
  expect(screen.getByText("Started at 09:20 by Rakesh Soni. It keeps saving as you go.")).toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "Leave without saving?" })).not.toBeInTheDocument();
  expect(keptDrafts().find((d) => d.data.notes === "Ring for Meena")).toBeDefined();
  await waitFor(() => expect([...server.rows.values()].some((d) => d.data.notes === "Ring for Meena")).toBe(true));
});

test("a save held behind the sync's PUT of this draft (the network back, a change made offline) says it waits, and the status says the draft is on its way (Task 6 review)", async () => {
  const user = fakeToday();
  // this device changed Rakesh's bill while offline: the shop's list has the older version
  const mine = { ...rakeshs, data: { ...RAKESHS, notes: "Changed offline" }, updated_at: "2026-10-08T09:30:00+05:30" };
  keepOnDevice({ ...mine, synced: false });
  const server = draftsOnServer([rakeshs]);
  server.hold("PUT");
  const { calls } = formServer(server.routes);
  const { router } = mountSaving(startDraft({ ...mine, onDevice: true } as UnfinishedBill));
  await settle();
  await screen.findByText("Finishing an unfinished bill");
  // the sync as the form opens sends this device's change, and its PUT hangs
  await waitFor(() => expect(puts(calls)).toHaveLength(1));
  expect(status().getByText("Keeping the draft…")).toBeInTheDocument();
  const dialog = await save(user);
  expect(within(dialog).getByRole("status")).toHaveTextContent("Saving once the draft's last change reaches the shop's list…");
  expect(status().getByText("Saving once the draft's last change reaches the shop's list…")).toBeInTheDocument();
  expect(calls.some((c) => c.method === "POST")).toBe(false);
  await act(async () => { server.release("PUT"); await vi.advanceTimersByTimeAsync(50); });
  await waitFor(() => expect(where(router)).toBe("/sales/501?saved=new"));
  expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ draft_id: rakeshs.id, notes: "Changed offline" });
});

test.each([
  ["doesn't go through", () => refuse(500, { detail: "Server error" }), true],
  ["finds a bill was made from it already (409 draft_saved)", () => refuse(409, SAVED_AS), false],
] as const)("left while the bill saves, and the save %s: what was typed is kept then, and only then, and the toast says the bill didn't save (Ruling 1D-10, F6)", async (_, answer, keeps) => {
  const user = fakeToday();
  const server = draftsOnServer([rakeshs]);
  let land = () => {};
  const { calls } = formServer([["POST", "sales/", () => new Promise<void>((r) => { land = r; }).then(answer)], ...server.routes]);
  const { router } = mountSaving(fromRakeshs());
  await settle();
  await screen.findByText("Finishing an unfinished bill");
  await user.type(screen.getByLabelText("Note on the bill"), " today");
  expect(savingIn(await save(user))).toBeInTheDocument();
  // the form is left before the save answers: nothing is kept while the save is on its way (F6)
  await act(async () => { await router.navigate("/sales"); });
  await settle();
  expect(keptDrafts()).toEqual([]);
  expect(puts(calls)).toEqual([]);
  await act(async () => { land(); await vi.advanceTimersByTimeAsync(50); });
  if (keeps) {
    expect(keptDraft(rakeshs.id)).toMatchObject({ data: { notes: "Waiting for the bangles to be weighed today" } });
    expect(screen.getByText("The bill didn't save")).toBeInTheDocument();
    expect(screen.getByText("What you typed is kept as an unfinished bill. Open it now?")).toBeInTheDocument();
    await waitFor(() => expect(server.rows.get(rakeshs.id)?.data.notes).toBe("Waiting for the bangles to be weighed today"));
    await arrive(server, () => user.click(screen.getByRole("button", { name: "Open" })));
    expect(where(router)).toBe(`/sales/new?draft=${rakeshs.id}`);
    expect(screen.getByLabelText("Note on the bill")).toHaveValue("Waiting for the bangles to be weighed today");
  } else {
    expect(keptDrafts()).toEqual([]);
    expect(puts(calls)).toEqual([]);
    expect(screen.queryByText("The bill didn't save")).not.toBeInTheDocument();
    expect(screen.queryByText("Bill kept as a draft")).not.toBeInTheDocument();
  }
});

/** The page hidden (a phone switching to another app), then closed: each keeps a change not kept yet, as AWAY says. */
function hideThenClose() {
  act(() => { for (const [, away] of AWAY) away()(); });
}

test.each([
  ["lands", false],
  ["is answered 409 draft_saved", true],
] as const)("hidden or closed while the bill saves, and again once its answer %s: nothing is kept (F6, Task 6 re-review)", async (_, madeAlready) => {
  const user = fakeToday();
  const server = draftsOnServer([rakeshs]);
  const { calls } = formServer(server.routes);
  const { router } = mountSaving(fromRakeshs());
  await settle();
  await screen.findByText("Finishing an unfinished bill");
  // a change made just before the save: not kept yet as Save is pressed, so only the save's guard stops a keep
  await user.type(screen.getByLabelText("Note on the bill"), " today");
  // another counter saved it as a bill meanwhile
  if (madeAlready) server.savedAsBill(rakeshs.id);
  server.hold("POST");
  expect(savingIn(await save(user))).toBeInTheDocument();
  hideThenClose();
  await settle();
  expect(keptDrafts()).toEqual([]);
  expect(puts(calls)).toEqual([]);
  await act(async () => { server.release("POST"); await vi.advanceTimersByTimeAsync(50); });
  if (madeAlready) await waitFor(() => expect(status().getByText(SAVED_AS.detail)).toBeInTheDocument());
  else await waitFor(() => expect(where(router)).toBe("/sales/501?saved=new"));
  hideThenClose();
  await settle();
  await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
  expect(keptDrafts()).toEqual([]);
  expect(puts(calls)).toEqual([]);
});

test("left while the save waits behind the draft's keep, which hears the draft became a bill already, and the save then fails another way: no toast claims it was kept (Task 6 re-review)", async () => {
  const user = fakeToday();
  const server = draftsOnServer([rakeshs]);
  let land = () => {};
  // the server refuses the bill another way first (a 500)
  const { calls } = formServer([["POST", "sales/", () => new Promise<void>((r) => { land = r; }).then(() => refuse(500, { detail: "Server error" }))], ...server.routes]);
  const { router } = mountSaving(fromRakeshs());
  await settle();
  await screen.findByText("Finishing an unfinished bill");
  server.hold("PUT");
  await user.type(screen.getByLabelText("Note on the bill"), " today");
  await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
  await waitFor(() => expect(puts(calls)).toHaveLength(1));
  await save(user);
  expect(calls.some((c) => c.method === "POST")).toBe(false);
  await act(async () => { await router.navigate("/sales"); });
  await settle();
  // another counter saves the draft as a bill: the keep on its way hears 409 draft_saved, and the save goes on
  server.savedAsBill(rakeshs.id);
  await act(async () => { server.release("PUT"); await vi.advanceTimersByTimeAsync(50); });
  await settle();
  expect(calls.some((c) => c.method === "POST")).toBe(true);
  await act(async () => { land(); await vi.advanceTimersByTimeAsync(50); });
  await settle();
  expect(screen.queryByText("The bill didn't save")).not.toBeInTheDocument();
  expect(screen.queryByText("Bill kept as a draft")).not.toBeInTheDocument();
  expect(keptDrafts()).toEqual([]);
  expect(puts(calls)).toHaveLength(1);
});

test("where the browser refuses storage, closing the tab with a change not kept yet, or with its keep still on its way, gets the browser's own prompt; leaving in the app doesn't ask, and keeps it at once (Ruling 1D-11)", async () => {
  const user = fakeToday();
  vi.spyOn(Object.getPrototypeOf(localStorage) as Storage, "setItem").mockImplementation(() => { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); });
  const server = draftsOnServer();
  const { calls } = formServer(server.routes);
  const { router } = mountForm("/sales/new");
  await settle();
  expect(asksOnClose()).toBe(false);
  await pickAnil(user);
  expect(asksOnClose()).toBe(true);
  // kept: in this page only, and its PUT on its way
  server.hold("PUT");
  await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
  await waitFor(() => expect(puts(calls)).toHaveLength(1));
  expect(asksOnClose()).toBe(true);
  // the shop's list has it: closing loses nothing
  await act(async () => { server.release("PUT"); await vi.advanceTimersByTimeAsync(50); });
  await waitFor(() => expect(screen.getByText("Kept as a draft at 10:00")).toBeInTheDocument());
  expect(asksOnClose()).toBe(false);
  // another change, then a link: no ask, and it's kept at once, the page living on to send it
  await user.click(screen.getByLabelText("Note on the bill"));
  await user.keyboard("Ring for Meena");
  expect(asksOnClose()).toBe(true);
  await act(async () => { await router.navigate("/sales"); });
  await settle();
  expect(screen.queryByRole("dialog", { name: "Leave without saving?" })).not.toBeInTheDocument();
  expect(where(router)).toBe("/sales");
  expect(screen.getByText("Bill kept as a draft")).toBeInTheDocument();
  await waitFor(() => expect([...server.rows.values()].map((d) => d.data.notes)).toEqual(["Ring for Meena"]));
  expect(asksOnClose()).toBe(false);
});

test("where the browser keeps unfinished bills, closing the tab never asks: the change is kept on this device as the tab closes (Ruling 1D-11)", async () => {
  const user = fakeToday();
  const server = draftsOnServer();
  server.hold("PUT");
  const { calls } = formServer(server.routes);
  mountForm("/sales/new");
  await settle();
  await pickAnil(user);
  expect(asksOnClose()).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
  await waitFor(() => expect(puts(calls)).toHaveLength(1));
  expect(asksOnClose()).toBe(false);
  await act(async () => { server.release("PUT"); await vi.advanceTimersByTimeAsync(50); });
});

test("an unfinished bill picked up opens at its newest version: the form waits for the shop's fresh answer, not the list it had (Task 6 review)", async () => {
  const user = fakeToday();
  const server = draftsOnServer([rakeshs]);
  formServer(server.routes);
  mountForm("/sales/new");
  await settle();
  const list = await screen.findByRole("list", { name: "Unfinished bills" });
  // Rakesh adds a ring on his counter meanwhile
  const ring = { ...RAKESHS.lines[0], productId: 5, name: "Gold Ring 22K", qty: 4.5 };
  server.rows.set(rakeshs.id, { ...rakeshs, data: { ...RAKESHS, lines: [...RAKESHS.lines, ring] }, updated_at: "2026-10-08T09:59:00+05:30" });
  await arrive(server, () => user.click(within(list).getByRole("button", { name: "Open Lalit Jain's unfinished bill" })));
  expect(screen.getByText("Finishing an unfinished bill")).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Line 2 product" })).toHaveValue("Gold Ring 22K");
});

test("where the browser refuses storage, a copy here the shop hasn't got yet is listed as not sent yet, never as on this device (Task 6 review)", async () => {
  fakeToday();
  vi.spyOn(Object.getPrototypeOf(localStorage) as Storage, "setItem").mockImplementation(() => { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); });
  keepOnDevice({ ...rakeshs, synced: false });
  const server = draftsOnServer();
  server.setDown(true);
  formServer(server.routes);
  mountForm("/sales/new");
  await settle();
  const list = await screen.findByRole("list", { name: "Unfinished bills" });
  expect(list).toHaveTextContent("Lalit Jain's unfinished bill in Kiran · started 09:20 by Rakesh · not sent yet");
  expect(list).not.toHaveTextContent("on this device");
});

test("a change to a saved bill keeps no draft: it says what isn't saved yet", async () => {
  const user = fakeToday();
  const server = draftsOnServer();
  const { calls } = formServer(server.routes);
  mountSaving(startEdit(toBillDetail(wireDetail())));
  await settle();
  expect(status().getByText("No changes yet")).toBeInTheDocument();
  await user.type(screen.getByLabelText("Note on the bill"), "Weighed again");
  expect(status().getByText("Changes not saved yet")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
  expect(puts(calls)).toEqual([]);
  expect(keptDrafts()).toEqual([]);
});
