import { useEffect, type ReactNode } from "react";
import { useCachedDue } from "@/core/due/cache";
import { tabBadges } from "@/core/due/badges";
import type { FirmId } from "@/core/scope";

export type TabBadgeState = { firm: FirmId | null; badges: Record<string, { words: string; mark: ReactNode } | undefined> };

/** Lazy data feed: the phone's existing tabs keep their DOM and focus while this chunk loads (Ruling P5-8). */
export default function TabBadges({ firm, onBadges }: { firm: FirmId | null; onBadges(state: TabBadgeState): void }) {
  const items = useCachedDue(firm).data?.items;
  useEffect(() => {
    const badges = Object.fromEntries(Object.entries(tabBadges(items)).map(([tab, badge]) => [tab, badge && {
      words: badge.words,
      mark: <span aria-hidden="true" className={badge.dot ? "absolute top-0 right-3 w-2.5 h-2.5 rounded-full bg-neg border-2 border-bar" : "absolute -top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-brand text-onbrand text-2xs font-bold grid place-items-center tnum"}>{badge.count}</span>,
    }]));
    onBadges({ firm, badges });
  }, [firm, items, onBadges]);
  return null;
}
