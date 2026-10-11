import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { __resetDrafts } from "@/core/api/drafts";
import { __resetDeviceDrafts, keptDrafts } from "@/core/deviceDrafts";
import { refuse, wireDetail, type Route } from "@/core/sales/fixtures";
import { ANIL, asksOnClose, BIG, fakeToday, formServer, mountForm, wireNext } from "./testing";
import { SAVE_WAITS } from "./useDraftKeeping";

vi.setConfig({ testTimeout: 20_000 });
const phone = (on: boolean) => { (window as unknown as { __phone?: boolean }).__phone = on; };
beforeEach(() => { phone(true); localStorage.clear(); __resetDrafts(); __resetDeviceDrafts(); });
afterEach(() => { cleanup(); phone(false); vi.useRealTimers(); vi.restoreAllMocks(); });
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(400); });
const where = (router: { state: { location: { pathname: string; search: string } } }) => router.state.location.pathname + router.state.location.search;
const copyRoute: Route = ["GET", "sales/412/", () => wireDetail()];
async function reviewCopy(user: ReturnType<typeof fakeToday>) {
  await screen.findByRole("heading", { level: 1, name: "New bill" });
  await settle();
  await user.click(screen.getByRole("radio", { name: "UPI / bank" }));
  await user.click(screen.getByRole("button", { name: "Check and save" }));
  const review = await screen.findByRole("dialog", { name: "Check the bill" });
  await settle();
  return review;
}
async function menu(user: ReturnType<typeof fakeToday>, label: string) {
  await user.click(screen.getByRole("button", { name: "More for this bill" }));
  const sheet = await screen.findByRole("dialog", { name: "Bill" });
  await settle();
  await user.click(within(sheet).getByRole("menuitem", { name: new RegExp(`^${label}`) }));
}

test("a typed-number collision opens its phone sheet before moving focus to the number", async () => {
  const user = fakeToday();
  formServer([copyRoute, ["POST", "sales/", () => refuse(409, { code: "number_taken", detail: "The number was just used.", next: { counter: 36, invoice_number: "KGH/2026-27/36" } })]]);
  mountForm("/sales/new?from=412");
  await screen.findByRole("heading", { level: 1, name: "New bill" });
  await user.click(screen.getByRole("button", { name: /KIRAN GOLD HOUSE/ }));
  let info = await screen.findByRole("dialog", { name: "Firm, number and date" });
  await settle();
  await user.clear(within(info).getByLabelText("Bill number"));
  await user.type(within(info).getByLabelText("Bill number"), "35");
  await user.click(within(info).getByRole("button", { name: "Done" }));
  await settle();
  const review = await reviewCopy(user);
  await act(async () => {
    fireEvent.click(within(review).getByRole("button", { name: "Save bill" }));
    await vi.advanceTimersByTimeAsync(100);
  });
  await user.click(await within(review).findByRole("button", { name: "Change the number" }));
  info = await screen.findByRole("dialog", { name: "Firm, number and date" });
  expect(within(info).getByLabelText("Bill number")).toHaveFocus();
  await settle();
  expect(within(info).getByLabelText("Bill number")).toHaveFocus();
  expect(screen.queryByRole("dialog", { name: "Check the bill" })).not.toBeInTheDocument();
});

test("the phone review says when Save waits for the draft's last change", async () => {
  const user = fakeToday();
  let answer = () => {};
  const { calls } = formServer([copyRoute, ["PUT", /^drafts\//, ({ url, body }) => new Promise((ok) => {
    answer = () => ok({ id: url.split("/")[1], ...(body as object), started_by: { id: 1, name: "Owner" }, created_at: "2026-10-08T10:00:00+05:30", updated_at: "2026-10-08T10:00:00+05:30" });
  })]]);
  const { router } = mountForm("/sales/new?from=412");
  await screen.findByRole("heading", { level: 1, name: "New bill" });
  await user.type(screen.getByLabelText("Note on the bill"), "For Meena");
  await act(async () => { await vi.advanceTimersByTimeAsync(1300); });
  await waitFor(() => expect(calls.some((c) => c.method === "PUT")).toBe(true));
  const review = await reviewCopy(user);
  await user.click(within(review).getByRole("button", { name: "Save bill" }));
  expect(await within(review).findByText(SAVE_WAITS)).toBeInTheDocument();
  expect(calls.some((c) => c.method === "POST")).toBe(false);
  await act(async () => { answer(); });
  await waitFor(() => expect(where(router)).toBe("/sales/501?saved=new"));
  expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ notes: "For Meena" });
});

