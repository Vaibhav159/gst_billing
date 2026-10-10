import axios from "axios";

export type ApiProblem = {
  kind: "offline" | "unreachable" | "server" | "auth" | "forbidden" | "notfound" | "validation" | "conflict" | "throttled";
  message: string;
  /** Each field's words by name; a list's rows by place, as "lines.1.quantity" (DRF answers a list with a list, {} for a good row). */
  fields?: Record<string, string>;
  /** The server's code for a refusal, when it sends one: "number_taken", "month_closed", "deleted"… */
  code?: string;
  /** What the server answered, for the screen that asked: a 409's next free number, a deleted bill's bin row. */
  body?: unknown;
};

/** Keys that say what happened rather than name a field. */
const NOT_FIELDS = ["detail", "error", "non_field_errors", "code"];

/** The first words in a DRF error value: a string, the first in a list, or the first inside a nested row ({} is a good row, skipped). */
function words(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") return v || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    for (const x of v) { const w = words(x); if (w) return w; }
    return null;
  }
  if (typeof v === "object") {
    for (const x of Object.values(v as Record<string, unknown>)) { const w = words(x); if (w) return w; }
  }
  return null;
}

function firstMessage(data: unknown): string | null {
  if (!data) return null;
  if (typeof data === "string") return data.length < 200 && !data.trimStart().startsWith("<") ? data : null;
  if (typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  for (const k of ["detail", "error", "non_field_errors"]) { const w = words(d[k]); if (w) return w; }
  for (const [k, v] of Object.entries(d)) {
    if (NOT_FIELDS.includes(k)) continue;
    const w = words(v);
    if (w) return w;
  }
  return null;
}

/**
 * Every field's words, flat: { gst_number: "…", "lines.1.quantity": "…", lines: "…" }. A list of words is one field's.
 * DRF 3.18 sends a list field's row errors as an object keyed by the row's 0-based position, good rows left out
 * ({ lines: { "1": { quantity: […] } } }, contract §1); an older list aligned with the rows ([{}, {…}]) reads the same.
 */
function fieldErrors(data: unknown): Record<string, string> | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const out: Record<string, string> = {};
  const walk = (v: unknown, path: string) => {
    if (v == null) return;
    if (typeof v === "string") { if (v && !(path in out)) out[path] = v; return; }
    if (Array.isArray(v)) {
      if (v.every((x) => typeof x === "string")) { const w = words(v); if (w) out[path] = w; return; }
      v.forEach((x, i) => walk(x, `${path}.${i}`));
      return;
    }
    if (typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, `${path}.${k}`);
  };
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) if (!NOT_FIELDS.includes(k)) walk(v, k);
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
  const said = data && typeof data === "object" ? (data as { code?: unknown }).code : undefined;
  const extra = { ...(typeof said === "string" ? { code: said } : {}), ...(data && typeof data === "object" ? { body: data } : {}) };
  if (status === 401) return { kind: "auth", message: "You've been signed out. Sign in again.", ...extra };
  if (status === 403) return { kind: "forbidden", message: firstMessage(data) || "Your role can't do this. Ask the owner if you need it.", ...extra };
  if (status === 404) return { kind: "notfound", message: "That isn't there any more.", ...extra };
  if (status === 409) return { kind: "conflict", message: firstMessage(data) || "Someone changed this at the same time. Open it again.", ...extra };
  if (status === 429) return { kind: "throttled", message: "Too many tries. Wait a minute, then try again.", ...extra };
  if (status === 400) return { kind: "validation", message: firstMessage(data) || "Something in the form needs fixing.", fields: fieldErrors(data), ...extra };
  return { kind: "server", message: "The app couldn't get through", ...extra };
}

/** Every message in a DRF error value, in order: ["…", "…"]. */
function allWords(v: unknown): string[] {
  if (typeof v === "string") return v ? [v] : [];
  if (Array.isArray(v)) return v.flatMap(allWords);
  return [];
}
/** The 400's `lines` value, if the problem carries one. */
function linesOf(problem: ApiProblem | null | undefined): unknown {
  const body = problem?.kind === "validation" ? problem.body : undefined;
  return body && typeof body === "object" ? (body as { lines?: unknown }).lines : undefined;
}

/**
 * Every message the server gave for line `index`'s `field` (the bill form shows them under that line), [] when none.
 * DRF 3.18 keys a line's errors by its 0-based position, as a string, and leaves good lines out
 * ({ lines: { "1": { quantity: […] } } }); an older list aligned with the lines reads the same.
 */
export function lineErrors(problem: ApiProblem | null | undefined, index: number, field: string): string[] {
  const lines = linesOf(problem);
  const row = Array.isArray(lines) ? lines[index] : lines && typeof lines === "object" ? (lines as Record<string, unknown>)[String(index)] : undefined;
  return row && typeof row === "object" && !Array.isArray(row) ? allWords((row as Record<string, unknown>)[field]) : [];
}

/** The messages about the lines as a whole ("Add at least one item: …", "A bill can have at most 200 items."), [] when none. */
export function linesErrors(problem: ApiProblem | null | undefined): string[] {
  const lines = linesOf(problem);
  return Array.isArray(lines) ? lines.filter((x): x is string => typeof x === "string" && x !== "") : [];
}

/** The prototype's words for a save that didn't happen (PROTO/core/store.jsx failureFor). */
export function saveFailure(p: ApiProblem): { title: string; body: string } {
  if (p.kind === "offline") return { title: "You're offline, so this wasn't saved", body: "What you typed is still here. Save again when the internet is back." };
  if (p.kind === "unreachable" || p.kind === "server") return { title: "Not saved: the app couldn't get through", body: "Nothing was changed. What you typed is still here; try again in a minute." };
  return { title: "Not saved", body: p.message };
}
