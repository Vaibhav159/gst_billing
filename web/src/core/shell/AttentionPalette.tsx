import { useEffect } from "react";
import type { DueItem } from "@/core/api/dashboard";
import { useCachedDue } from "@/core/due/cache";
import { useScope } from "@/core/scope";
import { Palette } from "./Palette";

/** Keep the eager search frame independent of scope; only the app-mounted wrapper reads the scoped cache. */
export function AttentionPalette(props: { open: boolean; onClose(): void }) {
  return <Palette {...props} attention={useCachedDue(useScope().firmId).data?.items} />;
}

/** AppLayout's lazy feed: hands the scoped cached items to its always-mounted Palette, so loading never remounts the
 * dialog or drops typed text (Rulings 1E-20, P5-8). */
export default function AttentionFeed({ onItems }: { onItems(items: DueItem[] | undefined): void }) {
  const items = useCachedDue(useScope().firmId).data?.items;
  useEffect(() => onItems(items), [items, onItems]);
  return null;
}
