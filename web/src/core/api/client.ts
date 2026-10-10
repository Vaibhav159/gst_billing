import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { markReachable, markUnreachable } from "./network";

export const ACCESS_KEY = "gst_access_token";
export const REFRESH_KEY = "gst_refresh_token";

function read(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
export function getTokens() { return { access: read(ACCESS_KEY), refresh: read(REFRESH_KEY) }; }
export function setTokens(access: string, refresh?: string) {
  try { localStorage.setItem(ACCESS_KEY, access); if (refresh) localStorage.setItem(REFRESH_KEY, refresh); } catch { /* storage refused */ }
}
export function clearTokens() {
  try { localStorage.removeItem(ACCESS_KEY); localStorage.removeItem(REFRESH_KEY); } catch { /* storage refused */ }
}

/** The user id an access token names (SimpleJWT's user_id claim), read without asking the server. Null when it can't be read. */
export function tokenUser(access: string | null | undefined): string | null {
  try {
    const body = access?.split(".")[1];
    if (!body) return null;
    const id = (JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/"))) as { user_id?: unknown }).user_id;
    return id == null ? null : String(id);
  } catch { return null; }
}

let onExpired: ((from: string) => void) | null = null;
export function setSessionExpiredHandler(fn: ((from: string) => void) | null) { onExpired = fn; }

/**
 * How long any request, the refresh included, waits for its answer: just over nginx's 95 s proxy_read_timeout, so a reply
 * the proxy would still deliver is never abandoned, and a server that never answers reads as not answering (unreachable).
 */
// ponytail: one limit for every request. Upgrade: an upload that can take longer on a slow line passes its own timeout.
const TIMEOUT_MS = 100_000;

export const api = axios.create({ baseURL: "/api/", timeout: TIMEOUT_MS, headers: { "Content-Type": "application/json" } });

api.interceptors.request.use((config) => {
  const { access } = getTokens();
  if (access) config.headers.Authorization = `Bearer ${access}`;
  if (config.data instanceof FormData) delete config.headers["Content-Type"];
  return config;
});

/** The proxy answered for an app server that didn't: as good as no reply. */
const APP_SERVER_DOWN = new Set([502, 503, 504]);
/** What a failed request says about the network: no reply, or only the proxy's, is unreachable; any other reply is reachable. */
function noteFailure(error: AxiosError) {
  if (!error.response || APP_SERVER_DOWN.has(error.response.status)) markUnreachable(error);
  else markReachable();
}

/** The server refused the refresh token, or there is none: the person has to sign in again. */
class SessionEnded extends Error {}
/** Signed out, or signed in as someone else, in this tab or another while this tab's refresh was out. That stands; the session didn't expire. */
class SignedOutMeanwhile extends Error {}

const REFRESH_LOCK = "gst-token-refresh";
/** How long a tab waits for another tab's refresh. It has sent nothing yet, so giving up costs no rotation. */
const LOCK_WAIT_MS = 20_000;

/** Every tab shares one refresh through a Web Lock, where the browser has them (https only); otherwise this tab's single flight does. */
async function underLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return fn();
  const wait = new AbortController();
  const timer = setTimeout(() => wait.abort(), LOCK_WAIT_MS);
  let granted = false;
  try {
    // the limit is for waiting only: once granted, the refresh has its own timeout (and an abort after the grant must not matter)
    return await locks.request(REFRESH_LOCK, { signal: wait.signal }, () => { granted = true; clearTimeout(timer); return fn(); });
  } catch (e) {
    if (granted || !wait.signal.aborted) throw e;
    const stuck = new AxiosError("Another tab's refresh didn't finish", AxiosError.ETIMEDOUT); // no response: reads as unreachable
    markUnreachable(stuck);
    throw stuck;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Another tab's login, if storage holds one made from a refresh token other than `ours`: the server rotated ours away.
 * It may be someone else's sign-in: a request goes again only as the person it was sent for (the interceptor below).
 */
function rotatedElsewhere(ours: string | null): string | null {
  const { access, refresh } = getTokens();
  return access && refresh && refresh !== ours ? access : null;
}

/**
 * Trades the refresh token for new ones, under the lock. `started` is the refresh token this tab had before it waited:
 * if another tab stored a different one meanwhile, that tab already refreshed, so use its tokens.
 * Only a refusal (400 or 401) ends the session: no reply, a timeout or a 5xx keeps the tokens for the next try.
 */
async function renew(started: string | null): Promise<string> {
  const theirs = rotatedElsewhere(started);
  if (theirs) return theirs;
  const sent = getTokens().refresh;
  if (!sent) throw new SessionEnded("no refresh token");
  try {
    const r = await axios.post("/api/token/refresh/", { refresh: sent }, { timeout: TIMEOUT_MS });
    markReachable();
    // The session changed while ours was out: another tab's login stands, and so does a sign-out. Never store over either.
    if (getTokens().refresh !== sent) {
      const rotated = rotatedElsewhere(sent);
      if (rotated) return rotated;
      throw new SignedOutMeanwhile("signed out while the refresh was out");
    }
    setTokens(r.data.access, r.data.refresh);
    return r.data.access as string;
  } catch (e) {
    if (!axios.isAxiosError(e)) throw e;
    const status = e.response?.status;
    if (status === 400 || status === 401) {
      markReachable();
      // Refused, unless another tab rotated the token while ours was out (a v2 tab takes no lock, and storage can lag
      // the lock). Then its login stands: don't wipe it.
      const rotated = rotatedElsewhere(sent);
      if (rotated) return rotated;
      clearTokens();
      throw new SessionEnded("refresh token refused");
    }
    noteFailure(e);
    for (const c of [e.config, e.response?.config]) if (c) c.data = undefined; // the refresh token is a 30-day credential: keep it out of errors
    throw e;
  }
}

let refreshing: Promise<string> | null = null;
/**
 * One refresh at a time. Every 401 waits on the same one: the server rotates refresh tokens and
 * blacklists the old one, so a second refresh with it fails and signs the person out (today's app does that).
 * Tabs share it too (see underLock). Only a refused refresh ends the session, and it's reported once however many requests waited.
 */
export function refreshAccessToken(): Promise<string> {
  if (!refreshing) {
    const started = getTokens().refresh;
    refreshing = underLock(() => renew(started))
      .catch((e: unknown) => {
        if (e instanceof SessionEnded) onExpired?.(window.location.pathname + window.location.search);
        throw e;
      })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

type Retryable = InternalAxiosRequestConfig & { _retry?: boolean };

api.interceptors.response.use(
  (response) => { markReachable(); return response; },
  async (error: AxiosError) => {
    noteFailure(error);
    const original = error.config as Retryable | undefined;
    const authCall = original?.url?.replace(/^\/+/, "").startsWith("token/");
    if (error.response?.status !== 401 || !original || original._retry || authCall) return Promise.reject(error);
    original._retry = true;
    // who this request was sent for, by its own token
    const sentFor = tokenUser(String(original.headers.Authorization ?? "").replace(/^Bearer /, ""));
    let access: string;
    try {
      access = await refreshAccessToken();
      // Someone else signed in meanwhile (another tab, or v2): sent again, this request would act for them (a phone-mode
      // save would change their setting). It doesn't go again; their sign-in stands, and this one is over.
      const now = tokenUser(access);
      if (sentFor !== null && now !== null && now !== sentFor) throw new SignedOutMeanwhile("someone else signed in while the refresh was out");
    } catch (e) {
      // Refused, or signed out meanwhile: the session is over, and the original 401 says so. A blip: the person stays signed in and sees the blip.
      return Promise.reject(e instanceof SessionEnded || e instanceof SignedOutMeanwhile ? error : e);
    }
    original.headers.Authorization = `Bearer ${access}`;
    return api(original);
  },
);
