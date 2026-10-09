import { forwardRef, useEffect, useRef, useState, type HTMLAttributes, type MouseEventHandler, type ReactNode, type Ref } from "react";
import { Link } from "react-router";
import { ChevronRight } from "lucide-react";
import { cn } from "@/core/cn";

/* ── Lists ─────────────────────────────────────────────── */
export type ListRowProps = {
  to?: string;
  onClick?: MouseEventHandler<HTMLElement>;
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  rightSub?: ReactNode;
  leading?: ReactNode;
  chevron?: boolean;
  className?: string;
} & Omit<HTMLAttributes<HTMLElement>, "title" | "onClick">;

/** Tappable row for phone lists (and dense desktop lists): a link with `to`, a button with only `onClick`, else plain. */
export const ListRow = forwardRef<HTMLElement, ListRowProps>(function ListRow({ to, onClick, title, subtitle, right, rightSub, leading, chevron = true, className, ...rest }, ref) {
  const inner = (
    <>
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span className="flex-1 min-w-0">
        <span className="block font-medium line-clamp-2 break-words">{title}</span>
        {subtitle ? <span className="block text-sm text-muted line-clamp-2 break-words mt-0.5">{subtitle}</span> : null}
      </span>
      {right != null ? (
        <span className="text-right shrink-0">
          <span className="block tnum">{right}</span>
          {rightSub ? <span className="block text-xs text-muted mt-0.5">{rightSub}</span> : null}
        </span>
      ) : null}
      {chevron && (to || onClick) ? <ChevronRight size={18} className="text-muted shrink-0" aria-hidden="true" /> : null}
    </>
  );
  const cls = cn("flex items-center gap-3 w-full text-left px-4 py-3 min-h-14 border-t border-rule first:border-t-0 transition-colors", (to || onClick) && "hover:bg-raised/60", className);
  if (to) return <Link ref={ref as Ref<HTMLAnchorElement>} to={to} onClick={onClick} className={cls} {...rest}>{inner}</Link>;
  if (onClick) return <button ref={ref as Ref<HTMLButtonElement>} type="button" onClick={onClick} className={cls} {...rest}>{inner}</button>;
  return <div ref={ref as Ref<HTMLDivElement>} className={cls} {...rest}>{inner}</div>;
});

/** scrollIntoView that respects "reduce motion" (a script's smooth scroll would ignore the CSS rule). */
export function scrollIntoViewSafe(el: Element | null | undefined, opts: ScrollIntoViewOptions = {}) {
  if (!el) return;
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "start", ...opts, behavior: reduce ? "auto" : opts.behavior || "smooth" });
}

/**
 * Ids that appeared after the list first rendered, for about 1.6 s.
 * Give their rows className="anim-flash" so a new or changed row is noticed.
 */
export function useNewIds(ids: string[], ms = 1600): Set<string> {
  const seen = useRef<Set<string> | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  if (seen.current === null) seen.current = new Set(ids);
  const key = ids.join("|");
  useEffect(() => {
    const known = seen.current!; // set during the first render, above
    const added = ids.filter((id) => !known.has(id));
    if (!added.length) return;
    added.forEach((id) => known.add(id));
    setFresh((f) => new Set([...f, ...added]));
    timers.current.push(setTimeout(() => setFresh((f) => { const n = new Set(f); added.forEach((id) => n.delete(id)); return n; }), ms));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return fresh;
}
