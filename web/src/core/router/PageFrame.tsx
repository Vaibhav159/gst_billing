import { Component, createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type MouseEvent } from "react";
import { useLocation, useNavigationType } from "react-router";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { noteVisit } from "@/core/shell/recent";
import { useView } from "@/core/view";
import { useToast } from "@/core/ui";

/** A record's own page (a bill, a customer, a purchase, a product, a supplier) for search's "Opened recently"; not a form or a tool beside them. */
const RECORD_PAGE = /^\/(sales|customers|purchases|products|suppliers)\/[^/]+$/;
const NOT_A_RECORD = /\/(new|export|batch|capture|inbox|ai-import|paper)$/;

export type Opener = { href: string | null; row: string | null; id: string | null };
type Place = { scroll: number; opener: Opener | null };
/** Where you were on each page you left (by history entry), for Back: the newest 50. */
const places = new Map<string, Place>();
const KEEP_PLACES = 50;
function remember(entry: string, place: Place) {
  places.delete(entry); // a Map keeps insertion order: re-adding makes it the newest
  places.set(entry, place);
  if (places.size > KEEP_PLACES) places.delete(places.keys().next().value!);
}

/**
 * True while the sign-in page shows (RootLayout keeps it). The frame mounts fresh after signing in, and that page is
 * a move like any other (focus to its title, its name announced), not the page the app opened on.
 */
export const SignInShown = createContext<{ current: boolean }>({ current: false });

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

/** A row itself when focus can land on it (a tabindex, or a link or button), else its first link or button: never a row that can't take focus (part 0 carry). */
function focusableRow(row: HTMLElement | null): HTMLElement | null {
  if (!row) return null;
  if (row.hasAttribute("tabindex") || row.matches("a[href], button, input, select, textarea")) return row;
  return row.querySelector<HTMLElement>("a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])");
}

/** After a page change: keep focus a page or dialog placed on purpose; on Back return to the row that opened the page; else the title. */
export function focusAfterNavigation(opener?: Opener | null) {
  if (document.querySelector('.overlay-layer [role="dialog"][aria-modal="true"]:not([data-closing])')) return;
  const main = document.getElementById("app-main");
  const a = document.activeElement;
  // the page's own title holds focus only because the frame put it there (the page that closed a moment before
  // focused late): it gives way to the row that opened this page; anything else in the page was placed on purpose (Ruling 60)
  const onTitle = a instanceof HTMLElement && a.hasAttribute("data-page-title") && Boolean(main?.contains(a));
  if (a && a !== document.body && !onTitle && (a.closest("[role=dialog]") || main?.contains(a) || a.hasAttribute("data-autofocus"))) return;
  let target: HTMLElement | null = null;
  if (opener && main) {
    try {
      target = (opener.id ? document.getElementById(opener.id) : null)
        || (opener.row ? focusableRow(main.querySelector<HTMLElement>(`[data-row="${CSS.escape(opener.row)}"]`)) : null)
        || (opener.href ? main.querySelector<HTMLElement>(`a[href="${CSS.escape(opener.href)}"]`) : null);
    } catch { target = null; }
  }
  if (!target && onTitle) return;
  (target || main?.querySelector<HTMLElement>("[data-page-title]"))?.focus({ preventScroll: true });
}

type Clicked = { current: { entry: string; opener: Opener | null } | null };
type KeeperProps = { pathname: string; entry: string; clicked: Clicked; children: ReactNode };
/**
 * Notes where you were on the page you're leaving just before React swaps in the next one, as the prototype's
 * placeOf() did: the list's scroll, and what has focus (a row opened with Enter), else what was last clicked
 * (Safari doesn't focus a clicked link). A scroll listener would be too late: on a slow phone it hears the
 * next page's clamp before React removes it, and Back lands at the top.
 */
