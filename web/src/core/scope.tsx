import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/core/api/client";
import { useAuth } from "@/core/auth/AuthProvider";
import { fyOf, todayIST } from "@/core/format";
import { usePrefs } from "@/core/prefs";

/** A firm (a business on the server). short: its name's first word, title-cased: "KIRAN GOLD HOUSE (SANDBOX)" gives "Kiran". */
export type Firm = { id: number; name: string; short: string; gstin: string; state: string };
export type FirmId = number | "all";

// ponytail: the first word stands in for a short name, so two firms that share one ("SHREE …") look alike on the
// header button (the menu's GSTIN tells them apart). Upgrade: a short name stored on the firm.
export function shortName(name: string): string {
  const w = name.trim().split(/\s+/)[0] ?? "";
  return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : name;
}

type ApiBusiness = { id: number; name?: string | null; gst_number?: string | null; state_name?: string | null };
function toFirms(data: unknown): Firm[] {
  const d = data as { results?: unknown } | null;
  // the API pages its lists; an older or unpaged answer is the array itself
  const rows = (Array.isArray(d) ? d : Array.isArray(d?.results) ? d.results : []) as ApiBusiness[];
  return rows.map((b) => {
    const name = (b.name ?? "").trim();
    return { id: b.id, name, short: shortName(name), gstin: b.gst_number ?? "", state: b.state_name ?? "" };
  });
}

const NO_FIRMS: Firm[] = [];
/**
 * Every firm, asked for once a visit: staleTime Infinity, so nothing asks again on a timer, on focus or on a remount
 * (the database is Neon's free plan). error: the list couldn't load, which is not the same as a shop with no firm.
 */
export function useFirms(): { firms: Firm[]; loading: boolean; error: boolean } {
  const { status } = useAuth();
  const q = useQuery({
    queryKey: ["firms"], enabled: status === "signed-in", staleTime: Infinity,
    // ponytail: one page of 100 is every firm a shop has; a bigger list would need the next pages
    queryFn: async ({ signal }) => toFirms((await api.get("businesses/", { params: { page_size: 100 }, signal })).data),
  });
  return { firms: q.data ?? NO_FIRMS, loading: q.isPending, error: q.isError };
}

/** ready: the firm is known (a pick on this device, or the person's preferences); until then firmId is only a stand-in. */
export type Scope = { firmId: FirmId; setFirmId(id: FirmId): void; fy: string; setFy(fy: string): void; fyChoices: string[]; ready: boolean };
const ScopeCtx = createContext<Scope | null>(null);

const FY_KEY = "gst3.fy";
const V2_FY_KEY = "gst_selected_fy";
const scopeKey = (meId: number) => `gst3.scope.${meId}`;
function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* private window: the pick lasts this visit */ }
}
/** A firm id from storage or preferences ("3"), or null when there isn't a usable one. */
function toId(v: unknown): number | null {
  const n = Number(v);
  return v != null && v !== "" && Number.isInteger(n) && n > 0 ? n : null;
}
function storedPick(meId: number): FirmId | null {
  const v = read(scopeKey(meId));
  return v === "all" ? "all" : toId(v);
}

/** The year a date falls in and the two before it, newest first: ["2026-27", "2025-26", "2024-25"]. */
function fyChoicesFor(current: string): string[] {
  const y = Number(current.slice(0, 4));
  return [0, 1, 2].map((n) => fyOf(`${y - n}-04-01`));
}
/** This device's last pick, else the one today's app (v2) remembered, else this year. A year the picker doesn't offer is ignored. */
function storedFy(choices: string[]): string {
  for (const key of [FY_KEY, V2_FY_KEY]) {
    const v = read(key);
    if (v && choices.includes(v)) return v;
  }
  return choices[0];
}

/**
 * Which firm and financial year lists and figures follow. The firm is this person's last pick on this device
 * (localStorage, per person), else their usual firm (preferences, kept from their last visit until the server
 * answers), else all firms. A firm the list doesn't have isn't used; until the list arrives the pick is trusted, so
 * pages don't ask for every firm first and then for one. Lists wait for `ready` for the same reason.
 */
export function ScopeProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const { prefs, ready: prefsReady } = usePrefs();
  const { firms, loading, error } = useFirms();
  const meId = me?.id ?? null;

  // each person's pick, read from this device once when they're first shown, then held here: another tab's later
  // pick doesn't move this tab, and a pick made here holds for the visit even if storage refuses it
  const [picks, setPicks] = useState<Record<number, FirmId | null>>(() => (meId === null ? {} : { [meId]: storedPick(meId) }));
  if (meId !== null && !(meId in picks)) setPicks((p) => ({ ...p, [meId]: storedPick(meId) }));
  const stored = meId === null ? null : picks[meId] ?? null;
  const listed = !loading && !error;
  const usable = (id: number | null): id is number => id !== null && (!listed || firms.some((f) => f.id === id));
  const usual = toId(prefs.defaultBusinessId);
  const picked = stored === "all" || usable(stored);
  const firmId: FirmId = stored === "all" ? "all" : usable(stored) ? stored : usable(usual) ? usual : "all";
  const ready = picked || prefsReady;
  const setFirmId = useCallback((id: FirmId) => {
    if (meId === null) return;
    write(scopeKey(meId), String(id));
    setPicks((p) => ({ ...p, [meId]: id }));
  }, [meId]);

  const current = fyOf(todayIST());
  const fyChoices = useMemo(() => fyChoicesFor(current), [current]);
  const [fyPick, setFyPick] = useState(() => storedFy(fyChoicesFor(current)));
  const fy = fyChoices.includes(fyPick) ? fyPick : fyChoices[0];
  const setFy = useCallback((v: string) => { write(FY_KEY, v); setFyPick(v); }, []);

  const value = useMemo<Scope>(() => ({ firmId, setFirmId, fy, setFy, fyChoices, ready }), [firmId, setFirmId, fy, setFy, fyChoices, ready]);
  return <ScopeCtx.Provider value={value}>{children}</ScopeCtx.Provider>;
}

export function useScope(): Scope {
  const v = useContext(ScopeCtx);
  if (!v) throw new Error("useScope needs ScopeProvider");
  return v;
}
