import { lazy, Suspense, useState } from "react";
import { Bell } from "lucide-react";
import { useCachedDue } from "@/core/due/cache";
import { useScope } from "@/core/scope";
import { IconButton } from "@/core/ui";

export const attentionCode = { load: () => import("./AttentionSheet") };
const AttentionSheet = lazy(attentionCode.load);

export function AttentionButton() {
  const { firmId } = useScope();
  const cached = useCachedDue(firmId);
  const [open, setOpen] = useState(false);
  const count = cached.data?.items.length;
  return <>
    <IconButton label={count === undefined ? "Needs attention" : count ? `Needs attention: ${count}` : "Nothing needs attention"}
      icon={Bell} variant="secondary" badge={count || undefined} onClick={() => setOpen(true)} />
    {open ? <Suspense fallback={null}><AttentionSheet firm={firmId} withReturns={cached.withReturns} cached={cached.data} onClose={() => setOpen(false)} /></Suspense> : null}
  </>;
}

export default AttentionButton;
