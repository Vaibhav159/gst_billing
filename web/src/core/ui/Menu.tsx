import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { useNavigate } from "react-router";
import { Check, type LucideIcon } from "lucide-react";
import { cn } from "@/core/cn";
import { useView } from "@/core/view";
import { Dialog } from "./Dialog";
import { Portal, layerZoom, overlayLayer, usePresence } from "./Overlay";

/** The active option in a listbox or combobox (Ctrl K, pickers): a ring you can see in every theme. */
export function optionClass(active: boolean): string {
  return active ? "row-on" : "hover:bg-fg/[0.04]";
}

/** A menu row. to: a page to open; checked: the current choice (a tick in the icon's place). */
export type MenuItem =
  | { label: string; onSelect?: () => void; to?: string; icon?: LucideIcon; hint?: string; tone?: "danger"; disabled?: boolean; checked?: boolean }
  | { divider: true }
  | { heading: string };
type MenuAction = Extract<MenuItem, { label: string }>;
export type MenuTriggerProps = ButtonHTMLAttributes<HTMLButtonElement> & { ref: Ref<HTMLButtonElement> };
export type MenuProps = { trigger: (props: MenuTriggerProps) => ReactNode; items: MenuItem[]; align?: "start" | "end"; width?: number; title?: string };

/** A desktop menu's place: under its trigger (top) or over it (bottom, so it grows up from the trigger), and its tallest. */
export type MenuPlace = { top?: number; bottom?: number; maxH: number };
const GAP = 6, EDGE = 8, MIN_H = 96;
/**
 * Where a desktop menu opens, in the overlay layer's px, and how tall it may grow (Ruling 57): under its trigger, or
 * over it when its guessed height (estH) doesn't fit below and there's more room above. Either way it's capped at the
 * room on that side less an 8 px margin, so it shows whole when it fits and scrolls inside when it doesn't.
 */
export function menuPlace(trigger: { top: number; bottom: number }, layerH: number, estH: number): MenuPlace {
  const below = layerH - trigger.bottom - GAP - EDGE;
  const above = trigger.top - GAP - EDGE;
  if (estH <= below || below >= above) return { top: trigger.bottom + GAP, maxH: Math.max(MIN_H, below) };
  return { bottom: layerH - trigger.top + GAP, maxH: Math.max(MIN_H, above) };
}

/**
 * Dropdown menu. trigger(props) renders the button; spread props onto it.
 * items: [{ label, icon, onSelect, to, tone: 'danger', disabled, checked, hint }, { heading }, { divider: true }]
 * Phones get a bottom sheet with large rows.
 */
export function Menu({ trigger, items, align = "end", width = 248, title = "Actions" }: MenuProps) {
  const { isPhone } = useView();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<(MenuPlace & { left: number }) | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const { mounted, closing } = usePresence(open, 130);
  const close = (refocus = true) => { setOpen(false); if (refocus) setTimeout(() => btn.current?.focus(), 0); };
  useLayoutEffect(() => {
    if (!open || isPhone || !btn.current) return;
    const overlay = overlayLayer();
    const z = layerZoom(overlay);
    const r = btn.current.getBoundingClientRect();
    const o = overlay.getBoundingClientRect();
    const ow = o.width / z, oh = o.height / z;
    let left = align === "end" ? (r.right - o.left) / z - width : (r.left - o.left) / z;
    left = Math.max(8, Math.min(left, ow - width - 8));
    setPos({ left, ...menuPlace({ top: (r.top - o.top) / z, bottom: (r.bottom - o.top) / z }, oh, items.length * 40 + 16) });
  }, [open, isPhone, align, width, items.length]);
  useEffect(() => {
    if (!open || isPhone) return;
    setTimeout(() => list.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus(), 0);
  }, [open, isPhone, pos]);
  const onKey = (e: KeyboardEvent) => {
    const els = [...list.current!.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") { e.preventDefault(); els[(i + 1) % els.length]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); els[(i - 1 + els.length) % els.length]?.focus(); }
    if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); close(); }
  };
  const select = (it: MenuAction) => { if (it.disabled) return; setOpen(false); btn.current?.focus({ preventScroll: true }); setTimeout(() => { it.onSelect?.(); if (it.to) navigate(it.to); }, 0); };
  const tp: MenuTriggerProps = { ref: btn, onClick: () => setOpen((o) => !o), "aria-haspopup": "menu", "aria-expanded": open };
  if (isPhone) {
    return (
      <>
        {trigger(tp)}
        <Dialog open={open} onClose={() => close()} title={title}>
          <div className="-mx-5 -mt-1 flex flex-col" role="menu">
            {items.map((it, i) => {
              if ("divider" in it) return <div key={i} className="h-px bg-rule my-1" />;
              if ("heading" in it) return <p key={i} className="caps px-5 pt-3 pb-1">{it.heading}</p>;
              const Icon = it.checked ? Check : it.icon;
              return (
                <button key={i} type="button" role="menuitem" disabled={it.disabled} aria-current={it.checked || undefined} onClick={() => select(it)}
                  className={cn("flex items-center gap-3 px-5 min-h-14 text-left text-md disabled:opacity-45", it.tone === "danger" ? "text-neg" : "text-fg")}>
                  {Icon ? <Icon size={20} aria-hidden="true" className={it.tone === "danger" ? "" : "text-fg2"} /> : null}
                  <span className="flex-1"><span className="block">{it.label}</span>{it.hint ? <span className="block text-sm text-muted">{it.hint}</span> : null}</span>
                </button>
              );
            })}
          </div>
        </Dialog>
      </>
    );
  }
  return (
    <>
      {trigger(tp)}
      {mounted && pos ? (
        <Portal>
          <div className={cn("absolute inset-0 z-pop", closing ? "pointer-events-none" : "pointer-events-auto")} onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }}>
            <div ref={list} role="menu" data-closing={closing ? "" : undefined} onKeyDown={onKey}
              style={{ top: pos.top, bottom: pos.bottom, left: pos.left, width, maxHeight: pos.maxH, transformOrigin: `${pos.bottom === undefined ? "top" : "bottom"} ${align === "end" ? "right" : "left"}` }}
              className={cn("absolute card shadow-pop py-1.5 overflow-y-auto", closing ? "anim-pop-out" : "anim-pop")}>
              {items.map((it, i) => {
                if ("divider" in it) return <div key={i} className="h-px bg-rule my-1.5" />;
                if ("heading" in it) return <p key={i} className="caps px-3.5 pt-2 pb-1">{it.heading}</p>;
                const Icon = it.checked ? Check : it.icon;
                return (
                  <button key={i} type="button" role="menuitem" disabled={it.disabled} aria-current={it.checked || undefined} onClick={() => select(it)} title={it.disabled && it.hint ? it.hint : undefined}
                    className={cn("w-full flex items-start gap-2.5 px-3.5 py-2 text-left hover:bg-fg/[0.04] outline-none row-focus disabled:opacity-45 disabled:cursor-not-allowed", it.tone === "danger" ? "text-neg" : "text-fg")}>
                    {Icon ? <Icon size={16} aria-hidden="true" className={cn("mt-0.5 shrink-0", it.tone === "danger" ? "" : "text-fg2")} /> : null}
                    <span className="flex-1 min-w-0"><span className="block">{it.label}</span>{it.hint ? <span className="block text-xs text-muted mt-0.5">{it.hint}</span> : null}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </Portal>
      ) : null}
    </>
  );
}
