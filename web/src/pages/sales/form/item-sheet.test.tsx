import { tick } from "@/test/clock";
import { useState } from "react";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { refuse, wireDetail } from "@/core/sales/fixtures";
import { toBillDetail } from "@/core/sales/wire";
import { renderApp } from "@/test/render";
import { ItemSheet, type ItemSheetProps } from "./ItemSheet";
import { startEdit, startNew, type FormLine, type Start } from "./model";
import { toSaleProduct } from "./products";
import { DIAMOND, fakeToday, formServer, mountForm, NECKLACE, RING, TODAY } from "./testing";
import { useBillForm } from "./useBillForm";

vi.setConfig({ testTimeout: 20_000 });
beforeEach(() => { (window as unknown as { __phone: boolean }).__phone = true; localStorage.clear(); });
afterEach(() => { (window as unknown as { __phone: boolean }).__phone = false; vi.useRealTimers(); });
const products = [RING, NECKLACE, DIAMOND].map(toSaleProduct);
const newBill = () => startNew({ firmId: 3, firmSource: "scope", today: TODAY });
const editBill = () => startEdit(toBillDetail(wireDetail()));

function Harness({ start, edit = false, productsError, focusField }: { start: Start; edit?: boolean } & Pick<ItemSheetProps, "productsError" | "focusField">) {
  const F = useBillForm(start);
  const [open, setOpen] = useState(false);
  const [again, setAgain] = useState(0);
  return <>
    <button onClick={() => setOpen(true)}>Open item</button>
    <button onClick={F.openReview}>Check bill</button>
    <button onClick={() => { void F.save().then((r) => { if (r.refused) setOpen(true); }); }}>Try save</button>
    <output data-testid="lines">{JSON.stringify(F.filled)}</output>
    <ItemSheet F={F} open={open} lineKey={edit ? start.form.lines[0].key : null} products={productsError ? undefined : products} productsError={productsError} focusField={focusField}
      onClose={() => setOpen(false)} onAgain={() => setAgain((n) => n + 1)} onRemove={(key) => { F.removeLine(key); setOpen(false); }} again={again} />
  </>;
}
const savedLines = (): FormLine[] => JSON.parse(screen.getByTestId("lines").textContent || "[]") as FormLine[];
async function openItem(user: ReturnType<typeof fakeToday>, start = newBill(), edit = false) {
  renderApp(<Harness start={start} edit={edit} />);
  await user.click(screen.getByRole("button", { name: "Open item" }));
  const sheet = await screen.findByRole("dialog", { name: edit ? "Item 1" : "Add item 1" });
  await tick(400);
  return sheet;
}

test("Add and next item keeps the first item and opens the common list with empty fields for the next", async () => {
  const user = fakeToday();
  formServer();
  const sheet = await openItem(user);
  expect(within(sheet).getByRole("group", { name: "Common products" })).toBeInTheDocument();
  expect(within(sheet).getByLabelText("Search products")).not.toHaveFocus();
  await user.click(within(sheet).getByRole("button", { name: "Gold Ring 22K" }));
  await user.keyboard("2{Enter}6500");
  await user.click(within(sheet).getByRole("button", { name: "Add and next item" }));
  const next = await screen.findByRole("dialog", { name: "Add item 2" });
  expect(within(next).getByRole("group", { name: "Common products" }).parentElement).toHaveFocus();
  expect(savedLines()).toMatchObject([{ name: "Gold Ring 22K", qty: 2, rate: "6500" }]);
  await tick(400);
  await user.click(within(next).getByRole("button", { name: "Gold Necklace 22K" }));
  expect(within(next).getByLabelText("Weight in grams")).toHaveValue("");
  expect(within(next).getByLabelText("Rate per gram")).toHaveValue("");
  await user.keyboard("3{Enter}6100{Enter}");
  await tick(400);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(savedLines()).toMatchObject([{ name: "Gold Ring 22K", qty: 2 }, { name: "Gold Necklace 22K", qty: 3, rate: "6100" }]);
});

