import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { useNetwork, useSlow } from "@/core/api/network";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { ListSkeleton, LoadError } from "./Feedback";

/**
 * Above data still on screen when asking for it again failed: it stays, and this says why and offers Try again
 * (offline, TanStack asks again by itself once the device is back, so no button then).
 */
export function StaleNote({ problem, what, retry }: { problem: ApiProblem; what: string; retry?: () => void }) {
  const why = problem.kind === "offline" ? "You're offline, so this is what was last loaded. It refreshes when you're back online."
    : problem.kind === "unreachable" || problem.kind === "server" ? "The app couldn't reach the shop's records just now, so this is what was last loaded."
      : `${problem.message} This is what was last loaded.`;
  return (
    <Banner tone="neg" title={`Couldn't refresh ${what}`} actions={retry && problem.kind !== "offline" ? <Button size="sm" onClick={retry}>Try again</Button> : undefined}>
      {why}
    </Banner>
  );
}

/** The prototype's loading, slow and error states for any query: never "₹0" or "nothing here" while it's still loading. */
export function QueryView<T>({ query, what, skeleton, children }: { query: UseQueryResult<T>; what: string; skeleton?: ReactNode; children: (data: T) => ReactNode }) {
  const net = useNetwork();
  // a query that hasn't started (enabled: false) waits for something it needs, such as the firm: it isn't slow, it's waiting
  const waiting = query.isPending && query.fetchStatus === "idle";
  const slow = useSlow(query.isPending && !query.isPaused && !waiting);
  // offline, TanStack holds the request and sends it once the device is back, and a waiting query can't start: the
  // prototype's offline state, not "Still loading". No Try again: refetch() does nothing then.
  if (query.isPending && (query.isPaused || waiting) && net === "offline") return <LoadError problem={{ kind: "offline", message: "You're offline" }} what={what} />;
  if (query.isPending) return <>{skeleton ?? <ListSkeleton what={what} />}{slow ? <p role="status" className="mt-3 text-sm text-muted">Still loading {what}…</p> : null}</>;
  if (query.isError && query.data === undefined) return <LoadError problem={problemOf(query.error)} what={what} retry={() => query.refetch()} />;
  // a refetch that failed keeps what was shown, and says so (part 0 carry: it used to swap the list for the error card)
  if (query.isError) return <><StaleNote problem={problemOf(query.error)} what={what} retry={() => void query.refetch()} />{children(query.data as T)}</>;
  return <>{children(query.data as T)}</>;
}
