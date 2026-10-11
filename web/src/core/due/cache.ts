import { useCallback, useEffect, useSyncExternalStore } from "react";
import { notifyManager, QueryObserver, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { DueNext } from "@/core/api/dashboard";
import { dueNextKeys } from "./keys";
import type { FirmId } from "@/core/scope";

/** The newest answer for this firm, with or without returns. No FY and no other firm's fallback. */
function latest(qc: QueryClient, firm: FirmId | null) {
  if (firm === null) return undefined;
  const plain = qc.getQueryState<DueNext>(dueNextKeys.one(firm, false));
  const rich = qc.getQueryState<DueNext>(dueNextKeys.one(firm, true));
  if (!plain?.data) return rich?.data ? rich : undefined;
  if (!rich?.data) return plain;
  return rich.dataUpdatedAt >= plain.dataUpdatedAt ? rich : plain;
}

/** Disabled exact-key observers retain answers without replacing a visible reader's request function. */
export function useCachedDue(firm: FirmId | null) {
  const qc = useQueryClient();
  useEffect(() => {
    if (firm === null) return;
    const stop = [false, true].map(withReturns => new QueryObserver<DueNext>(qc, {
      queryKey: dueNextKeys.one(firm, withReturns), enabled: false,
    }).subscribe(() => {}));
    return () => stop.forEach(unsubscribe => unsubscribe());
  }, [qc, firm]);
  const subscribe = useCallback((changed: () => void) => qc.getQueryCache().subscribe(notifyManager.batchCalls(changed)), [qc]);
  const snapshot = useCallback(() => latest(qc, firm), [qc, firm]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  return { data: state?.data, withReturns: Boolean(state && state === qc.getQueryState(dueNextKeys.one(firm, true))) };
}