test("closing a typed item asks; Keep editing keeps its weight and Discard leaves the bill untouched", async () => {
  const user = fakeToday();
  formServer();
  const sheet = await openItem(user);
  await user.click(within(sheet).getByRole("button", { name: "Gold Ring 22K" }));
  await user.keyboard("4.5{Escape}");
  expect(within(sheet).getByRole("alert")).toHaveTextContent("Discard this item?");
  await user.click(within(sheet).getByRole("button", { name: "Keep editing" }));
  expect(within(sheet).getByLabelText("Weight in grams")).toHaveValue("4.500");
  await user.click(within(sheet).getByRole("button", { name: "Close" }));
  await user.click(within(sheet).getByRole("button", { name: "Discard" }));
  await tick(400);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(savedLines()).toEqual([]);
  await user.click(screen.getByRole("button", { name: "Open item" }));
  await tick(400);
  expect(screen.getByRole("group", { name: "Common products" })).toBeInTheDocument();
});

test("Save item replaces the edited line while keeping its key and saved-line identity", async () => {
  const user = fakeToday();
  formServer();
  const start = editBill();
  const first = start.form.lines[0];
  const sheet = await openItem(user, start, true);
  await user.clear(within(sheet).getByLabelText("Rate per gram"));
  await user.type(within(sheet).getByLabelText("Rate per gram"), "7000");
  await user.click(within(sheet).getByRole("button", { name: "Save item" }));
  await tick(400);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(savedLines()).toHaveLength(2);
  expect(savedLines()[0]).toEqual({ ...first, rate: "7000" });
  expect(savedLines()[1]).toEqual(start.form.lines[1]);
});

test("Change picks another product for the same saved line", async () => {
  const user = fakeToday();
  formServer();
  const start = editBill();
  const first = start.form.lines[0];
  const sheet = await openItem(user, start, true);
  await user.click(within(sheet).getByRole("button", { name: "Change" }));
  await user.click(within(sheet).getByRole("button", { name: "Gold Necklace 22K" }));
  await user.type(within(sheet).getByLabelText("Rate per gram"), "7000");
  await user.click(within(sheet).getByRole("button", { name: "Save item" }));
  await tick(400);
  expect(savedLines()[0]).toMatchObject({ key: first.key, savedId: first.savedId, name: "Gold Necklace 22K", qty: first.qty, rate: "7000" });
  expect(savedLines()).toHaveLength(2);
  expect(savedLines()[1]).toEqual(start.form.lines[1]);
});

test("a short HSN and unsupported GST slab stay repairable, with the fields kept through valid HSN digits and rate selection", async () => {
  const user = fakeToday();
  formServer();
  const start = editBill();
  start.form.lines[0] = { ...start.form.lines[0], hsn: "71", gst: "7" };
  const sheet = await openItem(user, start, true);
  const hsn = within(sheet).getByLabelText("HSN code");
  const gst = within(sheet).getByLabelText("GST rate");
  expect(gst).toHaveValue("");
  expect(within(sheet).getByText("Line total incl. GST").nextSibling).toHaveTextContent("₹80,396.81");
  expect(within(sheet).getByText("GST rate not chosen")).toBeInTheDocument();
  await user.click(within(sheet).getByRole("button", { name: "Save item" }));
  expect(hsn).toHaveFocus();
  expect(hsn).toHaveAccessibleDescription("Type the HSN code, 4 to 8 digits (7113 for jewellery).");
  await user.type(hsn, "1319");
  expect(hsn).toHaveValue("711319");
  await user.selectOptions(gst, "3");
  expect(within(sheet).getByText("Line total incl. GST").nextSibling).toHaveTextContent("₹82,808.71");
  expect(within(sheet).getByLabelText("HSN code")).toBe(hsn);
  expect(within(sheet).getByLabelText("GST rate")).toBe(gst);
  await user.click(hsn);
  await user.type(hsn, "00");
  expect(hsn).toHaveValue("71131900");
  await user.click(within(sheet).getByRole("button", { name: "Save item" }));
  await tick(400);
  expect(savedLines()[0]).toMatchObject({ hsn: "71131900", gst: "3", savedId: 901 });
});

test("local errors use the unit being edited instead of the saved line's old unit", async () => {
  const user = fakeToday();
  formServer();
  const start = editBill();
  start.tried = true;
  start.form.lines[0] = { ...start.form.lines[0], qty: null, rate: "" };
  const sheet = await openItem(user, start, true);
  await user.selectOptions(within(sheet).getByLabelText("Unit"), "pcs");
  expect(within(sheet).getByText("Type how many pieces.")).toBeInTheDocument();
  expect(within(sheet).getByText("Type the rate per piece.")).toBeInTheDocument();
  expect(within(sheet).queryByText("Type the weight in grams, like 12.345.")).not.toBeInTheDocument();
  expect(within(sheet).queryByText("Type the rate per gram.")).not.toBeInTheDocument();
});

