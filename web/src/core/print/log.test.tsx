// The audit log's lines for printing: one home for the print page, a share's download and batch print.
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { refuse, salesServer, wireDetail } from "@/core/sales/fixtures";
import { toBillDetail } from "@/core/sales/wire";
import { testQueryClient } from "@/test/render";
import { batchLog, billLog, useLogPrint } from "./log";

const BILL = toBillDetail(wireDetail());

test("a bill's lines, as v2's bulk PDFs wrote them: printed from its print page, or its PDF downloaded", () => {
  expect(billLog("printed", BILL, "original")).toEqual({ action: "printed", entity_id: 412, entity_name: "#KGH/2026-27/31 - Anil Gupta", details: "Printed: original copy" });
  expect(billLog("exported", BILL, "all")).toEqual({ action: "exported", entity_id: 412, entity_name: "#KGH/2026-27/31 - Anil Gupta", details: "PDF downloaded: all three copies" });
  expect(billLog("exported", BILL, "duplicate").details).toBe("PDF downloaded: duplicate copy");
});

test("many bills' line, as v2's bulk PDFs wrote it (entity_id 0): the bills firm by firm with their numbers, the pages, and three copies each", () => {
  const span = "3 bills from 2 firms: KIRAN GOLD HOUSE (KGH/2026-27/31, KGH/2026-27/32) and MEERA ORNAMENTS (MO/2026-27/7)";
  expect(batchLog("printed", { what: "3 bills", span, pages: 9, copies: "all" })).toEqual({
    action: "printed", entity_id: 0, entity_name: "Batch print (3 bills)", details: `${span} · 9 pages · three copies each`,
  });
  expect(batchLog("exported", { what: "1 bill", span: "KGH/2026-27/31", pages: 1, copies: "original" })).toEqual({
    action: "exported", entity_id: 0, entity_name: "Combined PDF (1 bill)", details: "KGH/2026-27/31 · 1 page",
  });
});

test("a line goes into the audit log against the bill, and a log that fails stops nothing", async () => {
  let fail = false;
  const { calls } = salesServer([["POST", "audit-logs/log/", () => (fail ? refuse(500, {}) : { ok: true })]]);
  const qc = testQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useLogPrint(), { wrapper });
  act(() => result.current(billLog("printed", BILL, "all")));
  await waitFor(() => expect(calls.map((c) => c.body)).toEqual([
    { action: "printed", entity: "invoice", entity_id: 412, entity_name: "#KGH/2026-27/31 - Anil Gupta", details: "Printed: all three copies" },
  ]));
  fail = true;
  act(() => result.current(billLog("exported", BILL, "original")));
  await waitFor(() => expect(calls).toHaveLength(2));
  // the refusal is the mutation's own, kept quiet: nothing throws
  await waitFor(() => expect(qc.getMutationCache().getAll().at(-1)?.state.status).toBe("error"));
});
