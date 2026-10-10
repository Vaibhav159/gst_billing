import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ACCESS_KEY, REFRESH_KEY, api, clearTokens, getTokens, setSessionExpiredHandler, setTokens } from "@/core/api/client";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { can as canDo, whyNot as whyNotFor, type Action } from "./permissions";
import { RoleContext, type Role } from "./role";

export type Me = { id: number; username: string; fullName: string; role: Role; roleLabel: string; permissions: "*" | Action[]; needsRoleChoice: boolean };
type Status = "loading" | "signed-in" | "signed-out" | "error";
type SignIn = { ok: true } | { ok: false; problem: ApiProblem };
export type AuthValue = {
  me: Me | null; status: Status; startProblem: ApiProblem | null; expiredFrom: string | null;
  /** Signed out on purpose, here or on another tab, since anyone last signed in on this tab (it survives a reload): the sign-in page keeps no page for whoever is next. */
  signedOutOnPurpose: boolean;
  signIn(username: string, password: string): Promise<SignIn>; signOut(): void; retryStart(): void;
  can(a: Action): boolean; whyNot(a: Action, what?: string): string;
};

export const AuthContext = createContext<AuthValue | null>(null);
const ME_KEY = "gst3.me";

function readMe(): Me | null { try { const s = localStorage.getItem(ME_KEY); return s ? (JSON.parse(s) as Me) : null; } catch { return null; } }
function saveMe(me: Me | null) { try { if (me) localStorage.setItem(ME_KEY, JSON.stringify(me)); else localStorage.removeItem(ME_KEY); } catch { /* storage refused */ } }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMe(d: any): Me { return { id: d.id, username: d.username, fullName: d.full_name, role: d.role, roleLabel: d.role_label, permissions: d.permissions, needsRoleChoice: d.needs_role_choice }; }

/**
 * This tab saw a sign-out on purpose (Ruling 39). Per tab, in sessionStorage: a reload or a link opened here still starts
 * the next person on a plain sign-in page, while a new tab is a first visit. Signing in here clears it.
 */
const MARK_KEY = "gst3.signedOutHere";
function readMark(): boolean { try { return sessionStorage.getItem(MARK_KEY) !== null; } catch { return false; } }
function saveMark(on: boolean) { try { if (on) sessionStorage.setItem(MARK_KEY, "1"); else sessionStorage.removeItem(MARK_KEY); } catch { /* storage refused: the mark lasts this page */ } }