test("saving a new product holds the sheet through Close and Esc, then puts the returned product on the item", async () => {
  const user = fakeToday();
  let answer = () => {};
  const { calls } = formServer([["POST", "catalog/", ({ body }) => new Promise((resolve) => {
    answer = () => resolve({ id: 12, ...(body as object) });
  })]]);
  const sheet = await openItem(user);
  await user.click(within(sheet).getByRole("button", { name: "An item that isn't in Products" }));
  await user.type(within(sheet).getByLabelText(/^Name/), "Silver idol");
  await user.type(within(sheet).getByLabelText(/^HSN code/), "7114");
  await user.selectOptions(within(sheet).getByLabelText(/^GST rate/), "3");
  await user.click(within(sheet).getByRole("button", { name: "Save and use on this bill" }));
  await waitFor(() => expect(within(sheet).getByRole("button", { name: "Saving…" })).toHaveAttribute("aria-disabled", "true"));
  expect(within(sheet).getByRole("button", { name: "Back" })).toBeDisabled();
  await user.keyboard("{Escape}");
  await user.click(within(sheet).getByRole("button", { name: "Close" }));
  expect(within(sheet).queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "An item that isn't in Products" })).toBeInTheDocument();
  await act(async () => { answer(); });
  await waitFor(() => expect(within(sheet).getByText("Silver idol")).toBeInTheDocument());
  expect(within(sheet).getByLabelText("Weight in grams")).toHaveFocus();
  await user.keyboard("10{Enter}100{Enter}");
  await tick(400);
  expect(savedLines()).toMatchObject([{ productId: 12, name: "Silver idol", hsn: "7114", gst: "3", qty: 10, rate: "100" }]);
  expect(calls.filter((c) => c.method === "POST" && c.url === "catalog/")).toHaveLength(1);
});

test("a save refusal shows each line field in its sheet, clearing each server error only when that field changes", async () => {
  const user = fakeToday();
  formServer([["PUT", "sales/412/", () => refuse(400, { lines: [{
    product_name: ["Use the printed item name."], hsn_code: ["Confirm this HSN."], gst_percent: ["Confirm this GST rate."],
    quantity: ["Confirm this weight."], rate: ["Confirm this rate."], note: ["Shorten this item note."],
  }] })]]);
  const start = editBill();
  start.form.notes = "Changed";
  renderApp(<Harness start={start} edit />);
  await tick(400);
  await user.click(screen.getByRole("button", { name: "Check bill" }));
  await user.click(screen.getByRole("button", { name: "Try save" }));
  const sheet = await screen.findByRole("dialog", { name: "Item 1" });
  await tick(400);
  expect(within(sheet).getByText("Use the printed item name.")).toBeInTheDocument();
  expect(within(sheet).getByLabelText("HSN code")).toHaveAccessibleDescription("Confirm this HSN.");
  expect(within(sheet).getByLabelText("GST rate")).toHaveAccessibleDescription("Confirm this GST rate.");
  expect(within(sheet).getByLabelText("Weight in grams")).toHaveAccessibleDescription("Confirm this weight.");
  expect(within(sheet).getByLabelText("Rate per gram")).toHaveAccessibleDescription("Confirm this rate.");
  expect(within(sheet).getByLabelText("Note on this item")).toHaveAccessibleDescription("Shorten this item note.");
  await user.type(within(sheet).getByLabelText("HSN code"), "00");
  expect(within(sheet).queryByText("Confirm this HSN.")).not.toBeInTheDocument();
  expect(within(sheet).getByText("Confirm this GST rate.")).toBeInTheDocument();
  await user.selectOptions(within(sheet).getByLabelText("GST rate"), "0.25");
  expect(within(sheet).queryByText("Confirm this GST rate.")).not.toBeInTheDocument();
  expect(within(sheet).getByLabelText("HSN code")).toHaveValue("71131900");
  await user.type(within(sheet).getByLabelText("Note on this item"), "Short note");
  expect(within(sheet).queryByText("Shorten this item note.")).not.toBeInTheDocument();
  expect(within(sheet).getByText("Confirm this rate.")).toBeInTheDocument();
  await user.click(within(sheet).getByRole("button", { name: "Change" }));
  await user.click(within(sheet).getByRole("button", { name: "Gold Necklace 22K" }));
  expect(within(sheet).queryByText("Use the printed item name.")).not.toBeInTheDocument();
});


