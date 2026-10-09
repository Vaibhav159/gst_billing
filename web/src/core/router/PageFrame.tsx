import { useEffect, useRef, type ReactNode, type MouseEvent } from "react";
import { useLocation, useNavigationType } from "react-router";
import { cn } from "@/core/cn";
import { useView } from "@/core/view";
import { useToast } from "@/core/ui";

export type Opener = { href: string | null; row: string | null; id: string | null };
type Place = { scroll: number; opener: Opener | null };
const places = new Map<string, Place>();

/** Say the new page's name to screen readers (the polite live region in AppLayout). */
export function announce(text: string) {
  const el = document.getElementById("route-announcer");
  if (!el) return;
  el.textContent = "";
  requestAnimationFrame(() => { el.textContent = text; });
}

function openerOf(target: EventTarget | null): Opener | null {
  const el = target instanceof Element ? target.closest("a, button, [data-row]") : null;
  if (!el) return null;
  return { href: el.getAttribute("href"), row: el.closest("[data-row]")?.getAttribute("data-row") ?? null, id: el.id || null };
}

/** After a page change: keep focus a page or dialog placed on purpose; on Back return to the row that opened the page; else the title. */
export function focusAfterNavigation(opener?: Opener | null) {
  if (document.querySelector('.overlay-layer [role="dialog"][aria-modal="true"]:not([data-closing])')) return;
  const main = document.getElementById("app-main");
  const a = document.activeElement;
  if (a && a !== document.body && (a.closest("[role=dialog]") || main?.contains(a) || a.hasAttribute("data-autofocus"))) return;
  let target: HTMLElement | null = null;
  if (opener && main) {
    try {
      target = (opener.id ? document.getElementById(opener.id) : null)
        || (opener.row ? main.querySelector<HTMLElement>(`[data-row="${CSS.escape(opener.row)}"]`) : null)
        || (opener.href ? main.querySelector<HTMLElement>(`a[href="${CSS.escape(opener.href)}"]`) : null);
    } catch { target = null; }
  }
  (target || main?.querySelector<HTMLElement>("[data-page-title]"))?.focus({ preventScroll: true });
}

/**
 * Wraps every page. A new page starts at the top; Back returns to the same scroll and row.
 * Focus moves to the new page's title, and its name is announced. Plain toasts clear.
 * The second click of a double click (within 300 ms) can't land on the page that just opened.
 * Pages rise in on desktop; on phones they slide forward or back.
 */
export function PageFrame({ children }: { children: ReactNode }) {
  const location = useLocation();
  const nav = useNavigationType();
  const { isDesktop } = useView();
  const { clearPlain } = useToast();
  const first = useRef(true);
  const openedAt = useRef(0);
  const key = location.key;

  useEffect(() => {
    const main = document.getElementById("app-main");
    if (!main) return undefined;
    const onScroll = () => { const p = places.get(key) || { scroll: 0, opener: null }; places.set(key, { ...p, scroll: main.scrollTop }); };
    main.addEventListener("scroll", onScroll, { passive: true });
    return () => main.removeEventListener("scroll", onScroll);
  }, [key]);

  useEffect(() => {
    openedAt.current = Date.now();
    const main = document.getElementById("app-main");
    const back = nav === "POP" ? places.get(key) : undefined;
    requestAnimationFrame(() => main?.scrollTo(0, back?.scroll ?? 0));
    if (first.current) { first.current = false; return undefined; }
    clearPlain();
    const t = setTimeout(() => {
      announce(document.title.replace(/ · GST Billing$/, ""));
      focusAfterNavigation(back?.opener);
    }, 90);
    return () => clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const onClickCapture = (e: MouseEvent) => {
    if (!first.current && Date.now() - openedAt.current < 300) { e.stopPropagation(); e.preventDefault(); return; }
    const p = places.get(key) || { scroll: 0, opener: null };
    places.set(key, { ...p, opener: openerOf(e.target) });
  };
  // the phone header's Back with no page before it goes up a level in place (a replace marked dir: "back"): still a step back
  const stepBack = nav === "POP" || (location.state as { dir?: string } | null)?.dir === "back";
  const anim = first.current ? "" : isDesktop ? "anim-page-rise" : stepBack ? "anim-page-pop" : "anim-page-push";
  return <div key={location.pathname} onClickCapture={onClickCapture} className={cn("h-full", anim)}>{children}</div>;
}
