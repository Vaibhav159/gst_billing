import { useCallback, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { dueNextKeys, type DueNext } from "@/core/api/dashboard";
import type { FirmId } from "@/core/scope";

/** The newest answer for this firm, with or without returns. No FY and no other firm's fallback. */
function latest(qc: QueryClient, firm: FirmId | null) {
  if (firm === null) return undefined;
  return qc.getQueryCache().findAll({ queryKey: dueNextKeys.scope(firm) })
    .filter(q => q.state.data !== undefined)
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt || Number(b.queryKey[2] === true) - Number(a.queryKey[2] === true))[0];
}

/** Subscribes to the cache itself: these readers never make a query active or register a query function. */
export function useCachedDue(firm: FirmId | null) {
  const qc = useQueryClient();
  const subscribe = useCallback((changed: () => void) => qc.getQueryCache().subscribe(changed), [qc]);
  const snapshot = useCallback(() => latest(qc, firm)?.state, [qc, firm]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  return { data: state?.data as DueNext | undefined, withReturns: latest(qc, firm)?.queryKey[2] === true };
}
