import type { DueItem } from "@/core/api/dashboard";

type Badge = { count?: number; dot?: boolean; words: string };
/** The API already applies permissions and the urgent-return rule. Never recount loaded bill rows. */
export function tabBadges(items: readonly DueItem[] = []): Record<string, Badge | undefined> {
  const captures = items.find(a => a.kind === "captures")?.count ?? 0;
  const unsent = items.find(a => a.kind === "unsent")?.count ?? 0;
  return {
    capture: captures > 0 ? { count: captures, words: `${captures} waiting` } : undefined,
    bills: unsent > 0 ? { count: unsent, words: `${unsent} not sent` } : undefined,
    home: items.some(a => a.kind === "blocker" && a.badge === "home_dot") ? { dot: true, words: "a return due soon is blocked" } : undefined,
  };
}
