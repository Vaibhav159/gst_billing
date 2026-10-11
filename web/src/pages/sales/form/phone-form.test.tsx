import { act, screen, waitFor, within } from "@testing-library/react";
import { wireDetail } from "@/core/sales/fixtures";
import { formServer, fakeToday, mountForm } from "./testing";

// whole flows through the form, a step at a time: a busy runner takes longer than vitest's 5 s for one
vi.setConfig({ testTimeout: 20_000 });

const phone = (on: boolean) => { (window as unknown as { __phone?: boolean }).__phone = on; };
beforeEach(() => { phone(true); localStorage.clear(); });
afterEach(() => { phone(false); vi.useRealTimers(); });
const where = (router: { state: { location: { pathname: string; search: string } } }) => router.state.location.pathname + router.state.location.search;
/** Past a sheet's guard against the tap that opened it, and a search's debounce. */
const settle = () => act(async () => { vi.advanceTimersByTime(400); });

test("on a phone a bill is made with sheets: the customer list first, an item from the common products, the total in the action bar", async () => {
  const user = fakeToday();
  const { calls } = formServer();
  const { router } = mountForm("/sales/new");
  expect(await screen.findByRole("heading", { level: 1, name: "New bill" })).toBeInTheDocument();
  expect(screen.getByText("Kept as a draft once you start")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /Choose customer/ }));
  const sheet = await screen.findByRole("dialog", { name: "Customer" });
  await settle();
  // the list first (walk-in, then recent), not the keyboard
  await user.click(await within(sheet).findByRole("button", { name: /^Anil Gupta/ }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Customer" })).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: /^Anil Gupta/ })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Add item" }));
  const item = await screen.findByRole("dialog", { name: "Add item 1" });
  await settle();
  const chips = within(item).getByRole("group", { name: "Common products" });
  expect(within(chips).getAllByRole("button").map((b) => b.textContent)).toEqual(["Gold Ring", "Gold Necklace", "Cut Diamond"]);
  await user.click(within(chips).getByRole("button", { name: "Gold Ring" }));
  const weight = within(item).getByLabelText("Weight in grams");
  await waitFor(() => expect(weight).toHaveFocus());
  await user.keyboard("12.345{Enter}");
  expect(within(item).getByLabelText("Rate per gram")).toHaveFocus();
  await user.keyboard("6512.5");
  expect(within(item).getByText("Line total incl. GST").nextSibling).toHaveTextContent("₹82,808.71");
  await user.keyboard("{Enter}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add item 1" })).not.toBeInTheDocument());
  const card = screen.getByRole("button", { name: "Item 1: Gold Ring 22K. Edit" });
  expect(card).toHaveTextContent("12.345 gms × ₹6,512.50/gram");
  expect(card).toHaveTextContent("₹80,396.81");
  expect(screen.getByText("1 item · incl. GST")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Check and save" }));
  const review = await screen.findByRole("dialog", { name: "Check the bill" });
  await settle();
  await user.click(within(review).getByRole("radio", { name: "UPI / bank" }));
  await user.click(within(review).getByRole("button", { name: "Save bill" }));
  await waitFor(() => expect(where(router)).toBe("/sales/501?saved=new"));
  expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ customer: 7, payment_mode: "bank", lines: [{ product_name: "Gold Ring 22K", quantity: "12.345", rate: "6512.5" }] });
});

test("Check and save takes you to what's missing: the customer's sheet, then an item's own problems in its sheet", async () => {
  const user = fakeToday();
  formServer();
  mountForm("/sales/new");
  await screen.findByRole("heading", { level: 1, name: "New bill" });
  await user.click(screen.getByRole("button", { name: "Check and save" }));
  expect(await screen.findByRole("dialog", { name: "Customer" })).toBeInTheDocument();
  expect(screen.getByText("Choose who this bill is for. Pick Walk-in customer for a counter sale.")).toBeInTheDocument();
  await settle();
  await user.click(await within(screen.getByRole("dialog", { name: "Customer" })).findByRole("button", { name: /^Walk-in Customer/ }));
  // an item without its rate: Add to bill says what's missing, in the sheet, and goes there
  await user.click(screen.getByRole("button", { name: "Add item" }));
  const item = await screen.findByRole("dialog", { name: "Add item 1" });
  await settle();
  await user.click(within(item).getByRole("button", { name: "Gold Necklace" }));
  await user.keyboard("18.2");
  await user.click(within(item).getByRole("button", { name: "Add to bill" }));
  expect(within(item).getByText("Type the rate per gram.")).toBeInTheDocument();
  expect(within(item).getByLabelText("Rate per gram")).toHaveFocus();
});

test("changing a bill on a phone: the firm, number and date are one sheet, the number kept; Remove has Undo", async () => {
  const user = fakeToday();
  formServer([["GET", "sales/412/", () => wireDetail()]]);
  mountForm("/sales/412/edit");
  expect(await screen.findByRole("heading", { level: 1, name: "Edit KGH/2026-27/31" })).toBeInTheDocument();
  expect(screen.getByText("No changes yet")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /KIRAN GOLD HOUSE/ })).toHaveTextContent("No. KGH/2026-27/31 · 08 Oct 2026");
  await user.click(screen.getByRole("button", { name: /KIRAN GOLD HOUSE/ }));
  const info = await screen.findByRole("dialog", { name: "Firm, number and date" });
  await settle();
  expect(within(info).getByRole("radiogroup", { name: "Firm" })).toBeInTheDocument();
  expect(within(info).getByText("A bill keeps its number. Renumbering is for the owner, while the month is open.")).toBeInTheDocument();
  await user.click(within(info).getByRole("button", { name: "Done" }));
  await user.click(screen.getByRole("button", { name: "Remove item 2, Gold Pendant 22K" }));
  expect(screen.queryByRole("button", { name: /^Item 2/ })).not.toBeInTheDocument();
  expect(screen.getByText("Changes not saved yet")).toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: /^Undo/ }));
  expect(screen.getByRole("button", { name: "Item 2: Gold Pendant 22K. Edit" })).toBeInTheDocument();
});
