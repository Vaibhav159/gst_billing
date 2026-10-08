/**
 * The Backup page's counts (M6).
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

// No useProducts: the page has no business downloading every product to count them.
vi.mock("@/hooks/useDataStore", () => ({
  useBusinesses: () => ({ items: [{ id: "14", name: "KIRAN GOLD HOUSE (SANDBOX)" }], totalCount: 1 }),
  useCustomers: () => ({ items: [], totalCount: 0 }),
  mapDjangoInvoice: (row: unknown) => row,
  fetchAllPages: vi.fn(async () => []),
}));
vi.mock("@/utils/api", () => ({ default: { get: (url: string) => get(url), post: vi.fn(async () => ({ data: {} })) } }));

import Backup from "./Backup";

const COUNTS: Record<string, number> = { "businesses/": 3, "customers/": 35, "products/": 10, "invoices/": 435 };

function answer(url: string) {
  const u = new URL(url, "http://x/api/");
  const path = u.pathname.replace(/^\/api\//, "");
  const count = path === "invoices/" && u.searchParams.get("type_of_invoice") === "inward" ? 110
    : path === "invoices/" && u.searchParams.has("start_date") ? 149
    : COUNTS[path] ?? 0;
  return { data: { count, next: null, results: [] } };
}

const renderPage = () => render(<MemoryRouter><Backup /></MemoryRouter>);
const tile = (label: string) => screen.getByText(label, { selector: "p" }).closest(".stat-card") as HTMLElement;

beforeEach(() => {
  get.mockReset();
  localStorage.clear();
});

describe("Backup page counts (M6)", () => {
  it("counts every kind of record with one-row requests", async () => {
    get.mockImplementation(async (url: string) => answer(url));
    renderPage();
    await waitFor(() => expect(within(tile("Products")).getByText("10")).toBeInTheDocument());
    expect(within(tile("Businesses")).getByText("3")).toBeInTheDocument();
    expect(within(tile("Customers")).getByText("35")).toBeInTheDocument();
    expect(within(tile("Invoices")).getByText("435")).toBeInTheDocument();
    expect(within(tile("Total")).getByText("483")).toBeInTheDocument();
    for (const path of ["businesses/", "customers/", "products/"]) {
      const asked = get.mock.calls.map(([u]) => new URL(u as string, "http://x/api/"))
        .filter((u) => u.pathname === `/api/${path}`);
      expect(asked.length, `${path} asked once`).toBe(1);
      expect(asked[0].searchParams.get("page_size")).toBe("1");
    }
  });

  it("shows … rather than 0 until the counts arrive", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    get.mockImplementation(async (url: string) => { await gate; return answer(url); });
    renderPage();
    for (const label of ["Businesses", "Customers", "Products", "Invoices", "Total"]) {
      expect(within(tile(label)).getByText("…")).toBeInTheDocument();
    }
    expect(screen.getByText(/For the Excel report/)).toHaveTextContent("… invoices");
    release();
    await waitFor(() => expect(within(tile("Total")).getByText("483")).toBeInTheDocument());
    expect(screen.getByText(/For the Excel report/)).toHaveTextContent("149 invoices");
  });
});
