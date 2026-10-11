import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { onlineManager, QueryClient } from "@tanstack/react-query";
import { matchRoutes } from "react-router";
import { __setNetState } from "@/core/api/network";
import { billQuery, invalidateSales, type BillOutcome } from "@/core/api/sales";
import { appRoutes } from "@/core/router/routes";
import { loadedPage } from "@/core/router/lazyPage";
import { refuse, wireBin, wireDetail, WIRE_LINES, type Route } from "@/core/sales/fixtures";
import { toBillDetail, toBinRow } from "@/core/sales/wire";
import EditBillPage from "./EditBillPage";
import { asksOnClose, formServer, fakeToday, mountForm, settle, STAFF, wireNext } from "./testing";

// whole flows through the form, a step at a time: a busy runner takes longer than vitest's 5 s for one
vi.setConfig({ testTimeout: 20_000 });

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); act(() => __setNetState("online")); (window as unknown as { __phone?: boolean }).__phone = false; });
const where = (router: { state: { location: { pathname: string; search: string } } }) => router.state.location.pathname + router.state.location.search;
const SENT = { at: "2026-10-05T12:09:00+05:30", last_at: "2026-10-05T12:09:00+05:30", count: 1, via: "whatsapp", to: "" };

/** KGH/2026-27/31 open to change, with the ring's weight changed from 12.345 to 12.5 g. */
async function changeWeight(user: ReturnType<typeof fakeToday>, bill = wireDetail(), routes: Route[] = []) {
  const server = formServer([["GET", "sales/412/", () => bill], ...routes]);
  const view = mountForm("/sales/412/edit");
  expect(await screen.findByRole("heading", { level: 1, name: "Edit KGH/2026-27/31" })).toBeInTheDocument();
  expect(screen.getByText("No changes yet")).toBeInTheDocument();
  const weight = screen.getByRole("textbox", { name: "Line 1 weight in grams" });
  await user.clear(weight);
  await user.type(weight, "12.5");
  expect(screen.getByText("Changes not saved yet")).toBeInTheDocument();
  return { ...server, ...view };
}

test("changing a saved bill: its number kept, what changes listed in the review, Save changes is a PUT, and no draft is kept", async () => {
  const user = fakeToday();
  const { calls, router } = await changeWeight(user);
  expect(screen.queryByRole("switch", { name: "Copying a paper bill" })).not.toBeInTheDocument();
  expect(screen.getByText("A bill keeps its number. Renumbering is for the owner, while the month is open.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Renumber…" })).toBeInTheDocument();
  // a change to a saved bill is saved, or it isn't: nothing goes to the shop's unfinished bills
  await act(async () => { vi.advanceTimersByTime(3000); });
  expect(calls.some((c) => c.url.startsWith("drafts/") && c.method !== "GET")).toBe(false);
  await user.click(screen.getByRole("button", { name: "Check and save changes" }));
  const dialog = await screen.findByRole("dialog", { name: "Check the changes to KGH/2026-27/31" });
  act(() => { vi.advanceTimersByTime(400); });
  const changes = within(dialog).getByRole("list", { name: "What changes" });
  expect(within(changes).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
    "Gold Ring 22K weight: 12.345 gms →becomes 12.500 gms", "Total: ₹87,083.21 →becomes ₹88,122.94",
  ]);
  expect(dialog).toHaveTextContent("The bill keeps its number. The change is written to the audit log.");
  await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(where(router)).toBe("/sales/412?saved=edit"));
  expect(calls.find((c) => c.method === "PUT")).toMatchObject({ url: "sales/412/", body: expect.objectContaining({ invoice_number: "KGH/2026-27/31" }) });
  expect(calls.find((c) => c.method === "PUT")?.body).not.toHaveProperty("draft_id");
});

