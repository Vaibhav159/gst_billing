// The desktop shell: a top bar with every section visible (overflow under More), firm and year scope,
// search (Ctrl K) and the account menu. The page's <main id="app-main"> comes in as children.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { Search } from "lucide-react";
import { cn } from "@/core/cn";
import { useFirms } from "@/core/scope";
import { AppMark, Kbd } from "@/core/ui";
import { AccountMenu } from "./AccountMenu";
import { MOD, MORE_NAV, sectionOf } from "./nav";
import { NavBar } from "./NavBar";
import { FirmPicker, FyPicker } from "./ScopePickers";
import { useShortcuts } from "./shortcuts";
import { ShortcutsDialog } from "./ShortcutsDialog";

export function DesktopShell({ children, openPalette }: { children: ReactNode; openPalette: () => void }) {
  const { pathname } = useLocation();
  const section = sectionOf(pathname);
  const inMore = MORE_NAV.some((m) => m.section === section);
  const head = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [keys, setKeys] = useState(false);
  useShortcuts({ enabled: true, openPalette, openShortcuts: () => setKeys(true) });
  useEffect(() => {
    if (!head.current || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < 1220));
    ro.observe(head.current);
    return () => ro.disconnect();
  }, []);
  // a shop with no firm yet: only the business to add, nothing to pick or count (a list that failed to load isn't that)
  const { firms, loading, error } = useFirms();
  const empty = !loading && !error && !firms.length;
  return (
    <div className="h-full flex flex-col bg-ground text-fg text-base">
      <SkipLink />
      <header className="bg-bar border-b border-rule shrink-0">
        <div ref={head} className="flex items-center gap-5 px-8 h-16 mx-auto w-full max-w-[1400px]">
          <Link to="/" className="flex items-center gap-2.5 rounded-ctl shrink-0" aria-label="GST Billing, dashboard">
            <AppMark size={36} />
            <span className={cn("flex flex-col leading-tight", narrow && "sr-only")}><span className="font-semibold">GST Billing</span><span className="text-2xs text-muted">Pro Suite</span></span>
          </Link>
          {empty ? <p className="flex-1 text-fg2">Setting up the shop</p> : <NavBar section={section} inMore={inMore} />}
          <div className="flex items-center gap-2 shrink-0">
            {empty ? null : (
              <button type="button" onClick={openPalette} aria-label="Search (Ctrl K)" aria-keyshortcuts="Control+K" className={cn("h-10 inline-flex items-center gap-2 rounded-ctl border border-line bg-card text-fg2 hover:text-fg hover:border-muted/50 transition-colors", narrow ? "w-10 justify-center" : "pl-3 pr-2")}>
                <Search size={16} aria-hidden="true" />{narrow ? null : <><span className="text-sm">Search</span> <Kbd>{MOD} K</Kbd></>}
              </button>
            )}
            {empty ? null : <><FirmPicker /><FyPicker /></>}
            <AccountMenu onShortcuts={() => setKeys(true)} />
          </div>
        </div>
      </header>
      {children}
      <ShortcutsDialog open={keys} onClose={() => setKeys(false)} />
    </div>
  );
}

/** Keyboard users can jump past the header. */
function SkipLink() {
  return (
    <a href="#app-main" onClick={(e) => { e.preventDefault(); document.getElementById("app-main")?.focus(); }}
      className="sr-only focus:not-sr-only focus:absolute focus:z-toast focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:rounded-ctl focus:bg-brand focus:text-onbrand focus:font-semibold">Skip to main content</a>
  );
}
