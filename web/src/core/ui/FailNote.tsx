import { AlertTriangle, RotateCw } from "lucide-react";
import { cn } from "@/core/cn";
import { Button } from "./Button";

/** A failed save, in place, with Try again (PROTO sales/parts.jsx FailNote). error: failText()'s words (@/core/sales/words), or null for none. */
export function FailNote({ error, onRetry, busy, className }: { error: { title: string; body: string } | null; onRetry?: () => void; busy?: boolean; className?: string }) {
  if (!error) return null;
  return (
    <div role="alert" className={cn("rounded-ctl border border-neg-line bg-neg-tint px-4 py-3 flex flex-wrap items-start gap-x-3 gap-y-2 anim-rise", className)}>
      <AlertTriangle size={18} className="text-neg shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-[min(100%,220px)]">
        <p className="font-semibold">{error.title}</p>
        {error.body ? <p className="text-sm text-fg2 mt-0.5">{error.body}</p> : null}
      </div>
      {onRetry ? <Button size="sm" variant="primary" icon={RotateCw} loading={busy} onClick={onRetry}>{busy ? "Trying…" : "Try again"}</Button> : null}
    </div>
  );
}
