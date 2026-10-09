import { useId, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/core/cn";
import { useView } from "@/core/view";

/* ── Cards and sections ────────────────────────────────── */
export type CardProps = {
  as?: "section" | "div" | "article" | "aside" | "li" | "form";
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  pad?: boolean;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "title">;

export function Card({ as: Tag = "section", title, subtitle, actions, children, className, bodyClassName, pad = true, ...rest }: CardProps) {
  const id = useId();
  const { isPhone } = useView();
  const p = isPhone ? "p-4" : "p-5";
  return (
    <Tag className={cn("card min-w-0", className)} aria-labelledby={title && Tag === "section" ? id : undefined} {...rest}>
      {title || actions ? (
        <div className={cn("flex flex-wrap items-start justify-between gap-x-4 gap-y-2", isPhone ? "px-4 pt-4" : "px-5 pt-4")}>
          <div className="min-w-0">
            {title ? <h2 id={id} className="text-md font-semibold leading-snug">{title}</h2> : null}
            {subtitle ? <p className="text-sm text-muted mt-0.5">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2 flex-wrap">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn(pad && p, (title || actions) && pad && "pt-3", bodyClassName)}>{children}</div>
    </Tag>
  );
}

export type SectionTitleProps = { title: ReactNode; count?: number | string; action?: ReactNode; id?: string; as?: "h2" | "h3" | "h4"; children?: ReactNode };

export function SectionTitle({ title, count, children, action, id, as: H = "h2" }: SectionTitleProps) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <H id={id} className="text-md font-semibold">{title}{count != null ? <span className="text-muted font-normal"> · {count}</span> : null}</H>
      {children}
      {action}
    </div>
  );
}

export type DLRowOptions = { strong?: boolean; tone?: "muted" };
/** [label, value] or [label, value, { strong, tone }]. */
export type DLRow = readonly [label: ReactNode, value: ReactNode, options?: DLRowOptions];

/** label / value rows. rows: [[label, value, {strong, tone}]]; false, null and undefined rows are skipped. */
export function DL({ rows, className }: { rows: readonly (DLRow | false | null | undefined)[]; className?: string }) {
  return (
    <dl className={cn("flex flex-col", className)}>
      {rows.filter((r): r is DLRow => Boolean(r)).map(([k, v, o = {}], i) => (
        <div key={i} className={cn("flex items-baseline justify-between gap-4 py-2", i > 0 && "border-t border-rule", o.strong && "font-semibold")}>
          <dt className={cn(o.strong ? "text-fg" : "text-fg2", "min-w-0")}>{k}</dt>
          <dd className={cn("tnum text-right min-w-0", o.tone === "muted" && "text-muted")}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ── Progress and success ──────────────────────────────── */
export function Steps({ step, total, label }: { step: number; total: number; label?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted">Step {step} of {total}{label ? ` · ${label}` : ""}</span>
      <span className="flex gap-1" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => <span key={i} className={cn("h-1 flex-1 rounded-full transition-colors duration-300", i < step ? "bg-brand" : "bg-line")} />)}
      </span>
    </div>
  );
}

export type SuccessTone = "sale" | "brand" | "file";

/** Animated success tick (saved, sent, filed). */
export function SuccessMark({ size = 72, tone = "sale" }: { size?: number; tone?: SuccessTone }) {
  const t = { sale: "border-sale-line bg-sale-tint text-sale", brand: "border-brand-line bg-brand-tint text-brand", file: "border-file-line bg-file-tint text-file" }[tone];
  return (
    <span aria-hidden="true" className={cn("anim-ring inline-grid place-items-center rounded-full border-2 shrink-0", t)} style={{ width: size, height: size }}>
      <svg width={size * 0.48} height={size * 0.48} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="m5 12.5 4.5 4.5L19 7.5" pathLength="1" className="anim-draw" />
      </svg>
    </span>
  );
}
