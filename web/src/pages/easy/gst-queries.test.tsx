import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";
import { testQueryClient } from "@/test/render";
import { serve } from "@/test/server";
import { wirePage } from "@/core/sales/fixtures";
import { useEasyGst } from "./gst-queries";
import { easyGst } from "./gst";

afterEach(() => vi.useRealTimers());
test("waits for a firm, reads the previous IST month and a one-row current summary once, idle makes no requests", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2025-12-31T18:35:00Z"));
  const calls = serve({
    "GET sales/": wirePage([]),
    "GET gst/month/": { business: 3, month: "2025-12", stage: "ready", due: { gstr1: "2026-01-11", gstr3b: "2026-01-20" }, record: { gstr1: null, gstr3b: null, legacy: false },
      checks: { blockers: [] }, gstr3b: { output: { total: "10378.76" }, cash: { total: "2120.00" }, carry_on: { total: "0.00" }, opening_missing: true } },
  });
  const client = testQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const h = renderHook(({ firm }) => useEasyGst(firm), { wrapper, initialProps: { firm: null as number | null } });
  expect(calls).toHaveLength(0);
  h.rerender({ firm: 3 });
  await waitFor(() => expect(h.result.current.previous.isSuccess && h.result.current.current.isSuccess).toBe(true));
  expect(calls.find((c) => c.url === "gst/month/")?.params).toEqual({ business_id: 3, month: "2025-12" });
  expect(calls.find((c) => c.url === "sales/")?.params).toMatchObject({ business_id: 3, month: "2026-01", page_size: 1 });
  expect(easyGst(h.result.current.previous.data!).cash).toBe(212000);
  vi.useFakeTimers();
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(calls).toHaveLength(2);
  h.unmount(); client.clear();
});
test("changing firm never renders the last firm's GST under the new name", async () => {
  const calls = serve({ "GET sales/": wirePage([]), "GET gst/month/": () => ({ status: 200, data: { business: 3, month: "2026-09", stage: "ready" } }) });
  const client = testQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const h = renderHook(({ firm }) => useEasyGst(firm, "2026-10-08"), { wrapper, initialProps: { firm: 3 } });
  await waitFor(() => expect(h.result.current.previous.isSuccess).toBe(true));
  h.rerender({ firm: 2 });
  expect(h.result.current.previous.data).toBeUndefined();
  await waitFor(() => expect(calls.filter((c) => c.params.business_id === 2)).toHaveLength(2));
  h.unmount(); client.clear();
});