test.each([false, true])("closing a new phone bill keeps the pending note at once; refused storage prompts only on tab close (%s)", async (storageRefused) => {
  const user = fakeToday();
  if (storageRefused) vi.spyOn(Object.getPrototypeOf(localStorage) as Storage, "setItem").mockImplementation(() => { throw new DOMException("Storage refused", "QuotaExceededError"); });
  const { calls } = formServer([["PUT", /^drafts\//, () => new Promise(() => {})]]);
  const { router } = mountForm("/sales/new");
  await screen.findByRole("heading", { level: 1, name: "New bill" });
  // Close through the menu before the 1.2 s keep has fired.
  await user.type(screen.getByLabelText("Note on the bill"), "Meena");
  expect(asksOnClose()).toBe(storageRefused);
  await menu(user, "Close");
  await settle();
  expect(where(router)).toBe("/sales");
  expect(screen.queryByRole("dialog", { name: "Leave without saving?" })).not.toBeInTheDocument();
  expect(keptDrafts().map((d) => d.data.notes)).toEqual(["Meena"]);
  expect(calls.find((c) => c.method === "PUT")?.body).toMatchObject({ data: { notes: "Meena" } });
});

test("an unchanged phone edit cannot save, a changed edit asks to leave, and reverting clears both guards", async () => {
  const user = fakeToday();
  const { calls } = formServer([["GET", "sales/412/", () => wireDetail({ total_amount: "87083.22" })]]);
  const { router } = mountForm("/sales/412/edit");
  await screen.findByRole("heading", { level: 1, name: "Edit KGH/2026-27/31" });
  expect(screen.getByText("No changes yet")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Check and save changes" }));
  const review = await screen.findByRole("dialog", { name: "Check the changes to KGH/2026-27/31" });
  await settle();
  expect(within(review).getByRole("button", { name: "Save changes" })).toBeDisabled();
  await user.keyboard("{Control>}s{/Control}");
  expect(calls.some((c) => c.method === "PUT")).toBe(false);
  await user.click(within(review).getByRole("button", { name: "Go back and edit" }));
  await settle();
  await user.click(screen.getByRole("radio", { name: "UPI / bank" }));
  expect(asksOnClose()).toBe(true);
  await menu(user, "Stop editing");
  const ask = await screen.findByRole("dialog", { name: "Leave without saving?" });
  await settle();
  await user.click(within(ask).getByRole("button", { name: "Stay" }));
  await settle();
  await user.click(screen.getByRole("radio", { name: "Cash" }));
  expect(screen.getByText("No changes yet")).toBeInTheDocument();
  expect(asksOnClose()).toBe(false);
  await menu(user, "Stop editing");
  await waitFor(() => expect(where(router)).toBe("/sales/412"));
});

test("a final refusal on the phone offers the saved bill, with no Try again", async () => {
  const user = fakeToday();
  formServer([copyRoute, ["POST", "sales/", () => refuse(409, { code: "draft_saved", detail: "This unfinished bill was saved already.", bill: { id: 412, invoice_number: "KGH/2026-27/31", invoice_date: "2026-10-08", customer_name: "Anil Gupta", status: "active" } })]]);
  mountForm("/sales/new?from=412");
  const review = await reviewCopy(user);
  await user.click(within(review).getByRole("button", { name: "Save bill" }));
  expect(await within(review).findByRole("link", { name: "Open KGH/2026-27/31" })).toHaveAttribute("href", "/sales/412");
  expect(within(review).queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
});

test("a PAN fixed from the phone review keeps focus in it and holds Save for the fresh number", async () => {
  const user = fakeToday();
  let held: Promise<void> | null = null;
  let land = () => {};
  const { calls } = formServer([
    ["GET", "sales/412/", () => wireDetail({ lines: BIG })],
    ["GET", "sales/next-number/", async ({ params }) => { await held; return wireNext(Number(params.business_id), String(params.invoice_date)); }],
    ["PATCH", "customers/7/", () => ({ ...ANIL, pan_number: "ABCPG1234K", pan: "ABCPG1234K" })],
  ]);
  mountForm("/sales/new?from=412");
  const review = await reviewCopy(user);
  held = new Promise<void>((r) => { land = r; });
  await user.click(within(review).getByRole("button", { name: "Add PAN" }));
  const pan = await screen.findByRole("dialog", { name: "Anil Gupta's PAN" });
  await settle();
  await user.type(within(pan).getByRole("textbox"), "ABCPG1234K{Enter}");
  await settle();
  expect(screen.queryByRole("dialog", { name: "Anil Gupta's PAN" })).not.toBeInTheDocument();
  expect(review).toContainElement(document.activeElement as HTMLElement);
  expect(within(review).getByRole("button", { name: "Save bill" })).toBeDisabled();
  expect(review).toHaveTextContent("Getting the next number");
  await user.keyboard("{Control>}s{/Control}");
  expect(calls.some((c) => c.method === "POST")).toBe(false);
  await act(async () => { land(); });
  await waitFor(() => expect(within(review).getByRole("button", { name: "Save bill" })).toBeEnabled());
});

test("a line refused by the server opens its own phone sheet and shows the server's words beside its field", async () => {
  const user = fakeToday();
  const words = "Check this item's rate against the paper bill.";
  formServer([copyRoute, ["POST", "sales/", () => refuse(400, { lines: [{ rate: [words] }, {}] })]]);
  mountForm("/sales/new?from=412");
  const review = await reviewCopy(user);
  await act(async () => {
    fireEvent.click(within(review).getByRole("button", { name: "Save bill" }));
    await vi.advanceTimersByTimeAsync(400);
  });
  const item = await screen.findByRole("dialog", { name: "Item 1" });
  await settle();
  expect(within(item).getByText(words)).toBeInTheDocument();
  const rate = within(item).getByLabelText("Rate per gram");
  expect(rate).toHaveAttribute("aria-invalid", "true");
  expect(rate).toHaveFocus();
  await user.clear(rate);
  await user.type(rate, "6500");
  expect(within(item).queryByText(words)).not.toBeInTheDocument();
  await user.click(within(item).getByRole("button", { name: "Save item" }));
  await settle();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
