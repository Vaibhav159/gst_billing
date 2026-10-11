import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { __resetDrafts } from "@/core/api/drafts";
import { __resetDeviceDrafts } from "@/core/deviceDrafts";
import { refuse, wireDetail, WIRE_LINES } from "@/core/sales/fixtures";
import { fakeToday, formServer, mountForm } from "./testing";

vi.setConfig({ testTimeout: 20_000 });
beforeEach(() => {
  (window as unknown as { __phone: boolean }).__phone = true;
  localStorage.clear(); __resetDrafts(); __resetDeviceDrafts();
});
afterEach(() => { cleanup(); (window as unknown as { __phone: boolean }).__phone = false; vi.useRealTimers(); });
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(400); });
async function copiedBill(over: Record<string, unknown> = {}) {
  const user = fakeToday();
  const server = formServer([["GET", "sales/412/", () => wireDetail(over)]]);
  const view = mountForm("/sales/new?from=412");
  await screen.findByRole("heading", { level: 1, name: "New bill" });
  await settle();
  return { user, ...server, ...view };
}

test("a failed phone product list says to add the item by hand, including before a search", async () => {
  const user = fakeToday();
  formServer([["GET", "products/", () => refuse(503, { detail: "Products are unavailable." })]]);
  mountForm("/sales/new");
  await screen.findByRole("heading", { level: 1, name: "New bill" });
  await settle();
  await user.click(screen.getByRole("button", { name: "Add item" }));
  const sheet = await screen.findByRole("dialog", { name: "Add item 1" });
  await settle();
  expect(within(sheet).getByText("Products couldn't load: add the item by hand")).toBeInTheDocument();
  await user.type(within(sheet).getByLabelText("Search products"), "ring");
  expect(within(sheet).getByText("Products couldn't load: add the item by hand")).toBeInTheDocument();
  expect(within(sheet).queryByText("Products are still loading.")).not.toBeInTheDocument();
  await user.click(within(sheet).getByRole("button", { name: "“ring” isn't in Products" }));
  expect(screen.getByRole("dialog", { name: "An item that isn't in Products" })).toBeInTheDocument();
});

test("Remove on a phone card focuses the next card, or Add another item after the last card", async () => {
  const { user } = await copiedBill();
  await user.click(screen.getByRole("button", { name: "Remove item 1, Gold Ring 22K" }));
  expect(screen.getByRole("button", { name: "Item 1: Gold Pendant 22K. Edit" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: /^Undo/ }));
  await user.click(screen.getByRole("button", { name: "Remove item 2, Gold Pendant 22K" }));
  expect(screen.getByRole("button", { name: "Add another item" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Remove item 1, Gold Ring 22K" }));
  expect(screen.getByRole("button", { name: "Add item" })).toHaveFocus();
});

test("an unsupported stored GST rate reads as not set on the phone card and in its sheet", async () => {
  const { user } = await copiedBill({ lines: [{ ...WIRE_LINES[0], gst_percent: "7" }] });
  const card = screen.getByRole("button", { name: "Item 1: Gold Ring 22K. Edit" });
  expect(card).toHaveTextContent("GST not set");
  expect(card).not.toHaveTextContent("GST 7%");
  await user.click(card);
  await settle();
  expect(screen.getByRole("dialog", { name: "Item 1" })).toHaveTextContent("GST not set");
});

test.each([
  ["Bill number", "A B"], ["Date", "not a date"],
])("Check and save focuses the refused %s in its phone sheet, and keeps focus there", async (label, value) => {
  const { user } = await copiedBill();
  await user.click(screen.getByRole("button", { name: /KIRAN GOLD HOUSE/ }));
  const info = screen.getByRole("dialog", { name: "Firm, number and date" });
  await settle();
  if (label === "Date") {
    // A missing date cannot look up an automatic number. Keep a typed number so Date is the first problem.
    await user.clear(within(info).getByLabelText("Bill number"));
    await user.type(within(info).getByLabelText("Bill number"), "40");
  }
  const box = within(info).getByLabelText(label);
  await user.clear(box);
  await user.type(box, value);
  await user.click(within(info).getByRole("button", { name: "Done" }));
  await settle();
  await user.click(screen.getByRole("button", { name: "Check and save" }));
  const reopened = screen.getByRole("dialog", { name: "Firm, number and date" });
  expect(within(reopened).getByLabelText(label)).toHaveFocus();
  await settle();
  expect(within(reopened).getByLabelText(label)).toHaveFocus();
});

test.each([
  ["hsn_code", "7", "HSN code"], ["gst_percent", "7", "GST rate"],
  ["quantity", "0", "Weight in grams"], ["rate", "0", "Rate per gram"],
])("Check and save focuses the first line problem: %s", async (field, value, label) => {
  const { user } = await copiedBill({ lines: [{ ...WIRE_LINES[0], [field]: value }] });
  await user.click(screen.getByRole("button", { name: "Check and save" }));
  const sheet = screen.getByRole("dialog", { name: "Item 1" });
  expect(within(sheet).getByLabelText(label)).toHaveFocus();
  await settle();
  expect(within(sheet).getByLabelText(label)).toHaveFocus();
});

test.each(["Control", "Meta"])("%s S opens the phone review without saving on its opening press", async (modifier) => {
  const { user, calls } = await copiedBill();
  await user.click(screen.getByRole("radio", { name: "UPI / bank" }));
  await user.keyboard(`{${modifier}>}s{/${modifier}}`);
  const review = screen.getByRole("dialog", { name: "Check the bill" });
  fireEvent.keyDown(window, { key: "s", ctrlKey: modifier === "Control", metaKey: modifier === "Meta" });
  expect(calls.some((c) => c.method === "POST")).toBe(false);
  await settle();
  expect(review).toBeInTheDocument();
  await user.keyboard(`{${modifier}>}s{/${modifier}}`);
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
});

test("Ctrl S behind a phone sheet or menu stays there and still takes the browser shortcut", async () => {
  const { user, calls } = await copiedBill();
  await user.click(screen.getByRole("button", { name: "Add another item" }));
  await settle();
  expect(fireEvent.keyDown(window, { key: "s", ctrlKey: true })).toBe(false);
  expect(screen.getByRole("dialog", { name: "Add item 3" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "Check the bill" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Close" }));
  await settle();
  await user.click(screen.getByRole("button", { name: "More for this bill" }));
  await settle();
  expect(fireEvent.keyDown(window, { key: "s", metaKey: true })).toBe(false);
  expect(screen.getByRole("dialog", { name: "Bill" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "Check the bill" })).not.toBeInTheDocument();
  expect(calls.some((c) => c.method === "POST")).toBe(false);
});
