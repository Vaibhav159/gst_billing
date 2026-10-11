import { useCachedDue } from "@/core/due/cache";
import { useScope } from "@/core/scope";
import { Palette } from "./Palette";

/** Keep the eager search frame independent of scope; only the app-mounted wrapper reads the scoped cache. */
export function AttentionPalette(props: { open: boolean; onClose(): void }) {
  return <Palette {...props} attention={useCachedDue(useScope().firmId).data?.items} />;
}
