import axios from "axios";

export type ApiProblem = { kind: "offline" | "unreachable" | "server" | "auth" | "forbidden" | "notfound" | "validation" | "conflict" | "throttled"; message: string; fields?: Record<string, string> };

function text(v: unknown): string { return Array.isArray(v) ? String(v[0]) : String(v); }
function firstMessage(data: unknown): string | null {
  if (!data) return null;
  if (typeof data === "string") return data.length < 200 && !data.trimStart().startsWith("<") ? data : null;
  if (typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  for (const k of ["detail", "error", "non_field_errors"]) if (d[k]) return text(d[k]);
  const first = Object.values(d)[0];
  return first ? text(first) : null;
}
function fieldErrors(data: unknown): Record<string, string> | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) if (!["detail", "error", "non_field_errors"].includes(k)) out[k] = text(v);
  return Object.keys(out).length ? out : undefined;
}

/** Any failure from the API, as a kind the screens can act on and words a person can read. */
export function problemOf(error: unknown): ApiProblem {
  if (!axios.isAxiosError(error)) return { kind: "server", message: "Something went wrong" };
  if (!error.response) {
    return typeof navigator !== "undefined" && navigator.onLine === false
      ? { kind: "offline", message: "You're offline" }
      : { kind: "unreachable", message: "The app couldn't get through" };
  }
  const { status, data } = error.response;
  if (status === 401) return { kind: "auth", message: "You've been signed out. Sign in again." };
  if (status === 403) return { kind: "forbidden", message: firstMessage(data) || "Your role can't do this. Ask the owner if you need it." };
  if (status === 404) return { kind: "notfound", message: "That isn't there any more." };
  if (status === 409) return { kind: "conflict", message: firstMessage(data) || "Someone changed this at the same time. Open it again." };
  if (status === 429) return { kind: "throttled", message: "Too many tries. Wait a minute, then try again." };
  if (status === 400) return { kind: "validation", message: firstMessage(data) || "Something in the form needs fixing.", fields: fieldErrors(data) };
  return { kind: "server", message: "The app couldn't get through" };
}

/** The prototype's words for a save that didn't happen (PROTO/core/store.jsx failureFor). */
export function saveFailure(p: ApiProblem): { title: string; body: string } {
  if (p.kind === "offline") return { title: "You're offline, so this wasn't saved", body: "What you typed is still here. Save again when the internet is back." };
  if (p.kind === "unreachable" || p.kind === "server") return { title: "Not saved: the app couldn't get through", body: "Nothing was changed. What you typed is still here; try again in a minute." };
  return { title: "Not saved", body: p.message };
}
