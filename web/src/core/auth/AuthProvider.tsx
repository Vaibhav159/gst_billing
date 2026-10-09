import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, clearTokens, getTokens, setSessionExpiredHandler, setTokens } from "@/core/api/client";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { can as canDo, whyNot as whyNotFor, type Action } from "./permissions";
import { RoleContext, type Role } from "./role";

export type Me = { id: number; username: string; fullName: string; role: Role; roleLabel: string; permissions: "*" | Action[]; needsRoleChoice: boolean };
type Status = "loading" | "signed-in" | "signed-out" | "error";
type SignIn = { ok: true } | { ok: false; problem: ApiProblem };
export type AuthValue = {
  me: Me | null; status: Status; startProblem: ApiProblem | null; expiredFrom: string | null;
  signIn(username: string, password: string): Promise<SignIn>; signOut(): void; retryStart(): void;
  can(a: Action): boolean; whyNot(a: Action, what?: string): string;
};

export const AuthContext = createContext<AuthValue | null>(null);
const ME_KEY = "gst3.me";

function readMe(): Me | null { try { const s = localStorage.getItem(ME_KEY); return s ? (JSON.parse(s) as Me) : null; } catch { return null; } }
function saveMe(me: Me | null) { try { if (me) localStorage.setItem(ME_KEY, JSON.stringify(me)); else localStorage.removeItem(ME_KEY); } catch { /* storage refused */ } }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMe(d: any): Me { return { id: d.id, username: d.username, fullName: d.full_name, role: d.role, roleLabel: d.role_label, permissions: d.permissions, needsRoleChoice: d.needs_role_choice }; }

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const signedIn = Boolean(getTokens().access);
  const [me, setMe] = useState<Me | null>(() => (signedIn ? readMe() : null));
  const [status, setStatus] = useState<Status>(() => (!signedIn ? "signed-out" : readMe() ? "signed-in" : "loading"));
  const [startProblem, setStartProblem] = useState<ApiProblem | null>(null);
  const [expiredFrom, setExpiredFrom] = useState<string | null>(null);

  const forget = useCallback(() => { clearTokens(); saveMe(null); qc.clear(); setMe(null); setStatus("signed-out"); }, [qc]);

  const loadMe = useCallback(async () => {
    const r = await api.get("me/");
    const m = toMe(r.data);
    saveMe(m); setMe(m); setStatus("signed-in"); setStartProblem(null);
  }, []);

  const start = useCallback(() => {
    if (!getTokens().access) return;
    loadMe().catch((e) => {
      const p = problemOf(e);
      if (p.kind === "auth") { forget(); return; }
      // offline or the server is down: a remembered person keeps working; otherwise say so
      if (!readMe()) { setStartProblem(p); setStatus("error"); }
    });
  }, [loadMe, forget]);

  useEffect(() => {
    setSessionExpiredHandler((from) => { setExpiredFrom(from); forget(); });
    start();
    return () => setSessionExpiredHandler(null);
  }, [start, forget]);

  const signIn = useCallback(async (username: string, password: string): Promise<SignIn> => {
    try {
      const r = await api.post("token/", { username, password });
      setTokens(r.data.access, r.data.refresh);
      await loadMe();
      setExpiredFrom(null);
      return { ok: true };
    } catch (e) {
      clearTokens();
      return { ok: false, problem: problemOf(e) };
    }
  }, [loadMe]);

  const value = useMemo<AuthValue>(() => ({
    me, status, startProblem, expiredFrom, signIn, signOut: forget, retryStart: start,
    can: (a) => canDo(me?.permissions, a),
    whyNot: (a, what) => (me ? whyNotFor(me.role, a, what) : ""),
  }), [me, status, startProblem, expiredFrom, signIn, forget, start]);

  return <AuthContext.Provider value={value}><RoleContext.Provider value={me?.role ?? null}>{children}</RoleContext.Provider></AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth needs AuthProvider");
  return v;
}
