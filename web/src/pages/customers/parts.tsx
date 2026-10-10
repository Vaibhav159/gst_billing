// Pieces the customer screens share, ported from PROTO pages/records/shared.jsx and CustomerDetail.jsx.
import { useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle, Check, Lock, RotateCw, Search, type LucideIcon } from "lucide-react";
import { saveFailure, type ApiProblem } from "@/core/api/errors";
import { cn } from "@/core/cn";
import type { Firm } from "@/core/scope";
import { Banner, Button, ButtonLink, Card, EmptyState, Page, scrollIntoViewSafe } from "@/core/ui";
import { useView } from "@/core/view";

/** A quiet line saying why a control is off. */
export function WhyNote({ children, className }: { children: ReactNode; className?: string }) {
  if (!children) return null;
  return <p className={cn("text-sm text-muted flex items-start gap-1.5", className)}><Lock size={14} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{children}</span></p>;
}

/** A page section shown instead of what the person's role can't use. */
export function NoAccess({ icon, title, children, actions }: { icon?: LucideIcon; title: string; children: ReactNode; actions?: ReactNode }) {
  return <Card><EmptyState icon={icon ?? Lock} title={title} actions={actions}>{children}</EmptyState></Card>;
}

/** A record that isn't there (an old link, or removed or merged). */
export function MissingRecord({ icon, title, to, label }: { icon?: LucideIcon; title: string; to: string; label: string }) {
  return (
    <Page title={title} back={to}>
      <Card><EmptyState icon={icon ?? Search} title={title} actions={<ButtonLink to={to} variant="primary">{label}</ButtonLink>}>The link may be old, or the record was removed or merged into another. Everything else is where it was.</EmptyState></Card>
    </Page>
  );
}

/** What to fix before saving; a press moves focus to that field. items: [{ field: the control's id, text }]. */
export function ErrorSummary({ items }: { items: { field: string; text: string }[] }) {
  const { isPhone } = useView();
  if (!items.length) return null;
  const focus = (id: string) => { const el = document.getElementById(id); if (el) { el.focus({ preventScroll: true }); scrollIntoViewSafe(el, { block: "center" }); } };
  return (
    <div className="anim-rise">
      <Banner tone="neg" icon={AlertTriangle} title={items.length === 1 ? "One thing to fix before saving" : `${items.length} things to fix before saving`}>
        <ul className="flex flex-col gap-0.5 mt-1">
          {items.map((it) => (
            <li key={it.field}>
              <button type="button" onClick={() => focus(it.field)} className={cn("text-left text-fg hover:text-brand underline underline-offset-2 decoration-neg/50", isPhone ? "min-h-11 w-full" : "min-h-8")}>{it.text}</button>
            </li>
          ))}
        </ul>
      </Banner>
    </div>
  );
}

/**
 * Why a save didn't go through, next to Save: offline and server trouble offer Try again; a refusal says what to do.
 * What was typed stays (PROTO shared.jsx SaveError).
 */
export function SaveError({ problem, onRetry, actions, className }: { problem: ApiProblem | null; onRetry?: () => void; actions?: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Save is often pressed at the bottom of a long form: bring the reason into view
  useEffect(() => { if (problem) scrollIntoViewSafe(ref.current, { block: "nearest" }); }, [problem]);
  if (!problem) return null;
  const { title, body } = saveFailure(problem);
  const network = problem.kind === "offline" || problem.kind === "unreachable" || problem.kind === "server";
  return (
    <div ref={ref} className={cn("anim-rise scroll-mt-24", className)} role="alert">
      <Banner tone="neg" icon={AlertTriangle} title={title}
        actions={<>{actions}{network && onRetry ? <Button size="sm" icon={RotateCw} onClick={onRetry}>Try again</Button> : null}</>}>
        {body}
      </Banner>
    </div>
  );
}

/** Firms as tickable cards (PROTO shared.jsx FirmToggles). note: a line under a firm ("Has billed Anil"). */
export function FirmToggles({ firms, value, onChange, labelledBy, describedBy, note }: {
  firms: Firm[]; value: number[]; onChange: (ids: number[]) => void; labelledBy: string; describedBy?: string; note?: (f: Firm) => string | null;
}) {
  const { isPhone } = useView();
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((x) => x !== id) : firms.filter((f) => f.id === id || value.includes(f.id)).map((f) => f.id));
  return (
    <div role="group" aria-labelledby={labelledBy} aria-describedby={describedBy} className={cn("grid gap-3", isPhone ? "grid-cols-1" : "grid-cols-3")}>
      {firms.map((f) => {
        const on = value.includes(f.id);
        const n = note?.(f);
        return (
          <button key={f.id} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(f.id)}
            className={cn("text-left rounded-card border px-4 py-3.5 min-h-11 flex items-start gap-3 transition-[background-color,border-color,transform] duration-150 active:scale-[0.99]",
              on ? "bg-brand-sel border-brand" : "bg-field border-ctl-line hover:border-muted")}>
            <span aria-hidden="true" className={cn("mt-0.5 w-5 h-5 rounded-sm border grid place-items-center shrink-0 transition-colors duration-150", on ? "bg-brand border-brand text-onbrand" : "border-ctl-line")}>
              {on ? <Check size={14} strokeWidth={3} /> : null}
            </span>
            <span className="min-w-0">
              <span className={cn("block font-medium", on && "text-brand")}>{f.name}</span>
              <span className="block text-xs text-muted tnum mt-0.5">{f.gstin}</span>
              {n ? <span className="block text-xs text-muted mt-0.5">{n}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
