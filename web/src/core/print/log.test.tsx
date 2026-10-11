// The audit log's lines for printing: one home for the print page, a share's download and batch print.
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { refuse, salesServer, wireDetail } from "@/core/sales/fixtures";
import { toBillDetail } from "@/core/sales/wire";
import { testQueryClient } from "@/test/render";
import { billLog, useLogPrint } from "./log";

const BILL = toBillDetail(wireDetail());

test("a bill's lines, as v2's bulk PDFs wrote them: printed from its print page, or its PDF downloaded", () => {
  expect(billLog("printed", BILL, "original")).toEqual({ action: "printed", entity_id: 412, entity_name: "#KGH/2026-27/31 - Anil Gupta", details: "Printed: original copy" });
  expect(billLog("exported", BILL, "all")).toEqual({ action: "exported", entity_id: 412, entity_name: "#KGH/2026-27/31 - Anil Gupta", details: "PDF downloaded: all three copies" });
  expect(billLog("exported", BILL, "duplicate").details).toBe("PDF downloaded: duplicate copy");
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
