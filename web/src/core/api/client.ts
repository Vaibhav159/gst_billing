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

let refreshing: Promise<string> | null = null;
/**
 * One refresh at a time. Every 401 waits on the same one: the server rotates refresh tokens and
 * blacklists the old one, so a second refresh with it fails and signs the person out (today's app does that).
 */
export function refreshAccessToken(): Promise<string> {
  if (!refreshing) {
    const { refresh } = getTokens();
    refreshing = (refresh ? axios.post("/api/token/refresh/", { refresh }) : Promise.reject(new Error("no refresh token")))
      .then((r) => { setTokens(r.data.access, r.data.refresh); return r.data.access as string; })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

type Retryable = InternalAxiosRequestConfig & { _retry?: boolean };

api.interceptors.response.use(
  (response) => { markReachable(); return response; },
  async (error: AxiosError) => {
    if (!error.response) { markUnreachable(error); return Promise.reject(error); }
    markReachable();
    const original = error.config as Retryable | undefined;
    const authCall = original?.url?.startsWith("token/");
    if (error.response.status === 401 && original && !original._retry && !authCall) {
      original._retry = true;
      try {
        const access = await refreshAccessToken();
        original.headers.Authorization = `Bearer ${access}`;
        return api(original);
      } catch {
        clearTokens();
        onExpired?.(window.location.pathname + window.location.search);
      }
    }
    return Promise.reject(error);
  },
);
