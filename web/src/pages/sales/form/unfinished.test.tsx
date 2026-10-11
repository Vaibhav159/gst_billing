import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { __resetDrafts, type DraftData, type UnfinishedBill } from "@/core/api/drafts";
import { __setNetState } from "@/core/api/network";
import { __resetDeviceDrafts, keepOnDevice, keptDraft, keptDrafts } from "@/core/deviceDrafts";
import { refuse, wireDetail, type Route } from "@/core/sales/fixtures";
import { toBillDetail } from "@/core/sales/wire";
import { DesktopForm } from "./DesktopForm";
import { startDraft, startEdit, type Start } from "./model";
import { ANIL, formServer, fakeToday, mountForm } from "./testing";
import { useBillForm } from "./useBillForm";
import { useDraftKeeping } from "./useDraftKeeping";

// whole flows through the form, a step at a time: a busy runner takes longer than vitest's 5 s for one
vi.setConfig({ testTimeout: 20_000 });

beforeEach(() => { localStorage.clear(); __resetDeviceDrafts(); __resetDrafts(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); act(() => __setNetState("online")); });

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
  const gates: Record<string, { wait: Promise<void>; open: () => void } | undefined> = {};
  const gate = async (m: string) => { await gates[m]?.wait; };
  const routes: Route[] = [
    ["GET", "drafts/", async () => { if (down) throw offline(); await gate("GET"); return { results: [...rows.values()] }; }],
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
/** Lets what's on its way land (answers, the cache telling the page, a dialog's focus): a little faked time, inside act. */
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(50); });
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
  await user.click(screen.getByRole("button", { name: "Open" }));
  expect(await screen.findByText("Finishing an unfinished bill")).toBeInTheDocument();
  await settle();
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
  await user.click(within(list).getByRole("button", { name: "Open Lalit Jain's unfinished bill" }));
  expect(await screen.findByText("Started at 09:20 by Rakesh Soni. It keeps saving as you go.")).toBeInTheDocument();
  await settle();
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

/**
 * The bill form as BillForm puts it together, with a Save button standing in for the review's: the review comes with
 * Task 5 (Ruling 1D-9), and saves through the same F.save().
 */
function SavingForm({ start }: { start: Start }) {
  const F = useBillForm(start);
  const drafts = useDraftKeeping(F, "saving-form");
  return (
    <DesktopForm F={F} drafts={drafts}>
      <button type="button" onClick={() => { void F.save(); }}>Save the bill</button>
      <p data-testid="saving">{F.savedTo ? `Saved: ${F.savedTo}` : `${F.saving ? "Saving" : "Not saving"}; ${drafts.pending ? "a change waits to be kept" : "nothing waits to be kept"}`}</p>
      {F.saveError ? <p data-testid="save-error">{`${F.saveError.title}. ${F.saveError.body}`}</p> : null}
    </DesktopForm>
  );
}
const fromRakeshs = () => startDraft({ ...rakeshs, onDevice: false } as UnfinishedBill);
function mountSaving(start: Start) {
  return mountForm("/form", { routes: [{ path: "/form", element: <SavingForm start={start} /> }] });
}
/** Paid in cash, Check and save (Ctrl S), then Save: what the review will do. */
async function save(user: ReturnType<typeof fakeToday>) {
  await waitFor(() => expect(screen.getByLabelText("Bill number")).toHaveValue("34"));
  await user.click(screen.getByRole("radio", { name: "Cash" }));
  await user.keyboard("{Control>}s{/Control}");
  await user.click(screen.getByRole("button", { name: "Save the bill" }));
  await settle();
}

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
  expect(screen.getByTestId("saving")).toHaveTextContent("Not saving; a change waits to be kept");
  server.hold("POST");
  await save(user);
  // the save takes the change: nothing waits to be kept, so leaving now wouldn't ask
  expect(screen.getByTestId("saving")).toHaveTextContent("Saving; nothing waits to be kept");
  // and nothing is kept while the save is on its way, however long it takes
  await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
  expect(puts(calls)).toEqual([]);
  await act(async () => { server.release("POST"); await vi.advanceTimersByTimeAsync(50); });
  expect(screen.getByTestId("saving")).toHaveTextContent("Saved: /sales/501?saved=new");
  expect(status().queryByText("Keeping the draft…")).not.toBeInTheDocument();
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

