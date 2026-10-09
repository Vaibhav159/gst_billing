import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
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

let onExpired: ((from: string) => void) | null = null;
export function setSessionExpiredHandler(fn: ((from: string) => void) | null) { onExpired = fn; }

export const api = axios.create({ baseURL: "/api/", headers: { "Content-Type": "application/json" } });

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

const REFRESH_LOCK = "gst-token-refresh";
/** Every tab shares one refresh through a Web Lock, where the browser has them (https only); otherwise this tab's single flight does. */
async function underLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  return locks ? await locks.request(REFRESH_LOCK, fn) : fn();
}

/**
 * Trades the refresh token for new ones, under the lock. `started` is the refresh token this tab had before it waited:
 * if another tab stored a different one meanwhile, that tab already refreshed (the server rotated `started`), so use its tokens.
 * Only a refusal (400 or 401) ends the session: no reply or a 5xx keeps the tokens for the next try.
 */
async function renew(started: string | null): Promise<string> {
  const { access, refresh } = getTokens();
  if (access && refresh && refresh !== started) return access;
  if (!refresh) throw new SessionEnded("no refresh token");
  const r = await axios.post("/api/token/refresh/", { refresh }).catch((e: unknown) => {
    if (!axios.isAxiosError(e)) throw e;
    const status = e.response?.status;
    if (status === 400 || status === 401) { markReachable(); clearTokens(); throw new SessionEnded("refresh token refused"); }
    noteFailure(e);
    throw e;
  });
  markReachable();
  setTokens(r.data.access, r.data.refresh);
  return r.data.access as string;
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
    let access: string;
    try {
      access = await refreshAccessToken();
    } catch (e) {
      // Refused: the session is over, and the original 401 says so. A blip: the person stays signed in and sees the blip.
      return Promise.reject(e instanceof SessionEnded ? error : e);
    }
    original.headers.Authorization = `Bearer ${access}`;
    return api(original);
  },
);
