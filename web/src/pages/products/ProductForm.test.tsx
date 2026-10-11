import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { mount, VIEWER } from "@/pages/customers/testing";
import { PRODUCT_DETAIL, recordsServer } from "@/test/records";
import ProductForm from "./ProductForm";

const routes = [{ path: "/products/new", element: <ProductForm /> }, { path: "/products/:id/edit", element: <ProductForm /> }, { path: "/products", element: <p>Product list after saving</p> }, { path: "/products/:id", element: <p>Product after saving</p> }];
const box = (name: string) => screen.getByRole("textbox", { name: name === "Name" ? "Name · required" : name });
const choose = (code: string) => { const h = screen.getByRole("combobox", { name: "HSN code · required" }); fireEvent.change(h, { target: { value: code } }); fireEvent.keyDown(h, { key: "Enter" }); };
beforeEach(() => { (window as unknown as { __phone: boolean }).__phone = false; });
test("HSN and GST have no default, failed save focuses the first problem, Enter picks a diamond without submitting", async () => {
  const calls = recordsServer(); mount(routes, ["/products/new"]);
  fireEvent.click(screen.getAllByRole("button", { name: "Save product" })[0]);
  expect(box("Name")).toHaveFocus();
  expect(screen.getByRole("combobox", { name: "GST rate · required" })).toHaveValue("");
  fireEvent.change(box("Name"), { target: { value: "Diamond pendant" } });
  choose("7102");
  expect(screen.getByRole("combobox", { name: "GST rate · required" })).toHaveValue("0.25");
  expect(screen.getByRole("combobox", { name: "Kind" })).toHaveValue("");
  expect(screen.getByRole("option", { name: "Automatic: Diamond" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "VVS" })).toBeInTheDocument();
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
});
test("mismatched slab only warns; save keeps a three-decimal usual rate and Bought only in the contract body", async () => {
  const calls = recordsServer({ "POST catalog/": { ...PRODUCT_DETAIL, id: 50 } }); mount(routes, ["/products/new"]);
  fireEvent.change(box("Name"), { target: { value: "  Diamond   pendant " } }); choose("7102");
  fireEvent.change(screen.getByRole("combobox", { name: "GST rate · required" }), { target: { value: "3" } });
  expect(screen.getByText("Cut and polished diamonds (HSN 7102) are taxed at 0.25%. Check the rate.")).toBeInTheDocument();
  fireEvent.change(box("Usual rate · per g"), { target: { value: "6470.125" } });
  fireEvent.click(screen.getByRole("switch", { name: "Bought only, never sold" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Save product" })[0]);
  expect(await screen.findByText("Product list after saving")).toBeInTheDocument();
  expect(calls.find((c) => c.method === "POST")?.data).toEqual({ name: "Diamond pendant", hsn_code: "7102", gst_percent: "3", unit: "gms", kind: null, purity: "", usual_rate: "6470.125", purchase_only: true, description: "" });
});
test("server field refusal keeps all values and puts the message beside the field", async () => {
  recordsServer({ "POST catalog/": () => ({ status: 400, data: { name: ["There's already a product called Necklace. Use a different name."] } }) });
  mount(routes, ["/products/new"]); fireEvent.change(box("Name"), { target: { value: "Necklace" } }); choose("7113");
  fireEvent.click(screen.getAllByRole("button", { name: "Save product" })[0]);
  await waitFor(() => expect(box("Name")).toHaveAttribute("aria-invalid", "true"));
  expect(box("Name")).toHaveValue("Necklace");
  expect(screen.getByRole("combobox", { name: "GST rate · required" })).toHaveValue("3");
});
test("an older off-slab product keeps its rate on an unrelated edit and warns before a rename", async () => {
  const calls = recordsServer({ "GET catalog/12/": { ...PRODUCT_DETAIL, gst_percent: "7", slab_ok: false }, "PUT catalog/12/": PRODUCT_DETAIL });
  mount(routes, ["/products/12/edit"]);
  expect(await screen.findByRole("combobox", { name: "GST rate · required" })).toHaveValue("7");
  expect(screen.getByRole("option", { name: "7% · Not a GST rate" })).toBeInTheDocument();
  fireEvent.change(box("Name"), { target: { value: "Gold necklace renamed" } });
  expect(screen.getByText(/Bills already made keep the old name/)).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[0]);
  expect(await screen.findByText("Product after saving")).toBeInTheDocument();
  expect(calls.find((c) => c.method === "PUT")?.data).toMatchObject({ gst_percent: "7", usual_rate: "6470.125" });
});
test("a viewer sees why products cannot change and never sees writable fields", () => {
  recordsServer(); mount(routes, ["/products/new"], { me: VIEWER });
  expect(screen.getByText("You can't add or change products")).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: /^Name/ })).not.toBeInTheDocument();
});
test("typing then leaving asks before discarding, and the phone keeps the Save action", async () => {
  (window as unknown as { __phone: boolean }).__phone = true;
  recordsServer(); const view = mount(routes, ["/products/new"]);
  fireEvent.change(box("Name"), { target: { value: "Unsaved ring" } });
  expect(screen.getByRole("button", { name: "Save product" })).toBeInTheDocument();
  await act(async () => { await view.router.navigate("/products"); });
  expect(await screen.findByRole("dialog", { name: "Leave without saving?" })).toBeInTheDocument();
});

