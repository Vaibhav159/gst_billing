import { useSyncExternalStore } from "react";
import { useAuth } from "@/core/auth/AuthProvider";
import { usePrefs } from "@/core/prefs";
import { useNetwork } from "@/core/api/network";
import { useShopSettings } from "@/core/api/sales";
import type { ItaxFlag } from "@/core/api/customers";
import { fyOf, groupIN, pct, qty, todayIST } from "@/core/format";
import { defaultFirmId, useFirms, type Firm } from "@/core/scope";
import { readStored, writeStored } from "@/core/storage";
import { type FormState } from "@/pages/sales/form/model";
import { perWord } from "@/pages/sales/form/rules";
import type { PaymentMode } from "@/core/sales/types";

export { easyRateSlip, rateSlip, rateNote } from "./rates";

type Pref = "firm" | "welcomed";
const memory = new Map<string, string | null>();
const listeners = new Set<() => void>();
const keyOf = (kind: Pref, id: number) => `gst3.easy.${kind}.${id}`;
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
function getPref(kind: Pref, id: number | null) {
  if (id === null) return null;
  const key = keyOf(kind, id);
  return memory.has(key) ? memory.get(key)! : readStored(key);
}
export function setEasyPref(kind: Pref, id: number, value: number | boolean | null) {
  const key = keyOf(kind, id); const text = value === null ? null : String(value);
  memory.set(key, text); writeStored(key, text); listeners.forEach(cb => cb());
}
function useEasyPref(kind: Pref) {
  const id = useAuth().me?.id ?? null;
  const value = useSyncExternalStore(subscribe, () => getPref(kind, id), () => null);
  return [value, (next: number | boolean | null) => { if (id !== null) setEasyPref(kind, id, next); }] as const;
}
export function easyFirmId(firms: readonly Firm[], picked: unknown, personal: unknown, shop: unknown): number | null {
  const id = Number(picked);
  return Number.isInteger(id) && firms.some(f => f.id === id) ? id : defaultFirmId(firms, personal, shop);
}
export function useEasyFirm() {
  const list = useFirms(); const { prefs, ready, unavailable } = usePrefs(); const shop = useShopSettings();
  const offline = useNetwork() === "offline";
  const [picked, setPick] = useEasyPref("firm");
  const valid = (id: unknown) => list.firms.some(f => f.id === Number(id));
  const unreadPrefs = !valid(picked) && Boolean(unavailable);
  const waiting = list.loading || unreadPrefs || (!valid(picked) && (!ready || (!valid(prefs.defaultBusinessId) && (shop.isPending || (shop.isError && !shop.data)))));
  const firmId = waiting ? null : easyFirmId(list.firms, picked, prefs.defaultBusinessId, shop.data?.default_business);
  return { ...list, firmId, firm: list.firms.find(f => f.id === firmId) ?? null, loading: waiting && !unreadPrefs && !offline && !shop.isPaused && !shop.isError, error: list.error || unreadPrefs || (waiting && (offline || shop.isPaused || shop.isError)),
    setFirm: (id: number) => { if (valid(id)) setPick(id); } };
}
export function useWelcome() {
  const [seen, set] = useEasyPref("welcomed");
  return { seen: seen === "true", done: () => set(true), reset: () => set(null) };
}
export function thisYear(today = todayIST()) {
  const fy = fyOf(today); const y = Number(fy.slice(0, 4));
  return { fy, from: `${y}-04-01`, to: `${y + 1}-03-31` };
}
export const lastYear = (today = todayIST()) => thisYear(`${Number(thisYear(today).fy.slice(0, 4)) - 1}-04-01`);
export const earlyInYear = (today = todayIST()) => ["04", "05"].includes(today.slice(5, 7));
export const paidWords = (mode: PaymentMode | null) => ({ cash: "paid in cash", bank: "paid by UPI", credit: "billed on udhaar, to be paid later", mixed: "paid part in cash, part by UPI", "": "payment not recorded" })[mode ?? ""];
export const PAY_CHOICES = [
  { value: "cash", label: "Cash", sub: "" }, { value: "bank", label: "UPI", sub: "or bank" },
  { value: "mixed", label: "Part cash", sub: "rest UPI" }, { value: "credit", label: "Udhaar", sub: "pays later" },
] as const;
export const unitWord = perWord;
export const weightLabel = (unit: string) => unit === "g" || unit === "gms" ? "Weight in grams" : unit === "ct" ? "Weight in carats" : unit === "pcs" || unit === "nos" ? "How many pieces" : `Quantity (${unit})`;
export const maskPhone = (phone: string | null) => phone ? `••• ${phone.replace(/\D/g, "").slice(-5)}` : "No phone";
export type CheckNote = { id: string; text: string; tick?: string; tone?: "brand" };
export type SlipNote = { text: string; tick: string };
export function weightSlip(line: { qty: number | null; unit: string; name: string }) {
  const n = line.qty;
  if (n === null || !Number.isFinite(n)) return null;
  const grams = line.unit === "g" || line.unit === "gms";
  if (!((grams && n > 1000) || (line.unit === "ct" && n > 100))) return null;
  const fix = Number.isInteger(n) ? n / 1000 : null;
  const amount = qty(n, line.unit);
  return { text: `${amount} ${grams ? `is more than ${groupIN(Math.floor(n / 1000))} kg.` : "is a lot for loose diamonds."}${fix ? ` Did you mean ${qty(fix, line.unit)}?` : ""}`,
    fix, fixLabel: fix ? `Use ${qty(fix, line.unit)}` : "", tick: `Yes, ${amount}${grams ? ` of ${line.name}` : ""} is right` };
}
/** Rates are supplied by 5C's rateSlip, keyed by line; never calculated a second time here. */
export function unusual(form: FormState, { total, inter = false, twin = "", itax = [], rates = {} }: {
  total: number; inter?: boolean; twin?: string; itax?: ItaxFlag[]; rates?: Record<string, SlipNote | null>;
}): CheckNote[] {
  const notes: CheckNote[] = [];
  for (const line of form.lines) {
    const rate = rates[line.key]; if (rate) notes.push({ id: `rate-${line.key}`, ...rate });
    const weight = weightSlip(line); if (weight) notes.push({ id: `weight-${line.key}`, text: weight.text, tick: weight.tick });
    const hsn = line.hsn.trim().slice(0, 4);
    const expected = ["7113", "7114", "7117", "7118"].includes(hsn) ? 0.03 : hsn === "7102" ? 0.0025 : null;
    const gst = line.gst === null || line.gst === "" ? null : Number(line.gst) / 100;
    if (expected !== null && gst !== null && gst !== expected) notes.push({ id: `gst-${line.key}`, text: `${line.name} has GST ${pct(gst)}; HSN ${hsn} uses GST ${pct(expected)}.`, tick: `Yes, GST ${pct(gst)} is right for ${line.name}` });
  }
  if (form.payment === "mixed" && total >= 20000000) notes.push({ id: "cash-part", text: "The total is ₹2,00,000 or more, so the cash part must stay under ₹2,00,000 (income-tax rules)." });
  if (twin) notes.push({ id: "twin", text: twin, tick: "Yes, this is another bill" });
  for (const flag of itax) if (["cash_limit", "pan", "walkin_limit", "b2b_address", "b2c_address"].includes(flag.kind)) notes.push({ id: flag.kind, text: flag.text, tone: "brand" });
  if (inter) notes.push({ id: "igst", text: "IGST, sale to another state", tone: "brand" });
  return notes;
}
