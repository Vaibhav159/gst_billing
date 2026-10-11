import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { AxiosError } from "axios";
import { __resetDrafts } from "@/core/api/drafts";
import { __setNetState } from "@/core/api/network";
import { salesKeys } from "@/core/api/sales";
import { __resetDeviceDrafts } from "@/core/deviceDrafts";
import { refuse, wireDetail, wireFacets, wirePage, type Route } from "@/core/sales/fixtures";
import { takeFresh } from "@/core/sales/fresh";
import { ANIL, BIG, formServer, fakeToday, mountForm, settle, wireNext } from "./testing";

// whole flows through the form, a step at a time: a busy runner takes longer than vitest's 5 s for one
vi.setConfig({ testTimeout: 20_000 });

beforeEach(() => { localStorage.clear(); __resetDeviceDrafts(); __resetDrafts(); });
afterEach(() => { vi.useRealTimers(); act(() => __setNetState("online")); takeFresh(); });

const where = (router: { state: { location: { pathname: string; search: string } } }) => router.state.location.pathname + router.state.location.search;
const posts = (calls: { method: string; body: unknown }[]) => calls.filter((c) => c.method === "POST").map((c) => (c.body as { invoice_number: string }).invoice_number);
/** What a row of the review says: its label and value ("Bill no.KGH/2026-27/34"). */
const cell = (dialog: HTMLElement, label: string) => within(dialog).getByText(label).parentElement;

/** A copy of KGH/2026-27/31 (Anil Gupta: a ring and a pendant), a whole bill ready to check: the review open, past its guard. */
async function review(user: ReturnType<typeof fakeToday>, routes: Route[] = [], bill = wireDetail()) {
  const server = formServer([["GET", "sales/412/", () => bill], ...routes]);
  const view = mountForm("/sales/new?from=412");
  await screen.findByText("Copied from KGH/2026-27/31");
  await user.keyboard("{Control>}s{/Control}");
  const dialog = await screen.findByRole("dialog", { name: "Check the bill before saving" });
  act(() => { vi.advanceTimersByTime(400); }); // past the dialog's guard against the key that opened it
  return { ...server, ...view, dialog };
}

test("Check and save shows exactly what will be saved; How was it paid? comes first; a pick moves to Save, Enter saves, and the bill opens with its saved panel", async () => {
  const user = fakeToday();
  const { calls, router, dialog } = await review(user);
  expect(dialog).toHaveTextContent("This is exactly what will be saved, to the paisa. Nothing on it is rounded.");
  expect(within(dialog).getByRole("table", { name: "Items that will be saved" })).toHaveTextContent("Gold Pendant 22K");
  expect(dialog).toHaveTextContent("It goes into October's GSTR-1 as a B2C sale as KGH/2026-27/34.");
  expect(dialog).toHaveTextContent("Eighty Seven Thousand Eighty Three Rupees and Twenty One Paise Only");
  expect(dialog).toHaveTextContent("Paid byNot picked yet");
  await waitFor(() => expect(within(dialog).getByRole("radio", { name: "Cash" })).toHaveFocus());
  await user.keyboard(" ");
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Save bill" })).toHaveFocus());
  await user.keyboard("{Enter}");
  await waitFor(() => expect(where(router)).toBe("/sales/501?saved=new"));
  expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({
    business: 3, customer: 7, invoice_number: "34", invoice_date: "2026-10-08", payment_mode: "cash", place_of_supply: "08", notes: "", paper: false, replaces: null, draft_id: expect.any(String),
  });
  // the leave-guard let go first: no "Leave without saving?" on the way
  expect(screen.queryByRole("dialog", { name: "Leave without saving?" })).not.toBeInTheDocument();
  expect(takeFresh([501])).toEqual(new Set([501]));
});

test("cash of ₹2,00,000 or more doesn't save in one press: Part cash, or a tick that it's all cash anyway; the PAN check offers Add PAN", async () => {
  const user = fakeToday();
  formServer([["GET", "sales/412/", () => wireDetail({ lines: BIG })]]);
  mountForm("/sales/new?from=412");
  await screen.findByText("Copied from KGH/2026-27/31");
  const checks = within(screen.getByRole("complementary", { name: "Bill summary" })).getByRole("list", { name: "Checks on this bill" });
  expect(checks).toHaveTextContent("Over ₹2,00,000: Income Tax Rule 114B needs Anil Gupta's PAN (or Form 60).");
  await user.click(within(checks).getByRole("button", { name: "Add PAN" }));
  expect(await screen.findByRole("dialog", { name: "Anil Gupta's PAN" })).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Anil Gupta's PAN" })).not.toBeInTheDocument());
  await user.keyboard("{Control>}s{/Control}");
  const dialog = await screen.findByRole("dialog", { name: "Check the bill before saving" });
  act(() => { vi.advanceTimersByTime(400); });
  await user.click(within(dialog).getByRole("radio", { name: "Cash" }));
  expect(dialog).toHaveTextContent("₹2,67,800.00 in cash from one person isn't allowed");
  const save = within(dialog).getByRole("button", { name: "Save bill" });
  expect(save).toBeDisabled();
  await user.click(within(dialog).getByRole("checkbox", { name: "Save it as all cash anyway" }));
  expect(save).toBeEnabled();
  await user.click(within(dialog).getByRole("checkbox", { name: "Save it as all cash anyway" }));
  expect(save).toBeDisabled();
  await user.click(within(dialog).getByRole("button", { name: "Change to Part cash, part UPI" }));
  expect(dialog).toHaveTextContent("Paid byPart cash, part UPI");
  expect(save).toBeEnabled();
  await waitFor(() => expect(save).toHaveFocus());
});

