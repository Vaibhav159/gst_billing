import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useInRouterContext, useLocation } from "react-router";
import { CheckCircle2, Info, X, XCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/core/cn";
import { MOD } from "@/core/modifierKeys";
import { useIsPhone } from "@/core/device";
import { useView } from "@/core/view";
import { Kbd } from "./Badge";
import { Button, IconButton } from "./Button";
import { Portal, layerZoom, overlayLayer } from "./Overlay";

export type ToastInput = { title: string; body?: ReactNode; tone?: "sale" | "neg" | "brand"; action?: { label: string; onClick: () => void }; duration?: number };
type Toast = ToastInput & { id: string; duration: number; at: number; leaving?: boolean };
export type ToastApi = {
  show(t: ToastInput): string; dismiss(id: string): void; clearPlain(): void;
  /** Ctrl Z: runs the last Undo a toast offered, once, for 30 s. False when there's nothing to undo. */
  undoLast(): boolean;
};

const ToastApiCtx = createContext<ToastApi | null>(null);
const ToastListCtx = createContext<{ toasts: Toast[]; hosted: boolean; acted(id: string): void }>({ toasts: [], hosted: false, acted: () => {} });

/**
 * Holds the toasts (the prototype kept them in its store). show({ title, body, tone, action: { label, onClick }, duration }):
 * the host times each one (paused while pointed at, focused or the tab is hidden): 6 s, 15 s with an action, 10 s for a problem.
 * duration: Infinity keeps an action available until dismissed.
 * A new timed toast replaces one with the same title, and at most three timed toasts show. Persistent actions stay
 * until dismissed, including when another bill's action uses the same title. An action labelled Undo can also be run by
 * Ctrl Z (undoLast) for 30 s, once; pressing it on the toast uses it up.
 * Inside a router the provider shows them itself; above one (the app's case), ToastHost shows them.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const shown = useRef(toasts);
  shown.current = toasts;
  const isPhone = useIsPhone();
  const phone = useRef(isPhone);
  phone.current = isPhone;
  // a toast on its way out goes 170 ms later; those still waiting when the provider goes stop with it, so none sets
  // state after it (a test file can't end with one waiting to fire once its window has gone)
  const leaveTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = leaveTimers.current;
    return () => { for (const t of timers) clearTimeout(t); timers.clear(); };
  }, []);
  const dismiss = useCallback((id: string) => {
    setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    const timer = setTimeout(() => { leaveTimers.current.delete(timer); setToasts((t) => t.filter((x) => x.id !== id)); }, 170);
    leaveTimers.current.add(timer);
  }, []);
  // the last Undo a toast offered (PROTO core/store.jsx:101-123): Ctrl Z runs it for 30 s, once
  const undo = useRef<{ id: string; run: () => void; until: number } | null>(null);
  const show = useCallback((t: ToastInput) => {
    const id = Math.random().toString(36).slice(2);
    const duration = t.duration || (t.action ? 15000 : t.tone === "neg" ? 10000 : 6000);
    setToasts((all) => {
      const timed = all.filter((x) => Number.isFinite(x.duration) && x.title !== t.title).slice(Number.isFinite(duration) ? -2 : -3);
      return [...all.filter((x) => !Number.isFinite(x.duration) || timed.includes(x)), { id, tone: "sale", ...t, duration, at: Date.now() }];
    });
    if (t.action && /^undo/i.test(t.action.label)) undo.current = { id, run: t.action.onClick, until: Date.now() + 30_000 };
    return id;
  }, []);
  // a toast that says what just happened belongs to that page: on phones, moving on clears it
  // (an Undo stays its full time, and one shown just before the move, like "Saved", stays too)
  const clearPlain = useCallback(() => {
    if (!phone.current) return;
    for (const t of shown.current) if (!t.action && Date.now() - (t.at || 0) > 1200) dismiss(t.id);
  }, [dismiss]);
  const undoLast = useCallback(() => {
    const u = undo.current;
    undo.current = null;
    if (!u || Date.now() > u.until) return false;
    u.run();
    dismiss(u.id);
    return true;
  }, [dismiss]);
  /** A toast's own action was pressed: its Undo is used up, so Ctrl Z can't run it a second time. */
  const acted = useCallback((id: string) => { if (undo.current?.id === id) undo.current = null; }, []);
  const api = useMemo(() => ({ show, dismiss, clearPlain, undoLast }), [show, dismiss, clearPlain, undoLast]);
  const hosted = useInRouterContext();
  const list = useMemo(() => ({ toasts, hosted, acted }), [toasts, hosted, acted]);
  return (
    <ToastApiCtx.Provider value={api}>
      <ToastListCtx.Provider value={list}>
        {children}
        {hosted ? <ToastStack /> : null}
      </ToastListCtx.Provider>
    </ToastApiCtx.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastApiCtx);
  if (!api) throw new Error("useToast needs a ToastProvider above it");
  return api;
}

/** Shows the toasts when the provider sits above the router: render it inside the router. Under a provider that's inside one, it adds nothing. */
export function ToastHost() {
  const { hosted } = useContext(ToastListCtx);
  return hosted ? null : <ToastStack />;
}

