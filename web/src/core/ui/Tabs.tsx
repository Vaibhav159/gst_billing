import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/core/cn";
import { useView } from "@/core/view";

export type TabItem<T extends string | number> = { value: T; label: string; count?: number };
export type TabsProps<T extends string | number> = { tabs: readonly TabItem<T>[]; value: T; onChange: (v: T) => void; label: string; idBase?: string; panelId?: string; className?: string };

/** Underlined tabs with a sliding indicator. tabs: [{value, label, count?}] */
export function Tabs<T extends string | number>({ tabs, value, onChange, label, className, idBase = "tab", panelId }: TabsProps<T>) {
  const { isPhone } = useView();
  const ref = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ left: number; width: number } | null>(null);
  const [ready, setReady] = useState(false);
  const measure = () => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-v="${value}"]`);
    if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth });
  };
  // the resize observer calls the latest measure: the first render's would slide the indicator back to the tab chosen first
  const latest = useRef(measure);
  latest.current = measure;
  useLayoutEffect(measure, [value, tabs.length, isPhone]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => setReady(true), 50); return () => clearTimeout(t); }, []);
  // the row, and each tab: a tab's own width changes (a count arriving after the first paint) while the row's doesn't
  const tabKeys = tabs.map((t) => String(t.value)).join("\u0000");
  useEffect(() => {
    const row = ref.current;
    if (!row || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => latest.current());
    ro.observe(row);
    row.querySelectorAll("[data-v]").forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [tabKeys]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.value === value);
    if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const n = e.key === "Home" ? tabs[0] : e.key === "End" ? tabs[tabs.length - 1] : tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      onChange(n.value);
      ref.current?.querySelector<HTMLElement>(`[data-v="${n.value}"]`)?.focus();
    }
  };
  return (
    <div ref={ref} role="tablist" aria-label={label} onKeyDown={onKey} className={cn("relative flex gap-1 border-b border-rule overflow-x-auto no-scrollbar", className)}>
      {tabs.map((t) => {
        const sel = t.value === value;
        return (
          <button key={t.value} id={`${idBase}-${t.value}`} data-v={t.value} type="button" role="tab" aria-selected={sel} aria-controls={sel && panelId ? panelId : undefined} tabIndex={sel ? 0 : -1} onClick={() => onChange(t.value)}
            className={cn("inline-flex items-center gap-1.5 px-3 whitespace-nowrap transition-colors duration-150", isPhone ? "min-h-12" : "h-11",
              sel ? "text-brand font-semibold" : "text-fg2 hover:text-fg")}>
            {t.label}
            {t.count != null ? <span className={cn("tnum text-xs rounded-full px-1.5 py-0.5 transition-colors", sel ? "bg-brand-sel text-brand" : "bg-raised text-muted")}>{t.count}</span> : null}
          </button>
        );
      })}
      {ind ? <span aria-hidden="true" className={cn("absolute bottom-0 left-0 h-0.5 rounded-full bg-brand", ready && "transition-[transform,width] duration-200 ease-out")} style={{ width: ind.width, transform: `translateX(${ind.left}px)` }} /> : null}
    </div>
  );
}
