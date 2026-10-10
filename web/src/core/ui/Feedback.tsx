import type { ReactNode } from "react";
import { CloudOff, Loader2, RotateCw, WifiOff } from "lucide-react";
import { cn } from "@/core/cn";
import type { ApiProblem } from "@/core/api/errors";
import { useRole } from "@/core/auth/role";
import { Button } from "./Button";

/**
 * What a page shows when its data can't load, with Try again when there's a retry.
 * Offline and server trouble keep the prototype's words; any other problem says its own message.
 */
export function LoadError({ problem, retry, what = "this page", className }: { problem: ApiProblem; retry?: () => void; what?: string; className?: string }) {
  const offline = problem.kind === "offline";
  const server = problem.kind === "unreachable" || problem.kind === "server";
  const role = useRole();
  const again = role === "owner" ? "If it keeps happening, call the person who looks after the app." : "If it keeps happening, tell the owner.";
  return (
    <div role="alert" className={cn("card flex flex-col items-center text-center gap-2 px-6 py-10 anim-rise", className)}>
      <span aria-hidden="true" className="w-12 h-12 rounded-card bg-neg-tint border border-neg-line grid place-items-center text-neg mb-1">
        {offline ? <WifiOff size={22} /> : <CloudOff size={22} />}
      </span>
      <p className="text-md font-semibold">{offline ? "You're offline" : `Couldn't load ${what}`}</p>
      <p className="text-fg2 max-w-[46ch]">{offline ? `${what[0].toUpperCase() + what.slice(1)} can't load without the internet. Nothing you saved is lost; it shows again when you're back online.` : server ? `The app couldn't reach the shop's records just now. Nothing is lost. Try again in a minute. ${again}` : problem.message}</p>
      {retry ? <Button variant="primary" icon={RotateCw} onClick={retry} className="mt-2">Try again</Button> : null}
    </div>
  );
}

/** Placeholder rows while a list loads (never "₹0" or "nothing here"). */
export function ListSkeleton({ rows = 6, className, what = "the list" }: { rows?: number; what?: string; className?: string }) {
  return (
    <div role="status" aria-busy="true" className={cn("card divide-y divide-rule", className)}>
      <span className="sr-only">Loading {what}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <Skeleton w="22%" h={14} /><Skeleton w="30%" h={14} /><span className="flex-1" /><Skeleton w={96} h={14} />
        </div>
      ))}
    </div>
  );
}

export function Skeleton({ w = "100%", h = 14, className }: { w?: number | string; h?: number; className?: string }) {
  return <span aria-hidden="true" className={cn("block rounded-md bg-raised anim-pulse", className)} style={{ width: w, height: h }} />;
}

/** Words that say the app is working, next to a spinner. They stay solid (only skeleton blocks pulse). */
export function BusyText({ children, className }: { children: ReactNode; className?: string }) {
  return <span role="status" className={cn("inline-flex items-center gap-2", className)}><Loader2 size={16} className="anim-spin shrink-0" aria-hidden="true" />{children}</span>;
}

export function Spinner({ size = 18, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cn("anim-spin", className)} aria-hidden="true" />;
}
