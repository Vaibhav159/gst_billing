import { useState } from "react";
import { Link } from "react-router";
import { ChevronRight } from "lucide-react";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { dateShort, plural } from "@/core/format";
import type { DueData, DueItem } from "@/core/dashboard/types";
import { Card } from "@/core/ui";
import { chipWhen, COUNT_WORD, dueLink, dueTone, PILL, VERB } from "./model";
export function DueRow({ item, today, phone = false }: { item: DueItem; today: string; phone?: boolean }) {
  return <Link to={dueLink(item)} className={cn("group flex items-start gap-3 border-t border-rule first:border-t-0 hover:bg-raised/50 transition-colors", phone ? "px-4 py-3 min-h-16" : "px-5 py-3")}>
    <span className={cn("mt-0.5 shrink-0 rounded-md border text-xs font-semibold tnum text-center leading-tight px-1.5 py-1", phone ? "w-[64px]" : "w-[70px]", PILL[dueTone(item, today)])}>
      {item.due ? <><span className="sr-only">Due </span>{dateShort(item.due)}<span className="block font-normal opacity-90">{chipWhen(today, item.due)}</span></> : <>{item.count}<span className="block font-normal opacity-90">{COUNT_WORD[item.kind] || "waiting"}</span></>}
    </span>
    <span className="flex-1 min-w-0"><span className="block font-medium">{item.title}</span><span className="block text-sm text-muted mt-0.5 line-clamp-2">{item.detail}</span></span>
    <span aria-hidden="true" className="shrink-0 self-center inline-flex items-center gap-0.5 text-sm font-semibold text-brand group-hover:underline underline-offset-4">{VERB[item.kind]}<ChevronRight size={15} /></span>
  </Link>;
}
export function DueNextCard({ data, phone = false, limit = phone ? 4 : 6 }: { data: DueData; phone?: boolean; limit?: number }) {
  const { can } = useAuth(); const [all, setAll] = useState(false);
  const items = all ? data.items : data.items.slice(0, limit), dated = data.items.filter(i => i.due).length;
  const works = can("gst.file") || can("bill.create");
  const sub = data.items.length ? `${plural(data.items.length, "thing")} · ${dated ? "soonest first" : "nothing with a date"}` : works ? "Nothing due in the next 15 days" : "Nothing for you to do here";
  return <Card title="Due next" subtitle={sub} pad={false}>
    {items.length ? <div className="mt-2">
      {items.map((item, i) => <DueRow key={`${item.kind}:${item.firm}:${item.month}:${i}`} item={item} today={data.today} phone={phone} />)}
      {data.items.length > limit ? <button type="button" onClick={() => setAll(!all)} aria-expanded={all} className={cn("link w-full text-left flex items-center border-t border-rule", phone ? "min-h-12 px-4" : "min-h-11 px-5")}>{all ? "Show fewer" : `Show ${data.items.length - limit} more`}</button> : null}
    </div> : <p className={cn("text-fg2", phone ? "px-4 pb-4" : "px-5 pb-5")}>{works ? "Problems that stop a return, returns and tax due, photos to fill in and bills not sent show up here, soonest first." : "The owner and the accountant look after filing and the day's loose ends. Figures below are for reading."}</p>}
  </Card>;
}