test("Ctrl S in the review presses Save, but not in its first moments: the key that opened it, pressed again at once or held down, doesn't save a bill unseen", async () => {
  const user = fakeToday();
  const { calls } = formServer([["GET", "sales/412/", () => wireDetail()]]);
  const { router } = mountForm("/sales/new?from=412");
  await screen.findByText("Copied from KGH/2026-27/31");
  await waitFor(() => expect(screen.getByLabelText("Bill number")).toHaveValue("34"));
  // picked on the form, so the review opens with Save on
  await user.click(screen.getByRole("radio", { name: "UPI / bank" }));
  // Ctrl S twice at once: the first opens the review, and the second is its tail
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  const dialog = await screen.findByRole("dialog", { name: "Check the bill before saving" });
  act(() => { vi.advanceTimersByTime(400); });
  fireEvent.keyDown(window, { key: "s", ctrlKey: true, repeat: true });
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(posts(calls)).toEqual([]);
  expect(within(dialog).getByRole("button", { name: "Save bill" })).toBeEnabled();
  await user.keyboard("{Control>}s{/Control}");
  await waitFor(() => expect(where(router)).toBe("/sales/501?saved=new"));
  expect(posts(calls)).toEqual(["34"]);
});

test("Ctrl S saves from the review only while it's on top and Save is on: not while all cash over the limit holds it, and not from a PAN sheet opened over it", async () => {
  const user = fakeToday();
  const { calls } = formServer([["GET", "sales/412/", () => wireDetail({ lines: BIG })]]);
  const { router } = mountForm("/sales/new?from=412");
  await screen.findByText("Copied from KGH/2026-27/31");
  await waitFor(() => expect(screen.getByLabelText("Bill number")).toHaveValue("34"));
  await user.click(screen.getByRole("radio", { name: "Cash" }));
  await user.keyboard("{Control>}s{/Control}");
  const dialog = await screen.findByRole("dialog", { name: "Check the bill before saving" });
  act(() => { vi.advanceTimersByTime(400); });
  expect(within(dialog).getByRole("button", { name: "Save bill" })).toBeDisabled();
  await user.keyboard("{Control>}s{/Control}");
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(posts(calls)).toEqual([]);
  await user.click(within(dialog).getByRole("button", { name: "Change to Part cash, part UPI" }));
  // the PAN, added from the review's own checks: its sheet opens over the review, and Ctrl S there is the sheet's
  const checked = within(dialog).getByRole("list", { name: "Checked before saving" });
  expect(checked).toHaveTextContent("Over ₹2,00,000: Income Tax Rule 114B needs Anil Gupta's PAN (or Form 60).");
  await user.click(within(checked).getByRole("button", { name: "Add PAN" }));
  const sheet = await screen.findByRole("dialog", { name: "Anil Gupta's PAN" });
  act(() => { vi.advanceTimersByTime(400); });
  await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
  await user.keyboard("{Control>}s{/Control}");
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(posts(calls)).toEqual([]);
  expect(screen.getByRole("dialog", { name: "Anil Gupta's PAN" })).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Anil Gupta's PAN" })).not.toBeInTheDocument());
  // the review on top again: Ctrl S saves it
  await user.keyboard("{Control>}s{/Control}");
  await waitFor(() => expect(where(router)).toBe("/sales/501?saved=new"));
  expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ payment_mode: "mixed", invoice_number: "34" });
});

test("a PAN added from the review's own checks: the check and its Add PAN go, and the cursor is back in the review, never on the page behind it (T5 review)", async () => {
  const user = fakeToday();
  formServer([
    ["GET", "sales/412/", () => wireDetail({ lines: BIG })],
    ["PATCH", "customers/7/", () => ({ ...ANIL, pan_number: "ABCPG1234K", pan: "ABCPG1234K" })],
  ]);
  mountForm("/sales/new?from=412");
  await screen.findByText("Copied from KGH/2026-27/31");
  await waitFor(() => expect(screen.getByLabelText("Bill number")).toHaveValue("34"));
  await user.click(screen.getByRole("radio", { name: "UPI / bank" }));
  await user.keyboard("{Control>}s{/Control}");
  const dialog = await screen.findByRole("dialog", { name: "Check the bill before saving" });
  act(() => { vi.advanceTimersByTime(400); });
  const checked = within(dialog).getByRole("list", { name: "Checked before saving" });
  await user.click(within(checked).getByRole("button", { name: "Add PAN" }));
  const sheet = await screen.findByRole("dialog", { name: "Anil Gupta's PAN" });
  act(() => { vi.advanceTimersByTime(400); });
  await user.click(within(sheet).getByRole("textbox"));
  await user.keyboard("ABCPG1234K{Enter}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Anil Gupta's PAN" })).not.toBeInTheDocument());
  await settle();
  expect(within(dialog).queryByRole("button", { name: "Add PAN" })).not.toBeInTheDocument();
  expect(dialog).toContainElement(document.activeElement as HTMLElement);
});