test("reopening after Add to bill never focuses the previous weight and Close returns to Add another item", async () => {
  const user = fakeToday();
  formServer();
  mountForm("/sales/new");
  await screen.findByRole("heading", { level: 1, name: "New bill" });
  await tick(400);
  await user.click(screen.getByRole("button", { name: "Add item" }));
  let sheet = await screen.findByRole("dialog", { name: "Add item 1" });
  await tick(400);
  await user.click(within(sheet).getByRole("button", { name: "Gold Ring 22K" }));
  await user.keyboard("2{Enter}6500{Enter}");
  await tick(400);
  const opener = screen.getByRole("button", { name: "Add another item" });
  const focused: string[] = [];
  const record = (e: FocusEvent) => focused.push((e.target as Element).id);
  document.addEventListener("focusin", record);
  try {
    await user.click(opener);
    sheet = await screen.findByRole("dialog", { name: "Add item 2" });
    await tick(400);
  } finally {
    document.removeEventListener("focusin", record);
  }
  expect.soft(focused).not.toContain("is-qty");
  expect(within(sheet).getByRole("group", { name: "Common products" }).parentElement).toHaveFocus();
  await user.click(within(sheet).getByRole("button", { name: "Close" }));
  await tick(400);
  expect(opener).toHaveFocus();
});

test("a failed product list says it could not load and keeps adding by hand available", async () => {
  const user = fakeToday();
  formServer();
  renderApp(<Harness start={newBill()} productsError />);
  await user.click(screen.getByRole("button", { name: "Open item" }));
  const sheet = await screen.findByRole("dialog", { name: "Add item 1" });
  await tick(400);
  expect(within(sheet).getByText("Products couldn't load: add the item by hand")).toBeInTheDocument();
  await user.type(within(sheet).getByLabelText("Search products"), "silver");
  expect(within(sheet).queryByText("Products are still loading.")).not.toBeInTheDocument();
  await user.click(within(sheet).getByRole("button", { name: "“silver” isn't in Products" }));
  expect(within(sheet).getByLabelText(/^Name/)).toHaveValue("silver");
});

test.each(["product", "hsn", "gst", "qty", "rate", "note"] as const)("an item opened for its %s problem focuses that field immediately and keeps it after the guard", async (focusField) => {
  const user = fakeToday();
  formServer();
  const start = editBill();
  start.form.lines[0] = { ...start.form.lines[0], hsn: "71", gst: "7" };
  renderApp(<Harness start={start} edit focusField={focusField} />);
  await user.click(screen.getByRole("button", { name: "Open item" }));
  await screen.findByRole("dialog", { name: "Item 1" });
  expect(document.getElementById(`is-${focusField}`)).toHaveFocus();
  await tick(400);
  expect(document.getElementById(`is-${focusField}`)).toHaveFocus();
});

test("Add and next item swallows a second tap on the new product list until its 350 ms guard passes", async () => {
  const user = fakeToday();
  formServer();
  const sheet = await openItem(user);
  await user.click(within(sheet).getByRole("button", { name: "Gold Ring 22K" }));
  await user.keyboard("2{Enter}6500");
  fireEvent.click(within(sheet).getByRole("button", { name: "Add and next item" }));
  const next = screen.getByRole("dialog", { name: "Add item 2" });
  const byHand = within(next).getByRole("button", { name: "An item that isn't in Products" });
  fireEvent.click(byHand);
  expect(screen.getByRole("dialog", { name: "Add item 2" })).toBeInTheDocument();
  act(() => { vi.advanceTimersByTime(349); });
  fireEvent.click(byHand);
  expect(screen.getByRole("dialog", { name: "Add item 2" })).toBeInTheDocument();
  act(() => { vi.advanceTimersByTime(1); });
  fireEvent.click(byHand);
  expect(screen.getByRole("dialog", { name: "An item that isn't in Products" })).toBeInTheDocument();
  expect(savedLines()).toHaveLength(1);
});
