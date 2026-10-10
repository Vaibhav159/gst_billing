import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { useInRouterContext, useLocation } from "react-router";
import { CheckCircle2, Info, X, XCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/core/cn";
import { useIsPhone } from "@/core/device";
import { useView } from "@/core/view";
import { Kbd } from "./Badge";
import { Button, IconButton } from "./Button";
import { Portal, layerZoom, overlayLayer } from "./Overlay";

export type ToastInput = { title: string; body?: ReactNode; tone?: "sale" | "neg" | "brand"; action?: { label: string; onClick: () => void }; duration?: number };
type Toast = ToastInput & { id: string; duration: number; at: number; leaving?: boolean };
export type ToastApi = { show(t: ToastInput): string; dismiss(id: string): void; clearPlain(): void };

const ToastApiCtx = createContext<ToastApi | null>(null);
const ToastListCtx = createContext<{ toasts: Toast[]; hosted: boolean }>({ toasts: [], hosted: false });

/**
 * Holds the toasts (the prototype kept them in its store). show({ title, body, tone, action: { label, onClick }, duration }):
 * the host times each one (paused while pointed at or focused): 6 s, 15 s with an action, 10 s for a problem.
 * A new toast replaces one with the same title, and at most three show.
 * Inside a router the provider shows them itself; above one (the app's case), ToastHost shows them.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const shown = useRef(toasts);
  shown.current = toasts;
  const isPhone = useIsPhone();
  const phone = useRef(isPhone);
  phone.current = isPhone;
  const dismiss = useCallback((id: string) => {
    setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 170);
  }, []);
  const show = useCallback((t: ToastInput) => {
    const id = Math.random().toString(36).slice(2);
    const duration = t.duration || (t.action ? 15000 : t.tone === "neg" ? 10000 : 6000);
    setToasts((all) => [...all.filter((x) => x.title !== t.title).slice(-2), { id, tone: "sale", ...t, duration, at: Date.now() }]);
    return id;
  }, []);
  // a toast that says what just happened belongs to that page: on phones, moving on clears it
  // (an Undo stays its full time, and one shown just before the move, like "Saved", stays too)
  const clearPlain = useCallback(() => {
    if (!phone.current) return;
    for (const t of shown.current) if (!t.action && Date.now() - (t.at || 0) > 1200) dismiss(t.id);
  }, [dismiss]);
  const api = useMemo(() => ({ show, dismiss, clearPlain }), [show, dismiss, clearPlain]);
  const hosted = useInRouterContext();
  const list = useMemo(() => ({ toasts, hosted }), [toasts, hosted]);
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
  const { toasts } = useContext(ToastListCtx);
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
        {toasts.map((t) => <ToastItem key={t.id} t={t} dismiss={dismiss} isPhone={isPhone} isEasy={isEasy} />)}
      </div>
    </Portal>
  );
}

function ToastItem({ t, dismiss, isPhone, isEasy }: { t: Toast; dismiss: (id: string) => void; isPhone: boolean; isEasy: boolean }) {
  const [I, c] = TOAST_ICON[t.tone ?? "sale"] || TOAST_ICON.sale;
  const paused = useRef(false);
  const left = useRef(isEasy && !t.action ? Math.round(t.duration * 1.35) : t.duration || 6000);
  const started = useRef(Date.now());
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const arm = () => {
    clearTimeout(timer.current);
    started.current = Date.now();
    timer.current = setTimeout(() => dismiss(t.id), left.current);
  };
  const pause = () => {
    if (paused.current) return;
    paused.current = true;
    clearTimeout(timer.current);
    left.current = Math.max(1500, left.current - (Date.now() - started.current));
  };
  const resume = (e?: SyntheticEvent<HTMLElement>) => {
    if (!paused.current) return;
    if (e && e.currentTarget.contains(document.activeElement) && e.type !== "focusout") return;
    paused.current = false;
    arm();
  };
  useEffect(() => { arm(); return () => clearTimeout(timer.current); }, []);
  const action = t.action;
  const undo = action && /^undo/i.test(action.label);
  return (
    <div role={t.tone === "neg" ? "alert" : undefined}
      onPointerEnter={pause} onPointerLeave={resume} onFocus={pause} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) resume(); }}
      className={cn("pointer-events-auto card shadow-pop px-4 py-3 flex items-start gap-3", isEasy && "text-md", t.leaving ? "anim-toast-out" : "anim-toast")}>
      <I size={20} className={cn("shrink-0 mt-0.5", c)} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold">{t.title}</p>
        {t.body ? <p className={cn("text-fg2 mt-0.5", isEasy ? "text-md" : "text-sm")}>{t.body}</p> : null}
      </div>
      {action ? (
        // a toast on its way out (pressed, dismissed or timed out) ignores its action, so a quick second press can't run it twice
        <Button size="sm" variant="link" onClick={() => { if (t.leaving) return; action.onClick(); dismiss(t.id); }} aria-keyshortcuts={undo && !isPhone ? "Control+Z" : undefined}>
          {action.label}{undo && !isPhone ? <Kbd className="ml-1">Ctrl Z</Kbd> : null}
        </Button>
      ) : null}
      <IconButton label="Dismiss" icon={X} size="sm" onClick={() => dismiss(t.id)} className="-mr-2 -mt-1" />
    </div>
  );
}
