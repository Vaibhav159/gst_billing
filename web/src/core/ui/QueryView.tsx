import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { problemOf } from "@/core/api/errors";
import { useNetwork, useSlow } from "@/core/api/network";
import { ListSkeleton, LoadError } from "./Feedback";

/** The prototype's loading, slow and error states for any query: never "₹0" or "nothing here" while it's still loading. */
export function QueryView<T>({ query, what, skeleton, children }: { query: UseQueryResult<T>; what: string; skeleton?: ReactNode; children: (data: T) => ReactNode }) {
  const net = useNetwork();
  const slow = useSlow(query.isPending && !query.isPaused);
  // offline, TanStack holds the request and sends it once the device is back: the prototype's offline state, not "Still
  // loading". It also holds a retry while the tab is hidden, which isn't offline. No Try again: refetch() does nothing then.
  if (query.isPending && query.isPaused && net === "offline") return <LoadError problem={{ kind: "offline", message: "You're offline" }} what={what} />;
  if (query.isPending) return <>{skeleton ?? <ListSkeleton what={what} />}{slow ? <p role="status" className="mt-3 text-sm text-muted">Still loading {what}…</p> : null}</>;
  if (query.isError) return <LoadError problem={problemOf(query.error)} what={what} retry={() => query.refetch()} />;
  return <>{children(query.data as T)}</>;
}
