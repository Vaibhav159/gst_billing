import { useCachedDue } from "@/core/due/cache";
import { useScope } from "@/core/scope";
import { Palette } from "./Palette";

/** Keep the eager search frame independent of scope; only the app-mounted wrapper reads the scoped cache. */
export function AttentionPalette({ open, onClose }: { open: boolean; onClose(): void }) {
  const { firmId } = useScope();
  const cached = useCachedDue(firmId);
  return <Palette open={open} onClose={onClose} attention={cached.data?.items} />;
}
