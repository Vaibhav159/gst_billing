// Printing's lines in the audit log (contract §2.2, as v2's bulk PDFs wrote them): the one home for the print page, a
// share's download (pages/sales/actions/deliver.ts), batch print and bulk PDFs.
import { useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/core/api/client";
import { plural } from "@/core/format";
import type { Copies } from "@/core/sales/types";
import { copiesWords } from "./model";

export type PrintLog = { action: "printed" | "exported"; entity_id: number; entity_name: string; details: string };

/** A print or a PDF goes into the audit log against the bills (entity "invoice"). A log that fails stops nothing. */
export function useLogPrint(): (entry: PrintLog) => void {
  const { mutate } = useMutation({ mutationFn: (e: PrintLog) => api.post("audit-logs/log/", { ...e, entity: "invoice" }) });
  return useCallback((e) => mutate(e), [mutate]);
}

/** One bill's line: printed from its print page, or its PDF downloaded (the print page's PDF, or a share's download). */
export function billLog(action: PrintLog["action"], b: { id: number; invoice_number: string; customer: { name: string } }, copies: Copies): PrintLog {
  return {
    action, entity_id: b.id, entity_name: `#${b.invoice_number} - ${b.customer.name}`.slice(0, 255),
    details: `${action === "printed" ? "Printed" : "PDF downloaded"}: ${copiesWords(copies).toLowerCase()}`,
  };
}

/**
 * Many bills' line, entity_id 0 as v2's bulk PDFs wrote it for many: "Batch print (3 bills)" or "Combined PDF (3 bills)",
 * then span (billsSpan with their numbers: the bills firm by firm), the pages, and "three copies each" for all three.
 */
export function batchLog(action: PrintLog["action"], { what, span, pages, copies }: { what: string; span: string; pages: number; copies: Copies }): PrintLog {
  return {
    action, entity_id: 0, entity_name: `${action === "printed" ? "Batch print" : "Combined PDF"} (${what})`,
    details: `${span} · ${plural(pages, "page")}${copies === "all" ? " · three copies each" : ""}`,
  };
}

/** A bulk zip's line: every bill firm by firm, the chosen period and the file's name. */
export function exportLog({ what, span, period, name }: { what: string; span: string; period: string; name: string }): PrintLog {
  return {
    action: "exported", entity_id: 0, entity_name: `Bulk PDFs (${what})`,
    details: `${span} · ${period} · ${name}`,
  };
}
