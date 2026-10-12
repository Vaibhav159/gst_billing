import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/core/cn";

/** Words that say the app is working, next to a spinner. They stay solid (only skeleton blocks pulse). */
export function BusyText({ children, className }: { children: ReactNode; className?: string }) {
  return <span role="status" className={cn("inline-flex items-center gap-2", className)}><Loader2 size={16} className="anim-spin shrink-0" aria-hidden="true" />{children}</span>;
}
