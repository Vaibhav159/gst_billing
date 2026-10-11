import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { testQueryClient } from "@/test/render";
import { serve } from "@/test/server";
import { api } from "./client";
import { problemOf } from "./errors";
import { saveFile } from "@/core/print/files";
import { auditParams, useAuditExport, useAuditLog, type AuditEntry, type AuditPage } from "./audit";

vi.mock("@/core/print/files", () => ({ saveFile: vi.fn() }));
export const ENTRY: AuditEntry = {
  id: 9012, at: "2026-10-07T15:14:00+05:30", by: { id: 1, name: "Kailash Mehta" }, action: "updated", entity: "customer", entity_id: 7,
  kind: "records", group: "change", words: { text: "Edited customer", target: "Priya Sharma", after: "" }, link: "/customers/7", note: "", details: "phone",
  changes: [{ key: "mobile_number", field: "Phone", from: "98290 41122", to: "98290 41123" }], result: null,
  can: { kind: "revert", label: "Revert…", disabled: "", hint: "Shows what goes back before anything changes", effect: "" },
};
export const PAGE: AuditPage = { count: 1, next: null, previous: null, results: [ENTRY], total: 5123,
  counts: { all: 5123, sales: 2101, purchases: 611, records: 1840, filing: 96, admin: 41, backup: 434 },
  people: [{ id: 1, name: "Kailash Mehta" }, { id: null, name: "Someone no longer here" }],
};
function setup() {
  const qc = testQueryClient();
  return { qc, wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children) };
}
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

test("asks for thirty entries and counts only on the first page; filters reset the loaded pages", async () => {
  const calls = serve({ "GET audit/": ({ params }: { params: Record<string, unknown> }) => ({ status: 200, data: {
    ...PAGE, count: 31, next: params.page === 1 ? "/api/audit/?page=2" : null,
    results: [{ ...ENTRY, id: Number(params.page) }], ...(params.page === 2 ? { counts: undefined, people: undefined } : {}),
  } }) });
  const { wrapper } = setup();
  const { result, rerender } = renderHook(({ kind }) => useAuditLog({ kind, by: "none", group: "change", q: " Priya " }), { wrapper, initialProps: { kind: "records" } });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.pages[0].counts?.all).toBe(5123);
  await act(async () => { await result.current.fetchNextPage(); });
  await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
  expect(calls.map((c) => c.params)).toEqual([
    { kind: "records", by: "none", group: "change", q: "Priya", page: 1, page_size: 30, counts: 1 },
    { kind: "records", by: "none", group: "change", q: "Priya", page: 2, page_size: 30 },
  ]);
  rerender({ kind: "sales" });
  await waitFor(() => expect(calls).toHaveLength(3));
  await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
  expect(calls[2].params).toMatchObject({ page: 1, kind: "sales", counts: 1 });
});

test("preserves record and IST date filters, caps search, drops only empty and all filters", () => {
  expect(auditParams({ by: "all", kind: "all", group: "all", entity: "customer", entity_id: 7, q: " x".repeat(100), start_date: "2026-03-31", end_date: "2026-04-01" })).toEqual({
    entity: "customer", entity_id: 7, q: " x".repeat(100).trim().slice(0, 100), start_date: "2026-03-31", end_date: "2026-04-01",
  });
});

test("exports the active filters through the API, then invalidates the new download entry", async () => {
  const csv = new Blob(["date,time,person"], { type: "text/csv" });
  const calls = serve({ "GET audit/export/": csv });
  const { qc, wrapper } = setup();
  qc.setQueryData(["audit", "list", {}], PAGE);
  const { result } = renderHook(() => useAuditExport(), { wrapper });
  await act(async () => { await result.current.mutateAsync({ kind: "records", group: "change", q: "Priya", by: "none" }); });
  expect(calls[0].params).toEqual({ kind: "records", group: "change", q: "Priya", by: "none" });
  expect(saveFile).toHaveBeenCalledWith(csv, expect.stringMatching(/^Audit-log_\d{4}-\d{2}-\d{2}\.csv$/));
  expect(qc.getQueryState(["audit", "list", {}])?.isInvalidated).toBe(true);
});


test("CSV has its own transfer timeout and uses the server's filename", async () => {
  const csv = new Blob(["csv"]);
  const get = vi.spyOn(api, "get").mockResolvedValue({ data: csv, headers: { "content-disposition": 'attachment; filename="Audit-log_2026-10-08.csv"' } });
  const { wrapper } = setup();
  const { result } = renderHook(() => useAuditExport(), { wrapper });
  await act(async () => { await result.current.mutateAsync({}); });
  expect(get).toHaveBeenCalledWith("audit/export/", expect.objectContaining({ responseType: "blob", timeout: 600_000 }));
  expect(saveFile).toHaveBeenCalledWith(csv, "Audit-log_2026-10-08.csv");
});

test("a JSON refusal received as a Blob retains its exact field words", async () => {
  const refusal = new Blob([JSON.stringify({ end_date: ["The start date is after the end date."] })], { type: "application/json" });
  Object.defineProperty(refusal, "text", { value: async () => JSON.stringify({ end_date: ["The start date is after the end date."] }) });
  serve({ "GET audit/export/": () => ({ status: 400, data: refusal }) });
  const { wrapper } = setup();
  const { result } = renderHook(() => useAuditExport(), { wrapper });
  let failed: unknown;
  await act(async () => { try { await result.current.mutateAsync({ start_date: "2026-04-01", end_date: "2026-03-31" }); } catch (error) { failed = error; } });
  expect(problemOf(failed).message).toBe("The start date is after the end date.");
  expect(saveFile).not.toHaveBeenCalled();
});