test("a change to a saved bill with nothing changed yet: Save changes is off, with its reason, and Ctrl S doesn't send it either (Ruling 1D-14)", async () => {
  const user = fakeToday();
  const { calls } = formServer([["GET", "sales/412/", () => wireDetail()]]);
  mountForm("/sales/412/edit");
  await screen.findByRole("heading", { level: 1, name: "Edit KGH/2026-27/31" });
  await settle();
  await user.keyboard("{Control>}s{/Control}");
  const dialog = await screen.findByRole("dialog", { name: "Check the changes to KGH/2026-27/31" });
  act(() => { vi.advanceTimersByTime(400); });
  expect(dialog).toHaveTextContent("What changesNothing has changed yet. Go back and edit, or close this.");
  const save = within(dialog).getByRole("button", { name: "Save changes" });
  expect(save).toBeDisabled();
  expect(save).toHaveAttribute("title", "Nothing has changed yet");
  await user.keyboard("{Control>}s{/Control}");
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(calls.some((c) => c.method === "PUT")).toBe(false);
  expect(screen.getByRole("dialog", { name: "Check the changes to KGH/2026-27/31" })).toBeInTheDocument();
});

test.each([
  ["no PAN that counts (\"N/A\" stored)", "N/A", "", true],
  ["a PAN", "ABCPG1234K", "ABCPG1234K", false],
] as const)("over ₹2,00,000, the review's checks ask for the PAN of a customer with %s, and only then (Ruling 1A-20)", async (_, panNumber, pan, asks) => {
  const user = fakeToday();
  formServer([
    ["GET", "sales/412/", () => wireDetail({ lines: BIG })],
    ["GET", "customers/7/", () => ({ ...ANIL, pan_number: panNumber, pan })],
  ]);
  mountForm("/sales/new?from=412");
  await screen.findByText("Copied from KGH/2026-27/31");
  await waitFor(() => expect(screen.getByLabelText("Bill number")).toHaveValue("34"));
  await settle();
  await user.keyboard("{Control>}s{/Control}");
  const dialog = await screen.findByRole("dialog", { name: "Check the bill before saving" });
  const checked = within(dialog).getByRole("list", { name: "Checked before saving" });
  if (asks) expect(checked).toHaveTextContent("Over ₹2,00,000: Income Tax Rule 114B needs Anil Gupta's PAN (or Form 60). Add PAN");
  else expect(checked).not.toHaveTextContent(/PAN/);
});

test("a number taken meanwhile: the server's words first, and a suggested number saves as the next free one in one press", async () => {
  const user = fakeToday();
  let tries = 0;
  const { calls, router, dialog } = await review(user, [["POST", "sales/", () => {
    tries += 1;
    return tries === 1
      ? refuse(409, { detail: "KGH/2026-27/34 is already used in FY 2026-27 by Meena Jain's bill of 08 Oct 2026. The next free number is KGH/2026-27/35.", code: "number_taken",
        bill: { id: 499, invoice_number: "KGH/2026-27/34", invoice_date: "2026-10-08", customer_name: "Meena Jain", status: "active" }, next: { counter: 35, invoice_number: "KGH/2026-27/35" } })
      : wireDetail({ id: 502, invoice_number: "KGH/2026-27/35" });
  }]]);
  await user.click(within(dialog).getByRole("radio", { name: "UPI / bank" }));
  await user.click(within(dialog).getByRole("button", { name: "Save bill" }));
  const fail = await within(dialog).findByRole("alert");
  expect(fail).toHaveTextContent("KGH/2026-27/34 was just used");
  expect(fail).toHaveTextContent("KGH/2026-27/34 is already used in FY 2026-27 by Meena Jain's bill of 08 Oct 2026. The next free number is KGH/2026-27/35. Check the number on the paper bill.");
  expect(dialog).toHaveTextContent("Save as KGH/2026-27/35 takes the next free number in one step.");
  expect(dialog).toHaveTextContent("It goes into October's GSTR-1 as a B2C sale as KGH/2026-27/35.");
  expect(cell(dialog, "Bill no.")).toHaveTextContent("KGH/2026-27/35");
  await user.click(within(dialog).getByRole("button", { name: "Save as KGH/2026-27/35" }));
  await waitFor(() => expect(where(router)).toBe("/sales/502?saved=new"));
  expect(posts(calls)).toEqual(["34", "KGH/2026-27/35"]);
});

