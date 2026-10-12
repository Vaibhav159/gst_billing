// Pieces both lists share (PROTO sales/SalesList.jsx:252-328, 683-769): the filter fieldset, the notes and banners
// above the list, saved views, chip counts, the summary, the loading and empty states, and rows that flash.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bookmark, CalendarClock, Filter, History, Lock, Plus, ReceiptText, Search } from "lucide-react";
import { useAuth } from "@/core/auth/AuthProvider";
import { ROLES } from "@/core/auth/permissions";
import { cn } from "@/core/cn";
import { monthLabel, plural } from "@/core/format";
import { SEGMENTS } from "@/core/sales/pos";
import { takeFresh } from "@/core/sales/fresh";
import { cancelledNote, fyLabel, whoCan } from "@/core/sales/words";
import { Banner, Button, ButtonLink, Chip, EmptyState, Figure, Money, Skeleton } from "@/core/ui";
import { useView } from "@/core/view";
import { QUALITY, type ListModel } from "./model";

/** Search, filters and period stay as picked, but are off while the bills can't load. */
export function FilterSet({ m, className, children }: { m: ListModel; className?: string; children: ReactNode }) {
  const off = Boolean(m.load.failed);
  return (
    <fieldset disabled={off} className={cn("min-w-0 m-0 p-0 border-0 flex flex-col transition-opacity duration-200 [&_button:disabled]:cursor-not-allowed", off && "opacity-55", className)}>
      <legend className="sr-only">{off ? "Search, filters and period, off until the bills load" : "Search, filters and period"}</legend>
      {children}
    </fieldset>
  );
}

/** Roles that can't make bills see why the buttons are greyed, in words (a tooltip doesn't reach touch or keyboard). */
export function ListRoleNote() {
  const { me, can } = useAuth();
  if (!me || can("bill.create")) return null;
  return (
    <p className="text-sm text-muted flex items-start gap-1.5"><Lock size={15} className="shrink-0 mt-0.5" aria-hidden="true" />
      <span>Signed in as {ROLES[me.role].label.toLowerCase()}: you can look at, print, download and export bills. Making them is for {whoCan("bill.create")}; changing or deleting them, for {whoCan("bill.edit")}.</span>
    </p>
  );
}

/** Past years are filed: say so, with the way back. */
export function PastYearBanner({ m }: { m: ListModel }) {
  if (m.current || m.state.month === "years" || !m.facets) return null;
  const all = m.months.length > 0 && m.months.every((x) => x.locked);
  return (
    <Banner tone="muted" icon={CalendarClock} title={`You're looking at ${fyLabel(m.fy)}`}
      actions={<Button size="sm" onClick={m.backToThisYear}>Back to FY {m.fyChoices[0]}</Button>}>
      {all ? "Every month is filed: these bills can be printed and sent again, not changed." : "Some months aren't filed yet."} The FY picker in the top bar changes it for every screen.
    </Banner>
  );
}

export function DrillBanner({ m }: { m: ListModel }) {
  if (!m.drill) return null;
  const hint = m.state.quality ? QUALITY[m.state.quality].hint : m.state.segment ? SEGMENTS[m.state.segment].long : "";
  return (
    <Banner tone="brand" icon={Filter} title={`Filtered: ${m.drillText.join(" · ")}`} className="anim-rise"
      actions={<Button size="sm" onClick={m.clearDrill}>Show all bills</Button>}>
      {hint}{m.state.quality ? " This check looks at every year." : ""}
    </Banner>
  );
}

const monthShort = (m: ListModel) => (m.state.month === "today" ? "today" : monthLabel(m.state.month, { long: true, year: false }));
/** A typed search covers the whole FY: say so, and offer the picked month alone. */
export function SearchScope({ m }: { m: ListModel }) {
  if (!m.dq || m.state.month === "years" || m.state.month === "all") return null;
  return (
    <p className="text-sm text-fg2 flex flex-wrap items-center gap-x-2 gap-y-1" role="status">
      <Search size={14} className="text-muted" aria-hidden="true" />
      {m.widened ? <>Searching all of FY {m.fy}, not just {m.pickedText}.</> : <>Searching {m.pickedText} only.</>}
      <Button size="sm" variant="link" onClick={() => m.set({ only: !m.state.only })}>{m.widened ? `Only ${monthShort(m)}` : `All of FY ${m.fy}`}</Button>
    </p>
  );
}

/** Saved views: one click sets the filters; each count follows the firm and the FY. */
export function SavedViews({ m, phone = false }: { m: ListModel; phone?: boolean }) {
  if (!m.facets) return null;
  return (
    <div className={cn("flex gap-2", phone ? "flex-wrap" : "flex-wrap items-center")} role="group" aria-label="Saved views">
      {!phone ? <span className="text-sm text-muted inline-flex items-center gap-1.5 mr-1"><Bookmark size={14} aria-hidden="true" />Views</span> : null}
      {m.views.map((v) => (
        <Chip key={v.key} selected={m.viewOn === v.key} onClick={() => m.pickView(v)} aria-label={`${v.label}: ${plural(v.count, "bill")}${m.viewOn === v.key ? ". Showing; press to clear" : ""}`}>
          {v.label} <span className={cn("tnum", m.viewOn === v.key ? "text-brand" : v.count && (v.key === "check" || v.key === "cash") ? "text-neg" : "text-muted")}>{v.count}</span>
        </Chip>
      ))}
    </div>
  );
}

/** A chip's bill count, once there's one to back it (never a number the page can't stand behind). */
export function ChipCount({ on, n }: { on: boolean; n: number | null }) {
  if (n == null) return null;
  return <span className={cn("tnum", on ? "text-brand" : "text-muted")}>{n}</span>;
}

