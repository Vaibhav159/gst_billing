// The phone shells. Expert: five bottom tabs. Easy: the same five slots with big labels.
// The page's <main id="app-main"> comes in as children.
import type { ReactNode } from "react";
import { Link, useLocation, useMatches } from "react-router";
import { ArrowLeft } from "lucide-react";
import { useNetwork } from "@/core/api/network";
import { cn } from "@/core/cn";
import { phoneModeOf, usePrefs } from "@/core/prefs";
import { HideNavContext, NotchClearedContext, PhoneSearchContext } from "@/core/ui";
import { EASY_TABS, EXPERT_TABS, tabOf } from "./nav";
import { bannerShows, OfflineBanner } from "./OfflineBanner";

/** What a route can say about the phone shell (routes.tsx): forms and print hide the tabs. */
type ShellHandle = { hideNav?: boolean } | undefined;

/** openPalette: search, for the Expert header's Search button (PhoneHeader puts it on pages without Back). */
export function PhoneShell({ children, easy, openPalette }: { children: ReactNode; easy: boolean; openPalette?: () => void }) {
  const { pathname } = useLocation();
  const matches = useMatches();
  const net = useNetwork();
  const { prefs, ready } = usePrefs();
  const tabs = easy ? EASY_TABS : EXPERT_TABS;
  const cur = tabOf(pathname);
  const hide = matches.some((m) => (m.handle as ShellHandle)?.hideNav === true);
  // someone whose phone opens on Easy is on a full-view page: the way back stays at the top (once their setting is known)
  const fromEasy = ready && phoneModeOf(prefs) === "easy";
  // the topmost strip clears the notch (the prototype's order: the banner, then Back to Easy), else the page's own header does
  const banner = bannerShows(net);
  const back = !easy && fromEasy;
  // search is Expert's, beside the tabs: Easy has its own big buttons, and a form or print, where the tabs make way, keeps its header
  const search = !easy && !hide && openPalette ? openPalette : null;
  return (
    <div className={cn("h-full flex flex-col bg-ground text-fg", easy ? "text-[16px]" : "text-md", net === "offline" && "has-offline")}>
      <OfflineBanner />
      {back ? (
        // a mode switch is a new home, as More's switch is: Back from Easy's home doesn't return to the full view
        <Link to="/e" replace className={cn("shrink-0 flex items-center justify-center gap-2 bg-brand text-onbrand font-semibold text-md anim-rise", banner ? "min-h-11" : "pt-[env(safe-area-inset-top,0px)] min-h-[calc(44px+env(safe-area-inset-top,0px))]")}>
          <ArrowLeft size={18} aria-hidden="true" />Back to Easy
        </Link>
      ) : null}
      <NotchClearedContext.Provider value={banner || back}>
        <HideNavContext.Provider value={hide}><PhoneSearchContext.Provider value={search}>{children}</PhoneSearchContext.Provider></HideNavContext.Provider>
      </NotchClearedContext.Provider>
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
