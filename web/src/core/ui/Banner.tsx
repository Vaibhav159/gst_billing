import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, type LucideIcon } from "lucide-react";
import { cn } from "@/core/cn";
import { useView } from "@/core/view";

export type BannerTone = "brand" | "neg" | "sale" | "file" | "amber" | "muted";

// amber isn't in the prototype's map (it would crash there); it follows the other tones' pattern.
const BANNER: Record<BannerTone, [string, string, LucideIcon]> = { neg: ["bg-neg-tint border-neg-line", "text-neg", AlertTriangle], brand: ["bg-brand-tint border-brand-line", "text-brand", AlertTriangle], sale: ["bg-sale-tint border-sale-line", "text-sale", CheckCircle2], file: ["bg-file-tint border-file-line", "text-file", Info], amber: ["bg-amber-tint border-amber-line", "text-amber", AlertTriangle], muted: ["bg-card border-line", "text-fg2", Info] };
export function Banner({ tone = "brand", icon, title, children, actions, className }: { tone?: BannerTone; icon?: LucideIcon; title?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  const { isEasy } = useView();
  const [bg, ic, Def] = BANNER[tone];
  const I = icon || Def;
  return (
    <div role="status" className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border px-4 py-3", bg, className)}>
      <I size={20} className={cn("shrink-0 self-start mt-0.5", ic)} aria-hidden="true" />
      <div className="flex-1 min-w-[min(100%,220px)]">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn("text-fg2", title && "mt-0.5", title && (isEasy ? "text-[15px] leading-[21px]" : "text-sm"))}>{children}</div> : null}
      </div>
      {actions ? <div className="flex gap-2 flex-wrap">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, actions, className }: { icon?: LucideIcon; title: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center text-center gap-2 px-6 py-10", className)}>
      {Icon ? <span aria-hidden="true" className="w-12 h-12 rounded-card bg-raised border border-line grid place-items-center text-fg2 mb-1"><Icon size={22} /></span> : null}
      <p className="text-md font-semibold">{title}</p>
      {children ? <div className="text-fg2 max-w-[46ch]">{children}</div> : null}
      {actions ? <div className="flex flex-wrap justify-center gap-2 mt-2">{actions}</div> : null}
    </div>
  );
}
