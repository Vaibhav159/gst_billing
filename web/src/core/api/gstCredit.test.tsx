import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { serve, type Call } from "@/test/server";
import { testQueryClient } from "@/test/render";
import { creditWire, effectWire, openingWire } from "@/core/gst/creditFixtures";
import { useGstCredit, useOpeningCredit, useOpeningPreview, useSaveOpeningCredit, useMoveCredit } from "./gstCredit";

function setup() {
  const client = testQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}
describe("GST credit wire boundary", () => {
  it("requests the picked firm and FY and converts every money field once", async () => {
    const calls = serve({ "GET gst/credit/": creditWire, "GET gst/opening-credit/": openingWire });
    const { wrapper } = setup();
    const { result } = renderHook(() => ({ credit: useGstCredit(3, "2026-27"), opening: useOpeningCredit(3) }), { wrapper });
    await waitFor(() => expect(result.current.credit.isSuccess && result.current.opening.isSuccess).toBe(true));
    const d = result.current.credit.data!;
    expect(d.at_risk.tax).toBe(90240);
    expect(d.at_risk.bills[0].tax).toBe(90240);
    expect(d.buckets.claimed.tax).toBe(12567890);
    expect(d.buckets.open.tax).toBe(90240);
    expect(d.buckets.lapsed.tax).toBe(0);
    expect(d.opening.total).toBe(1900000);
    expect(d.opening.carried_out_of_first_month.heads).toEqual({ igst: 0, cgst: 800000, sgst: 800000 });
    expect(result.current.opening.data?.cgst).toBe(950000);
    expect(calls.map(c => c.params)).toEqual([{ business_id: 3, fy: "2026-27" }, { business_id: 3 }]);
  });
  it("does not fetch without a firm, even on forced invalidation", async () => {
    const calls = serve({});
    const { client, wrapper } = setup();
    renderHook(() => ({ credit: useGstCredit(null, "2026-27"), opening: useOpeningCredit(null) }), { wrapper });
    await act(async () => { await client.invalidateQueries(); await client.refetchQueries(); });
    expect(calls).toEqual([]);
  });
  it("keeps previews read-only, sends decimal strings, and invalidates dependent reads only after save", async () => {
    const calls = serve({ "PUT gst/opening-credit/": (c: Call) => ({ status: 200, data: c.params.preview ? effectWire : { opening: openingWire, effect: effectWire } }) });
    const { client, wrapper } = setup();
    const keys = [["gst", "month", 3, "2026-09"], ["reports", "tax"], ["purchases", "detail", 77]];
    const invalidations = vi.spyOn(client, "invalidateQueries");
    keys.forEach(k => client.setQueryData(k, {}));
    const { result } = renderHook(() => ({ preview: useOpeningPreview(), save: useSaveOpeningCredit() }), { wrapper });
    const input = { business: 3, igst: 123, cgst: 950000, sgst: 950000 };
    await act(async () => { await result.current.preview.mutateAsync(input); });
    expect(result.current.preview.data).toEqual({ ...effectWire, carried_out: { from: 1600000, to: 1600123 }, cash: { month: "2025-05", from: 1250, to: 1127 } });
    expect(keys.every(k => !client.getQueryState(k)?.isInvalidated)).toBe(true);
    await act(async () => { await result.current.save.mutateAsync(input); });
    expect(calls.map(c => c.params)).toEqual([{ preview: 1 }, {}]);
    expect(calls.every(c => JSON.stringify(c.data) === JSON.stringify({ business: 3, igst: "1.23", cgst: "9500.00", sgst: "9500.00" }))).toBe(true);
    expect(keys.every(k => client.getQueryState(k)?.isInvalidated)).toBe(true);
    expect(invalidations.mock.calls.map(([filter]) => filter?.queryKey)).toEqual([["gst"], ["reports"], ["purchases"]]);
  });
  it("uses part 2's credit-month endpoint and invalidates the ledger and purchase on success", async () => {
    const calls = serve({ "PUT purchases/77/credit-month/": { id: 77, credit: {}, previous: "2026-10" } });
    const { wrapper, client } = setup();
    client.setQueryData(["gst", "credit", 3, "2026-27"], {});
    client.setQueryData(["purchases", "detail", 77], {});
    const { result } = renderHook(useMoveCredit, { wrapper });
    await act(async () => { await result.current.mutateAsync({ id: 77, month: "2026-09" }); });
    expect(calls[0].data).toEqual({ itc_month: "2026-09" });
    expect(client.getQueryState(["gst", "credit", 3, "2026-27"])?.isInvalidated).toBe(true);
    expect(client.getQueryState(["purchases", "detail", 77])?.isInvalidated).toBe(true);
  });
});