test("an unrelated edit preserves an inferred null kind and never writes kind_effective", async () => {
  const product = { ...PRODUCT_DETAIL, name: "Cut diamond", hsn_code: "7102", gst_percent: "0.25", kind: null, kind_effective: "diamond", purity: "VVS" };
  const calls = recordsServer({ "GET catalog/12/": product, "PUT catalog/12/": product });
  mount(routes, ["/products/12/edit"]);
  expect(await screen.findByRole("combobox", { name: "Kind" })).toHaveValue("");
  expect(screen.getByRole("option", { name: "Automatic: Diamond" })).toBeInTheDocument();
  fireEvent.change(box("Description"), { target: { value: "Kept in the safe" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[0]);
  expect(await screen.findByText("Product after saving")).toBeInTheDocument();
  const body = calls.find((c) => c.method === "PUT")?.data;
  expect(body).toMatchObject({ kind: null, purity: "VVS", description: "Kept in the safe" });
  expect(body).not.toHaveProperty("kind_effective");
});
test("a chosen kind can go back to automatic", async () => {
  const product = { ...PRODUCT_DETAIL, kind: "gold", kind_effective: "gold" };
  const calls = recordsServer({ "GET catalog/12/": product, "PUT catalog/12/": product });
  mount(routes, ["/products/12/edit"]);
  fireEvent.change(await screen.findByRole("combobox", { name: "Kind" }), { target: { value: "" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save changes" })[0]);
  expect(await screen.findByText("Product after saving")).toBeInTheDocument();
  expect(calls.find((c) => c.method === "PUT")?.data).toMatchObject({ kind: null });
});
test("an HSN suggestion stores a kind only when it says more than the automatic one", async () => {
  const calls = recordsServer({ "POST catalog/": { ...PRODUCT_DETAIL, id: 50 } }); mount(routes, ["/products/new"]);
  fireEvent.change(box("Name"), { target: { value: "Anklet" } }); choose("71131920");
  expect(screen.getByRole("combobox", { name: "Kind" })).toHaveValue("silver");
  choose("71131910");
  expect(screen.getByRole("combobox", { name: "Kind" })).toHaveValue("");
  fireEvent.change(screen.getByRole("combobox", { name: "GST rate · required" }), { target: { value: "3" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save product" })[0]);
  expect(await screen.findByText("Product list after saving")).toBeInTheDocument();
  expect(calls.find((c) => c.method === "POST")?.data).toMatchObject({ kind: null });
});
test("the rate warning's live region is there before the warning, so it is read out", async () => {
  recordsServer(); mount(routes, ["/products/new"]);
  const region = document.getElementById("pr-gst-warn");
  expect(region).toHaveAttribute("role", "status");
  expect(region).toHaveTextContent("");
  choose("7102");
  fireEvent.change(screen.getByRole("combobox", { name: "GST rate · required" }), { target: { value: "3" } });
  expect(document.getElementById("pr-gst-warn")).toBe(region);
  expect(region).toHaveTextContent("Cut and polished diamonds (HSN 7102) are taxed at 0.25%. Check the rate.");
});
