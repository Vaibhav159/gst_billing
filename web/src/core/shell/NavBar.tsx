import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ChevronDown } from "lucide-react";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { Menu } from "@/core/ui";
import { DESKTOP_NAV, MORE_NAV, NAV_ICON } from "./nav";

/** Top nav with a gold underline that slides to the current section. */
export function NavBar({ section, inMore: inMoreList }: { section: string; inMore: boolean }) {
  const { can } = useAuth();
  const ref = useRef<HTMLElement>(null);
  const widths = useRef<Record<string, number>>({});
  const [fit, setFit] = useState(DESKTOP_NAV.length);
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  const [ready, setReady] = useState(false);
  const shown = DESKTOP_NAV.slice(0, fit);
  const folded = DESKTOP_NAV.slice(fit);
  const inMore = inMoreList || folded.some((n) => n.section === section);
  const key = inMore ? "more" : section;
  const measure = () => {
    const nav = ref.current;
    // no layout yet (or none at all, as in tests): keep every section in view
    if (!nav || !nav.clientWidth) return;
    // remember each item's width while it shows, then keep as many as fit beside "More"
    for (const el of nav.querySelectorAll<HTMLElement>("[data-nav]")) if (el.dataset.nav !== "more") widths.current[el.dataset.nav!] = el.offsetWidth;
    const room = nav.clientWidth - 130;
    let used = 0, n = 0;
    for (const item of DESKTOP_NAV) {
      const w = widths.current[item.section] || 96;
      if (used + w > room) break;
      used += w + 2; n += 1;
    }
    setFit((f) => (f === n ? f : Math.max(1, n)));
    const el = nav.querySelector<HTMLElement>(`[data-nav="${key}"]`);
    setBar(el ? { left: el.offsetLeft, width: el.offsetWidth } : null);
  };
  // the resize observer calls the latest measure: the first render's would slide the underline back to where the app opened
  const latest = useRef(measure);
  latest.current = measure;
  // section too: between two pages under More the key stays "more" while More's words, and so its width, change
  useLayoutEffect(measure, [key, fit, section]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => setReady(true), 60); return () => clearTimeout(t); }, []);
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => latest.current());
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const here = [...folded, ...MORE_NAV].find((m) => m.section === section);
  return (
    <nav ref={ref} aria-label="Main" className="relative flex items-stretch self-stretch gap-0.5 flex-1 min-w-0">
      {shown.map((n) => {
        const cur = n.section === section;
        return (
          <Link key={n.to} to={n.to} data-nav={n.section} aria-current={cur ? "page" : undefined}
            className={cn("inline-flex items-center px-3 transition-colors duration-150 whitespace-nowrap", cur ? "text-brand font-semibold" : "text-fg2 hover:text-fg")}>
            {n.label}
          </Link>
        );
      })}
      <Menu align="start" width={240} title="More"
        items={[
          ...folded.map((m) => ({ label: m.label, icon: NAV_ICON[m.section], checked: m.section === section, to: m.to })),
          ...(folded.length ? [{ divider: true as const }] : []),
          // pages this person's role can't open stay out of the menu
          ...MORE_NAV.filter((m) => !m.need || can(m.need)).map((m) => ({ label: m.label, icon: m.icon, checked: m.section === section, to: m.to })),
        ]}
        trigger={(p) => (
          <button {...p} type="button" data-nav="more" aria-current={inMore ? "page" : undefined} className={cn("inline-flex items-center gap-1 px-3 whitespace-nowrap transition-colors duration-150", inMore ? "text-brand font-semibold" : "text-fg2 hover:text-fg")}>
            More{inMore && here ? <span className="font-normal"> · {here.label}</span> : null} <ChevronDown size={14} aria-hidden="true" />
          </button>
        )} />
      {bar ? <span aria-hidden="true" className={cn("absolute bottom-0 left-0 h-0.5 rounded-full bg-brand", ready && "transition-[transform,width] duration-200 ease-out")} style={{ width: bar.width, transform: `translateX(${bar.left}px)` }} /> : null}
    </nav>
  );
}