test("after a clash, the review shows the number Save sends as it is now: the server's next, until the next number asked for again moves past it (T4 review)", async () => {
  const user = fakeToday();
  let counter = 34;
  let held: Promise<void> | null = null;
  let answer = () => {};
  const { calls, router, dialog } = await review(user, [
    ["GET", "sales/next-number/", async ({ params }) => { await held; return wireNext(Number(params.business_id), String(params.invoice_date), counter); }],
    ["POST", "sales/", ({ body }) => ((body as { invoice_number: string }).invoice_number === "34"
      ? refuse(409, { detail: "KGH/2026-27/34 is already used in FY 2026-27 by Meena Jain's bill of 08 Oct 2026. The next free number is KGH/2026-27/35.", code: "number_taken", next: { counter: 35, invoice_number: "KGH/2026-27/35" } })
      : wireDetail({ id: 502, invoice_number: (body as { invoice_number: string }).invoice_number }))],
  ]);
  // another counter takes 35 too before the next number is asked for again, and that answer is slow
  counter = 36;
  held = new Promise<void>((r) => { answer = r; });
  await user.click(within(dialog).getByRole("radio", { name: "UPI / bank" }));
  await user.click(within(dialog).getByRole("button", { name: "Save bill" }));
  await within(dialog).findByRole("alert");
  expect(cell(dialog, "Bill no.")).toHaveTextContent("KGH/2026-27/35");
  expect(within(dialog).getByRole("button", { name: "Save as KGH/2026-27/35" })).toBeInTheDocument();
  await act(async () => { answer(); await vi.advanceTimersByTimeAsync(50); });
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Save as KGH/2026-27/36" })).toBeInTheDocument());
  expect(cell(dialog, "Bill no.")).toHaveTextContent("KGH/2026-27/36");
  expect(dialog).toHaveTextContent("It goes into October's GSTR-1 as a B2C sale as KGH/2026-27/36.");
  // and Ctrl S sends what the review shows
  await user.keyboard("{Control>}s{/Control}");
  await waitFor(() => expect(where(router)).toBe("/sales/502?saved=new"));
  expect(posts(calls)).toEqual(["34", "KGH/2026-27/36"]);
});

test("a second clash, on the number offered: the next free one again, never one taken already, though the next number asked for again lags (T4 review)", async () => {
  const user = fakeToday();
  const taken = (n: number) => refuse(409, {
    detail: `KGH/2026-27/${n} is already used in FY 2026-27 by Meena Jain's bill of 08 Oct 2026. The next free number is KGH/2026-27/${n + 1}.`, code: "number_taken",
    next: { counter: n + 1, invoice_number: `KGH/2026-27/${n + 1}` },
  });
  // the next number asked for again still says 34: the review goes by the server's latest next instead
  const { calls, router, dialog } = await review(user, [["POST", "sales/", ({ body }) => {
    const n = (body as { invoice_number: string }).invoice_number;
    return n === "34" ? taken(34) : n === "KGH/2026-27/35" ? taken(35) : wireDetail({ id: 502, invoice_number: n });
  }]]);
  await user.click(within(dialog).getByRole("radio", { name: "UPI / bank" }));
  await user.click(within(dialog).getByRole("button", { name: "Save bill" }));
  await user.click(await within(dialog).findByRole("button", { name: "Save as KGH/2026-27/35" }));
  await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("KGH/2026-27/35 was just used"));
  expect(cell(dialog, "Bill no.")).toHaveTextContent("KGH/2026-27/36");
  await user.click(within(dialog).getByRole("button", { name: "Save as KGH/2026-27/36" }));
  await waitFor(() => expect(where(router)).toBe("/sales/502?saved=new"));
  expect(posts(calls)).toEqual(["34", "KGH/2026-27/35", "KGH/2026-27/36"]);
});

test("a number that belonged to a deleted bill: the server's words first, and the next free one in one press", async () => {
  const user = fakeToday();
  const { calls, router, dialog } = await review(user, [["POST", "sales/", ({ body }) => ((body as { invoice_number: string }).invoice_number === "34"
    ? refuse(409, { detail: "KGH/2026-27/34 belonged to a bill that was deleted (it can be restored from the Audit log), so it can't be used again. The next free number is KGH/2026-27/35.", code: "number_deleted",
      binned: { id: 4, original_id: 205, invoice_number: "KGH/2026-27/34", invoice_date: "2026-10-01", reason: "Entered twice by mistake", deleted_at: "2026-10-03T18:40:00+05:30" }, next: { counter: 35, invoice_number: "KGH/2026-27/35" } })
    : wireDetail({ id: 502, invoice_number: "KGH/2026-27/35" }))]]);
  await user.click(within(dialog).getByRole("radio", { name: "Cash" }));
  await user.click(within(dialog).getByRole("button", { name: "Save bill" }));
  const fail = await within(dialog).findByRole("alert");
  expect(fail).toHaveTextContent("KGH/2026-27/34 belonged to a deleted bill");
  expect(fail).toHaveTextContent("KGH/2026-27/34 belonged to a bill that was deleted (it can be restored from the Audit log), so it can't be used again. The next free number is KGH/2026-27/35. Check the number on the paper bill.");
  await user.click(within(dialog).getByRole("button", { name: "Save as KGH/2026-27/35" }));
  await waitFor(() => expect(where(router)).toBe("/sales/502?saved=new"));
  expect(posts(calls)).toEqual(["34", "KGH/2026-27/35"]);
});

