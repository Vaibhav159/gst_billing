// The phone shells. Expert: five bottom tabs. Easy: the same five slots with big labels.
// The page's <main id="app-main"> comes in as children.
import type { ReactNode } from "react";
import { Link, useLocation, useMatches } from "react-router";
import { ArrowLeft } from "lucide-react";
import { useNetwork } from "@/core/api/network";
import { cn } from "@/core/cn";
import { phoneModeOf, usePrefs } from "@/core/prefs";
import { HideNavContext } from "@/core/ui";
import { EASY_TABS, EXPERT_TABS, tabOf } from "./nav";

/** What a route can say about the phone shell (routes.tsx): forms and print hide the tabs. */
type ShellHandle = { hideNav?: boolean } | undefined;

export function PhoneShell({ children, easy }: { children: ReactNode; easy: boolean }) {
  const { pathname } = useLocation();
  const matches = useMatches();
  const net = useNetwork();
  const { prefs, ready } = usePrefs();
  const tabs = easy ? EASY_TABS : EXPERT_TABS;
  const cur = tabOf(pathname);
  const hide = matches.some((m) => (m.handle as ShellHandle)?.hideNav === true);
  // someone whose phone opens on Easy is on a full-view page: the way back stays at the top (once their setting is known)
  const fromEasy = ready && phoneModeOf(prefs) === "easy";
  return (
    <div className={cn("h-full flex flex-col bg-ground text-fg", easy ? "text-[16px]" : "text-md", net === "offline" && "has-offline")}>
      {!easy && fromEasy ? (
        <Link to="/e" className="shrink-0 flex items-center justify-center gap-2 min-h-11 bg-brand text-onbrand font-semibold text-md anim-rise">
          <ArrowLeft size={18} aria-hidden="true" />Back to Easy
        </Link>
      ) : null}
      <HideNavContext.Provider value={hide}>{children}</HideNavContext.Provider>
      {hide ? null : (
        <nav aria-label="Tabs" className="phone-tabs shrink-0 border-t border-rule bg-bar grid grid-cols-5 pb-[env(safe-area-inset-bottom,0px)]">
          {tabs.map((t) => {
            const on = t.tab === cur;
            return (
              <Link key={t.to} to={t.to} replace aria-current={on ? "page" : undefined}
                className={cn("flex flex-col items-center justify-center gap-1 min-h-[60px] transition-colors active:scale-[0.96] duration-150", easy ? "text-[14px] leading-[18px]" : "text-2xs", on ? "text-brand font-semibold" : "text-muted hover:text-fg2")}>
                <span className="relative grid place-items-center w-14 h-8">
                  <span aria-hidden="true" className={cn("absolute inset-0 rounded-full bg-brand-tint border border-brand-line transition-[transform,opacity] duration-200 ease-out", on ? "opacity-100 scale-100" : "opacity-0 scale-x-50")} />
                  <t.icon size={easy ? 24 : 22} aria-hidden="true" strokeWidth={on ? 2.25 : 2} className="relative" />
                </span>
                <span className="tab-label">{t.label}</span>
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
