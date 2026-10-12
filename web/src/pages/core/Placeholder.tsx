import { Hammer } from "lucide-react";
import { EmptyState, Page } from "@/core/ui";

/** A screen a later part of v3 builds. Until the switch, today's app has it. phoneSearch: Today's Search (see Page). */
export default function Placeholder({ area, part, phoneSearch }: { area: string; part: number; phoneSearch?: boolean }) {
  return (
    <Page title={area} phoneSearch={phoneSearch}>
      <EmptyState icon={Hammer} title={`${area} comes in part ${part}`}>This screen is being rebuilt for v3. Until the switch, today's app has it.</EmptyState>
    </Page>
  );
}
