// @vitest-environment jsdom
/**
 * The summary cards ask the server for exactly what the invoice list shows. The cards used to send FY dates plus a
 * "month" the server never reads, and no GST-rate, segment or payment filter: with a month chip they showed the
 * whole FY, and on a 3% slab drill-down every slab, beside a list of one month or one slab.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn().mockResolvedValue({ data: {} }) }));
vi.mock("@/utils/api", () => ({ default: { get, post: vi.fn() } }));

import { useDashboardStats, type InvoiceFilters } from "./useDataStore";

async function statsQuery(filters: InvoiceFilters) {
  renderHook(() => useDashboardStats(filters));
  await waitFor(() => expect(get).toHaveBeenCalled());
  const url: string = get.mock.calls[0][0];
  expect(url.startsWith("invoices/stats/")).toBe(true);
  return new URL(`http://x/${url}`).searchParams;
}

describe("useDashboardStats asks for what the invoice list shows", () => {
  // The hook asks only when signed in. A stub rather than localStorage itself: Node 25's own empty localStorage global
  // (no --localstorage-file) shadows jsdom's, while CI runs Node 20.
  beforeEach(() => {
    get.mockClear();
    vi.stubGlobal("localStorage", { getItem: (k: string) => (k === "gst_access_token" ? "test" : null), setItem: () => {}, removeItem: () => {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a month chip: that month's dates, not the whole FY", async () => {
    const q = await statsQuery({ fyFilter: "2026-27", monthFilter: "9" });
    expect(q.get("start_date")).toBe("2026-09-01");
    expect(q.get("end_date")).toBe("2026-09-30");
    expect(q.has("month")).toBe(false);
  });

  it("a GST-page drill-down: its dates, slab, segment and payment, as the list sends them", async () => {
    const q = await statsQuery({
      fyFilter: "all", monthFilter: "all", startDate: "2026-09-01", endDate: "2026-09-30",
      gstRate: "3", segment: "b2cs", paymentFilter: "cash", typeFilter: "OUTWARD",
    });
    expect(q.get("start_date")).toBe("2026-09-01");
    expect(q.get("end_date")).toBe("2026-09-30");
    expect(q.get("gst_rate")).toBe("3");
    expect(q.get("segment")).toBe("b2cs");
    expect(q.get("payment_mode")).toBe("cash");
    expect(q.get("type_of_invoice")).toBe("outward");
  });

  it("the dashboard's FY and firm, as before", async () => {
    const q = await statsQuery({ fyFilter: "2026-27", businessId: "3" });
    expect(q.get("start_date")).toBe("2026-04-01");
    expect(q.get("end_date")).toBe("2027-03-31");
    expect(q.get("business_id")).toBe("3");
  });

  it("the Reports page's own dates win over its FY, as before", async () => {
    const q = await statsQuery({ fyFilter: "2026-27", startDate: "2026-07-01", endDate: "2026-07-31", businessId: "all", typeFilter: "all" });
    expect(q.get("start_date")).toBe("2026-07-01");
    expect(q.get("end_date")).toBe("2026-07-31");
    expect(q.has("business_id")).toBe(false);
  });
});
