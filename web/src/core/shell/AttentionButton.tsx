import { lazy, Suspense, useState } from "react";
import { Bell } from "lucide-react";
import { useCachedDue } from "@/core/due/cache";
import { useScope } from "@/core/scope";
import { FailNote, IconButton, Sheet } from "@/core/ui";
import { AttentionBoundary } from "./AttentionBoundary";

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
    {open ? <AttentionBoundary fallback={<Sheet open onClose={() => setOpen(false)} title="Needs attention">
      <FailNote error={{ title: "Needs attention couldn't load", body: "Close this panel to keep working. Save your changes before reloading the page to try again." }} />
    </Sheet>}><Suspense fallback={null}><AttentionSheet firm={firmId} withReturns={cached.withReturns} cached={cached.data} onClose={() => setOpen(false)} /></Suspense></AttentionBoundary> : null}
  </>;
}

export default AttentionButton;
