import { cn } from "@/core/cn";
import { LOGO } from "./logo";

export function Avatar({ name = "", size = 36, tone = "brand" }: { name: string; size?: number; tone?: "brand" | "muted" }) {
  const t = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <span aria-hidden="true" style={{ width: size, height: size, fontSize: size * 0.4 }}
      className={cn("rounded-full grid place-items-center font-bold shrink-0", tone === "brand" ? "bg-brand text-onbrand" : "bg-raised text-fg2 border border-line")}>{t || "?"}</span>
  );
}

/** Today's logo, the faceted gold G, on a quiet tile. */
export function AppMark({ size = 40 }: { size?: number }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size }}
      className="rounded-ctl bg-card border border-line grid place-items-center shrink-0 overflow-hidden">
      <img src={LOGO} alt="" width={Math.round(size * 0.78)} height={Math.round(size * 0.78)} className="block" draggable="false" />
    </span>
  );
}