test("two lines of one product, both changed: each change is listed, and React never meets two with one key", async () => {
  const user = fakeToday();
  const errors = vi.spyOn(console, "error");
  // a second 22K ring, weighed the same
  const rings = [WIRE_LINES[0], { ...WIRE_LINES[0], id: 903 }];
  formServer([["GET", "sales/412/", () => wireDetail({ lines: rings, total_amount: "165617.42" })]]);
  mountForm("/sales/412/edit");
  await screen.findByRole("heading", { level: 1, name: "Edit KGH/2026-27/31" });
  for (const [n, grams] of [[1, "12.5"], [2, "13"]] as const) {
    const weight = screen.getByRole("textbox", { name: `Line ${n} weight in grams` });
    await user.clear(weight);
    await user.type(weight, grams);
  }
  await user.keyboard("{Control>}s{/Control}");
  const dialog = await screen.findByRole("dialog", { name: "Check the changes to KGH/2026-27/31" });
  act(() => { vi.advanceTimersByTime(400); });
  expect(within(within(dialog).getByRole("list", { name: "What changes" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
    "Gold Ring 22K weight: 12.345 gms →becomes 12.500 gms", "Gold Ring 22K weight: 12.345 gms →becomes 13.000 gms", "Total: ₹1,65,617.42 →becomes ₹1,71,050.82",
  ]);
  expect(errors).not.toHaveBeenCalled();
});

test("a sent bill whose total changes says the customer has the old one, and where to send the corrected one", async () => {
  const user = fakeToday();
  await changeWeight(user, wireDetail({ sent: SENT }));
  await user.keyboard("{Control>}s{/Control}");
  const dialog = await screen.findByRole("dialog", { name: "Check the changes to KGH/2026-27/31" });
  expect(dialog).toHaveTextContent("You sent Anil Gupta this bill on 05 Oct at 12:09, with ₹87,083.21. After saving, send the corrected one from the bill's page.");
});

test("leaving with changes asks first; Stay keeps them", async () => {
  const user = fakeToday();
  const { router } = await changeWeight(user);
  await user.click(screen.getByRole("link", { name: "Cancel" }));
  const ask = await screen.findByRole("dialog", { name: "Leave without saving?" });
  expect(ask).toHaveTextContent("Your changes to this bill aren't saved. Leave and lose them?");
  await user.click(within(ask).getByRole("button", { name: "Stay" }));
  expect(where(router)).toBe("/sales/412/edit");
  // the weight as it was left (written out to the milligram when the box was left)
  expect(screen.getByRole("textbox", { name: "Line 1 weight in grams" })).toHaveValue("12.500");
});

test("a cancelled bill, a filed month, or someone who can't change bills: what's on the bill and why it can't change", async () => {
  fakeToday();
  formServer([["GET", "sales/412/", () => wireDetail({ status: "cancelled", cancel_reason: "Customer returned the piece" })]]);
  const first = mountForm("/sales/412/edit");
  expect(await screen.findByText("This bill can't be changed")).toBeInTheDocument();
  expect(screen.getByText("Cancelled bills can't be changed. Make it again from the bill instead.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Make it again" })).toHaveAttribute("href", "/sales/new?remake=412");
  expect(screen.getByRole("table", { name: "Items on this bill" })).toHaveTextContent("Gold Pendant 22K");
  first.unmount();

  formServer([["GET", "sales/412/", () => wireDetail({ locked: true })]]);
  const second = mountForm("/sales/412/edit");
  expect(await screen.findByText("This bill's month is filed and locked. Unlock the month in GST returns first (owner only). The change then goes into a revised return.")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Make it again" })).not.toBeInTheDocument();
  second.unmount();

  formServer([["GET", "sales/412/", () => wireDetail()]]);
  mountForm("/sales/412/edit", { me: STAFF });
  expect(await screen.findByText("Only the owner can change bills. Ask the owner if you need it.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open the bill" })).toHaveAttribute("href", "/sales/412");
});

test("a deleted bill says so and where it went; an address with no bill says that", async () => {
  fakeToday();
  formServer([["GET", "sales/412/", () => refuse(404, { code: "deleted", binned: wireBin({ original_id: 412 }) })]]);
  const first = mountForm("/sales/412/edit");
  expect(await screen.findByText("KGH/2026-27/27 was deleted")).toBeInTheDocument();
  expect(screen.getByText("A deleted bill can't be changed. Restore it from the bill's page first.")).toBeInTheDocument();
  first.unmount();
  formServer([["GET", "sales/999/", () => refuse(404, { detail: "Not found." })]]);
  mountForm("/sales/999/edit");
  expect(await screen.findByText("This bill isn't here")).toBeInTheDocument();
});

/* ── The rulings (task 8's dispatch) ── */

test("the app's /sales/:id/edit is this page, the phone's tabs making way, and no longer a placeholder", async () => {
  const m = matchRoutes(appRoutes, "/sales/412/edit");
  const route = m?.[m.length - 1].route;
  expect(await loadedPage(route?.element)).toBe(EditBillPage);
  expect(route?.handle).toEqual({ hideNav: true });
});

test("a filed month's bill shows what's on it, with its way on: Open the bill, and GST returns for that firm and month (PROTO BillForm.jsx:120-123)", async () => {
  fakeToday();
  formServer([["GET", "sales/412/", () => wireDetail({ locked: true })]]);
  mountForm("/sales/412/edit");
  expect(await screen.findByText("This bill can't be changed")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open the bill" })).toHaveAttribute("href", "/sales/412");
  expect(screen.getByRole("link", { name: "GST returns" })).toHaveAttribute("href", "/gst?firm=3&month=2026-10");
  const bill = screen.getByRole("region", { name: "What's on the bill" });
  expect(bill).toHaveTextContent("Anil Gupta · 08 Oct 2026 · 3% · CGST+SGST");
  // exact to the paisa: nothing is rounded (Ruling 1B-12)
  expect(bill).toHaveTextContent("Total₹87,083.21");
  // nothing to change the bill with
  expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
});

test("a bill that can't load says so, and Try again asks again through the client (Ruling 1B-11); the form then opens", async () => {
  fakeToday();
  let down = true;
  formServer([["GET", "sales/412/", () => (down ? refuse(500, {}) : wireDetail())]]);
  const asked = vi.spyOn(QueryClient.prototype, "refetchQueries");
  mountForm("/sales/412/edit");
  expect(await screen.findByText("Couldn't load this bill")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Edit bill" })).toBeInTheDocument();
  down = false;
  // pressed, then the bill's answer and the form's own as it opens land, all inside act: nothing lands after it
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await settle();
  expect(screen.getByRole("heading", { level: 1, name: "Edit KGH/2026-27/31" })).toBeInTheDocument();
  expect(asked).toHaveBeenCalledWith({ queryKey: ["sales", "bill", 412] });
});

test("offline before the bill has loaded: said so, never a form that waits for good; it opens once the device is back", async () => {
  fakeToday();
  formServer([["GET", "sales/412/", () => wireDetail()]]);
  act(() => { onlineManager.setOnline(false); });
  try {
    mountForm("/sales/412/edit");
    expect(await screen.findByText("You're offline")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  } finally {
    act(() => { onlineManager.setOnline(true); });
  }
  await settle();
  expect(screen.getByRole("heading", { level: 1, name: "Edit KGH/2026-27/31" })).toBeInTheDocument();
});

test("a cancelled bill made again already: its way on is the bill it became, never Make it again (as the bill's page has it)", async () => {
  fakeToday();
  const remade = { id: 418, invoice_number: "KGH/2026-27/33", invoice_date: "2026-10-08", customer_name: "Anil Gupta", status: "active" };
  formServer([["GET", "sales/412/", () => wireDetail({ status: "cancelled", cancel_reason: "Wrong weight", replaced_by: remade })]]);
  mountForm("/sales/412/edit");
  expect(await screen.findByText("Cancelled bills can't be changed. It was made again as KGH/2026-27/33.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open KGH/2026-27/33" })).toHaveAttribute("href", "/sales/418");
  expect(screen.queryByRole("link", { name: "Make it again" })).not.toBeInTheDocument();
});

test("on a phone, a bill that can't change lists its items one to a line, with the totals under them", async () => {
  fakeToday();
  (window as unknown as { __phone?: boolean }).__phone = true;
  formServer([["GET", "sales/412/", () => wireDetail({ status: "cancelled", cancel_reason: "Customer returned the piece" })]]);
  mountForm("/sales/412/edit");
  expect(await screen.findByText("This bill can't be changed")).toBeInTheDocument();
  const bill = screen.getByRole("region", { name: "What's on the bill" });
  expect(within(bill).queryByRole("table")).not.toBeInTheDocument();
  expect(bill).toHaveTextContent("Gold Ring 22K12.345 gms × ₹6,512.50₹80,396.81");
  expect(bill).toHaveTextContent("Gold Pendant 22K1 pcs × ₹4,150.00₹4,150.00");
  expect(bill).toHaveTextContent("Total₹87,083.21");
  expect(screen.getByText("KIRAN GOLD HOUSE · 08 Oct 2026")).toBeInTheDocument();
});

const CANCELLED = "Cancelled bills can't be changed. Make it again from the bill instead.";
const FILED_OCT = "October 2026 is filed and locked for KIRAN GOLD HOUSE, so its bills can't be changed. Have the owner unlock October 2026 in GST returns first.";
const OCTOBER = { id: 7, business: 3, year: 2026, month: 10 };
/** A change saved after the bill was deleted (a PUT's 404 names nothing): the form names the bill, and says what happened. */
const GONE = "KGH/2026-27/31 isn't in Sales any more. It was deleted while you were changing it, so nothing was saved.";
test.each([
  ["cancelled", () => ({ kind: "bill", bill: toBillDetail(wireDetail({ status: "cancelled", cancel_reason: "Customer returned the piece" })) }), () => refuse(409, { detail: CANCELLED, code: "cancelled" }), "Not saved", CANCELLED, true],
  ["deleted", () => ({ kind: "deleted", binned: toBinRow(wireBin({ original_id: 412 })) }), () => refuse(404, { detail: "No Invoice matches the given query." }), "Not saved", GONE, true],
  ["deleted, the server saying so in its own words", () => ({ kind: "deleted", binned: toBinRow(wireBin({ original_id: 412 })) }), () => refuse(404, { detail: "This bill was deleted.", code: "deleted", binned: wireBin({ original_id: 412 }) }), "Not saved", "This bill was deleted.", true],
  ["put in a filed month", () => ({ kind: "bill", bill: toBillDetail(wireDetail({ locked: true })) }), () => refuse(409, { detail: FILED_OCT, code: "month_closed", locked_period: OCTOBER }), "October 2026 was just filed", FILED_OCT, false],
] as const)("once the form is open it stays, though the bill is %s meanwhile; the save then says what happened, in the server's words", async (_, now, put, title, words, final) => {
  const user = fakeToday();
  const { calls, client, router } = await changeWeight(user, wireDetail(), [["PUT", "sales/412/", put]]);
  // the bill's own answer says so now (a refresh elsewhere on this device), and the page draws again (its address
  // changes, the same bill's): the form and what's typed stay
  act(() => { client.setQueryData<BillOutcome>(billQuery(412).queryKey, now() as BillOutcome); });
  await act(async () => { await router.navigate("/sales/412/edit?again=1"); });
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(screen.getByRole("heading", { level: 1, name: "Edit KGH/2026-27/31" })).toBeInTheDocument();
  expect(screen.queryByText("This bill can't be changed")).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Line 1 weight in grams" })).toHaveValue("12.5");
  await user.keyboard("{Control>}s{/Control}");
  const dialog = await screen.findByRole("dialog", { name: "Check the changes to KGH/2026-27/31" });
  act(() => { vi.advanceTimersByTime(400); });
  await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(`${title}${words}`);
  expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  if (final) {
    // saving again can't change it: the way on is the bill's own page (Ruling 1D-12)
    expect(within(dialog).queryByRole("button", { name: /^(Try again|Save)/ })).not.toBeInTheDocument();
    const open = within(dialog).getByRole("link", { name: "Open KGH/2026-27/31" });
    expect(open).toHaveAttribute("href", "/sales/412");
    expect(open).toHaveFocus();
  } else {
    // the owner may unlock the month and try again
    expect(within(dialog).getByRole("button", { name: "Try again" })).toBeEnabled();
  }
});

test.each([
  ["out of a filed month: the bill's own October", OCTOBER, "October 2026", FILED_OCT],
  ["into a filed month: the new date's September", { id: 6, business: 3, year: 2026, month: 9 }, "September 2026",
    "September 2026 is filed and locked for KIRAN GOLD HOUSE, so its bills can't be changed. Have the owner unlock September 2026 in GST returns first."],
] as const)("a change that moves the bill %s is refused for the month the server names (contract §2.3: the old and the new month)", async (_, period, month, words) => {
  const user = fakeToday();
  formServer([["GET", "sales/412/", () => wireDetail()], ["PUT", "sales/412/", () => refuse(409, { detail: words, code: "month_closed", locked_period: period })]]);
  mountForm("/sales/412/edit");
  await screen.findByRole("heading", { level: 1, name: "Edit KGH/2026-27/31" });
  const day = screen.getByLabelText("Date");
  await user.clear(day);
  await user.type(day, "30/09/2026");
  await user.keyboard("{Control>}s{/Control}");
  const dialog = await screen.findByRole("dialog", { name: "Check the changes to KGH/2026-27/31" });
  act(() => { vi.advanceTimersByTime(400); });
  expect(within(dialog).getByRole("list", { name: "What changes" })).toHaveTextContent("Date: 08 Oct 2026 →becomes 30 Sep 2026");
  await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(`${month} was just filed${words}`);
});

/* ── Review fix 1 ── */

/** The review of the edit as it stands, opened from the form, past its guard; and what its "What changes" lists. */
async function reviewChanges(user: ReturnType<typeof fakeToday>) {
  await user.click(screen.getByRole("button", { name: "Check and save changes" }));
  const dialog = await screen.findByRole("dialog", { name: "Check the changes to KGH/2026-27/31" });
  act(() => { vi.advanceTimersByTime(400); });
  const list = within(dialog).queryByRole("list", { name: "What changes" });
  return { dialog, changes: list ? within(list).getAllByRole("listitem").map((li) => li.textContent) : [] };
}
async function openEdit(bill = wireDetail()) {
  const server = formServer([["GET", "sales/412/", () => bill]]);
  const view = mountForm("/sales/412/edit");
  await screen.findByRole("heading", { level: 1, name: "Edit KGH/2026-27/31" });
  return { ...server, ...view };
}

test("the first line removed is named as removed, never as the second line changed into it (T8 review)", async () => {
  const user = fakeToday();
  await openEdit();
  await user.click(screen.getByRole("button", { name: "Remove line 1, Gold Ring 22K" }));
  // the cursor moves to the pendant's product box a moment later, inside act
  await settle();
  const { changes } = await reviewChanges(user);
  expect(changes).toEqual(["Items removed: Gold Ring 22K →becomes None", "Total: ₹87,083.21 →becomes ₹4,274.50"]);
});

test("an untouched v2 bill whose stored total is a paisa off v3's maths offers nothing to save; a real change lists the total beside it (Ruling 1D-16)", async () => {
  const user = fakeToday();
  const { calls } = await openEdit(wireDetail({ total_amount: "87083.22", sent: SENT }));
  expect(screen.getByText("No changes yet")).toBeInTheDocument();
  let { dialog } = await reviewChanges(user);
  expect(dialog).toHaveTextContent("What changesNothing has changed yet. Go back and edit, or close this.");
  // nothing to send again either: the customer's bill hasn't changed
  expect(dialog).not.toHaveTextContent("You sent");
  const save = within(dialog).getByRole("button", { name: "Save changes" });
  expect(save).toBeDisabled();
  expect(save).toHaveAttribute("title", "Nothing has changed yet");
  await user.click(within(dialog).getByRole("button", { name: "Go back and edit" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Check the changes to KGH/2026-27/31" })).not.toBeInTheDocument());
  // a real change: the total it's saved with is listed beside it, and the customer has the old one
  await user.click(screen.getByRole("radio", { name: "UPI / bank" }));
  let changes: (string | null)[];
  ({ dialog, changes } = await reviewChanges(user));
  expect(changes).toEqual(["Paid by: Cash →becomes UPI / bank", "Total: ₹87,083.22 →becomes ₹87,083.21"]);
  expect(dialog).toHaveTextContent("You sent Anil Gupta this bill on 05 Oct at 12:09, with ₹87,083.22. After saving, send the corrected one from the bill's page.");
  await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1));
});

test("a sent bill whose total stays the same gets no word about sending it again", async () => {
  const user = fakeToday();
  await openEdit(wireDetail({ sent: SENT }));
  await user.click(screen.getByRole("radio", { name: "UPI / bank" }));
  const { dialog, changes } = await reviewChanges(user);
  expect(changes).toEqual(["Paid by: Cash →becomes UPI / bank"]);
  expect(dialog).not.toHaveTextContent("You sent");
});

test("leaving an unchanged edit asks nothing, in the app or as the tab closes", async () => {
  const user = fakeToday();
  const { router } = await openEdit();
  await settle();
  expect(asksOnClose()).toBe(false);
  await user.click(screen.getByRole("link", { name: "Cancel" }));
  await waitFor(() => expect(where(router)).toBe("/sales/412"));
  expect(screen.queryByRole("dialog", { name: "Leave without saving?" })).not.toBeInTheDocument();
});

test("the open form asks for the bill once: saves elsewhere on this device leave it be (Neon's free plan; T8 review)", async () => {
  fakeToday();
  const { calls, client } = await openEdit();
  await settle();
  const asked = () => calls.filter((c) => c.method === "GET" && c.url === "sales/412/").length;
  expect(asked()).toBe(1);
  for (let i = 0; i < 2; i += 1) await act(async () => { invalidateSales(client); await vi.advanceTimersByTimeAsync(50); });
  expect(asked()).toBe(1);
  expect(screen.getByRole("heading", { level: 1, name: "Edit KGH/2026-27/31" })).toBeInTheDocument();
});

test("a deleted bill shows what was on it; one deleted from a filed month says why it can't come back (T8 review)", async () => {
  fakeToday();
  formServer([["GET", "sales/412/", () => refuse(404, { code: "deleted", binned: wireBin({ original_id: 412 }) })]]);
  const first = mountForm("/sales/412/edit");
  expect(await screen.findByText("KGH/2026-27/27 was deleted")).toBeInTheDocument();
  expect(screen.getByText("Walk-in Customer · 24 Sep 2026 · ₹45,000.00")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open the bill" })).toHaveAttribute("href", "/sales/412");
  first.unmount();
  formServer([["GET", "sales/412/", () => refuse(404, { code: "deleted", binned: wireBin({ original_id: 412, locked: true }) })]]);
  mountForm("/sales/412/edit");
  expect(await screen.findByText("KGH/2026-27/27 was deleted")).toBeInTheDocument();
  expect(screen.getByText("A deleted bill can't be changed. September 2026 is filed and locked, so the bill can't come back into it. The owner can unlock the month in GST returns first.")).toBeInTheDocument();
  expect(screen.queryByText(/Restore it/)).not.toBeInTheDocument();
});


test("T9 leftovers: a moved edit names the pending number without empty words or arrows", async () => {
  const user = fakeToday();
  let answer = () => {};
  formServer([
    ["GET", "sales/412/", () => wireDetail()],
    ["GET", "sales/next-number/", ({ params }) => new Promise((ok) => { answer = () => ok(wireNext(Number(params.business_id), String(params.invoice_date))); })],
  ]);
  mountForm("/sales/412/edit");
  await screen.findByRole("heading", { level: 1, name: "Edit KGH/2026-27/31" });
  await user.selectOptions(screen.getByLabelText("Firm"), "2");
  await user.click(screen.getByRole("button", { name: "Check and save changes" }));
  const review = await screen.findByRole("dialog", { name: "Check the changes to KGH/2026-27/31" });
  expect(review).toHaveTextContent("It takes its new number. The change is written to the audit log.");
  expect(within(review).getByRole("list", { name: "What changes" })).toHaveTextContent("Bill number: KGH/2026-27/31 →becomes Getting the next number");
  expect(within(review).getByRole("button", { name: "Save changes" })).toBeDisabled();
  await act(async () => { answer(); });
  await waitFor(() => expect(review).toHaveTextContent("It becomes 9. The change is written to the audit log."));
  expect(within(review).getByRole("list", { name: "What changes" })).toHaveTextContent("Bill number: KGH/2026-27/31 →becomes 9");
});

test.each(["fails", "goes offline"] as const)("T9 review fix 1: a moved edit shows — when the next number %s with the review open", async (result) => {
  const user = fakeToday();
  let fail = () => {};
  formServer([
    ["GET", "sales/412/", () => wireDetail()],
    ["GET", "sales/next-number/", () => new Promise<void>((done) => { fail = done; }).then(() => refuse(500, {}))],
  ]);
  mountForm("/sales/412/edit");
  await screen.findByRole("heading", { level: 1, name: "Edit KGH/2026-27/31" });
  await user.selectOptions(screen.getByLabelText("Firm"), "2");
  const { dialog } = await reviewChanges(user);
  const changes = within(dialog).getByRole("list", { name: "What changes" });
  expect(changes).toHaveTextContent("Bill number: KGH/2026-27/31 →becomes Getting the next number");
  await act(async () => { if (result === "fails") fail(); else __setNetState("offline"); });
  await settle();
  expect(changes).toHaveTextContent("Bill number: KGH/2026-27/31 →becomes —");
  expect(changes).not.toHaveTextContent("Getting the next number");
});

test("T9 leftovers: typing weight and rate back clears the status and both leave prompts", async () => {
  const user = fakeToday();
  const { router } = await openEdit();
  const weight = screen.getByRole("textbox", { name: "Line 1 weight in grams" });
  const rate = screen.getByRole("textbox", { name: "Line 1 rate per gram" });
  await user.clear(weight);
  await user.type(weight, "12.345");
  await user.clear(rate);
  await user.type(rate, "6512.50");
  await user.tab();
  expect(screen.getByText("No changes yet")).toBeInTheDocument();
  expect(asksOnClose()).toBe(false);
  const { dialog } = await reviewChanges(user);
  expect(dialog).toHaveTextContent("Nothing has changed yet");
  expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeDisabled();
  await user.click(within(dialog).getByRole("button", { name: "Go back and edit" }));
  await settle();
  await user.click(screen.getByRole("link", { name: "Cancel" }));
  await waitFor(() => expect(where(router)).toBe("/sales/412"));
  expect(screen.queryByRole("dialog", { name: "Leave without saving?" })).not.toBeInTheDocument();
});