/** What the list adds up to: the whole filtered set, never just the page loaded (the contract's summary). */
export function SummaryBlock({ m }: { m: ListModel }) {
  const s = m.summary;
  if (!s) return null;
  const x = m.state.status === "cancelled";
  return (
    <div className="px-5 pt-4 pb-4 flex flex-wrap items-start justify-between gap-x-8 gap-y-3 border-b border-rule">
      <div className="flex flex-col gap-3 min-w-0">
        <p className="text-fg2"><span className="font-semibold text-fg">{m.scope} · {m.periodText}</span>{[...m.drillText, ...m.extras].map((e) => ` · ${e}`).join("")} · sales bills only</p>
        <div className="flex flex-wrap gap-x-10 gap-y-3">
          <Figure label={x ? "Cancelled bills" : "Sales bills"} value={<span className="text-2xl font-semibold tnum">{s.bills}</span>} />
          <Figure label={x ? "Total when issued" : "Total incl. GST"} value={<Money value={s.total_amount} size="2xl" tone={x ? "muted" : "sale"} bump />} />
          <Figure label="Taxable value" value={<Money value={s.taxable} size="2xl" bump />} />
          <Figure label="GST charged" value={<Money value={s.tax} size="2xl" bump />} />
          {!x && s.average != null ? <Figure label="Average bill" value={<Money value={s.average} size="2xl" bump />} /> : null}
        </div>
      </div>
      <p className="text-sm text-muted max-w-[280px] text-right ml-auto">
        {x ? "Cancelled bills keep their numbers in GSTR-1; their amounts aren't in sales. " : "Purchases are never counted here. "}
        These figures follow your search, firm, payment, status and period.{s.cancelled && !x ? ` ${cancelledNote(s.cancelled, "not counted")}.` : ""}
      </p>
    </div>
  );
}

export function ListSkeletonBlock() {
  return (
    <div role="status" aria-label="Loading sales bills">
      <div className="px-5 pt-4 pb-4 flex flex-col gap-3 border-b border-rule">
        <Skeleton w={360} h={16} />
        <div className="flex gap-10">{[80, 180, 160, 140].map((w, i) => <div key={i} className="flex flex-col gap-2"><Skeleton w={90} h={11} /><Skeleton w={w} h={26} /></div>)}</div>
      </div>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-6 px-5 py-4 border-t border-rule first:border-t-0">
          <Skeleton w={18} h={18} /><Skeleton w={90} /><Skeleton w={120} /><Skeleton w={180} /><span className="flex-1" /><Skeleton w={110} /><Skeleton w={70} />
        </div>
      ))}
      <p className="sr-only">Loading sales bills</p>
    </div>
  );
}

/** Nothing to show, said for the case (PROTO SalesList.jsx:741-769). */
export function ListEmpty({ m }: { m: ListModel }) {
  const { isPhone } = useView();
  const { can } = useAuth();
  const q = m.dq;
  if (q) {
    const n = m.elsewhere.reduce((a, e) => a + e.bills, 0);
    const where = m.elsewhere.map((e) => `${plural(e.bills, "bill")} in FY ${e.fy}`).join(" · ");
    return (
      <EmptyState icon={Search} title={`No sales bills match “${q}”`} actions={<>
        <Button onClick={() => m.set({ q: "" })}>Clear search</Button>
        {m.effMonth !== "years" ? <Button variant={n ? "primary" : "secondary"} icon={History} onClick={() => m.set({ month: "years" })}>{`Search all years${n ? ` (${n})` : ""}`}</Button> : null}
        {m.filterCount ? <Button variant="ghost" onClick={m.clearFilters}>Clear all filters</Button> : null}
      </>}>
        Searched customer names, phone numbers, bill numbers and GSTINs in {m.scope} · {m.periodText}{m.filterCount ? " with your filters" : ""}.{where ? ` Found ${where}.` : " Try part of a name, the last digits of a phone, or a bill number like 31."}
      </EmptyState>
    );
  }
  if (m.drill) return <EmptyState icon={Filter} title={`Nothing to fix: no ${m.drillText.join(" · ").toLowerCase()}`} actions={<Button onClick={m.clearDrill}>Show all bills</Button>}>In {m.scope} · {m.periodText}.</EmptyState>;
  const today = m.effMonth === "today";
  return (
    <EmptyState icon={ReceiptText} title={today ? (m.state.status === "unsent" ? "Every bill from today is sent" : "No bills yet today") : "No bills here"} actions={<>
      {m.anyFilter ? <Button onClick={m.clearFilters}>Clear filters</Button> : null}
      {m.effMonth !== "all" && m.effMonth !== "years" ? <Button onClick={() => m.set({ month: "all" })}>Show FY {m.fy}</Button> : null}
      {!isPhone && today && m.state.status !== "unsent" && can("bill.create") ? <ButtonLink to="/sales/new" variant="primary" icon={Plus}>New bill</ButtonLink> : null}
    </>}>
      {today && !m.anyFilter ? `${m.scope} hasn't made a bill today. New bills show here as soon as they're saved.` : `Nothing in ${m.scope} · ${m.periodText} matches ${m.extras.length ? m.extras.join(", ") : "these filters"}.`}
    </EmptyState>
  );
}

/** Bills made or restored elsewhere (markFresh) flash once as their rows show (PROTO SalesList.jsx:207-231). */
export function useFlash(ids: readonly number[]): ReadonlySet<number> {
  const [lit, setLit] = useState<ReadonlySet<number>>(() => new Set());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const key = ids.join(",");
  useEffect(() => {
    const got = takeFresh(ids);
    if (!got.size) return;
    setLit((s) => new Set([...s, ...got]));
    timers.current.push(setTimeout(() => setLit((s) => new Set([...s].filter((id) => !got.has(id)))), 1700));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return lit;
}
