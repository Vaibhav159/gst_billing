import type { ReactNode } from "react";
import { useCachedDue } from "@/core/due/cache";
import { tabBadges, type Badge } from "@/core/due/badges";
import type { FirmId } from "@/core/scope";

/** Lazy, so the cache reader and badge building stay out of the eager phone shell (Ruling P5-8). */
export default function TabBadges({ firm, children }: { firm: FirmId | null; children(badges: Record<string, Badge | undefined>): ReactNode }) {
  return children(tabBadges(useCachedDue(firm).data?.items));
}
