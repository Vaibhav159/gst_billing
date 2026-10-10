import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { salesServer } from "@/core/sales/fixtures";
import { testQueryClient } from "@/test/render";
import { matchProducts, percentOf, quickProducts, toSaleProduct, useCreateProduct, useSaleProducts } from "./products";

const RING = { id: 5, name: "Gold Ring 22K", hsn_code: "711319", gst_tax_rate: "0.0300", default_unit: "gms", description: "", usage_count: 9 };
const DIAMOND = { id: 6, name: "Cut Diamond", hsn_code: "710239", gst_tax_rate: "0.0025", default_unit: "ct", description: "VVS1", usage_count: 2 };
const CHAIN = { id: 7, name: "Silver Chain", hsn_code: "711311", gst_tax_rate: "0.0300", default_unit: "gms", description: "", usage_count: 30 };

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
  expect(toSaleProduct(DIAMOND)).toEqual({ id: 6, name: "Cut Diamond", hsn_code: "710239", gst_percent: "0.25", unit: "ct", description: "VVS1", usage: 2 });
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

test("the owner keeps an item for the next bill: v2's products/ with the rate as a fraction", async () => {
  let listed: object[] = [RING];
  const { calls } = salesServer([
    ["GET", "products/", () => ({ count: listed.length, results: listed })],
    ["POST", "products/", ({ body }) => { const made = { id: 9, ...(body as object) }; listed = [...listed, made]; return made; }],
  ]);
  const { result } = renderHook(() => ({ list: useSaleProducts(), create: useCreateProduct() }), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.list.data).toHaveLength(1));
  let made: unknown;
  await act(async () => { made = await result.current.create.mutateAsync({ name: "Silver Idol", hsn_code: "7114", gst_percent: "3", unit: "pcs", description: "Ganesh" }); });
  expect(calls.find((c) => c.method === "POST")?.body).toEqual({ name: "Silver Idol", hsn_code: "7114", gst_tax_rate: "0.03", default_unit: "pcs", description: "Ganesh" });
  expect(made).toMatchObject({ id: 9, gst_percent: "3", unit: "pcs" });
  // the products are asked for again, so the next bill can pick it (and the test ends on that settled answer)
  await waitFor(() => expect(result.current.list.data?.map((p) => p.name)).toEqual(["Gold Ring 22K", "Silver Idol"]));
  expect(result.current.create.isSuccess).toBe(true);
});