class PlaceKeeper extends Component<KeeperProps> {
  getSnapshotBeforeUpdate(prev: Readonly<KeeperProps>) {
    if (prev.pathname === this.props.pathname) return null;
    const main = document.getElementById("app-main");
    const a = document.activeElement;
    const focused = main && a && a !== document.body && main.contains(a) ? openerOf(a) : null;
    const click = this.props.clicked.current;
    remember(prev.entry, { scroll: main?.scrollTop ?? 0, opener: focused ?? (click?.entry === prev.entry ? click.opener : null) });
    return null;
  }
  componentDidUpdate() { /* React warns when getSnapshotBeforeUpdate has no componentDidUpdate beside it */ }
  render() { return this.props.children; }
}

/**
 * Wraps every page. A new page starts at the top; Back returns to the same scroll and row.
 * Focus moves to the new page's title, and its name is announced. Plain toasts clear.
 * The second click of a double click (within 300 ms) can't land on the page that just opened.
 * Pages rise in on desktop; on phones they slide forward or back. A record stayed on is noted for search's "Opened recently".
 * A page is its path: a filter change (?query) re-renders it, and none of the above happens.
 */
export function PageFrame({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { pathname, key } = location;
  const nav = useNavigationType();
  const { isDesktop } = useView();
  const { clearPlain } = useToast();
  const signIn = useContext(SignInShown);
  const meId = useAuth().me?.id;
  const openedAt = useRef(0);
  const clicked = useRef<Clicked["current"]>(null);
  // the page on screen now, written as React puts it there (a layout effect runs before anything else can): a page's
  // 90 ms focus timer that fires after another page took its place does nothing, so a quick Back isn't overtaken (Ruling 60)
  const shown = useRef(pathname);
  useLayoutEffect(() => { shown.current = pathname; }, [pathname]);

  // the phone header's Back with no page before it goes up a level in place (a replace marked dir: "back"): still a step back
  const stepBack = nav === "POP" || (location.state as { dir?: string } | null)?.dir === "back";
  const entrance = isDesktop ? "anim-page-rise" : stepBack ? "anim-page-pop" : "anim-page-push";
  // how this page came in, settled once per page: the page the app opened on comes in quietly, with the app,
  // however often the shell re-renders; the page after signing in comes in like any other move
  const [visit, setVisit] = useState(() => ({ pathname, anim: signIn.current ? entrance : "", quiet: !signIn.current }));
  if (visit.pathname !== pathname) setVisit({ pathname, anim: entrance, quiet: false });

  useEffect(() => {
    openedAt.current = Date.now();
    const main = document.getElementById("app-main");
    const back = nav === "POP" ? places.get(key) : undefined;
    requestAnimationFrame(() => main?.scrollTo(0, back?.scroll ?? 0));
    if (visit.quiet) return undefined;
    clearPlain();
    const t = setTimeout(() => {
      if (shown.current !== pathname) return;
      announce(document.title.replace(/ · GST Billing$/, ""));
      focusAfterNavigation(back?.opener);
    }, 90);
    return () => clearTimeout(t);
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // a record stayed on goes to the top of search's "Opened recently", under the title its page put up (400 ms gives it
  // time to). The page the app opened on counts; a filter change (?query) is the same visit, as above.
  // ponytail: a record still loading at 400 ms is noted under its loading title. Upgrade: the record's page names it.
  useEffect(() => {
    if (meId == null || !RECORD_PAGE.test(pathname) || NOT_A_RECORD.test(pathname)) return undefined;
    const t = setTimeout(() => noteVisit(meId, { to: pathname, label: document.title.replace(/ · GST Billing$/, "") }), 400);
    return () => clearTimeout(t);
  }, [pathname, meId]);

  const onClickCapture = (e: MouseEvent) => {
    if (Date.now() - openedAt.current < 300) { e.stopPropagation(); e.preventDefault(); return; }
    clicked.current = { entry: key, opener: openerOf(e.target) };
  };
  return (
    <PlaceKeeper pathname={pathname} entry={key} clicked={clicked}>
      <div key={pathname} onClickCapture={onClickCapture} className={cn("h-full", visit.anim)}>{children}</div>
    </PlaceKeeper>
  );
}
