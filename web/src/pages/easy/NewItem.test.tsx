import { act, fireEvent, screen, within } from "@testing-library/react";
import { renderApp } from "@/test/render";
import { handClock, tick } from "@/test/clock";
import { toSaleProduct } from "@/pages/sales/form/products";
import { NewItemSheet, type NewItemSheetProps } from "./NewItem";

beforeEach(() => { handClock(); (window as unknown as { __phone: boolean }).__phone = true; });
afterEach(async () => { await tick(); vi.useRealTimers(); (window as unknown as { __phone: boolean }).__phone = false; });

async function open(overrides: Partial<NewItemSheetProps> = {}) {
  const props: NewItemSheetProps = { open: true, onClose: vi.fn(), products: [], canKeep: true, onAdd: vi.fn(), onUseExisting: vi.fn(), ...overrides };
  renderApp(<NewItemSheet {...props} />, { path: "/e/new/items" });
  await tick(400);
  return props;
}
const name = (value: string) => fireEvent.change(screen.getByLabelText("What is it called?"), { target: { value } });
const pick = (label: string) => fireEvent.click(screen.getByRole("button", { name: label }));
const category = (label: string) => fireEvent.click(screen.getByRole("radio", { name: new RegExp(`^${label}`) }));
const add = async () => { await act(async () => { pick("Add to the bill"); }); };

test("missing answers are explained and the first field takes focus", async () => {
  const p = await open();
  await add();
  expect(screen.getByLabelText("What is it called?")).toHaveFocus();
  expect(screen.getByText("Type what it's called, as it should print on the bill.")).toBeInTheDocument();
  expect(screen.getByText("Pick what it's made of.")).toBeInTheDocument();
  expect(p.onAdd).not.toHaveBeenCalled();
});

test("gold categories exclude loose diamonds and switching material clears an incompatible category", async () => {
  await open();
  name("Gold kada"); pick("Diamond"); category("Loose diamonds"); pick("Gold 22K");
  expect(screen.getAllByRole("radio")).toHaveLength(3);
  expect(screen.queryByRole("radio", { name: /^Loose diamonds/ })).not.toBeInTheDocument();
  await add();
  expect(screen.getByText("Pick what kind of item it is. It sets the GST code and rate on the bill.")).toBeInTheDocument();
  category("Jewellery");
  expect(screen.getByText(/On the bill:/)).toHaveTextContent("Gold kada 22K · HSN 7113 · GST 3% · weighed in grams");
});

test("a custom gold item keeps its purity once, starts with no weight or rate and is not retained by default", async () => {
  const p = await open();
  name("  Gold   kada 22K  "); pick("Gold 22K"); category("Jewellery");
  expect(screen.getByLabelText(/^Also keep it in the item list/)).not.toBeChecked();
  await add();
  expect(p.onAdd).toHaveBeenCalledWith(expect.objectContaining({ kind: "gold", purity: "22K", keep: false,
    line: expect.objectContaining({ name: "Gold kada 22K", hsn: "7113", gst: "3", unit: "gms", qty: null, rate: "", productId: null, custom: true }) }));
  expect(screen.queryByLabelText(/Rate|Making/)).not.toBeInTheDocument();
});

test("loose diamonds use the shared diamond kind, carats and the quarter-percent slab", async () => {
  const p = await open({ canKeep: false });
  name("Loose diamond"); pick("Diamond"); category("Loose diamonds");
  expect(screen.queryByLabelText(/^Also keep it in the item list/)).not.toBeInTheDocument();
  expect(screen.getByText("Used on this bill only. The owner adds products to the list.")).toBeInTheDocument();
  await add();
  expect(p.onAdd).toHaveBeenCalledWith(expect.objectContaining({ kind: "diamond", keep: false,
    line: expect.objectContaining({ gst: "0.25", hsn: "7102", unit: "ct", rate: "" }) }));
});