/** The user id an access token names (SimpleJWT's user_id claim), read without asking the server. Null when it can't be read. */
function tokenUser(access: string | null): string | null {
  try {
    const body = access?.split(".")[1];
    if (!body) return null;
    const id = (JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/"))) as { user_id?: unknown }).user_id;
    return id == null ? null : String(id);
  } catch { return null; }
}
/** False only when the token plainly belongs to someone else (v2 or another tab signed them in). */
function tokenFits(m: Me, access: string | null): boolean {
  const u = tokenUser(access);
  return u === null || u === String(m.id);
}
/** Who this browser last signed in as, when the stored token is theirs: the app opens with them straight away, even offline. */
function remembered(): Me | null {
  const { access } = getTokens();
  const m = access ? readMe() : null;
  return m && tokenFits(m, access) ? m : null;
}

/**
 * Who is signed in, for every page. Tabs share one sign-in (the tokens in localStorage, shared with v2), so another tab's
 * change reaches this one by storage events, never a timer: signed out there, signed out here; a new token there, ask
 * /api/me/ who it is now. A different person clears the cache and is passed to onSwitchedUser, for App to show
 * "Signed in as <name>", so a half-filled bill isn't saved under someone else's sign-in unnoticed.
 */
export function AuthProvider({ children, onSwitchedUser }: { children: ReactNode; onSwitchedUser?: (me: Me) => void }) {
  const qc = useQueryClient();
  const [me, setMe] = useState<Me | null>(remembered);
  const [status, setStatus] = useState<Status>(() => (!getTokens().access ? "signed-out" : remembered() ? "signed-in" : "loading"));
  const [startProblem, setStartProblem] = useState<ApiProblem | null>(null);
  const [expiredFrom, setExpiredFrom] = useState<string | null>(null);
  const [onPurpose, setOnPurpose] = useState(readMark);
  /** The person this tab last showed (signing out forgets them), for the callbacks below. */
  const shown = useRef(me);
  /** The access token whose owner this tab knows, or is asking /api/me/ about. */
  const checked = useRef<string | null>(null);
  /** Each question to /api/me/ and each sign-out moves this on, so an answer to an older question is dropped. */
  const gen = useRef(0);
  const switched = useRef(onSwitchedUser);
  switched.current = onSwitchedUser;

  const forget = useCallback(() => {
    gen.current++; checked.current = null; shown.current = null;
    clearTokens(); saveMe(null); qc.clear(); setMe(null); setStatus("signed-out");
  }, [qc]);
  // On a shared counter computer the next person mustn't land on this person's page: a sign-out here, or one heard
  // from another tab (which can't be told from a session that ran out there), leaves the sign-in page plain, reloads included.
  const signOut = useCallback(() => { saveMark(true); setOnPurpose(true); forget(); }, [forget]);

  /** This tab's person is now `m`. Someone other than the person shown clears the cache and, unless this tab signed them in, is announced. */
  const adopt = useCallback((m: Me, announce: boolean) => {
    const before = shown.current;
    const other = before !== null && before.id !== m.id;
    const next = before && JSON.stringify(before) === JSON.stringify(m) ? before : m; // unchanged details keep the object: nothing re-renders
    // what's on screen refetches for the new person (clear() would leave a mounted list showing the last person's rows)
    if (other) { void qc.resetQueries(); qc.getMutationCache().clear(); }
    shown.current = next;
    saveMe(next); setMe(next); setStatus("signed-in"); setStartProblem(null); setExpiredFrom(null); setOnPurpose(false); saveMark(false);
    if (other && announce) switched.current?.(next);
  }, [qc]);

  /** Who the stored token belongs to, from the server. Null when a later question or a sign-out overtook this one. */
  const ask = useCallback(async (): Promise<Me | null> => {
    checked.current = getTokens().access;
    const g = ++gen.current;
    try {
      const r = await api.get("me/");
      return g === gen.current ? toMe(r.data) : null;
    } catch (e) {
      if (g !== gen.current) return null;
      throw e;
    }
  }, []);

  /**
   * The server couldn't say who this is (offline, or it's down). The person last shown carries on if the token is theirs.
   * Otherwise no one is shown and Try again asks again; `shown` keeps them, so the answer is announced if it's someone else.
   */
  const unconfirmed = useCallback((p: ApiProblem) => {
    const m = shown.current;
    if (m && tokenFits(m, getTokens().access)) { setMe(m); setStatus("signed-in"); setStartProblem(null); return; }
    setMe(null); setStartProblem(p); setStatus("error");
  }, []);

  const start = useCallback(() => {
    if (!getTokens().access) return;
    ask().then((m) => { if (m) adopt(m, true); }, (e: unknown) => {
      const p = problemOf(e);
      if (p.kind === "auth") forget();
      // offline or the server is down: a remembered person keeps working; otherwise say so
      else unconfirmed(p);
    });
  }, [ask, adopt, forget, unconfirmed]);

  useEffect(() => {
    setSessionExpiredHandler((from) => { setExpiredFrom(from); forget(); });
    start();
    return () => setSessionExpiredHandler(null);
  }, [start, forget]);

  /**
   * The sign-in stored now, followed (Ruling 30). What's stored decides, not the event that told this tab: a sign-out
   * heard after a newer sign-in must not wipe that sign-in. No tokens: signed out, to a plain sign-in page, unless this
   * page never had a token to check (it was signed out already: nothing to sign out of, and no mark to set). A token
   * this tab hasn't checked (someone else's sign-in, or a refresh): ask who it is now.
   */
  const follow = useCallback(() => {
    const { access } = getTokens();
    if (!access) { if (checked.current !== null) signOut(); }
    else if (access !== checked.current) start();
  }, [signOut, start]);

  // Another tab signed out, signed in or refreshed.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== ACCESS_KEY && e.key !== REFRESH_KEY && e.key !== ME_KEY) return;
      follow();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [follow]);

  // Back or Forward to this page from the browser's back/forward cache: it's as it was left, and it heard no storage
  // events while it was away, so it follows what's stored now as if it had (Ruling 42). An unchanged session stays.
  // A sign-out on purpose in this tab meanwhile counts, as on a reload; only ever to set it: a mark this tab's storage
  // refused to keep lives on in memory (Ruling 44).
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      if (readMark()) setOnPurpose(true);
      follow();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [follow]);

  const signIn = useCallback(async (username: string, password: string): Promise<SignIn> => {
    let mine: string | null = null;
    try {
      const r = await api.post("token/", { username, password });
      mine = r.data.access as string;
      setTokens(r.data.access, r.data.refresh);
      const m = await ask();
      if (m) adopt(m, false);
      return { ok: true };
    } catch (e) {
      // only this sign-in's own tokens: a failed try here never signs another tab out
      if (mine && getTokens().access === mine) clearTokens();
      return { ok: false, problem: problemOf(e) };
    }
  }, [ask, adopt]);

  const value = useMemo<AuthValue>(() => ({
    me, status, startProblem, expiredFrom, signedOutOnPurpose: onPurpose, signIn, signOut, retryStart: start,
    can: (a) => canDo(me?.permissions, a),
    whyNot: (a, what) => (me ? whyNotFor(me.role, a, what) : ""),
  }), [me, status, startProblem, expiredFrom, onPurpose, signIn, signOut, start]);

  return <AuthContext.Provider value={value}><RoleContext.Provider value={me?.role ?? null}>{children}</RoleContext.Provider></AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth needs AuthProvider");
  return v;
}
