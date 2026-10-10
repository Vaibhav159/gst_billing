import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode, type RefObject, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { useView } from "@/core/view";

/* ── Overlays: dialog, sheet, menu, toasts ─────────────── */

/**
 * The layer every overlay portals into: one div.overlay-layer on <body>, made on first use.
 * In the prototype it sat inside the app; here it sits beside #root, so it copies what overlays
 * used to inherit from there: text size's zoom and the keyboard inset (--kb). Portal gives it the view.
 */
export function overlayLayer(): HTMLElement {
  let layer = document.getElementById("overlay-root");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "overlay-root";
    layer.className = "overlay-layer fixed inset-0 z-sheet pointer-events-none";
    document.body.appendChild(layer);
    followApp(layer);
  }
  return layer;
}
function followApp(layer: HTMLElement) {
  const app = document.getElementById("root");
  if (!app) return;
  const copy = () => {
    layer.style.zoom = app.style.zoom;
    layer.style.setProperty("--kb", app.style.getPropertyValue("--kb"));
  };
  copy();
  new MutationObserver(copy).observe(app, { attributes: true, attributeFilter: ["style"] });
}
/** The layer's zoom (text size): measured screen px divide by it to give the layer's own px. */
export function layerZoom(layer: HTMLElement): number {
  return Number(layer.style.zoom) || 1;
}

export function Portal({ children }: { children: ReactNode }) {
  const { view } = useView();
  const layer = overlayLayer();
  // the [data-view] rules (16 px fields on phones, Easy's big fields) reach inside overlays too
  useLayoutEffect(() => { layer.setAttribute("data-view", view); }, [layer, view]);
  return createPortal(children, layer);
}

function focusables(node: HTMLElement): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null || el === document.activeElement);
}
/** Open dialogs, newest last: Esc closes the top one even if focus hasn't moved into it yet. */
const openDialogs: { node: HTMLElement }[] = [];
export function useFocusTrap(ref: RefObject<HTMLElement>, open: boolean, onClose: () => void, initialFocus?: RefObject<HTMLElement>) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const node = ref.current;
    if (!open || !node) return undefined;
    const prev = document.activeElement as HTMLElement | null;
    // a dialog that names its field has it at once, so keys typed straight after opening land there. Only after the
    // opener is read: React's development re-run of this effect reads the opener again (the cleanup gave focus back)
    initialFocus?.current?.focus({ preventScroll: true });
    // the others, or a field that couldn't take focus yet, after 20 ms
    const t = initialFocus?.current && document.activeElement === initialFocus.current ? undefined : setTimeout(() => {
      const target = initialFocus?.current || node.querySelector<HTMLElement>("[data-autofocus]") || focusables(node).find((el) => el.tagName !== "BUTTON" || !el.getAttribute("aria-label")?.startsWith("Close")) || node;
      target.focus?.({ preventScroll: true });
    }, 20);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); close.current?.(); return; }
      if (e.key !== "Tab") return;
      const f = focusables(node);
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    };
    node.addEventListener("keydown", onKey);
    const onOut = (e: FocusEvent) => {
      if (e.relatedTarget) return;
      setTimeout(() => {
        const a = document.activeElement;
        if (document.contains(node) && (!a || a === document.body)) (node.querySelector<HTMLElement>("[data-dialog-title]") || node).focus?.({ preventScroll: true });
      }, 0);
    };
    node.addEventListener("focusout", onOut);
    const entry = { node };
    openDialogs.push(entry);
    const onDocKey = (e: KeyboardEvent) => {
      // a menu or field that handled Esc itself (preventDefault) keeps its Esc
      if (e.key !== "Escape" || e.defaultPrevented || openDialogs[openDialogs.length - 1] !== entry || node.contains(document.activeElement)) return;
      e.stopPropagation();
      close.current?.();
    };
    document.addEventListener("keydown", onDocKey);
    return () => {
      const i = openDialogs.indexOf(entry);
      if (i >= 0) openDialogs.splice(i, 1);
      document.removeEventListener("keydown", onDocKey);
      clearTimeout(t); node.removeEventListener("keydown", onKey); node.removeEventListener("focusout", onOut);
      // focus already moved on (a new page put it in a field): leave it there
      const cur = document.activeElement;
      if (cur && cur !== document.body && !node.contains(cur)) return;
      // back to what opened it; if that's gone (a menu item, a deleted row), to the page title, never to nothing
      const back = prev?.focus && document.contains(prev) && prev !== document.body ? prev : document.querySelector<HTMLElement>("#app-main [data-page-title]");
      back?.focus?.({ preventScroll: true });
    };
  }, [open]);
}

/** Keeps an overlay mounted while it animates out. */
export function usePresence(open: boolean, ms = 170): { mounted: boolean; closing: boolean } {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) { setMounted(true); return undefined; }
    const t = setTimeout(() => setMounted(false), ms);
    return () => clearTimeout(t);
  }, [open, ms]);
  return { mounted: open || mounted, closing: !open && mounted };
}

/** Taps landing within ~350 ms of an overlay opening are the tail of the tap that opened it: swallow them. */
export function useGhostGuard(open: boolean): (e: SyntheticEvent) => void {
  const at = useRef(0);
  useEffect(() => { if (open) at.current = Date.now(); }, [open]);
  return (e) => { if (Date.now() - at.current < 350) { e.stopPropagation(); e.preventDefault(); } };
}

type DragHandlers = {
  onPointerDown?: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove?: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp?: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel?: () => void;
};
/** Phones: drag the sheet's handle or header down to close it (past 110 px, or a quick flick). */
export function useDragClose(onClose: () => void, enabled: boolean): { dy: number; handlers: DragHandlers } {
  const st = useRef<{ y: number; t: number } | null>(null);
  const [dy, setDy] = useState(0);
  // closed mid-drag by the app, not the finger: no release comes, so drop the drag and start the next open at rest
  useEffect(() => { if (!enabled) { st.current = null; setDy(0); } }, [enabled]);
  if (!enabled) return { dy: 0, handlers: {} };
  const handlers: DragHandlers = {
    onPointerDown: (e) => { if (e.button !== 0 || (e.target as Element).closest("button, a, input, select, textarea")) return; st.current = { y: e.clientY, t: Date.now() }; e.currentTarget.setPointerCapture?.(e.pointerId); },
    onPointerMove: (e) => { if (!st.current) return; setDy(Math.max(0, e.clientY - st.current.y)); },
    onPointerUp: (e) => {
      if (!st.current) return;
      const d = Math.max(0, e.clientY - st.current.y), v = d / Math.max(1, Date.now() - st.current.t);
      st.current = null;
      // back to rest either way: kept, the offset would hold a sheet that asks first (confirmClose) down, and reopen one this far down
      setDy(0);
      if (d > 110 || (d > 30 && v > 0.6)) onClose?.();
    },
    onPointerCancel: () => { st.current = null; setDy(0); },
  };
  return { dy, handlers };
}
