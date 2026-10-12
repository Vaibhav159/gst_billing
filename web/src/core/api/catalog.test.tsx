import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { testQueryClient } from "@/test/render";
import { serve } from "@/test/server";
import { toProduct, toProductDetail, useCatalog, useProduct, useSaveProduct } from "./catalog";
import { useRegistry } from "./registry";
import { useSetup } from "./setup";

const raw = { id: 12, name: "Gold necklace 22K", hsn_code: "711319", hsn_text: "Gold jewellery", gst_percent: "3", slab_ok: true, unit: "gms", kind: "gold", kind_effective: "gold", purity: "22K", usual_rate: "6470.125", purchase_only: false, description: "", sold: { bills: 14, quantity: "508.062", other_units: [{ unit: "pcs", quantity: "2.000" }], taxable: "3283912.40", tax: "98517.37", cancelled: 1 } };
function wrap() {
  const qc = testQueryClient();
  return { qc, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> };
}
test("catalog converts totals to paise while preserving decimal quantities and three-place rates", () => {
  expect(toProduct(raw)).toMatchObject({ usual_rate: "6470.125", gst_percent: "3", sold: { quantity: "508.062", taxable: 328391240, tax: 9851737, other_units: [{ unit: "pcs", quantity: "2.000" }] } });
});
test("catalog waits for scope, pages by twenty, and never carries another firm's figures", async () => {
  const calls = serve({ "GET catalog/": ({ params }: { params: Record<string, unknown> }) => ({ status: 200, data: { count: 21, results: [raw], next: params.page === 1 ? "?page=2" : null, total_products: 40, twins: [], summary: { taxable: "3283912.40", bills: 14, cancelled: 1, no_items: [], no_items_count: 0 } } }) });
  const { result, rerender } = renderHook(({ firmId }: { firmId: number | null }) => useCatalog({ firmId, fy: "2026-27", q: "gold", show: "sold", gst_rate: "3", ordering: "-sold" }), { ...wrap(), initialProps: { firmId: null as number | null } });
  expect(calls).toHaveLength(0);
  rerender({ firmId: 3 });
  await waitFor(() => expect(result.current.data?.pages[0].results).toHaveLength(1));
  expect(calls[0].params).toEqual({ figures: 1, business_id: 3, fy: "2026-27", q: "gold", show: "sold", gst_rate: "3", ordering: "-sold", page_size: 20, page: 1 });
  await act(async () => { await result.current.fetchNextPage(); });
  expect(calls[1].params.page).toBe(2);
  await waitFor(() => expect(result.current.hasNextPage).toBe(false));
  rerender({ firmId: 4 });
  expect(result.current.data).toBeUndefined();
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
});
test("product mutation sends whole contract body and invalidates catalog, sales picker and setup", async () => {
  const { qc, wrapper } = wrap();
  qc.setQueryData(["products", "for-sale"], []);
  qc.setQueryData(["setup"], {});
  const calls = serve({ "PUT catalog/12/": raw });
  const { result } = renderHook(() => useSaveProduct(), { wrapper });
  const body = { name: raw.name, hsn_code: "711319", gst_percent: "3", unit: "gms", kind: "gold" as const, purity: "22K", usual_rate: "6470.125", purchase_only: true, description: "" };
  await act(async () => { await result.current.mutateAsync({ id: 12, body }); });
  expect(calls[0].data).toEqual(body);
  expect(qc.getQueryState(["products", "for-sale"])?.isInvalidated).toBe(true);
  expect(qc.getQueryState(["setup"])?.isInvalidated).toBe(true);
});
test("a missing product id is never fetched", async () => {
  const calls = serve({});
  const { result } = renderHook(() => useProduct(null, { fy: "2026-27", firmId: "all" }), wrap());
  expect(result.current.data).toBeUndefined();
  expect(calls).toHaveLength(0);
});
test("registry asks only for a checksum-valid normalized GSTIN and drops stale fills", async () => {
  const answer = { gstin: "08VRHFA2322D1ZI", status: "found", registry: { legal_name: "Kiran" } };
  const calls = serve({ "GET registry/08VRHFA2322D1ZI/": answer });
  const { result, rerender } = renderHook(({ gstin }: { gstin: string | null }) => useRegistry(gstin), { ...wrap(), initialProps: { gstin: null as string | null } });
  rerender({ gstin: "08VRHFA2322D1ZX" });
  expect(calls).toHaveLength(0);
  rerender({ gstin: " 08vrhfa2322d1zi " });
  await waitFor(() => expect(result.current.data?.registry?.legal_name).toBe("Kiran"));
  expect(calls).toHaveLength(1);
  rerender({ gstin: "08" });
  expect(result.current.data).toBeUndefined();
});
test("setup preserves permission-hidden people and absent backup", async () => {
  const answer = { firms: { count: 0, names: [] }, customers: { count: 0, names: [] }, products: { count: 0, names: [] }, bills: { count: 0, cancelled: 0 }, people: null, last_backup_at: null };
  serve({ "GET setup/": answer });
  const { result } = renderHook(() => useSetup(), wrap());
  await waitFor(() => expect(result.current.data).toEqual(answer));
});

test("catalog preserves the stored kind separately from the server's effective classification", () => {
  expect(toProduct({ ...raw, kind: null, kind_effective: "diamond", purity: "VVS" })).toMatchObject({ kind: null, kind_effective: "diamond", purity: "VVS" });
  expect(toProduct({ ...raw, kind: "packing", kind_effective: "packing" })).toMatchObject({ kind: "packing", kind_effective: "packing" });
});


test("by-firm figures preserve the narrower contract without inventing tax or other-unit quantities", () => {
  const small = { bills: 2, quantity: "1.000", taxable: "125.00" };
  const result = toProductDetail({ ...raw, bought: raw.sold, by_firm: [{ business: { id: 3, name: "Kiran", short: "Kiran" }, sold: small, bought: small }], lines: [] });
  expect(result.by_firm[0].sold).toEqual({ bills: 2, quantity: "1.000", taxable: 12500 });
  expect(result.by_firm[0].bought).toEqual({ bills: 2, quantity: "1.000", taxable: 12500 });
});