test.each(["number_taken", "number_deleted"])("a paper bill's own number refused (%s): Change the number shows the fresh server check", async (code) => {
  const user = fakeToday();
  let taken = false;
  const words = code === "number_taken"
    ? "KGH/2026-27/36 is already used in FY 2026-27 by Hemant Dave's bill of 29 Sep 2026. The next free number is KGH/2026-27/37."
    : "KGH/2026-27/36 belonged to a bill that was deleted, so it can't be used again. The next free number is KGH/2026-27/37.";
  const { calls } = formServer([
    ["GET", "sales/check-number/", () => ({ invoice_number: "KGH/2026-27/36", counter: 36, code: taken ? code : "", problem: taken ? words : "", next: { counter: 37, invoice_number: "KGH/2026-27/37" } })],
    ["POST", "sales/", () => { taken = true; return refuse(409, { detail: words, code, next: { counter: 37, invoice_number: "KGH/2026-27/37" } }); }],
  ]);
  mountForm("/sales/new?paper=1&firm=3&date=2026-09-30&number=36");
  const customer = await screen.findByRole("combobox", { name: /Customer/ });
  await waitFor(() => expect(customer).toHaveFocus());
  await user.keyboard("Anil");
  await act(async () => { vi.advanceTimersByTime(400); });
  await screen.findByRole("option", { name: /^Anil Gupta/ });
  await user.keyboard("{Enter}ring{Enter}1{Enter}6000");
  await user.keyboard("{Control>}s{/Control}");
  const dialog = await screen.findByRole("dialog", { name: "Check the paper bill before saving" });
  act(() => { vi.advanceTimersByTime(400); });
  await user.keyboard(" ");
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Save bill" })).toHaveFocus());
  await user.keyboard("{Enter}");
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(code === "number_taken" ? "KGH/2026-27/36 was just used" : "KGH/2026-27/36 belonged to a deleted bill");
  expect(within(dialog).queryByRole("button", { name: /^Save as/ })).not.toBeInTheDocument();
  expect(cell(dialog, "Bill no.")).toHaveTextContent("KGH/2026-27/36");
  await user.click(within(dialog).getByRole("button", { name: "Change the number" }));
  await waitFor(() => expect(screen.getByLabelText("Number on the paper bill")).toHaveFocus());
  await waitFor(() => expect(screen.getByLabelText("Number on the paper bill")).toHaveAttribute("aria-invalid", "true"));
  expect(screen.getByLabelText("Number on the paper bill")).toHaveAccessibleDescription(words);
  const checks = within(screen.getByRole("complementary", { name: "Bill summary" })).getByRole("list", { name: "Checks on this bill" });
  expect(checks).not.toHaveTextContent("is free");
  expect(calls.filter((c) => c.url === "sales/check-number/")).toHaveLength(2);
  expect(calls.filter((c) => c.url === "sales/next-number/")).toHaveLength(2);
});

test("a closed month, then a lost connection: each said first in the review, with everything kept; Try again saves", async () => {
  const user = fakeToday();
  let tries = 0;
  const { router, dialog } = await review(user, [["POST", "sales/", () => {
    tries += 1;
    if (tries === 1) return refuse(409, { detail: "October 2026 is filed and locked for KIRAN GOLD HOUSE, so no bill can go into it. Have the owner unlock October 2026 in GST returns first.", code: "month_closed", locked_period: { id: 7, business: 3, year: 2026, month: 10 } });
    if (tries === 2) throw new AxiosError("Network Error", "ERR_NETWORK");
    return wireDetail({ id: 503, invoice_number: "KGH/2026-27/34" });
  }]]);
  await user.click(within(dialog).getByRole("radio", { name: "Cash" }));
  await user.click(within(dialog).getByRole("button", { name: "Save bill" }));
  let fail = await within(dialog).findByRole("alert");
  expect(fail).toHaveTextContent("October 2026 was just filed");
  expect(fail).toHaveTextContent("October 2026 is filed and locked for KIRAN GOLD HOUSE, so no bill can go into it. Have the owner unlock October 2026 in GST returns first.");
  await user.click(within(dialog).getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("Not saved: the app couldn't get through"));
  fail = within(dialog).getByRole("alert");
  expect(fail).toHaveTextContent("Nothing was changed. What you typed is still here. Try again in a minute.");
  await user.click(within(dialog).getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(where(router)).toBe("/sales/503?saved=new"));
});

