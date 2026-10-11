import { Link } from "react-router";
import { Check, ChevronRight } from "lucide-react";
import { useDueNext, type DueNext } from "@/core/api/dashboard";
import { cn } from "@/core/cn";
import { dueLink, dueTone } from "@/core/due";
import { useFirms, type FirmId } from "@/core/scope";
import { EmptyState, QueryView, Sheet } from "@/core/ui";

/** Mounted only while shown. Reuses the rich dashboard answer when present instead of asking again for plain items. */
export default function AttentionSheet({ firm, withReturns, cached, onClose }: { firm: FirmId | null; withReturns: boolean; cached?: DueNext; onClose(): void }) {
  const query = useDueNext(firm, withReturns);
  const { firms } = useFirms();
  const n = (cached ?? query.data)?.items.length;
  const scope = firm === "all" ? "all firms" : firms.find(f => f.id === firm)?.name;
  return <Sheet open onClose={onClose} title="Needs attention"
    description={n === undefined ? undefined : n ? `${n} ${n === 1 ? "thing" : "things"}${scope ? ` across ${scope}` : ""}` : "Nothing is waiting"}>
    <QueryView query={query} what="today's figures">{loaded => {
      const data = cached ?? loaded;
      return data.items.length ?
      <ul className="-mx-2 flex flex-col">{data.items.map((a, i) => {
        const tone = dueTone(a, data.today);
        return <li key={`${a.kind}:${a.firm}:${a.month}:${i}`}>
          <Link to={dueLink(a)} onClick={onClose} className="flex items-start gap-3 px-2 py-3 rounded-ctl hover:bg-raised/60">
            <span className={cn("mt-0.5 min-w-[26px] h-[26px] px-1.5 rounded-full grid place-items-center text-xs font-bold tnum border", tone === "neg" ? "bg-neg-tint text-neg border-neg-line" : tone === "brand" ? "bg-brand-tint text-brand border-brand-line" : "bg-raised text-fg2 border-line")}>{a.count}</span>
            <span className="flex-1 min-w-0"><span className="block font-medium">{a.title}</span><span className="block text-sm text-muted mt-0.5">{a.detail}</span></span>
            <ChevronRight size={18} className="text-muted mt-1 shrink-0" aria-hidden="true" />
          </Link>
        </li>;
      })}</ul> : <EmptyState icon={Check} title="All clear">New captured bills, filing problems and deadlines show up here.</EmptyState>;
    }}
    </QueryView>
  </Sheet>;
}
