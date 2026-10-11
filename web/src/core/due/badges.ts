import type { DueItem } from "@/core/api/dashboard";

export type Badge = { count?: number; dot?: boolean; words: string };
/** The API already applies permissions and the urgent-return rule. Never recount loaded bill rows. */
export function tabBadges(items: readonly DueItem[] = []): Record<string, Badge | undefined> {
  const countBadge = (kind: DueItem["kind"], words: string) => {
    const count = items.find(a => a.kind === kind)?.count ?? 0;
    return count > 0 ? { count, words: `${count} ${words}` } : undefined;
  };
  return {
    capture: countBadge("captures", "waiting"),
    bills: countBadge("unsent", "not sent"),
    home: items.some(a => a.badge === "home_dot") ? { dot: true, words: "a return due soon is blocked" } : undefined,
  };
}
