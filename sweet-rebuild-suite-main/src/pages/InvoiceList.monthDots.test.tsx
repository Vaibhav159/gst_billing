/**
 * The month pills' dots show which months of the period have bills. Since the cards ask for exactly what the list
 * shows, picking a month narrows the cards' request to that month; the dots must still come from the whole period.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import InvoiceList from "./InvoiceList";
import type { InvoiceFilters } from "@/hooks/useDataStore";

// The server answers `monthly` for the requested range: the whole FY has bills in Jun, Aug, Sep and Oct.
const row = (month: number) => ({ month, year: 2026, outward_total: 1000, inward_total: 0, outward_count: 1, inward_count: 0 });
const statsFor = (f: InvoiceFilters = {}) => ({
  totals: { outward: 0, inward: 0, net: 0, tax: 0, count: 0, outward_count: 0, inward_count: 0 },
  monthly: f.monthFilter && f.monthFilter !== "all" ? [row(Number(f.monthFilter))] : [row(6), row(8), row(9), row(10)],
});

vi.mock("@/hooks/useDataStore", () => ({
  useInvoices: () => ({
    items: [], remove: vi.fn(), isLoading: false, isLoadingMore: false, hasMore: false, loadMore: vi.fn(),
    totalCount: 0, error: null, refetch: vi.fn(),
  }),
  useBusinesses: () => ({ items: [] }),
  useCustomers: () => ({ items: [] }),
  useDashboardStats: (f?: InvoiceFilters, enabled = true) => ({ data: enabled ? statsFor(f) : null, isLoading: false, error: null }),
  fetchAllInvoices: vi.fn(),
}));
vi.mock("@/hooks/usePermission", () => ({ usePermission: () => ({ role: "admin", isAdmin: true, canDelete: false }) }));

const hasDot = (month: string) => !!screen.getByRole("button", { name: month }).querySelector("span.rounded-full");

describe("InvoiceList's month pills", () => {
  it("keep the period's dots when a month is picked", () => {
    render(
      <MemoryRouter initialEntries={["/billing/invoice/list"]}>
        <Routes>
          <Route element={<Outlet context={{ selectedFY: "2026-27" }} />}>
            <Route path="/billing/invoice/list" element={<InvoiceList />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(["Jun", "Aug", "Sep", "Oct"].every(hasDot)).toBe(true);
    expect(hasDot("Jul")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Sep" }));
    expect(["Jun", "Aug", "Oct"].map(hasDot)).toEqual([true, true, true]);
    expect(hasDot("Sep")).toBe(false); // the picked month hides its own dot, as before
    expect(hasDot("Jul")).toBe(false);
  });
});
