import { useRef, useState } from "react";
import { useSaveShopSettings } from "@/core/api/sales";
import { problemOf } from "@/core/api/errors";
import { useAuth } from "@/core/auth/AuthProvider";
import { usePrefs, type Prefs } from "@/core/prefs";
import { readStored, writeStored } from "@/core/storage";
import type { ShopSettings } from "@/core/sales/types";

export const PLACEHOLDERS = [["{customer}", "Customer's name"], ["{number}", "Bill number"], ["{total}", "Bill total"], ["{firm}", "Firm's name"], ["{date}", "Bill date"]] as const;
export function messageProblem(message: string): { error?: string; warning?: string } {
  if (!message.trim()) return { error: "Write a message, or put back the standard one." };
  const unknown = [...new Set((message.match(/\{[^{}]*\}/g) ?? []).filter((p) => !PLACEHOLDERS.some(([known]) => known === p)))];
  if (unknown.length) return { error: unknown.join(", ") + (unknown.length === 1 ? " isn't" : " aren't") + " something the app can fill in. Use {customer}, {number}, {total}, {firm} or {date}." };
  if (/[{}]/.test(message.replace(/\{[^{}]*\}/g, ""))) return { error: "A brace is left open. Each placeholder needs { and }." };
  if (message.length > 500) return { error: "Keep the message to 500 characters." };
  return message.includes("{number}") ? {} : { warning: "Customers find bills by number. Consider adding {number}." };
}
type ShopPatch = Partial<Pick<ShopSettings, "copies" | "show_bank" | "share_message" | "default_business">>;
type Pending = { scope: "shop"; patch: ShopPatch } | { scope: "me"; patch: Partial<Prefs> };
type PendingRows = Record<string, Pending>;
const keyFor = (id: number) => "gst3.pending-settings." + id;
function readPending(id: number): PendingRows {
  try {
    const value: unknown = JSON.parse(readStored(keyFor(id)) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([key, row]) => ["myFirm", "phoneMode", "defaultFirm", "copies", "showBank", "shareMessage", "setup", "reset"].includes(key) && row && typeof row === "object" && ["me", "shop"].includes(row.scope) && row.patch && typeof row.patch === "object" && !Array.isArray(row.patch)));
  } catch { return {}; }
}
/** Kept choices are row-local. Only a successful response changes the app's saved defaults. */
export function useSettingRows(person: number) {
  const shop = useSaveShopSettings();
  const { can } = useAuth();
  const { setPrefs } = usePrefs();
  const [pending, setPending] = useState(() => readPending(person));
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const active = useRef(new Set<string>());
  const keep = (change: (before: PendingRows) => PendingRows) => setPending((before) => {
    const after = change(before);
    writeStored(keyFor(person), JSON.stringify(after));
    return after;
  });
  const save = async (key: string, row: Pending): Promise<boolean> => {
    if (active.current.has(key) || (row.scope === "shop" && !can("settings.edit"))) return false;
    if (row.scope === "me" && (active.current.has("reset") || (key === "reset" && [...active.current].some((id) => ["myFirm", "phoneMode", "setup"].includes(id))))) return false;
    active.current.add(key);
    keep((before) => ({ ...before, [key]: row }));
    setBusy((before) => ({ ...before, [key]: true }));
    setErrors((before) => ({ ...before, [key]: "" }));
    try {
      if (row.scope === "shop") await shop.mutateAsync(row.patch);
      else await setPrefs(row.patch);
      keep((before) => Object.fromEntries(Object.entries(before).filter(([id]) => id !== key)));
      setSaved((before) => ({ ...before, [key]: true }));
      return true;
    } catch (error) {
      setErrors((before) => ({ ...before, [key]: problemOf(error).message }));
      return false;
    } finally {
      active.current.delete(key);
      setBusy((before) => ({ ...before, [key]: false }));
    }
  };
  const reset = async () => {
      const ok = await save("reset", { scope: "me", patch: { defaultBusinessId: null, phoneMode: null, setup: null } });
      if (ok) {
        keep((before) => Object.fromEntries(Object.entries(before).filter(([, row]) => row.scope === "shop")));
        setSaved((before) => ({ ...before, myFirm: true, phoneMode: true, setup: true }));
      }
      return ok;
  };
  return {
    pending, busy, errors, saved,
    value: <T,>(key: string, field: string, actual: T): T => {
      const patch = pending[key]?.patch as Record<string, unknown> | undefined;
      return patch && field in patch ? patch[field] as T : actual;
    },
    shop: (key: string, patch: ShopPatch) => save(key, { scope: "shop", patch }),
    mine: (key: string, patch: Partial<Prefs>) => save(key, { scope: "me", patch }),
    retry: (key: string) => key === "reset" ? reset() : pending[key] ? save(key, pending[key]) : Promise.resolve(true),
    reset,
  };
}

