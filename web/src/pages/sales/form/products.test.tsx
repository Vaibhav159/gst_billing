import type { ReactNode } from "react";
import { act, fireEvent, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { salesServer } from "@/core/sales/fixtures";
import { renderApp, testQueryClient } from "@/test/render";
import { Combobox } from "@/core/ui";
import { productOptions } from "./lines";
import { matchProducts, percentOf, quickProducts, toSaleProduct, useCreateProduct, useSaleProducts } from "./products";

const RING = { id: 5, name: "Gold Ring 22K", hsn_code: "711319", gst_tax_rate: "0.0300", default_unit: "gms", description: "", usage_count: 9 };
const DIAMOND = { id: 6, name: "Cut Diamond", hsn_code: "710239", gst_tax_rate: "0.0025", default_unit: "ct", description: "VVS1", usage_count: 2 };
const CHAIN = { id: 7, name: "Silver Chain", hsn_code: "711311", gst_tax_rate: "0.0300", default_unit: "gms", description: "", usage_count: 30 };

test("the product picker announces products alone, keeping its add-item action available", () => {
  renderApp(<Combobox id="products" ariaLabel="Product" query="gold" onQuery={() => {}} options={productOptions([toSaleProduct(RING)], false, "gold", true)} onPick={() => {}} />);
  fireEvent.focus(screen.getByRole("combobox", { name: "Product" }));
  expect(screen.getByRole("status").textContent).toBe("1 match");
  expect(screen.getByRole("option", { name: /An item that isn't in Products/ })).toBeInTheDocument();
});

/** The app's own cache defaults (a save never retries or queues), as every hook test's wrapper. */
function wrapper() {
  const qc = testQueryClient();
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

test("a product's GST rate reads as the percent a line takes, 0.25% and 28% exactly", () => {
  expect(percentOf("0.0300")).toBe("3");
  expect(percentOf("0.0025")).toBe("0.25");
  expect(percentOf(0.28)).toBe("28");
  expect(percentOf("0.0010")).toBe("0.1");
  expect(percentOf("")).toBeNull();
  expect(toSaleProduct(DIAMOND)).toEqual({ id: 6, name: "Cut Diamond", hsn_code: "710239", gst_percent: "0.25", unit: "ct", description: "VVS1", usage: 2, kind: null, kind_effective: "diamond", purity: "", usual_rate: null, purchase_only: false });
});

test("every product is asked for once, then searched here: every word typed, names starting with it first; the most billed for quick picks", async () => {
  const { calls } = salesServer([["GET", "products/", () => ({ count: 3, results: [DIAMOND, RING, CHAIN] })]]);
  const { result } = renderHook(() => useSaleProducts(), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.data).toHaveLength(3));
  expect(calls.find((c) => c.url === "products/")?.params).toEqual({ page_size: 1000, ordering: "name" });
  const all = result.current.data!;
  expect(matchProducts(all, "chain").map((p) => p.id)).toEqual([7]);
  expect(matchProducts(all, "gold ring").map((p) => p.id)).toEqual([5]);
  expect(matchProducts(all, "7113").map((p) => p.id)).toEqual([5, 7]);
  expect(matchProducts(all, "di").map((p) => p.id)).toEqual([6]);
  // "Cut Diamond" starts with "c", so it comes before "Silver Chain" wherever the list has it
  expect(matchProducts([...all].reverse(), "c").map((p) => p.id)).toEqual([6, 7]);
  expect(quickProducts(all, 2).map((p) => p.id)).toEqual([7, 5]);
});

test("a paper run reuses products for 30 minutes; time alone never asks again", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-10-08T10:00:00+05:30"));
  const shared = wrapper();
  const { calls } = salesServer([["GET", "products/", () => ({ count: 1, results: [RING] })]]);
  const first = renderHook(() => useSaleProducts(), { wrapper: shared });
  try {
    await waitFor(() => expect(first.result.current.data).toHaveLength(1));
    await act(async () => { await vi.advanceTimersByTimeAsync(29 * 60_000); });
    const second = renderHook(() => useSaleProducts(), { wrapper: shared });
    expect(second.result.current.data).toHaveLength(1);
    expect(calls).toHaveLength(1);
    second.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(calls).toHaveLength(1);
    const third = renderHook(() => useSaleProducts(), { wrapper: shared });
    await waitFor(() => expect(calls).toHaveLength(2));
    await waitFor(() => expect(third.result.current.isFetching).toBe(false));
    third.unmount();
  } finally {
    first.unmount();
    vi.useRealTimers();
  }
});

test("the owner keeps an item through catalog's validation, without filling its usual rate", async () => {
  let listed: object[] = [RING];
  const { calls } = salesServer([
    ["GET", "products/", () => ({ count: listed.length, results: listed })],
    ["POST", "catalog/", ({ body }) => { const made = { id: 9, ...(body as object) }; listed = [...listed, made]; return made; }],
  ]);
  const { result } = renderHook(() => ({ list: useSaleProducts(), create: useCreateProduct() }), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.list.data).toHaveLength(1));
  let made: unknown;
  await act(async () => { made = await result.current.create.mutateAsync({ name: "Silver Idol", hsn_code: "7114", gst_percent: "3", unit: "pcs", description: "Ganesh", kind: "silver", purity: "925" }); });
  expect(calls.find((c) => c.method === "POST")?.body).toEqual({ name: "Silver Idol", hsn_code: "7114", gst_percent: "3", unit: "pcs", description: "Ganesh", kind: "silver", purity: "925", usual_rate: null, purchase_only: false });
  expect(made).toMatchObject({ id: 9, gst_percent: "3", unit: "pcs" });
  // the products are asked for again, so the next bill can pick it (and the test ends on that settled answer)
  await waitFor(() => expect(result.current.list.data?.map((p) => p.name)).toEqual(["Gold Ring 22K", "Silver Idol"]));
  expect(result.current.create.isSuccess).toBe(true);
});
test("the picker reads beyond 1000 products and filters bought-only on every page", async () => {
  const { calls } = salesServer([["GET", "products/", ({ params }) => params.page === 2
    ? { count: 1002, next: null, results: [{ ...DIAMOND, purchase_only: true }, { ...CHAIN, usual_rate: "123.456" }] }
    : { count: 1002, next: "https://example.invalid/api/products/?page=2", results: Array.from({ length: 1000 }, (_, id) => ({ ...RING, id: 100 + id, purchase_only: id === 0 })) }]]);
  const { result } = renderHook(() => useSaleProducts(), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.data).toHaveLength(1000));
  expect(result.current.data?.some((p) => p.id === CHAIN.id)).toBe(true);
  expect(result.current.data?.some((p) => p.id === 100 || p.id === DIAMOND.id)).toBe(false);
  expect(calls.map((c) => c.url)).toEqual(["products/", "products/"]);
  expect(calls[1].params.page).toBe(2);
});

test("the shared picker adapter keeps nullable kind, effective kind and purity for Dashboard and Easy", () => {
  expect(toSaleProduct({ ...DIAMOND, kind: null, kind_effective: "diamond", purity: "VVS", usual_rate: "123.456", purchase_only: false })).toMatchObject({ kind: null, kind_effective: "diamond", purity: "VVS", usual_rate: "123.456", purchase_only: false });
  expect(toSaleProduct({ ...DIAMOND, kind: "packing", kind_effective: "packing", purity: "999" })).toMatchObject({ kind: "packing", kind_effective: "packing", purity: "999" });
});
test("a server that never stops naming a next page is read to a cap, then the list fails instead of looping", async () => {
  const { calls } = salesServer([["GET", "products/", () => ({ count: 1, next: "https://example.invalid/api/products/?page=2", results: [RING] })]]);
  const { result } = renderHook(() => useSaleProducts(), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(calls).toHaveLength(100);
});


test("sales and purchase pickers keep separate cached lists for bought-only products", async () => {
  salesServer([["GET", "products/", () => ({ next: null, results: [RING, { ...DIAMOND, purchase_only: true }] })]]);
  const { result } = renderHook(() => ({ sales: useSaleProducts(), purchases: useSaleProducts(true, { forSale: false }) }), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.purchases.data).toHaveLength(2));
  expect(result.current.sales.data?.map(p => p.id)).toEqual([RING.id]);
  expect(result.current.purchases.data?.map(p => p.id)).toEqual([RING.id, DIAMOND.id]);
});
