import { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router";
import { useView } from "@/core/view";
import { ToastHost } from "@/core/ui";
import { PageFrame, SignInShown } from "@/core/router/PageFrame";

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

export function AppLayout() {
  const { view } = useView();
  return (
    <div data-view={view} className="h-full flex flex-col bg-ground text-fg">
      <main id="app-main" className="flex-1 min-h-0 overflow-y-auto"><PageFrame><Outlet /></PageFrame></main>
      <div id="route-announcer" aria-live="polite" aria-atomic="true" className="sr-only" />
    </div>
  );
}
