import { useLayoutEffect, type ReactNode } from "react";
import { useCachedDue } from "@/core/due/cache";
import { tabBadges } from "@/core/due/badges";
import type { FirmId } from "@/core/scope";
import { useEasyFirm } from "@/pages/easy/state";

export type TabBadgeState = { easy: boolean; firm: FirmId | null; badges: Record<string, { words: string; mark: ReactNode } | undefined> };
type Props = { easy: boolean; firm: FirmId | null; onBadges(state: TabBadgeState): void };

/** Lazy data feed: the phone's existing tabs keep their DOM and focus while this chunk loads (Ruling P5-8). */
export default function TabBadges(props: Props) {
  return props.easy ? <EasyBadges onBadges={props.onBadges} /> : <BadgeFeed {...props} />;
}
function EasyBadges({ onBadges }: Pick<Props, "onBadges">) {
  const { firmId } = useEasyFirm();
  return <BadgeFeed easy firm={firmId} onBadges={onBadges} />;
}
function BadgeFeed({ easy, firm, onBadges }: Props) {
  const items = useCachedDue(firm).data?.items;
  // A changed Easy selection clears the old firm's marks before the next paint, including while its answer is pending.
  useLayoutEffect(() => {
    const badges = Object.fromEntries(Object.entries(tabBadges(items)).map(([tab, badge]) => [tab, badge && {
      words: badge.words,
      mark: <span aria-hidden="true" className={badge.dot ? "absolute top-0 right-3 w-2.5 h-2.5 rounded-full bg-neg border-2 border-bar" : "absolute -top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-brand text-onbrand text-2xs font-bold grid place-items-center tnum"}>{badge.count}</span>,
    }]));
    onBadges({ easy, firm, badges });
  }, [easy, firm, items, onBadges]);
  return null;
}
