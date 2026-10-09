import { createContext, useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/core/cn";
import { useView } from "@/core/view";
import { AppMark } from "./Avatar";
import { IconButton } from "./Button";

/* ── Page layout ───────────────────────────────────────── */
/** The tab's title: "<title> · GST Billing". */
export function useDocTitle(title: string | null | undefined) {
  useEffect(() => { if (title) document.title = `${title} · GST Billing`; }, [title]);
}

export type Breadcrumb = { label: string; to?: string };
/**
 * The phone header's Back. When this tab has a page before this one, Back returns to it.
 * Opened straight from a link, a path goes up to that page, and true goes home.
 */
export type PageBack = string | true;

export type PageProps = {
  title: string;
  context?: ReactNode;
  icon?: LucideIcon;
  breadcrumbs?: Breadcrumb[];
  actions?: ReactNode;
  banner?: ReactNode;
  phoneTitle?: string;
  phoneSubtitle?: ReactNode;
  back?: PageBack;
  phoneActions?: ReactNode;
  actionBar?: ReactNode;
  narrow?: boolean;
  logo?: boolean;
  className?: string;
  children?: ReactNode;
};

/**
 * One page component for every view.
 * Desktop: banner, header (icon tile, breadcrumbs, title, context line, actions), content.
 * Phone: sticky header (back or logo, title, subtitle, actions), content, optional sticky action bar.
 */
export function Page({ title, context, icon, breadcrumbs, actions, banner, children, phoneTitle, phoneSubtitle, back, phoneActions, actionBar, narrow, logo, className }: PageProps) {
  const { isPhone } = useView();
  useDocTitle(title);
  if (isPhone) {
    return (
      <div className="min-h-full flex flex-col">
        <PhoneHeader title={phoneTitle ?? title} subtitle={phoneSubtitle ?? context} back={back} actions={phoneActions} logo={logo} />
        <div className={cn("flex-1 px-4 pt-4 pb-8 flex flex-col gap-4 min-w-0", className)}>
          {banner}
          {children}
        </div>
        {actionBar ? <PhoneActionBar>{actionBar}</PhoneActionBar> : null}
      </div>
    );
  }
  // (the phone page is min-h-full with flex-1 content, so a short page still puts its bar at the bottom)
  return (
    <div className={cn("mx-auto w-full px-8 pt-6 pb-14 flex flex-col gap-6 min-w-0", narrow ? "max-w-[1040px]" : "max-w-[1400px]", className)}>
      {banner}
      <PageHeader title={title} context={context} icon={icon} breadcrumbs={breadcrumbs} actions={actions} />
      {children}
    </div>
  );
}

export type PageHeaderProps = { title: ReactNode; context?: ReactNode; icon?: LucideIcon; breadcrumbs?: Breadcrumb[]; actions?: ReactNode };

export function PageHeader({ title, context, icon: Icon, breadcrumbs, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="flex items-center gap-4 min-w-0">
        {Icon ? (
          <span aria-hidden="true" className="w-12 h-12 rounded-card bg-brand-tint border border-brand-line grid place-items-center text-brand shrink-0">
            <Icon size={22} />
          </span>
        ) : null}
        <div className="min-w-0 flex flex-col gap-0.5">
          {breadcrumbs?.length ? (
            <nav aria-label="Breadcrumb">
              <ol className="flex flex-wrap items-center gap-1 text-sm text-muted">
                {breadcrumbs.map((b, i) => (
                  <li key={i} className="flex items-center gap-1">
                    {b.to ? <Link to={b.to} className="hover:text-fg rounded-sm">{b.label}</Link> : <span>{b.label}</span>}
                    <ChevronRight size={14} aria-hidden="true" />
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
          <h1 data-page-title="" tabIndex={-1} className="text-3xl font-semibold tracking-[-0.015em] leading-tight outline-none">{title}</h1>
          {context ? <p className="text-muted">{context}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export type PhoneHeaderProps = { title: ReactNode; subtitle?: ReactNode; back?: PageBack; actions?: ReactNode; logo?: boolean };

export function PhoneHeader({ title, subtitle, back, actions, logo }: PhoneHeaderProps) {
  const navigate = useNavigate();
  const { isEasy } = useView();
  // with no page before this one in the tab, go up to `back` (true: home) in place of this entry;
  // it's still a step back, so the page frame slides it in from the left (dir: "back")
  const onBack = () => {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate(typeof back === "string" ? back : isEasy ? "/e" : "/", { replace: true, state: { dir: "back" } });
  };
  return (
    <header data-phone-header="" className="sticky top-0 z-nav bg-bar border-b border-rule pt-[env(safe-area-inset-top,0px)]">
      <div className="flex items-center gap-1 pl-2 pr-2 min-h-[60px]">
        {back ? <IconButton label="Back" icon={ChevronLeft} onClick={onBack} /> : logo ? <span className="pl-2 pr-1"><AppMark size={38} /></span> : <span className="w-2" />}
        <div className="flex-1 min-w-0 px-1.5">
          <h1 data-page-title="" tabIndex={-1} className="text-lg font-semibold leading-tight truncate outline-none">{title}</h1>
          {subtitle ? <p className="text-xs text-muted line-clamp-2 mt-0.5">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-0.5">{actions}</div> : null}
      </div>
    </header>
  );
}

/**
 * The prototype's `route.hideNav`: true under a page that hides the phone's tab bar (a new bill,
 * an edit form). The phone shell provides it; with no tabs below, the action bar clears the home
 * indicator itself.
 */
export const HideNavContext = createContext(false);

export type PhoneActionBarProps = { children: ReactNode; className?: string };

/**
 * Sticky bar at the bottom of a phone page, above the tab bar (e.g. "New bill", "Save").
 * When any button's words would be cut, the secondary buttons show only their icons (their names
 * stay for screen readers), so the main button always reads in full.
 */
export function PhoneActionBar({ children, className }: PhoneActionBarProps) {
  const hideNav = useContext(HideNavContext);
  const bar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return undefined;
    const check = () => {
      el.removeAttribute("data-compact");
      const cut = [...el.querySelectorAll(":scope > * .btn-label")].some((l) => l.scrollWidth > l.clientWidth + 1);
      if (cut) el.setAttribute("data-compact", "");
    };
    check();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  });
  // above the tab bar the tabs already clear the home indicator; in flows without tabs the bar does
  // rides above the phone's keyboard when it's open (--kb, measured by the app)
  return <div ref={bar} data-actionbar="" style={{ bottom: "var(--kb, 0px)" }} className={cn("sticky z-nav border-t border-rule bg-bar px-4 pt-3 flex gap-2 [&>*]:flex-1 [&>*]:min-w-0", hideNav ? "pb-[calc(12px+env(safe-area-inset-bottom,0px))]" : "pb-3", className)}>{children}</div>;
}