const TOAST_ICON: Record<string, [LucideIcon, string]> = { sale: [CheckCircle2, "text-sale"], brand: [Info, "text-brand"], neg: [XCircle, "text-neg"], file: [Info, "text-file"], muted: [Info, "text-fg2"] };
/**
 * Lives in the overlay layer; shows the provider's toasts. Each toast times
 * itself and waits while it is pointed at or focused. Desktop: bottom left, clear
 * of the row actions on the right. Phones: above the bottom tabs and any pinned
 * action bar (measured while a toast shows), so it never covers the next button
 * or the next page's first field; moving to another page clears it (clearPlain).
 */
function ToastStack() {
  const { toasts, acted } = useContext(ToastListCtx);
  const { dismiss } = useToast();
  const { isPhone, isEasy } = useView();
  const { pathname } = useLocation();
  const [bottom, setBottom] = useState(88);
  const measure = useRef(() => {});
  measure.current = () => {
    if (!isPhone) return;
    const overlay = overlayLayer();
    const root = overlay.parentElement ?? document.body;
    const o = overlay.getBoundingClientRect();
    const z = layerZoom(overlay);
    // sit above the bottom tabs (the phone shell's .phone-tabs, whatever its label) and any pinned action bar on screen
    let edge = o.bottom;
    for (const el of root.querySelectorAll(".phone-tabs, [data-actionbar]")) {
      const r = el.getBoundingClientRect();
      if (r.height && r.top < o.bottom && r.bottom > o.top + o.height / 2) edge = Math.min(edge, r.top);
    }
    const b = Math.max(12, (o.bottom - edge) / z + 12);
    setBottom((v) => (Math.abs(v - b) > 0.5 ? b : v));
  };
  useLayoutEffect(() => { if (toasts.length) measure.current(); }, [toasts.length, pathname, isPhone, isEasy]);
  // the page under a toast can change (a bar appears after its first layout): keep measuring while one shows
  useEffect(() => {
    if (!isPhone || !toasts.length) return undefined;
    const t = setInterval(() => measure.current(), 200);
    return () => clearInterval(t);
  }, [isPhone, toasts.length]);
  const place = isPhone ? { bottom } : undefined;
  return (
    <Portal>
      <div aria-live="polite" style={place} className={cn("absolute z-toast flex gap-2 pointer-events-none", isPhone ? "left-3 right-3 flex-col" : "left-6 bottom-6 w-[400px] flex-col")}>
        {toasts.map((t) => <ToastItem key={t.id} t={t} dismiss={dismiss} acted={acted} isPhone={isPhone} isEasy={isEasy} />)}
      </div>
    </Portal>
  );
}

function ToastItem({ t, dismiss, acted, isPhone, isEasy }: { t: Toast; dismiss: (id: string) => void; acted: (id: string) => void; isPhone: boolean; isEasy: boolean }) {
  const [I, c] = TOAST_ICON[t.tone ?? "sale"] || TOAST_ICON.sale;
  const paused = useRef(false);
  const hovered = useRef(false);
  const focused = useRef(false);
  const left = useRef(isEasy && !t.action ? Math.round(t.duration * 1.35) : t.duration || 6000);
  const started = useRef(Date.now());
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const arm = () => {
    clearTimeout(timer.current);
    if (!Number.isFinite(left.current)) return;
    started.current = Date.now();
    timer.current = setTimeout(() => dismiss(t.id), left.current);
  };
  const pause = () => {
    if (paused.current) return;
    paused.current = true;
    clearTimeout(timer.current);
    left.current = Math.max(1500, left.current - (Date.now() - started.current));
  };
  const syncPause = () => {
    if (document.hidden || hovered.current || focused.current) { pause(); return; }
    if (!paused.current) return;
    paused.current = false;
    arm();
  };
  useEffect(() => {
    if (document.hidden) paused.current = true;
    else arm();
    document.addEventListener("visibilitychange", syncPause);
    return () => { clearTimeout(timer.current); document.removeEventListener("visibilitychange", syncPause); };
  }, []);
  const action = t.action;
  const undo = action && /^undo/i.test(action.label);
  return (
    <div role={t.tone === "neg" ? "alert" : undefined}
      onPointerEnter={() => { hovered.current = true; syncPause(); }} onPointerLeave={() => { hovered.current = false; syncPause(); }}
      onFocus={() => { focused.current = true; syncPause(); }} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) { focused.current = false; syncPause(); } }}
      className={cn("pointer-events-auto card shadow-pop px-4 py-3 flex items-start gap-3", isEasy && "text-md", t.leaving ? "anim-toast-out" : "anim-toast")}>
      <I size={20} className={cn("shrink-0 mt-0.5", c)} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold">{t.title}</p>
        {t.body ? <p className={cn("text-fg2 mt-0.5", isEasy ? "text-md" : "text-sm")}>{t.body}</p> : null}
      </div>
      {action ? (
        // a toast on its way out (pressed, dismissed or timed out) ignores its action, so a quick second press can't run it twice
        <Button size="sm" variant="link" onClick={() => { if (t.leaving) return; action.onClick(); acted(t.id); dismiss(t.id); }} aria-keyshortcuts={undo && !isPhone ? "Control+Z Meta+Z" : undefined}>
          {action.label}{undo && !isPhone ? <Kbd className="ml-1">{MOD} Z</Kbd> : null}
        </Button>
      ) : null}
      <IconButton label="Dismiss" icon={X} size="sm" onClick={() => dismiss(t.id)} className="-mr-2 -mt-1" />
    </div>
  );
}