test("a name already in Products offers that product instead and does not create another", async () => {
  const product = toSaleProduct({ id: 7, name: "Gold kada 22K", hsn_code: "7113", gst_tax_rate: "0.03", default_unit: "gms" });
  const p = await open({ products: [product] });
  name("gold kada"); pick("Gold 22K"); category("Jewellery"); await add();
  expect(screen.getByText("Gold kada 22K is already in your items.")).toBeInTheDocument();
  pick("Use it instead");
  expect(p.onUseExisting).toHaveBeenCalledWith(product);
  expect(p.onAdd).not.toHaveBeenCalled();
});

test("a failed retained-item save keeps its answers and retries only when asked", async () => {
  const onAdd = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(undefined);
  await open({ onAdd });
  name("Silver gift"); pick("Silver"); category("Utensils and gifts");
  fireEvent.click(screen.getByLabelText(/^Also keep it in the item list/));
  await add();
  expect(screen.getByRole("alert")).toHaveTextContent("Not added yet: the app couldn't get through.");
  expect(screen.getByLabelText("What is it called?")).toHaveValue("Silver gift");
  expect(screen.getByLabelText(/^Also keep it in the item list/)).toBeChecked();
  expect(onAdd).toHaveBeenCalledTimes(1);
  await act(async () => { pick("Try adding again"); });
  expect(onAdd).toHaveBeenCalledTimes(2);
  expect(onAdd.mock.calls[1][0]).toMatchObject({ kind: "silver", keep: true, line: { hsn: "7114", gst: "3", rate: "" } });
});

test("the sheet waits for its pending add and cannot submit twice or close", async () => {
  let finish = () => {};
  const onAdd = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  const p = await open({ onAdd });
  name("Gold coin"); pick("Gold 24K"); category("Coins"); await add();
  const pending = screen.getByRole("button", { name: "Adding…" });
  expect(pending).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("button", { name: "Go back" })).toBeDisabled();
  fireEvent.click(pending); pick("Go back"); pick("Close"); fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(p.onClose).not.toHaveBeenCalled();
  expect(onAdd).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
});

test.each(["Close", "Escape", "Go back"])("%s asks before discarding a typed item and Keep editing retains its answers", async (exit) => {
  const p = await open();
  name("Gold kada"); pick("Gold 22K"); category("Jewellery");
  fireEvent.click(screen.getByLabelText(/^Also keep it in the item list/));
  const close = () => exit === "Escape" ? fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }) : pick(exit);
  await act(async () => { close(); });
  expect(p.onClose).not.toHaveBeenCalled();
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("alert")).toHaveTextContent("Discard this item?");
  await act(async () => { pick("Keep editing"); });
  expect(screen.getByLabelText("What is it called?")).toHaveValue("Gold kada");
  expect(screen.getByRole("radio", { name: /^Jewellery/ })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByText(/On the bill:/)).toHaveTextContent("Gold kada 22K · HSN 7113 · GST 3% · weighed in grams");
  expect(screen.getByLabelText(/^Also keep it in the item list/)).toBeChecked();
  expect(p.onClose).not.toHaveBeenCalled();
  await act(async () => { close(); });
  await act(async () => { pick("Discard"); });
  expect(p.onClose).toHaveBeenCalledOnce();
});

test("Go back closes an untouched item without asking to discard", async () => {
  const p = await open();
  pick("Go back");
  expect(p.onClose).toHaveBeenCalledOnce();
  expect(screen.queryByText("Discard this item?")).not.toBeInTheDocument();
});

test("category arrows move the radio selection and Something else uses the imitation slab", async () => {
  const p = await open();
  name("Imitation chain"); pick("Something else");
  const radios = screen.getAllByRole("radio");
  fireEvent.keyDown(radios[0], { key: "ArrowDown" });
  expect(radios[0]).toHaveAttribute("aria-checked", "true");
  expect(radios[0]).toHaveFocus();
  fireEvent.keyDown(radios[0], { key: "ArrowDown" });
  expect(radios[1]).toHaveAttribute("aria-checked", "true");
  expect(radios[1]).toHaveFocus();
  await add();
  expect(p.onAdd).toHaveBeenCalledWith(expect.objectContaining({ kind: "other", purity: "", line: expect.objectContaining({ hsn: "7117", gst: "3", unit: "gms" }) }));
});
