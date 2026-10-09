import { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router";
import { cn } from "@/core/cn";
import { useView } from "@/core/view";
import { ScopeProvider } from "@/core/scope";
import { ToastHost } from "@/core/ui";
import { PageFrame, SignInShown } from "@/core/router/PageFrame";
import { DesktopShell } from "./DesktopShell";

/**
 * Around every route, sign-in included: the app's one ToastHost (a second would show every toast twice), and the
 * view on its root, so the sign-in form gets the phone's 16 px fields too (iOS zooms into anything smaller).
 * It also tells the page frame when the sign-in page was showing, so the page after it is greeted like a move.
 */
export function RootLayout() {
  const { view } = useView();
  const { pathname } = useLocation();
  const signIn = useRef(false);
  useEffect(() => { signIn.current = pathname === "/login"; }, [pathname]);
  return (
    <SignInShown.Provider value={signIn}>
      <div data-view={view} className="h-full"><Outlet /><ToastHost /></div>
    </SignInShown.Provider>
  );
}

/** Search (Ctrl K) arrives in Task 17; until then the shell's search button and Ctrl K do nothing. */
const openPalette = () => {};

export function AppLayout() {
  const { view, isDesktop } = useView();
  // on a desktop the skip link focuses the page, so <main> takes focus there
  const main = <main id="app-main" tabIndex={isDesktop ? -1 : undefined} className={cn("flex-1 min-h-0 overflow-y-auto", isDesktop && "outline-none")}><PageFrame><Outlet /></PageFrame></main>;
  return (
    <ScopeProvider>
      <div data-view={view} className="h-full flex flex-col bg-ground text-fg">
        {isDesktop ? <DesktopShell openPalette={openPalette}>{main}</DesktopShell> : main}
        <div id="route-announcer" aria-live="polite" aria-atomic="true" className="sr-only" />
      </div>
    </ScopeProvider>
  );
}