test("a save that waits behind the draft's last keep, still on its way, says so (Task 1's review)", async () => {
  const user = fakeToday();
  const server = draftsOnServer([rakeshs]);
  const { calls } = formServer(server.routes);
  mountSaving(fromRakeshs());
  await settle();
  await screen.findByText("Finishing an unfinished bill");
  server.hold("PUT");
  await user.type(screen.getByLabelText("Note on the bill"), " today");
  await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
  await waitFor(() => expect(puts(calls)).toHaveLength(1));
  expect(status().getByText("Keeping the draft…")).toBeInTheDocument();
  await save(user);
  expect(status().getByText("Saving once the draft's last change reaches the shop's list…")).toBeInTheDocument();
  expect(calls.some((c) => c.method === "POST")).toBe(false);
  await act(async () => { server.release("PUT"); await vi.advanceTimersByTimeAsync(50); });
  await waitFor(() => expect(screen.getByTestId("saving")).toHaveTextContent("Saved: /sales/501?saved=new"));
  expect(calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.url}`)).toEqual([`PUT drafts/${rakeshs.id}/`, "POST sales/"]);
});

test("a save answered 409 draft_saved: keeping stops, and the status says so in the server's words (Ruling 1D-8)", async () => {
  const user = fakeToday();
  const server = draftsOnServer([rakeshs]);
  const { calls } = formServer(server.routes);
  mountSaving(fromRakeshs());
  await settle();
  await screen.findByText("Finishing an unfinished bill");
  // another counter saves it as a bill meanwhile
  server.savedAsBill(rakeshs.id);
  await save(user);
  await waitFor(() => expect(status().getByText(SAVED_AS.detail)).toBeInTheDocument());
  expect(screen.getByText(`Started at 09:20 by Rakesh Soni. ${SAVED_AS.detail}`)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Discard draft" })).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Note on the bill"), " today");
  expect(status().queryByText("Keeping the draft…")).not.toBeInTheDocument();
  expect(screen.getByTestId("saving")).toHaveTextContent("nothing waits to be kept");
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
  await act(async () => { await router.navigate(`/sales/new?draft=${rakeshs.id}`); });
  expect(await screen.findByText("Finishing an unfinished bill")).toBeInTheDocument();
  await settle();
  expect(screen.getByText("Started at 09:20 by Rakesh Soni. It keeps saving as you go.")).toBeInTheDocument();
  expect(screen.queryByText("That unfinished bill isn't here any more")).not.toBeInTheDocument();
});

/**
 * The shop's list can't be read once a bill form has loaded (the firms and the list are in the cache): its request
 * fails, or the browser is offline and it waits for the network. Each gives back a way to undo it.
 */
const UNREAD: [string, (server: ReturnType<typeof draftsOnServer>) => () => void][] = [
  ["fails", (server) => { server.setDown(true); return () => {}; }],
  ["waits for the network", () => { onlineManager.setOnline(false); return () => onlineManager.setOnline(true); }],
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

test.each(UNREAD)("a draft neither on this device nor on a list it can read (the list %s) gets the form's own words, never \"isn't here any more\" (Ruling 1D-4)", async (_, unread) => {
  fakeToday();
  const done = await openUnread(unread);
  try {
    expect(await screen.findByText("That unfinished bill didn't open")).toBeInTheDocument();
    expect(screen.getByText("This device has no copy of it, and the shop's list didn't load. This is a new, empty bill; open that one again when the internet is back.")).toBeInTheDocument();
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

test("saved offline where the browser refuses storage, the save's words say it's kept for this visit only (Task 1's review)", async () => {
  const user = fakeToday();
  vi.spyOn(Object.getPrototypeOf(localStorage) as Storage, "setItem").mockImplementation(() => { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); });
  formServer(draftsOnServer([rakeshs]).routes);
  mountSaving(fromRakeshs());
  await settle();
  act(() => __setNetState("offline"));
  await save(user);
  expect(screen.getByTestId("save-error")).toHaveTextContent("Not saved: you're offline. This browser doesn't store unfinished bills, so this one lasts only while this page is open. Save it when the internet is back; nothing saves by itself.");
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

test("leaving before the last change is kept asks first; Leave keeps it at once, on this device first, and says where to find it (F18)", async () => {
  const user = fakeToday();
  const server = draftsOnServer();
  formServer(server.routes);
  const { router } = mountForm("/sales/new");
  await settle();
  await pickAnil(user);
  expect(screen.getByText("Keeping the draft…")).toBeInTheDocument();
  await act(async () => { await router.navigate("/sales"); });
  await settle(); // the dialog takes the cursor
  const ask = screen.getByRole("dialog", { name: "Leave without saving?" });
  expect(ask).toHaveTextContent("Your last change isn't in the draft yet. Leave and lose it?");
  // past the dialog's guard against a click meant for the page: the clock's date only, so the keep's 1.2 s don't run out
  vi.setSystemTime(Date.now() + 400);
  expect(keptDrafts()).toEqual([]);
  await act(async () => { fireEvent.click(within(ask).getByRole("button", { name: "Leave" })); await vi.advanceTimersByTimeAsync(50); });
  expect(where(router)).toBe("/sales");
  // on this device at once, then on the shop's list
  const [kept] = keptDrafts();
  expect(kept).toMatchObject({ data: { customer: { id: 7, name: "Anil Gupta" } } });
  expect(await screen.findByText("Bill kept as a draft")).toBeInTheDocument();
  await waitFor(() => expect(server.rows.get(kept.id)?.data.customer?.id).toBe(7));
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
  await user.click(screen.getByRole("button", { name: "Open Lalit Jain's unfinished bill" }));
  expect(await screen.findByText("Started at 09:20 by Rakesh Soni. It keeps saving as you go.")).toBeInTheDocument();
  await settle();
  expect(screen.queryByRole("dialog", { name: "Leave without saving?" })).not.toBeInTheDocument();
  expect(keptDrafts().find((d) => d.data.notes === "Ring for Meena")).toBeDefined();
  await waitFor(() => expect([...server.rows.values()].some((d) => d.data.notes === "Ring for Meena")).toBe(true));
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
