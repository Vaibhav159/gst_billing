import { readStored as read, writeStored as write } from "@/core/storage";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { firmListQuery, type FirmRow } from "@/core/api/firms";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { useAuth } from "@/core/auth/AuthProvider";
import { fyOf, todayIST } from "@/core/format";
import { usePrefs } from "@/core/prefs";

/**
 * A firm (a business on the server). short: its name's first word, title-cased: "KIRAN GOLD HOUSE (SANDBOX)" gives "Kiran".
 * prefix: its bill numbers' prefix ("KGH"), which names a PDF of a bare number (plan 1E).
 */
export type Firm = { id: number; name: string; short: string; gstin: string; state: string; prefix?: string };
export type FirmId = number | "all";

// Fallback for older answers; the slim firms endpoint supplies the stored effective short name.
export function shortName(name: string): string {
  const w = name.trim().split(/\s+/)[0] ?? "";
  return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : name;
}

export function toScopeFirm(b: FirmRow): Firm {
  return { id: b.id, name: b.name, short: b.short || shortName(b.name), gstin: b.gst_number ?? "", state: b.state_name ?? "", prefix: b.invoice_prefix ?? "" };
}

const NO_FIRMS: Firm[] = [];
/**
 * Every firm, asked for once a visit: staleTime Infinity, so nothing asks again on a timer, on focus or on a remount
 * (the database is Neon's free plan). error: the list couldn't load, which is not the same as a shop with no firm.
 */
export function useFirms(): { firms: Firm[]; loading: boolean; error: boolean; problem: ApiProblem | null } {
  const { status } = useAuth();
  const q = useQuery({ ...firmListQuery(), enabled: status === "signed-in" });
  const firms = useMemo(() => q.data?.map(toScopeFirm) ?? NO_FIRMS, [q.data]);
  return { firms, loading: q.isPending, error: q.isError, problem: q.isError ? problemOf(q.error) : null };
}

/**
 * firmId is null until the firm is known (a pick on this device, or the person's preferences), so a list can't ask for
 * every firm before the person's usual one is known: it waits for `firmId !== null`. ready says the same.
 */
export type Scope = { firmId: FirmId | null; setFirmId(id: FirmId): void; fy: string; setFy(fy: string): void; fyChoices: string[]; ready: boolean };
const ScopeCtx = createContext<Scope | null>(null);

const FY_KEY = "gst3.fy";
const V2_FY_KEY = "gst_selected_fy";
const scopeKey = (meId: number) => `gst3.scope.${meId}`;
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
  const ready = picked || prefsReady;
  const firmId: FirmId | null = !ready ? null : stored === "all" ? "all" : usable(stored) ? stored : usable(usual) ? usual : "all";
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
