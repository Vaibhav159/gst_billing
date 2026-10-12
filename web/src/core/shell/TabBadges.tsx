import { useEffect } from "react";
import { useCachedDue } from "@/core/due/cache";
import { tabBadges, type Badge } from "@/core/due/badges";
import type { FirmId } from "@/core/scope";

export type TabBadgeState = { firm: FirmId | null; badges: Record<string, Badge | undefined> };

/** Lazy data feed: the phone's existing tabs keep their DOM and focus while this chunk loads (Ruling P5-8). */
export default function TabBadges({ firm, onBadges }: { firm: FirmId | null; onBadges(state: TabBadgeState): void }) {
  const items = useCachedDue(firm).data?.items;
  useEffect(() => onBadges({ firm, badges: tabBadges(items) }), [firm, items, onBadges]);
  return null;
}
