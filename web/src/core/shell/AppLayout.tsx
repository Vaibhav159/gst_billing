import { useContext, useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { useNetwork } from "@/core/api/network";
import { cn } from "@/core/cn";
import { phoneModeOf, usePrefs } from "@/core/prefs";
import { useView } from "@/core/view";
import { ScopeProvider } from "@/core/scope";
import { ListSkeleton, ToastHost } from "@/core/ui";
import { PageFrame, SignInShown } from "@/core/router/PageFrame";
import { DesktopShell } from "./DesktopShell";
import { useKeyboardInset } from "./keyboard";
import { OfflineBanner } from "./OfflineBanner";
import { PhoneShell } from "./PhoneShell";
import { ScreenBoundary } from "./ScreenBoundary";

/**
 * Around every route, sign-in included: the app's one ToastHost (a second would show every toast twice), the view on
 * its root, so the sign-in form gets the phone's 16 px fields too (iOS zooms into anything smaller), and the phone's
 * keyboard height (--kb). It also tells the page frame that the sign-in page was showing, so the page after it is
 * greeted like a move: set while the sign-in page shows, cleared by AppLayout once a page has stayed.
 */
export function RootLayout() {
  const { view } = useView();
  const { pathname } = useLocation();
  const signIn = useRef(false);
  useEffect(() => { if (pathname === "/login") signIn.current = true; }, [pathname]);
  useKeyboardInset();
  return (
    <SignInShown.Provider value={signIn}>
      <div data-view={view} className="h-full"><Outlet /><ToastHost /></div>
    </SignInShown.Provider>
  );
}

/** Search (Ctrl K) arrives in Task 17; until then the shell's search button and Ctrl K do nothing. */
const openPalette = () => {};

export function AppLayout() {
  const { view, isPhone, isDesktop } = useView();
  const location = useLocation();
  const { pathname } = location;
  const navigate = useNavigate();
  const { prefs, ready } = usePrefs();
  const net = useNetwork();
  const signIn = useContext(SignInShown);
  // A phone's home is Easy unless the person chose Expert; an Expert person isn't sent there on a guess before their
  // setting is known. Easy and the phone's More are for phones: on a desktop their addresses open the dashboard.
  const home = isPhone && pathname === "/";
  const phoneOnly = pathname === "/e" || pathname.startsWith("/e/") || pathname.replace(/\/+$/, "") === "/more";
  const to = isDesktop && phoneOnly ? "/" : home && ready && phoneModeOf(prefs) === "easy" ? "/e" : null;
  // The address the app opened on (or that signing in led to) moving on is the app opening there: the page it moves to
  // is the first page, quiet as one, or greeted if signing in led here. Any later move goes through the page frame,
  // so it's read out and focused like any other.
  const [first] = useState(location.key);
  const opening = to !== null && location.key === first;
  // Opened at home with no setting kept on this phone yet, neither home shows, or is greeted, until the setting is in:
  // the greeting after signing in is for the home that stays. Offline the setting can't come, so the Expert home
  // stands in rather than a wait with no end, and a page that has shown stays until the setting moves it on.
  const shown = useRef(false);
  const unsure = home && !ready && location.key === first && net !== "offline" && !shown.current;
  // once a page stays, its frame has taken the greeting after signing in: later frames are for later moves
  useEffect(() => { if (!opening && !unsure) { shown.current = true; signIn.current = false; } });
  if (opening) return <Navigate to={to} replace />;
  // the offline or server-trouble banner is one per screen: above the page here, the phone shell's own (its topmost
  // strip), or under the desktop's top bar, as in the prototype
  if (unsure) return <><OfflineBanner /><div className="p-6"><ListSkeleton what="the app" /></div></>;
  const page = to ? <Navigate to={to} replace /> : <Outlet />;
  // on a desktop the skip link focuses the page, so <main> takes focus there; a page that fails to draw shows a way home instead
  const main = <main id="app-main" tabIndex={isDesktop ? -1 : undefined} className={cn("flex-1 min-h-0 overflow-y-auto", isDesktop ? "outline-none" : "overscroll-contain")}><PageFrame><ScreenBoundary key={pathname} onHome={() => navigate("/")}>{page}</ScreenBoundary></PageFrame></main>;
  return (
    <ScopeProvider>
      <div data-view={view} className="h-full flex flex-col bg-ground text-fg">
        {isDesktop ? <DesktopShell openPalette={openPalette}><OfflineBanner />{main}</DesktopShell> : <PhoneShell easy={view === "easy"}>{main}</PhoneShell>}
        <div id="route-announcer" aria-live="polite" aria-atomic="true" className="sr-only" />
      </div>
    </ScopeProvider>
  );
}
