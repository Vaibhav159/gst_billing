// Printing's lines in the audit log (contract §2.2, as v2's bulk PDFs wrote them): the one home for the print page, a
// share's download (pages/sales/actions/deliver.ts) and batch print.
import { useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/core/api/client";
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
    action, entity_id: b.id, entity_name: `#${b.invoice_number} - ${b.customer.name}`,
    details: `${action === "printed" ? "Printed" : "PDF downloaded"}: ${copiesWords(copies).toLowerCase()}`,
  };
}
