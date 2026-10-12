import { useEffect, useState, useSyncExternalStore } from "react";

export type NetState = "online" | "offline" | "unreachable";

let state: NetState = typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "online";
const listeners = new Set<() => void>();
function set(s: NetState) {
  if (s === state) return;
  state = s;
  listeners.forEach((l) => l());
}

/** A response arrived: the server is reachable. Unless the browser has since gone offline: a reply already on its way when the connection dropped doesn't mean we're back. */
export function markReachable() { set(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "online"); }
/** A request got no response. Cancelled requests don't count. We learn from real requests only: never poll (Neon's budget). */
export function markUnreachable(error?: unknown) {
  if ((error as { code?: string } | undefined)?.code === "ERR_CANCELED") return;
  set(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "unreachable");
}
export function __setNetState(s: NetState) { set(s); }

if (typeof window !== "undefined") {
  window.addEventListener("offline", () => set("offline"));
  // optimistic: the next real request confirms or corrects it
  window.addEventListener("online", () => set("online"));
}

export function useNetwork(): NetState {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => state, () => "online");
}

/** True once `busy` has lasted `ms` (the prototype's "slow" threshold), for "Still working…" notes. */
export function useSlow(busy: boolean, ms = 1400): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) { setSlow(false); return undefined; }
    const t = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(t);
  }, [busy, ms]);
  return busy && slow;
}
