import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/core/api/client";
import { useAuth } from "@/core/auth/AuthProvider";

/** Per-person settings on the server (/api/preferences/). defaultBusinessId is the key v2's Settings already uses. */
export type Prefs = { defaultBusinessId?: string; phoneMode?: "easy" | "expert"; [key: string]: unknown };

/** Each person's preferences as the server last gave them, kept on this device so the next load starts from them. */
const keptKey = (id: number) => `gst3.prefs.${id}`;
function readKept(id: number): Prefs | undefined {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(keptKey(id)) ?? "null");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Prefs) : undefined;
  } catch { return undefined; }
}
function keep(id: number, prefs: Prefs) {
  try { localStorage.setItem(keptKey(id), JSON.stringify(prefs)); } catch { /* storage refused: the next load waits for the server */ }
}

/**
 * This person's preferences. Until the server answers, the copy kept from their last visit on this device stands in
 * (and stays in use if the server can't be reached), so the usual firm and the phone mode are right from the first paint.
 * ready: there's something to go by (the server's answer, the kept copy, or the defaults once the server couldn't be asked).
 * loading: the server's own copy hasn't come yet, for callers that must have it.
 */
export function usePrefs() {
  const qc = useQueryClient();
  const { status, me } = useAuth();
  const id = me?.id;
  const kept = useMemo(() => (id === undefined ? undefined : readKept(id)), [id]);
  const q = useQuery({ queryKey: ["prefs", id], enabled: status === "signed-in", staleTime: Infinity, queryFn: async () => (await api.get("preferences/")).data.data as Prefs });
  // kept for whoever this query is for, once the server has answered. Not in queryFn: when someone else signs in on
  // another tab, AuthProvider's reset refetches the last person's query at once, with the new person's token.
  useEffect(() => { if (id !== undefined && q.data) keep(id, q.data); }, [id, q.data]);
  const m = useMutation({
    mutationFn: async (patch: Partial<Prefs>) => (await api.patch("preferences/", patch)).data.data as Prefs,
    // the answer belongs to whoever sent the change: onMutate keeps them, since a switch while it's out updates onSuccess in place
    onMutate: () => me?.id,
    onSuccess: (d, _patch, sentFor) => { qc.setQueryData(["prefs", sentFor], d); if (sentFor !== undefined) keep(sentFor, d); },
  });
  return { prefs: q.data ?? kept ?? {}, ready: q.data !== undefined || kept !== undefined || q.isError, loading: q.isPending, setPrefs: m.mutateAsync };
}

/** Easy or Expert on a phone: the person's setting, else what v2 remembered on this phone, else Easy (today's default). */
export function phoneModeOf(prefs: Prefs): "easy" | "expert" {
  if (prefs.phoneMode === "easy" || prefs.phoneMode === "expert") return prefs.phoneMode;
  try { const v2 = localStorage.getItem("mobile-mode"); if (v2 === "expert" || v2 === "easy") return v2; } catch { /* storage refused */ }
  return "easy";
}
