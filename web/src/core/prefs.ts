import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/core/api/client";
import { useAuth } from "@/core/auth/AuthProvider";

/** Per-person settings on the server (/api/preferences/). defaultBusinessId is the key v2's Settings already uses. */
export type Prefs = { defaultBusinessId?: string; phoneMode?: "easy" | "expert"; [key: string]: unknown };

export function usePrefs() {
  const qc = useQueryClient();
  const { status } = useAuth();
  const q = useQuery({ queryKey: ["prefs"], enabled: status === "signed-in", staleTime: Infinity, queryFn: async () => (await api.get("preferences/")).data.data as Prefs });
  const m = useMutation({ mutationFn: async (patch: Partial<Prefs>) => (await api.patch("preferences/", patch)).data.data as Prefs, onSuccess: (d) => qc.setQueryData(["prefs"], d) });
  return { prefs: q.data ?? {}, loading: q.isPending, setPrefs: m.mutateAsync };
}

/** Easy or Expert on a phone: the person's setting, else what v2 remembered on this phone, else Easy (today's default). */
export function phoneModeOf(prefs: Prefs): "easy" | "expert" {
  if (prefs.phoneMode === "easy" || prefs.phoneMode === "expert") return prefs.phoneMode;
  try { const v2 = localStorage.getItem("mobile-mode"); if (v2 === "expert" || v2 === "easy") return v2; } catch { /* storage refused */ }
  return "easy";
}
