import { fireEvent, screen, waitFor } from "@testing-library/react";
import { mount, VIEWER } from "@/pages/customers/testing";
import { CATALOG, PRODUCT, PRODUCT_DETAIL, recordsServer } from "@/test/records";
import Products from "./Products";
import ProductDetail from "./ProductDetail";

const routes = [{ path: "/products", element: <Products /> }, { path: "/products/:id", element: <ProductDetail /> }];
beforeEach(() => { (window as unknown as { __phone: boolean }).__phone = false; vi.useFakeTimers({ toFake: ["Date"] }); });
afterEach(() => { vi.useRealTimers(); });
test("products show server totals for the selected firm, decimal slab filter and matching count", async () => {
  const calls = recordsServer();
  mount(routes, ["/products"]);
  expect(await screen.findByText("1 of 17 products match")).toBeInTheDocument();
  expect(screen.getByText("Gold necklace 22K")).toBeInTheDocument();
  expect(screen.getAllByText("₹32,83,912.40")).toHaveLength(2);
  fireEvent.change(screen.getByRole("combobox", { name: "GST rate" }), { target: { value: "0.25" } });
  await waitFor(() => expect(calls.some((c) => c.url === "catalog/" && c.params.gst_rate === "0.25")).toBe(true));
  expect(calls.filter((c) => c.url === "catalog/").every((c) => c.params.business_id === 3)).toBe(true);
});
test("case twins stay visible to viewers, who cannot rename or add", async () => {
  recordsServer({ "GET catalog/": { ...CATALOG, twins: [[{ id: 12, name: "Gold" }, { id: 13, name: "GOLD" }]] } });
  mount(routes, ["/products"], { me: VIEWER });
  expect(await screen.findByText(/differ only in capital letters/)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Rename one" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add product" })).toBeDisabled();
});
test("phone list keeps bought-only words, rate precision and real sold figures", async () => {
  (window as unknown as { __phone: boolean }).__phone = true;
  recordsServer({ "GET catalog/": { ...CATALOG, results: [{ ...PRODUCT, purchase_only: true, sold: PRODUCT_DETAIL.sold }] } });
  mount(routes, ["/products"]);
  expect(await screen.findByText("Bought only", { selector: "span" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Add product" })).toBeInTheDocument();
});
test("detail uses server average, earlier names and mixed units, without making charges", async () => {
  recordsServer();
  mount(routes, ["/products/12"]);
  expect(await screen.findByText("per g, as billed")).toBeInTheDocument();
  expect(screen.getByText("₹6,463.125")).toBeInTheDocument();
  expect(screen.getByText(/also 2 pcs/)).toBeInTheDocument();
  expect(screen.getByText(/Old necklace/)).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "Making" })).not.toBeInTheDocument();
  expect(screen.getByText("Shown on the product; bills take the rate written on the paper bill")).toBeInTheDocument();
});
test("missing HSN names the blocked return and offers the oldest bill's repair", async () => {
  const bill = { id: 42, invoice_number: "KGH/2026-27/42", invoice_date: "2026-10-01", customer_name: "Anil", status: "active" };
  recordsServer({ "GET catalog/12/": { ...PRODUCT_DETAIL, hsn_on_bills: { lines: 1, groups: [{ hsn_code: "", matches: false, lines: 1, sales: [bill], purchases: [] }], blocking: [{ bill, business: { id: 3, name: "KIRAN GOLD HOUSE", short: "Kiran" }, month: "2026-10" }] } } });
  mount(routes, ["/products/12"]);
  expect(await screen.findByText("1 line has no HSN code")).toBeInTheDocument();
  expect(screen.getByText(/Kiran's October GSTR-1 can't be filed/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Add the HSN code" })).toHaveAttribute("href", "/sales/42/edit");
});
test("an invalid product address shows the missing record without requesting an invalid id", async () => {
  const calls = recordsServer();
  mount(routes, ["/products/nope"]);
  expect(await screen.findByRole("heading", { name: "This product isn't on file", level: 1 })).toBeInTheDocument();
  expect(calls.some((c) => c.url.includes("catalog/nope"))).toBe(false);
});
test("any bill use, including a bill in the bin, disables deletion with a Bought only explanation", async () => {
  recordsServer({ "GET catalog/12/": { ...PRODUCT_DETAIL, uses: { sales: 0, cancelled: 0, purchases: 0, bin: 1 } } });
  mount(routes, ["/products/12"]);
  fireEvent.click(await screen.findByRole("button", { name: "More" }));
  expect(await screen.findByRole("menuitem", { name: /Delete product/ })).toBeDisabled();
  expect(screen.getByText(/Mark it Bought only to hide it instead/)).toBeInTheDocument();
});
test("unused product deletion offers Undo through the returned audit id", async () => {
  const calls = recordsServer({ "GET catalog/12/": { ...PRODUCT_DETAIL, uses: { sales: 0, cancelled: 0, purchases: 0, bin: 0 } }, "DELETE catalog/12/": { audit_id: 9131 }, "POST audit/9131/restore/": { link: "/products/12" } });
  mount(routes, ["/products/12"]);
  fireEvent.click(await screen.findByRole("button", { name: "More" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /Delete product/ }));
  expect(await screen.findByRole("dialog", { name: "Delete Gold necklace 22K?" })).toBeInTheDocument();
  vi.setSystemTime(Date.now() + 400);
  fireEvent.click(screen.getByRole("button", { name: "Delete product" }));
  expect(await screen.findByText("Gold necklace 22K deleted")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
  await waitFor(() => expect(calls.some((c) => c.url === "audit/9131/restore/" && c.method === "POST")).toBe(true));
});

test("list and detail show the effective kind when no kind was stored", async () => {
  const product = { ...PRODUCT_DETAIL, kind: null, kind_effective: "diamond" };
  recordsServer({ "GET catalog/": { ...CATALOG, results: [product] }, "GET catalog/12/": product });
  mount(routes, ["/products"]);
  expect(await screen.findByText("Diamond · Plain and Rajkot designs")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "Gold necklace 22K" }));
  expect(await screen.findByText("Diamond")).toBeInTheDocument();
});
