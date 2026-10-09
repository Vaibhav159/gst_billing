import { useCallback, useState, useSyncExternalStore } from "react";

export type Theme = "obsidian" | "pearl" | "sapphire" | "ember" | "forest";
export const THEMES: { value: Theme; label: string }[] = [
  { value: "obsidian", label: "Obsidian" }, { value: "pearl", label: "Pearl" }, { value: "sapphire", label: "Sapphire" },
  { value: "ember", label: "Ember" }, { value: "forest", label: "Forest" },
];
const THEME_KEY = "gst3.theme";
const V2_THEME_KEY = "gst-theme";

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* private window: the choice lasts this visit */ }
}
function isTheme(v: string | null): v is Theme {
  return THEMES.some((t) => t.value === v);
}

/** Obsidian is the stylesheet's bare :root; the others are `theme-<name>` classes on <html>. */
export function applyTheme(t: Theme) {
  document.documentElement.className = t === "obsidian" ? "" : `theme-${t}`;
}

export function storedTheme(): Theme {
  const v3 = read(THEME_KEY);
  if (isTheme(v3)) return v3;
  const v2 = read(V2_THEME_KEY);
  if (v2 === "light-clean") return "pearl"; // v2's old name for its light theme, which v2 maps the same way
  return isTheme(v2) ? v2 : "obsidian";
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const t = storedTheme();
    write(THEME_KEY, t);
    applyTheme(t);
    return t;
  });
  const set = useCallback((t: Theme) => { write(THEME_KEY, t); applyTheme(t); setTheme(t); }, []);
  return [theme, set];
}

export const TEXT_SIZES: { value: number; label: string; hint: string }[] = [
  { value: 1, label: "Normal", hint: "" },
  { value: 1.1, label: "Large", hint: "A tenth bigger" },
  { value: 1.2, label: "Larger", hint: "A fifth bigger" },
];
const SIZE_KEY = "gst3.textSize";

export function storedTextSize(): number {
  const n = Number(read(SIZE_KEY));
  return TEXT_SIZES.some((s) => s.value === n) ? n : 1;
}

let sizeListener: (() => void) | null = null;
/** Larger text zooms the whole app; #root gets pixel sizes so the zoomed app fills the window. They round
 *  down: rounding up leaves the zoomed app a fraction of a pixel too big, and the browser adds scrollbars. */
export function applyTextSize(v: number) {
  const root = document.getElementById("root");
  if (!root) return;
  if (sizeListener) { window.removeEventListener("resize", sizeListener); sizeListener = null; }
  if (v === 1) { root.style.zoom = ""; root.style.width = ""; root.style.height = ""; return; }
  const fit = () => {
    root.style.zoom = String(v);
    root.style.width = `${Math.floor(window.innerWidth / v)}px`;
    root.style.height = `${Math.floor(window.innerHeight / v)}px`;
  };
  fit();
  sizeListener = fit;
  window.addEventListener("resize", fit);
}

export function useTextSize(): [number, (v: number) => void] {
  const [size, setSize] = useState<number>(() => {
    const v = storedTextSize();
    applyTextSize(v);
    return v;
  });
  const set = useCallback((v: number) => { write(SIZE_KEY, String(v)); applyTextSize(v); setSize(v); }, []);
  return [size, set];
}

const PHONE_QUERY = "(max-width: 767px), (max-height: 499px) and (pointer: coarse)";
function subscribePhone(cb: () => void) {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
/** True under 768 px wide, or on a touch screen under 500 px tall, so a phone turned on its side (844–932 px
 *  wide) stays a phone. Correct on the very first render (today's hook started false). */
export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE_QUERY).matches, () => false);
}
