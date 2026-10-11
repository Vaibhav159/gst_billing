import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { __resetDrafts } from "@/core/api/drafts";
import { __setNetState } from "@/core/api/network";
import { invalidateSales, salesKeys } from "@/core/api/sales";
import { __resetDeviceDrafts } from "@/core/deviceDrafts";
import { wireDetail } from "@/core/sales/fixtures";
import { fakeToday, formServer, mountForm, settle } from "./testing";

beforeEach(() => { localStorage.clear(); __resetDeviceDrafts(); __resetDrafts(); });
afterEach(() => { cleanup(); vi.useRealTimers(); act(() => __setNetState("online")); });

test.each(["2026-09-29", "2026-03-29"])("the form asks only for months, including the previous FY for %s", async (date) => {
  fakeToday();
  const { calls } = formServer();
  const { client } = mountForm(`/sales/new?paper=1&firm=3&date=${date}&number=35`);
  const customer = await screen.findByRole("combobox", { name: /Customer/ });
  await waitFor(() => expect(customer).toHaveFocus());
  await settle();
  const reads = calls.filter((c) => c.url === "sales/" && c.params.facets);
  expect(reads.map((c) => c.params)).toEqual([
    { business_id: 3, fy: "2026-27", facets: "months", summary: 0, page: 1, page_size: 1 },
    ...(date.startsWith("2026-03") ? [{ business_id: 3, fy: "2025-26", facets: "months", summary: 0, page: 1, page_size: 1 }] : []),
  ]);
  expect(client.getQueryState(salesKeys.facets(3, "2026-27"))).toBeUndefined();
  expect(client.getQueryState(["sales", "months", 3, "2026-27", "2026-10-08"])).toBeDefined();
  const at = calls.length;
  await act(async () => { invalidateSales(client); await vi.advanceTimersByTimeAsync(200); });
  expect(calls.slice(at).filter((c) => c.url === "sales/" && c.params.facets).map((c) => c.params.facets)).toEqual(reads.map(() => "months"));
});

test("the form's twin check leaves the unused sales summary out", async () => {
  fakeToday();
  const { calls } = formServer([["GET", "sales/412/", () => wireDetail()]]);
  mountForm("/sales/new?from=412");
  await screen.findByText("Copied from KGH/2026-27/31");
  await waitFor(() => expect(calls.some((c) => c.url === "sales/" && c.params.customer_id)).toBe(true));
  expect(calls.filter((c) => c.url === "sales/").every((c) => c.params.summary === 0)).toBe(true);
});
