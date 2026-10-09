import { Outlet } from "react-router";
import { useView } from "@/core/view";
import { ToastHost } from "@/core/ui";
import { PageFrame } from "@/core/router/PageFrame";

/** Around every route, sign-in included: the app's one ToastHost (a second would show every toast twice). */
export function RootLayout() {
  return <><Outlet /><ToastHost /></>;
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
