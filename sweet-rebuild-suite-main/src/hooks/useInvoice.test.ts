/**
 * Looking an invoice up by its shared address (UX8).
 *
 * The invoice page rewrites the address bar to /billing/invoice/<firm>/<fy>/
 * <number>. That lookup asked for numbers *containing* the number, 30 newest
 * first, and kept the exact ones in the browser; the year was never sent.
 * "#1" with 40 newer numbers containing a 1 came back as a page of 30 and no
 * #1: reloading or sharing the link said "not found".
 */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("@/utils/api", () => ({ default: { get: (url: string) => get(url) } }));

import { useInvoice } from "./useDataStore";

const row = (id: number, business: number, business_name: string, invoice_date = "2026-04-01") => ({
  id, invoice_number: "1", invoice_date, business, business_name, customer_name: "A BUYER",
  total_amount: "103.00", type_of_invoice: "outward",
});
const full = (r: ReturnType<typeof row>) => ({ ...r, customer: 7, line_items: [] });
const firms = [row(1732, 12, "AARAV JEWELLERS (SANDBOX)"), row(1733, 13, "MEERA ORNAMENTS (SANDBOX)"), row(1734, 14, "KIRAN GOLD HOUSE (SANDBOX)")];

const listCalls = () => get.mock.calls.map(([u]) => new URL(u as string, "http://x/api/")).filter((u) => u.pathname === "/api/invoices/");

beforeEach(() => {
  get.mockReset();
  localStorage.setItem("gst_access_token", "t");
});

describe("useInvoice by firm, year and number (UX8)", () => {
  it("asks the server for that number exactly, within that year, and reads every page", async () => {
    get.mockImplementation((url: string) => {
      const u = new URL(url, "http://x/api/");
      if (u.pathname === "/api/invoices/1734/") return Promise.resolve({ data: full(firms[2]) });
      if (u.searchParams.get("page") === "2") return Promise.resolve({ data: { count: 3, next: null, results: [firms[2]] } });
      return Promise.resolve({ data: { count: 3, next: "http://testserver/api/invoices/?page=2", results: firms.slice(0, 2) } });
    });
    const { result } = renderHook(() => useInvoice("1", "kiran-gold-house-sandbox", "2026-27"));
    await waitFor(() => expect(result.current.item?.id).toBe("1734"));
    const [first] = listCalls();
    expect(Object.fromEntries(first.searchParams)).toMatchObject({
      invoice_number: "1", start_date: "2026-04-01", end_date: "2027-03-31",
    });
    expect(listCalls().map((u) => u.searchParams.get("page") || "1")).toEqual(["1", "2"]);
  });

  it("finds nothing, honestly, when the firm has no such number that year", async () => {
    get.mockResolvedValue({ data: { count: 2, next: null, results: firms.slice(0, 2) } });
    const { result } = renderHook(() => useInvoice("1", "kiran-gold-house-sandbox", "2026-27"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.item).toBeNull();
    expect(result.current.candidates).toEqual([]);
  });
});

describe("useInvoice by id: the other invoices with its number (UX8)", () => {
  it("reads every page of exact matches, not the first 20 that contain the number", async () => {
    get.mockImplementation((url: string) => {
      const u = new URL(url, "http://x/api/");
      if (u.pathname === "/api/invoices/1734/") return Promise.resolve({ data: full(firms[2]) });
      if (u.searchParams.get("page") === "2") return Promise.resolve({ data: { count: 3, next: null, results: [firms[2]] } });
      return Promise.resolve({ data: { count: 3, next: "http://testserver/api/invoices/?page=2", results: firms.slice(0, 2) } });
    });
    const { result } = renderHook(() => useInvoice("1734"));
    await waitFor(() => expect(result.current.candidates.map((c) => c.id)).toEqual(["1732", "1733", "1734"]));
    expect(listCalls()[0].searchParams.get("invoice_number")).toBe("1");
  });
});
