import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/core/cn";

/* ── Status ────────────────────────────────────────────── */
export type BadgeTone = "muted" | "brand" | "sale" | "neg" | "file" | "amber";

const TONE_CHIP: Record<BadgeTone, string> = {
  sale: "bg-sale-tint text-sale border-sale-line",
  brand: "bg-brand-tint text-brand border-brand-line",
  amber: "bg-amber-tint text-amber border-amber-line",
  neg: "bg-neg-tint text-neg border-neg-line",
  file: "bg-file-tint text-file border-file-line",
  muted: "bg-raised text-fg2 border-line",
};
/** Status pill: always text, optional icon; tone sale | brand | amber | neg | file | muted */
export function Badge({ tone = "muted", icon: Icon, children, className, title }: { tone?: BadgeTone; icon?: LucideIcon; title?: string; children: ReactNode; className?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", TONE_CHIP[tone], className)}>
      {Icon ? <Icon size={13} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) { return <kbd className={cn("kbd", className)}>{children}</kbd>; }
