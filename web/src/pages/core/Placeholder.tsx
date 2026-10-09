import { Hammer } from "lucide-react";
import { EmptyState, Page } from "@/core/ui";

/** A screen a later part of v3 builds. Until the switch, today's app has it. */
export default function Placeholder({ area, part }: { area: string; part: number }) {
  return (
    <Page title={area}>
      <EmptyState icon={Hammer} title={`${area} comes in part ${part}`}>This screen is being rebuilt for v3. Until the switch, today's app has it.</EmptyState>
    </Page>
  );
}
