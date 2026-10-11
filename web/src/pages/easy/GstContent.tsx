import { ChevronRight, Maximize2 } from "lucide-react";
import { Link } from "react-router";
import { useAuth } from "@/core/auth/AuthProvider";
import { date, dateShort, inr, monthLabel, plural, rangeLabel } from "@/core/format";
import { STATE_META, dueText } from "@/core/gst/stages";
import { counterOf } from "@/core/sales/numbers";
import { Badge, Button, Card, DL, Money, cn } from "@/core/ui";
import { groupBlockers, OPENING_WORDS, type EasyGst, type GstSoFar } from "./gst";

type Props = { firmName: string; today: string; current: GstSoFar; previous: EasyGst };
export function GstContent({ firmName, today, current, previous, onVisit }: Props & { onVisit(path: string): void }) {
  const { can } = useAuth();
  const month = monthLabel(current.month, { long: true, year: false });
  const last = monthLabel(previous.month, { long: true, year: false });
  const meta = STATE_META[previous.stage];
  const groups = groupBlockers(previous.blockers);
  const correction = ["gstr1", "filed", "unlocked"].includes(previous.stage);
  return <>
    <Card>
      <h2 className="text-md text-fg2">GST on {month}'s sales so far</h2>
      <Money value={current.tax} size="4xl" className="block mt-1.5" />
      <p className="text-md text-muted mt-1.5">{rangeLabel(`${current.month}-01`, today)} · {plural(current.bills, "bill")} · {firmName}</p>
      <p className="text-fg2 mt-3">Customers pay it inside each bill's total. It goes to the government after the month ends, when your CA files {month}'s return.</p>
    </Card>
    <section aria-labelledby="easy-ret-t" className="card p-4 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><h2 id="easy-ret-t" className="text-lg font-semibold leading-snug">{last}'s return</h2><p className="text-md text-muted">{firmName}</p></div>
        <span data-testid="easy-gst-stage"><Badge tone={meta.tone} icon={meta.icon ?? undefined} title={meta.label}>{meta.word}</Badge></span>
      </div>
      {groups.map((group) => <div key={group.key} className="rounded-ctl border border-neg-line bg-neg-tint p-4 flex flex-col gap-3" role="status">
        {group.words.map((words) => <p key={words} className="font-semibold text-neg break-words">{words}</p>)}
        <p className="text-fg2">{can("bill.edit") ? (correction ? "These checks are for the books now. Review the correction in the full view." : `Until it's fixed, your CA can't file ${last}'s return.`)
          : `Tell the owner${group.bills.length ? `: ${group.bills.map((bill) => `bill ${counterOf(bill.invoice_number) ?? bill.invoice_number} (${bill.customer_name})`).join(", ")}` : ""}. ${correction ? "The filed record stays as it was." : `Until it's fixed, your CA can't file ${last}'s return.`}`}</p>
        {group.bills.length ? <ul className="flex flex-col rounded-ctl border border-line bg-card">
          {group.bills.map((bill, i) => <li key={bill.id ?? `${bill.invoice_number}-${i}`} className="border-t border-rule first:border-t-0">
            {bill.id !== null && bill.status !== "deleted" ? <Link to={`/e/bill/${bill.id}`} className="flex flex-wrap items-center gap-3 px-3 py-3 min-h-14">
              <span className="flex-1 min-w-0"><span className="block font-medium break-words">{bill.customer_name}</span><span className="block text-md text-muted tnum break-words">No. {counterOf(bill.invoice_number) ?? bill.invoice_number} · {date(bill.invoice_date)}</span></span>
              {group.kind === "empty" ? <span className="text-md text-muted">No items</span> : <Money value={bill.total} tone="sale" />}
            </Link> : <p className="px-3 py-3">{bill.invoice_number} · {bill.customer_name} · This bill was deleted</p>}
          </li>)}
        </ul> : null}
        {group.more > 0 ? <p className="text-md text-muted">{plural(group.more, "more bill")} in the full view.</p> : null}
        {can("bill.edit") ? <Button variant="primary" icon={Maximize2} onClick={() => onVisit(`/gst?firm=${previous.business}&month=${previous.month}&fix=1`)} className="self-start">Fix it in the full view</Button> : null}
      </div>)}
      <ul aria-label={`${last}'s two returns`} className="flex flex-col">
        {([['List of sales', 'GSTR-1', 'gstr1'], ['Tax payment', 'GSTR-3B', 'gstr3b']] as const).map(([what, form, key], i) => <li key={form} className={cn("flex items-start justify-between gap-4 py-2.5", i > 0 && "border-t border-rule")}>
          <span className="min-w-0"><span className="block">{what}</span><span className="block text-md text-muted">{form}</span></span>
          {previous.filed[key] ? <span className="text-right text-file">Filed {date(previous.filed[key])}</span>
            : previous.legacy ? <span className="text-right text-file">Filed before the app kept filing records</span>
              : <span className="text-right"><span className="block tnum">Due {dateShort(previous.due[key])}</span><span className="block text-md text-muted">{dueText(today, previous.due[key])}</span></span>}
        </li>)}
      </ul>
      <p className="text-md text-muted -mt-2">Your CA files both.</p>
      {previous.output !== null ? <>
        <div className="rounded-ctl border border-line bg-field px-4 py-1"><DL rows={[
          [`GST on ${last}'s sales`, <Money key="o" value={previous.output} />],
          ["Left to pay in cash", previous.cash === 0 ? <span key="c" className="text-sale font-semibold">Nothing</span> : <Money key="c" value={previous.cash} strong />],
        ]} /></div>
        <p className="text-md text-muted">{previous.cash === 0 ? `GST you paid on purchases covers it all. ${inr(previous.credit)} of credit is left for next month.` : "GST you paid on purchases is taken off first."}</p>
        {previous.openingMissing ? <p role="status" className="text-md text-amber">{OPENING_WORDS}</p> : null}
      </> : null}
    </section>
  </>;
}
export function GstCardContent({ current, previous }: Props) {
  const { can } = useAuth();
  const month = monthLabel(current.month, { long: true, year: false });
  const last = monthLabel(previous.month, { long: true, year: false });
  const first = previous.stage === "blocked" ? previous.blockers[0] : null;
  const line = first ? (can("bill.edit") ? `${last}'s return is held up: ${first.words} Fix it.` : `${last}'s return: the owner is fixing one bill.`)
    : previous.stage === "filed" ? `${last}'s return is filed.`
      : previous.stage === "gstr1" ? `${last}'s list of sales is filed; the tax is paid by ${dateShort(previous.due.gstr3b)}.`
        : previous.stage === "ready" ? `${last}'s return: your CA files it by ${dateShort(previous.due.gstr3b)}.`
          : `${last}'s return: ${STATE_META[previous.stage].label}.`;
  return <Link to="/e/gst" className="card p-4 flex items-center gap-3 min-h-14 hover:border-muted/50 transition-colors">
    <span className="flex-1 min-w-0"><span className="block text-md text-fg2">GST on {month}'s sales so far</span>
      <Money value={current.tax} size="2xl" className="block mt-1" />
      <span className={cn("block text-md mt-1", first && can("bill.edit") ? "text-neg" : "text-muted")}>{line}</span>
    </span><ChevronRight size={20} className="text-muted shrink-0" aria-hidden="true" />
  </Link>;
}
