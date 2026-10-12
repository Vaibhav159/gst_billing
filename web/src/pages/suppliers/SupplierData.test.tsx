import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { testQueryClient } from "@/test/render";
import { serve } from "@/test/server";
import { toSupplierPage, toSupplierDetail } from "@/core/purchases/wire";
import { useSuppliers } from "@/core/api/suppliers";
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={testQueryClient()}>{children}</QueryClientProvider>;
test("the summary is the whole match, never a sum of this page; money is paise", () => {
  const p = toSupplierPage({ count: 101, next: "more", results: [{ id: 21, name: "UBS", figures: { bills: 1, total: "12.34", tax: "0.36", credit: "0.36", last: null } }], summary: { suppliers: 101, bills: 150, total: "492645.00", tax: "14348.88" } });
  expect(p.results[0].figures.total).toBe(1234);
  expect(p.summary).toEqual({ suppliers: 101, bills: 150, total: 49264500, tax: 1434888 });
  expect(p.results[0].figures.last).toBeNull();
});
test("detail keeps three-decimal rates and quantity as decimals while money becomes paise", () => {
  const d = toSupplierDetail({ supplier: { id: 21 }, rates: [{ product_name: "Gold", quantity: "69.540", value: "478296.12", bills: 9, average: "6871.235", low: "6780.001", high: "6912.000" }] });
  expect(d.rates[0]).toMatchObject({ quantity: "69.540", value: 47829612, average: "6871.235", low: "6780.001" });
});
test("unknown scope makes no request; subsequent pages ask once on demand", async () => {
  const calls = serve({ "GET suppliers/": (c: { params: Record<string, unknown> }) => ({ status: 200, data: { count: 101, next: c.params.page === 1 ? "more" : null, results: [{ id: c.params.page }], summary: {} } }) });
  const { result, rerender } = renderHook(({ firm }: { firm: number | null }) => useSuppliers(firm, "2026-27", "", "-total"), { wrapper, initialProps: { firm: null as number | null } });
  expect(calls).toHaveLength(0);
  rerender({ firm: 3 });
  await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
  await result.current.fetchNextPage();
  await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
  expect(calls.map(c => c.params)).toEqual([1, 2].map(page => ({ business_id: 3, fy: "2026-27", q: "", ordering: "-total", page_size: 100, page })));
});