test("a bill cancelled while it was being changed: the review says so in the server's words (contract §2.3's 409 cancelled)", async () => {
  const user = fakeToday();
  const words = "Cancelled bills can't be changed. Make it again from the bill instead.";
  const { calls } = formServer([["GET", "sales/412/", () => wireDetail()], ["PUT", "sales/412/", () => refuse(409, { detail: words, code: "cancelled" })]]);
  mountForm("/sales/412/edit");
  await screen.findByRole("heading", { level: 1, name: "Edit KGH/2026-27/31" });
  await settle();
  const note = screen.getByLabelText("Note on the bill");
  await user.type(note, "Weighed again");
  await user.keyboard("{Control>}s{/Control}");
  const dialog = await screen.findByRole("dialog", { name: "Check the changes to KGH/2026-27/31" });
  act(() => { vi.advanceTimersByTime(400); });
  await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
  const fail = await within(dialog).findByRole("alert");
  expect(fail).toHaveTextContent(`Not saved${words}`);
  expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  // saving again can't change a cancelled bill: no Try again, and the way on is the bill itself (Ruling 1D-12)
  expect(within(dialog).queryByRole("button", { name: /^(Try again|Save)/ })).not.toBeInTheDocument();
  const open = within(dialog).getByRole("link", { name: "Open KGH/2026-27/31" });
  expect(open).toHaveAttribute("href", "/sales/412");
  expect(open).toHaveAttribute("data-variant", "primary");
  expect(open).toHaveFocus();
  // what was typed is still there behind it
  await user.click(within(dialog).getByRole("button", { name: "Go back and edit" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Check the changes to KGH/2026-27/31" })).not.toBeInTheDocument());
  expect(screen.getByLabelText("Note on the bill")).toHaveValue("Weighed again");
});

test("a cancelled bill made again whose remake the server refuses (made again already) keeps the review open with the server's words (Ruling 1D-4)", async () => {
  const user = fakeToday();
  const words = "KGH/2026-27/31 was made again already, as KGH/2026-27/33.";
  const { calls } = formServer([
    ["GET", "sales/412/", () => wireDetail({ status: "cancelled", cancel_reason: "Wrong weight", payment_mode: "bank" })],
    ["POST", "sales/", () => refuse(400, { replaces: [words] })],
  ]);
  mountForm("/sales/new?remake=412");
  await screen.findByText("Making KGH/2026-27/31 again");
  await waitFor(() => expect(screen.getByLabelText("Bill number")).toHaveValue("34"));
  await user.keyboard("{Control>}s{/Control}");
  const dialog = await screen.findByRole("dialog", { name: "Check the bill before saving" });
  act(() => { vi.advanceTimersByTime(400); });
  await user.click(within(dialog).getByRole("button", { name: "Save bill" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(`Not saved${words}`);
  expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ replaces: 412 });
  expect(screen.getByRole("dialog", { name: "Check the bill before saving" })).toBeInTheDocument();
  // saving again can't change that: no Try again, only back to the form (Ruling 1D-12)
  expect(within(dialog).queryByRole("button", { name: /^(Try again|Save)/ })).not.toBeInTheDocument();
  expect(within(dialog).queryByRole("link")).not.toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Go back and edit" })).toHaveFocus();
});

test("offline, the review says the bill can't be saved yet, and Save waits for the internet", async () => {
  const user = fakeToday();
  const { calls } = formServer([["GET", "sales/412/", () => wireDetail()]]);
  mountForm("/sales/new?from=412");
  await screen.findByText("Copied from KGH/2026-27/31");
  await waitFor(() => expect(screen.getByLabelText("Bill number")).toHaveValue("34"));
  act(() => __setNetState("offline"));
  await user.keyboard("{Control>}s{/Control}");
  const dialog = await screen.findByRole("dialog", { name: "Check the bill before saving" });
  act(() => { vi.advanceTimersByTime(400); });
  expect(within(dialog).getAllByRole("alert")[0]).toHaveTextContent("You're offline: this bill can't be saved yet");
  expect(within(dialog).getAllByRole("alert")[0]).toHaveTextContent("It's kept on this device as an unfinished bill. Save it when the internet is back.");
  await user.click(within(dialog).getByRole("radio", { name: "Cash" }));
  expect(within(dialog).getByRole("button", { name: "Save bill" })).toBeDisabled();
  // nor does Ctrl S get past it
  await user.keyboard("{Control>}s{/Control}");
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(calls.some((c) => c.method === "POST")).toBe(false);
});

test("what the server refuses on a line comes back under that line: the review closes and the line's box takes the cursor", async () => {
  const user = fakeToday();
  const { dialog } = await review(user, [["POST", "sales/", () => refuse(400, { lines: { "1": { rate: ["Type the rate per piece."] } } })]]);
  await user.click(within(dialog).getByRole("radio", { name: "Cash" }));
  await user.click(within(dialog).getByRole("button", { name: "Save bill" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Check the bill before saving" })).not.toBeInTheDocument());
  expect(screen.getByText("Type the rate per piece.")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Line 2 rate per piece" })).toHaveFocus());
});

test("a date the server refuses comes back under the date in its words (a date before 2000: Ruling 1A-32): the review closes and the date box takes the cursor", async () => {
  const user = fakeToday();
  const { dialog } = await review(user, [["POST", "sales/", () => refuse(400, { invoice_date: ["Pick a date from 2000 to 2099."] })]]);
  await user.click(within(dialog).getByRole("radio", { name: "Cash" }));
  await user.click(within(dialog).getByRole("button", { name: "Save bill" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Check the bill before saving" })).not.toBeInTheDocument());
  const day = screen.getByLabelText("Date");
  await waitFor(() => expect(day).toHaveFocus());
  expect(day).toHaveAccessibleDescription("Pick a date from 2000 to 2099.");
});

test("a save that answers after the form was left keeps the bill and says so, without moving the page (part 0 carry)", async () => {
  const user = fakeToday();
  let release!: (v: unknown) => void;
  const { router, dialog } = await review(user, [["POST", "sales/", () => new Promise((r) => { release = r; })]]);
  await user.click(within(dialog).getByRole("radio", { name: "Cash" }));
  await user.click(within(dialog).getByRole("button", { name: "Save bill" }));
  expect(within(dialog).getByRole("button", { name: "Saving…" })).toBeInTheDocument();
  // leaving a new bill never asks, while it saves too (Ruling 1D-10)
  await act(async () => { await router.navigate("/sales"); });
  expect(screen.queryByRole("dialog", { name: "Leave without saving?" })).not.toBeInTheDocument();
  await waitFor(() => expect(where(router)).toBe("/sales"));
  await act(async () => { release(wireDetail({ id: 504, invoice_number: "KGH/2026-27/34" })); });
  expect(await screen.findByText("Saved KGH/2026-27/34")).toBeInTheDocument();
  expect(where(router)).toBe("/sales");
  expect(screen.queryByText("Bill kept as a draft")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Open" }));
  await waitFor(() => expect(where(router)).toBe("/sales/504"));
});


test("a month closed during save refreshes the date and removes the unfiled assurance", async () => {
  const user = fakeToday();
  let closed = false;
  const words = "October 2026 is filed and locked for KIRAN GOLD HOUSE, so no bill can go into it. Have the owner unlock October 2026 in GST returns first.";
  const { calls, dialog } = await review(user, [
    ["GET", "sales/", ({ params }) => ({ ...wirePage([]), ...(params.facets ? { facets: { ...wireFacets(), months: [{ month: "2026-10", bills: 1, locked: closed }] } } : {}) })],
    ["POST", "sales/", () => { closed = true; return refuse(409, { detail: words, code: "month_closed", locked_period: { id: 7, business: 3, year: 2026, month: 10 } }); }],
  ]);
  await user.click(within(dialog).getByRole("radio", { name: "Cash" }));
  await user.click(within(dialog).getByRole("button", { name: "Save bill" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(words);
  await user.click(within(dialog).getByRole("button", { name: "Go back and edit" }));
  await waitFor(() => expect(screen.getByLabelText("Date")).toHaveAttribute("aria-invalid", "true"));
  expect(screen.getByLabelText("Date")).toHaveAccessibleDescription(/is filed and locked/);
  expect(screen.getByRole("complementary", { name: "Bill summary" })).not.toHaveTextContent("isn't filed yet");
  expect(calls.filter((c) => c.url === "sales/" && c.params.facets)).toHaveLength(2);
});

test.each([false, true])("a filed month refusal stays on an edit's unchanged date when its refresh fails: %s", async (fails) => {
  const user = fakeToday();
  let closed = false;
  const words = "October 2026 is filed and locked for KIRAN GOLD HOUSE, so its bills can't be changed. Have the owner unlock October 2026 in GST returns first.";
  formServer([
    ["GET", "sales/412/", () => wireDetail()],
    ["GET", "sales/", ({ params }) => {
      if (params.facets && closed && fails) return refuse(503, {});
      return { ...wirePage([]), ...(params.facets ? { facets: { ...wireFacets(), months: [{ month: "2026-10", bills: 1, locked: closed }] } } : {}) };
    }],
    ["PUT", "sales/412/", () => { closed = true; return refuse(409, { detail: words, code: "month_closed", locked_period: { business: 3, year: 2026, month: 10 } }); }],
  ]);
  const { client } = mountForm("/sales/412/edit");
  await screen.findByRole("heading", { name: "Edit KGH/2026-27/31" });
  await user.click(screen.getByRole("radio", { name: "UPI / bank" }));
  await user.click(screen.getByRole("button", { name: "Check and save changes" }));
  const dialog = await screen.findByRole("dialog", { name: "Check the changes to KGH/2026-27/31" });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(words);
  await user.click(within(dialog).getByRole("button", { name: "Go back and edit" }));
  await settle();
  const day = screen.getByLabelText("Date");
  expect(day).toHaveAttribute("aria-invalid", "true");
  expect(day).toHaveAccessibleDescription(words);
  expect(screen.getByRole("complementary", { name: "Bill summary" })).not.toHaveTextContent("isn't filed yet");
  // Changing payment cannot correct a closed month; a fresh answer that the owner unlocked it can.
  await user.click(screen.getByRole("radio", { name: "Cash" }));
  expect(day).toHaveAccessibleDescription(words);
  closed = false;
  await act(async () => { await client.invalidateQueries({ queryKey: ["sales", "months"] }); });
  await settle();
  expect(day).not.toHaveAttribute("aria-invalid", "true");
});

test("a new bill keeps the filed month refusal when its refresh fails, until the date moves to an open month", async () => {
  const user = fakeToday();
  let closed = false;
  const words = "October 2026 is filed and locked for KIRAN GOLD HOUSE, so no bill can go into it. Have the owner unlock October 2026 in GST returns first.";
  const { dialog } = await review(user, [
    ["GET", "sales/", ({ params }) => {
      if (params.facets && closed) return refuse(503, {});
      return { ...wirePage([]), ...(params.facets ? { facets: { ...wireFacets(), months: [{ month: "2026-10", bills: 1, locked: false }, { month: "2026-09", bills: 1, locked: false }] } } : {}) };
    }],
    ["POST", "sales/", () => { closed = true; return refuse(409, { detail: words, code: "month_closed", locked_period: { business: 3, year: 2026, month: 10 } }); }],
  ]);
  await user.click(within(dialog).getByRole("radio", { name: "Cash" }));
  await user.click(within(dialog).getByRole("button", { name: "Save bill" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(words);
  await user.click(within(dialog).getByRole("button", { name: "Go back and edit" }));
  await settle();
  const day = screen.getByLabelText("Date");
  expect(day).toHaveAccessibleDescription(words);
  expect(screen.getByRole("complementary", { name: "Bill summary" })).not.toHaveTextContent("isn't filed yet");
  await user.clear(day);
  await user.type(day, "30/09/2026");
  await settle();
  expect(day).not.toHaveAttribute("aria-invalid", "true");
});

test.each(["number_taken", "number_deleted"])("a typed number keeps the %s refusal when its check refresh fails", async (code) => {
  const user = fakeToday();
  let refused = false;
  const words = "KGH/2026-27/36 can't be used. Choose another number.";
  const { calls } = formServer([
    ["GET", "sales/412/", () => wireDetail()],
    ["GET", "sales/check-number/", ({ params }) => {
      if (refused) return refuse(503, {});
      return { invoice_number: `KGH/2026-27/${params.invoice_number}`, counter: Number(params.invoice_number), code: "", problem: "", next: { counter: 37, invoice_number: "KGH/2026-27/37" } };
    }],
    ["POST", "sales/", () => { refused = true; return refuse(409, { detail: words, code, next: { counter: 37, invoice_number: "KGH/2026-27/37" } }); }],
  ]);
  const { client } = mountForm("/sales/new?from=412");
  await screen.findByText("Copied from KGH/2026-27/31");
  await user.clear(screen.getByLabelText("Bill number"));
  await user.type(screen.getByLabelText("Bill number"), "36");
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  await user.keyboard("{Control>}s{/Control}");
  const dialog = await screen.findByRole("dialog", { name: "Check the bill before saving" });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  await user.click(within(dialog).getByRole("radio", { name: "Cash" }));
  await user.click(within(dialog).getByRole("button", { name: "Save bill" }));
  await within(dialog).findByRole("alert");
  await user.click(within(dialog).getByRole("button", { name: "Change the number" }));
  await settle();
  const number = screen.getByLabelText("Bill number");
  expect(calls.filter((c) => c.url === "sales/check-number/")).toHaveLength(2);
  expect(number).toHaveAccessibleDescription(words);
  expect(number).toHaveAttribute("aria-invalid", "true");
  await user.click(screen.getByRole("radio", { name: "UPI / bank" }));
  expect(number).toHaveAccessibleDescription(words);
  // The fresh free answer supersedes the refusal without needing an unrelated edit.
  refused = false;
  await act(async () => { await client.invalidateQueries({ queryKey: ["sales", "check-number"] }); });
  await settle();
  expect(number).not.toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("complementary", { name: "Bill summary" })).toHaveTextContent("is free");
});

test("a refused suggestion can save the server's offered number when the next-number refresh fails", async () => {
  const user = fakeToday();
  let taken = false;
  const { calls, router, client, dialog } = await review(user, [
    ["GET", "sales/next-number/", ({ params }) => taken ? refuse(503, {}) : wireNext(Number(params.business_id), String(params.invoice_date))],
    ["POST", "sales/", () => {
      if (!taken) { taken = true; return refuse(409, { code: "number_taken", detail: "KGH/2026-27/34 is already used.", next: { counter: 35, invoice_number: "KGH/2026-27/35" } }); }
      return wireDetail({ id: 502, invoice_number: "KGH/2026-27/35" });
    }],
  ]);
  await user.click(within(dialog).getByRole("radio", { name: "Cash" }));
  await user.click(within(dialog).getByRole("button", { name: "Save bill" }));
  await within(dialog).findByRole("alert");
  await waitFor(() => expect(client.getQueryState(salesKeys.nextNumber(3, "2026-10-08"))?.status).toBe("error"));
  const retry = within(dialog).getByRole("button", { name: "Save as KGH/2026-27/35" });
  expect(retry).toBeEnabled();
  await user.click(retry);
  await waitFor(() => expect(where(router)).toBe("/sales/502?saved=new"));
  expect(posts(calls)).toEqual(["34", "KGH/2026-27/35"]);
});
