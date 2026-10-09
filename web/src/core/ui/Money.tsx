import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "@/core/cn";
import { inr, inrParts } from "@/core/format";

/* ── Money and figures ─────────────────────────────────── */
const TONE_TEXT = { sale: "text-sale", brand: "text-brand", amber: "text-amber", neg: "text-neg", file: "text-file", muted: "text-muted", fg2: "text-fg2" };

/** Purchases show in amber, as on the prototype's pages. */
export type MoneyTone = "sale" | "neg" | "file" | "brand" | "muted" | "amber";
export type MoneySize = "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl";
export type MoneyProps = { value: number | null; whole?: boolean; size?: MoneySize; tone?: MoneyTone; sign?: boolean; strong?: boolean; bump?: boolean; className?: string };

/** value in paise. size (md..5xl) switches to display style: small ₹ and paise. whole: rupees only (FY-level tiles). */
export function Money({ value, whole, size, tone, className, sign, strong, bump }: MoneyProps) {
  const first = useRef(true);
  const [k, setK] = useState(0);
  useEffect(() => { if (!bump) return; if (first.current) { first.current = false; return; } setK((x) => x + 1); }, [value, bump]);
  const content = moneyContent({ value, whole, size, tone, className, sign, strong });
  if (!bump || k === 0) return content;
  return <span key={k} className="anim-bump">{content}</span>;
}
function moneyContent({ value, whole, size, tone, className, sign, strong }: Omit<MoneyProps, "bump">) {
  if (size) {
    const p = inrParts(value ?? 0, { whole });
    const sz = { md: "text-md", lg: "text-lg", xl: "text-xl", "2xl": "text-2xl", "3xl": "text-3xl", "4xl": "text-4xl", "5xl": "text-5xl" }[size];
    return (
      <span className={cn("tnum font-semibold tracking-[-0.015em] whitespace-nowrap", sz, tone && TONE_TEXT[tone], className)}>
        <span className="sr-only">{inr(value, { whole })}</span>
        <span aria-hidden="true">{p.neg ? "−" : ""}<span className="money-sym">₹</span>{p.rupees}{p.paise ? <span className="money-paise">{p.paise}</span> : null}</span>
      </span>
    );
  }
  return <span className={cn("tnum whitespace-nowrap", strong && "font-semibold", tone && TONE_TEXT[tone], className)}>{inr(value, { whole, sign })}</span>;
}

export type FigureProps = { label: ReactNode; value: number | ReactNode; whole?: boolean; caption?: ReactNode; tone?: MoneyTone; size?: MoneySize; to?: string; className?: string; children?: ReactNode };

/** A labelled figure. label names what it counts and for which period. */
export function Figure({ label, value, whole, caption, tone, size = "2xl", to, className, children }: FigureProps) {
  const inner = (
    <>
      <span className="caps">{label}</span>
      <span className="leading-none mt-1">{typeof value === "number" ? <Money value={value} whole={whole} size={size} tone={tone} /> : value}</span>
      {caption ? <span className="text-sm text-muted mt-1">{caption}</span> : null}
      {children}
    </>
  );
  if (to) return <Link to={to} className={cn("flex flex-col gap-1 min-w-0 rounded-ctl hover:bg-raised/40 transition-colors", className)}>{inner}</Link>;
  return <div className={cn("flex flex-col gap-1 min-w-0", className)}>{inner}</div>;
}
