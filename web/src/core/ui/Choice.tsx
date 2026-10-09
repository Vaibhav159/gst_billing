import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { cn } from "@/core/cn";
import { useView } from "@/core/view";

export type CheckboxProps = { id?: string; label: ReactNode; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void; hideLabel?: boolean; disabled?: boolean; className?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type" | "checked" | "onChange" | "disabled" | "className">;

export function Checkbox({ id, label, description, checked, onChange, className, hideLabel, disabled, ...rest }: CheckboxProps) {
  const auto = useId();
  const iid = id || auto;
  const { isPhone, isEasy } = useView();
  return (
    <label htmlFor={iid} className={cn("inline-flex items-start gap-2.5 cursor-pointer select-none", isPhone && "min-h-11 items-center", disabled && "cursor-not-allowed opacity-60", className)}>
      <input id={iid} type="checkbox" checked={Boolean(checked)} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)}
        className="mt-0.5 w-[18px] h-[18px] shrink-0 accent-brand cursor-pointer" {...rest} />
      <span className={cn(hideLabel && "sr-only")}>
        <span>{label}</span>
        {description ? <span className={cn("block text-muted", isEasy ? "text-[15px] leading-[21px]" : "text-sm")}>{description}</span> : null}
      </span>
    </label>
  );
}

export type SwitchProps = { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; id?: string; disabled?: boolean };

export function Switch({ checked, onChange, label, description, id, disabled }: SwitchProps) {
  const auto = useId();
  const lid = (id || auto) + "-l";
  return (
    <div className="flex items-center justify-between gap-4 min-h-11">
      <div className="min-w-0">
        <p id={lid} className="font-medium">{label}</p>
        {description ? <p className="text-sm text-muted">{description}</p> : null}
      </div>
      <button type="button" role="switch" aria-checked={Boolean(checked)} aria-labelledby={lid} disabled={disabled} onClick={() => onChange(!checked)}
        className="relative p-2.5 -m-2.5 shrink-0 disabled:opacity-45">
        <span className={cn("block w-11 h-6 rounded-full border transition-colors duration-150", checked ? "bg-brand border-brand" : "bg-raised border-line")}>
          <span className={cn("absolute top-[13px] left-[13px] w-5 h-5 rounded-full transition-transform duration-150", checked ? "translate-x-5 bg-onbrand" : "bg-fg2")} />
        </span>
      </button>
    </div>
  );
}

export type SegmentedOption<T extends string | number> = { value: T; label: ReactNode; icon?: LucideIcon; count?: number; disabled?: boolean };
export type SegmentedProps<T extends string | number> = { options: readonly SegmentedOption<T>[]; value: T; onChange: (v: T) => void; label: string; full?: boolean; size?: "sm" | "md" | "lg"; className?: string };

/** Radio-style segmented control with a sliding thumb. options: [{value, label, icon?, count?}] */
export function Segmented<T extends string | number>({ options, value, onChange, label, full, size = "md", className }: SegmentedProps<T>) {
  const { isPhone } = useView();
  const box = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const measure = () => {
    const el = box.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (el) setThumb({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight });
  };
  useLayoutEffect(measure, [value, options.length, isPhone, full]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!box.current || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const vals = options.filter((o) => !o.disabled).map((o) => o.value);
    const i = vals.indexOf(value);
    const fwd = e.key === "ArrowRight" || e.key === "ArrowDown";
    const n = e.key === "Home" ? vals[0] : e.key === "End" ? vals[vals.length - 1]
      : i < 0 ? (fwd ? vals[0] : vals[vals.length - 1]) : vals[(i + (fwd ? 1 : vals.length - 1)) % vals.length];
    onChange(n);
    setTimeout(() => box.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(), 0);
  };
  return (
    <div ref={box} role="radiogroup" aria-label={label} onKeyDown={onKey} className={cn("relative p-1 gap-1 rounded-ctl bg-field border border-line", full ? "flex w-full" : "inline-flex", className)}>
      {thumb ? <span aria-hidden="true" className="absolute rounded-md bg-brand-sel border border-brand transition-[transform,width] duration-200 ease-out" style={{ left: 0, top: thumb.top, width: thumb.width, height: thumb.height, transform: `translateX(${thumb.left}px)` }} /> : null}
      {options.map((o) => {
        const v = o.value;
        const sel = v === value;
        const I = o.icon;
        const none = !options.some((x) => x.value === value);
        return (
          <button key={String(v)} type="button" role="radio" aria-checked={sel} tabIndex={sel || (none && options.indexOf(o) === 0) ? 0 : -1} onClick={() => onChange(v)} disabled={o.disabled}
            className={cn("relative inline-flex items-center justify-center gap-1.5 rounded-md px-3 border border-transparent transition-colors duration-150 whitespace-nowrap disabled:opacity-45 active:scale-[0.98]",
              isPhone || size === "lg" ? "min-h-11" : "h-8 text-sm", full && "flex-1",
              sel ? "text-brand font-semibold" : "text-fg2 hover:text-fg", !thumb && sel && "bg-brand-sel border-brand")}>
            {I ? <I size={16} aria-hidden="true" /> : null}
            {o.label}
            {o.count != null ? <span className={cn("tnum text-xs", sel ? "text-brand" : "text-muted")}>{o.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export type ChipProps = { selected?: boolean; icon?: LucideIcon; count?: number; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>;

/** Toggle chip for filters. */
export function Chip({ selected, onClick, children, icon: Icon, count, className, ...rest }: ChipProps) {
  const { isPhone } = useView();
  return (
    <button type="button" aria-pressed={Boolean(selected)} onClick={onClick}
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-3.5 whitespace-nowrap transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97] shrink-0",
        isPhone ? "min-h-11 text-md" : "h-8 text-sm",
        selected ? "bg-brand-sel border-brand text-brand font-semibold" : "bg-card border-line text-fg2 hover:text-fg hover:border-muted/50", className)} {...rest}>
      {Icon ? <Icon size={14} aria-hidden="true" /> : null}
      {children}
      {count != null ? <span className={cn("tnum", selected ? "text-brand" : "text-muted")}>{count}</span> : null}
    </button>
  );
}

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
  useLayoutEffect(measure, [value, tabs.length, isPhone]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => setReady(true), 50); return () => clearTimeout(t); }, []);
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
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

export type DisclosureProps = { title: ReactNode; summary?: ReactNode; defaultOpen?: boolean; className?: string; children: ReactNode };

/** A section that opens and closes with an animated height. */
export function Disclosure({ title, summary, children, defaultOpen = false, className }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={cn("min-w-0", className)}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-3 min-h-11 py-2 text-left font-medium hover:text-brand transition-colors rounded-md">
        <span className="min-w-0">{title}{summary ? <span className="block text-sm text-muted font-normal">{summary}</span> : null}</span>
        <ChevronDown size={18} aria-hidden="true" className={cn("text-muted shrink-0 transition-transform duration-200", open && "rotate-180")} />
      </button>
      <div id={id} className="fold" data-open={open ? "true" : "false"} {...(open ? {} : { inert: "" })}>
        <div><div className="pt-1 pb-3">{children}</div></div>
      </div>
    </div>
  );
}
