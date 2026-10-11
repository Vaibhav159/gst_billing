// The phone's bills (PROTO sales/SalesList.jsx:995-1127): the summary line, period chips newest first, search and the
// filter sheet, then cards by day. No table, no selection and no preview: a card opens the bill.
import { memo, useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { BookOpenText, History, Lock, MoreHorizontal, Plus, SlidersHorizontal, X } from "lucide-react";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { inr, monthLabel, plural } from "@/core/format";
import type { BillRow } from "@/core/sales/types";
import { PAY, PAY_FILTER, PAY_SHORT, STATUS, cancelledNote, dayCount, dayGroups, listFooter, timeOf } from "@/core/sales/words";
import { Button, ButtonLink, Chip, IconButton, LoadError, Menu, Money, Page, SearchInput, Skeleton, StaleNote, type MenuItem } from "@/core/ui";
import { SendCell } from "../actions/SendCell";
import { StatusCell } from "../actions/StatusCell";
import { useQrCheck } from "../print/QrCheck";
import { FilterSheet } from "./FilterSheet";
import type { ListModel } from "./model";
import { ChipCount, DrillBanner, FilterSet, ListEmpty, ListRoleNote, PastYearBanner, SearchScope, useFlash } from "./parts";

/**
 * A bill as a card: the customer and total first, then the number, time and payment (never cut), status under them; Send
 * at the right. A cancelled bill's words are muted, as the desktop's row has them, rather than the card faded (the
 * prototype's opacity-70): faded, its red badge and muted lines fall below AA contrast in both themes. The link's name
 * stands in for its content, so its status badges are its description: a screen reader hears them too (Ruling 1B-17).
 */
export const PhoneCard = memo(function PhoneCard({ b, fresh, marked }: { b: BillRow; fresh: boolean; marked: boolean }) {
  const cancelled = b.status === "cancelled";
  const statusId = useId();
  return (
    <div data-card={b.id} aria-current={marked || undefined} className={cn("card relative flex items-stretch", fresh && "anim-flash", marked && "border-brand")}>
      {/* the whole card opens the bill (the link stretches over it); Send sits above it */}
      <Link to={`/sales/${b.id}`} data-row={b.id} className="flex-1 min-w-0 block pl-4 pr-2 pt-3.5 pb-3 rounded-card after:content-[''] after:absolute after:inset-0 after:rounded-card"
        aria-label={`${b.customer.name}, ${b.invoice_number}, ${inr(b.total_amount)}${cancelled ? ", cancelled" : ""}`} aria-describedby={statusId}>
        <span className={cn("block font-medium break-words", cancelled && "text-muted")}>{b.customer.name}</span>
        <span className="block mt-1 text-sm text-muted tnum">{b.invoice_number}{b.paper ? "" : ` · ${timeOf(b.created_at)}`} · {b.payment_mode ? PAY_SHORT[b.payment_mode] : "Payment not recorded"}</span>
        <span id={statusId} className="flex flex-wrap items-center gap-1.5 mt-1.5 empty:hidden"><StatusCell bill={b} /></span>
      </Link>
      <div className="flex flex-col items-end justify-between gap-1 pr-2 pt-3 pb-2 shrink-0">
        <span className="pr-2" aria-hidden="true"><Money value={b.total_amount} strong className={cancelled ? "line-through text-muted" : ""} /></span>
        {/* (SendCell waits for the shop's message, sends a bill once however often it's tapped, and says On paper for a paper bill) */}
        <span className="relative z-[1]"><SendCell bill={b} compact /></span>
      </div>
    </div>
  );
});

function PhoneSummarySkeleton() {
  return <div className="flex flex-col gap-2" aria-hidden="true"><Skeleton w={220} h={13} /><Skeleton w={260} h={18} /></div>;
}
function PhoneCardsSkeleton() {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading sales bills">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="card px-4 py-4 flex flex-col gap-2"><div className="flex justify-between"><Skeleton w={140} h={16} /><Skeleton w={90} h={16} /></div><Skeleton w={130} h={12} /><Skeleton w={80} h={12} /></div>
      ))}
    </div>
  );
}

export function PhoneList({ m }: { m: ListModel }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [filterOpen, setFilterOpen] = useState(false);
  const rows = m.rows;
  const flash = useFlash(rows.map((r) => r.id));
  const groups = dayGroups(rows, m.today, m.complete);
  // a link's bill (?bill=) is marked, and scrolled to once it's there
  const target = m.state.bill != null && rows.some((r) => r.id === m.state.bill) ? m.state.bill : null;
  useEffect(() => {
    if (target == null) return undefined;
    const t = setTimeout(() => document.querySelector(`[data-card="${target}"]`)?.scrollIntoView({ block: "center" }), 80);
    return () => clearTimeout(t);
  }, [target]);
  // the picked period's chip is in sight, even when it's FY or All years at the far end of the row
  const chipRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = chipRow.current;
    const on = row?.querySelector<HTMLElement>("[aria-pressed=true]");
    if (!row || !on) return;
    const left = on.offsetLeft - row.offsetLeft;
    if (left + on.offsetWidth > row.scrollLeft + row.clientWidth || left < row.scrollLeft) {
      const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      row.scrollTo({ left: Math.max(0, left - 16), behavior: reduce ? "auto" : "smooth" });
    }
  }, [m.effMonth, m.load.ready]);
  const s = m.summary;
  const x = m.state.status === "cancelled";
  const failed = Boolean(m.load.failed);
  const foot = s ? listFooter(s.bills, s.cancelled, rows, { cancelledOnly: x, newest: m.state.sort.key === "date" && m.state.sort.dir === "desc", step: true }) : null;
  const qr = useQrCheck();
  const moreItems: MenuItem[] = [
    qr.item,
    { label: "Bills from the paper book", hint: "Type in last month's paper bills", icon: BookOpenText, onSelect: () => navigate("/sales/paper") },
  ];
  return (
    <Page title="Bills" phoneSubtitle={`Sales bills · ${m.state.month === "years" ? "all years" : `FY ${m.fy}`}`}
      phoneActions={<Menu title="Bills" items={moreItems} trigger={(p) => <IconButton {...p} label="More for bills" icon={MoreHorizontal} />} />}
      actionBar={can("bill.create") ? <ButtonLink to="/sales/new" variant="primary" size="lg" icon={Plus}>New bill</ButtonLink> : null}>
      <ListRoleNote />
      <PastYearBanner m={m} />
      <DrillBanner m={m} />
      {s ? (
        <div className="flex flex-col gap-0.5">
          <p className="text-sm text-muted">{m.scope} · {m.periodText}{[...m.drillText, ...m.extras].map((e) => ` · ${e}`).join("")}</p>
          <p className="text-md">
            <span className="font-semibold">{x ? plural(s.bills, "cancelled bill") : plural(s.bills, "sales bill")}</span>
            {" · "}<Money value={s.total_amount} strong bump tone={x ? undefined : "sale"} /> <span className="text-muted">{x ? "when issued" : "incl. GST"}</span>
          </p>
          {!x && s.average != null ? <p className="text-xs text-muted">Average bill {inr(s.average)}{s.cancelled ? ` · ${cancelledNote(s.cancelled, "not counted")}` : ""}</p>
            : !x && s.cancelled ? <p className="text-xs text-muted">{cancelledNote(s.cancelled, "not counted")}</p> : null}
        </div>
      ) : m.load.loading ? <PhoneSummarySkeleton /> : null}
      <FilterSet m={m} className="gap-4">
        {/* while the list can't load, only the picked period shows (it can't change), so nothing scrolls */}
        <div ref={chipRow} className="-mx-4 px-4 flex gap-2 overflow-x-auto no-scrollbar" role="group" aria-label="Period">
          {m.current && (!failed || m.effMonth === "today") ? <Chip selected={m.effMonth === "today"} onClick={() => m.set({ month: "today" })}>Today <ChipCount on={m.effMonth === "today"} n={m.effMonth === "today" ? s?.bills ?? null : null} /></Chip> : null}
          {[...m.months].reverse().filter((x2) => !failed || m.effMonth === x2.month).map((x2) => (
            <Chip key={x2.month} selected={m.effMonth === x2.month} onClick={() => m.set({ month: x2.month })} icon={x2.locked ? Lock : undefined}
              aria-label={`${monthLabel(x2.month, { long: true })}: ${plural(x2.bills, "bill")}${x2.locked ? ", filed" : x2.note ? `, ${x2.note}` : ""}`}>
              {monthLabel(x2.month, { year: false })} <ChipCount on={m.effMonth === x2.month} n={x2.bills} />
              {x2.note && x2.month !== m.cur ? <span className="text-sm text-file">· {x2.note}</span> : null}
            </Chip>
          ))}
          {!failed || m.effMonth === "all" ? <Chip selected={m.effMonth === "all"} onClick={() => m.set({ month: "all" })}>FY {m.fy} <ChipCount on={m.effMonth === "all"} n={m.facets ? m.fyCount : null} /></Chip> : null}
          {!failed || m.effMonth === "years" ? <Chip selected={m.effMonth === "years"} onClick={() => m.set({ month: "years" })} icon={History}>All years <ChipCount on={m.effMonth === "years"} n={m.effMonth === "years" ? s?.bills ?? null : null} /></Chip> : null}
        </div>
        <div className="flex gap-2">
          <SearchInput data-page-search="" value={m.state.q} onChange={(q) => m.set({ q })} placeholder="Name, phone or no." label="Search sales bills" className="flex-1" enterKeyHint="search" />
          <Button icon={SlidersHorizontal} onClick={() => setFilterOpen(true)} aria-label={`Filter${m.filterCount ? `, ${m.filterCount} on` : ""}`} className={m.filterCount ? "border-brand text-brand" : ""}>
            Filter{m.filterCount ? <span className="tnum"> · {m.filterCount}</span> : null}
          </Button>
        </div>
        <SearchScope m={m} />
        {m.filterCount ? (
          <div className="-mx-4 px-4 flex gap-2 overflow-x-auto no-scrollbar" role="group" aria-label="Filters that are on">
            {m.state.paid !== "any" ? <Chip selected onClick={() => m.set({ paid: "any" })} aria-label={`${PAY_FILTER.find((p) => p.value === m.state.paid)?.label ?? ""}. Remove`}>{m.state.paid === "none" ? "Not recorded" : PAY[m.state.paid]}<X size={14} aria-hidden="true" /></Chip> : null}
            {m.state.status !== "any" ? <Chip selected onClick={() => m.set({ status: "any" })} aria-label={`${STATUS[m.state.status]}. Remove`}>{STATUS[m.state.status]}<X size={14} aria-hidden="true" /></Chip> : null}
            {m.state.customer != null ? <Chip selected onClick={() => m.set({ customer: null })} aria-label={`${m.customerName ?? "One customer"}. Remove`}>{m.customerName ?? "One customer"}<X size={14} aria-hidden="true" /></Chip> : null}
          </div>
        ) : null}
      </FilterSet>
      {m.load.stale ? <StaleNote problem={m.load.stale} what="the sales bills" retry={m.load.retry} busy={m.list.isFetching} /> : null}
      {m.load.failed ? <LoadError problem={m.load.failed} retry={m.load.retry} what="sales bills" />
        : !m.load.ready ? <PhoneCardsSkeleton />
          : rows.length === 0 ? <div className="card"><ListEmpty m={m} /></div> : (
            <div className="flex flex-col gap-5">
              {groups.map((g) => (
                <section key={g.date} aria-label={g.label} className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-3 px-1">
                    <h2 className="text-sm font-medium text-fg2">{g.label}</h2>
                    {g.partial ? null : <span className={cn("text-sm text-muted tnum text-right", !g.cancelled && "whitespace-nowrap")}>{dayCount(g)}</span>}
                  </div>
                  {g.bills.map((b) => <PhoneCard key={b.id} b={b} fresh={flash.has(b.id) || b.id === target} marked={b.id === target} />)}
                </section>
              ))}
              {foot?.more ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-muted text-center" aria-live="polite">{foot.text}</p>
                  <Button full loading={m.list.isFetchingNextPage} onClick={() => { void (foot.rest === "bills" ? m.loadMore() : m.loadRest()); }}>{foot.more}</Button>
                </div>
              ) : null}
            </div>
          )}
      <FilterSheet m={m} open={filterOpen} onClose={() => setFilterOpen(false)} />
      {qr.dialog}
    </Page>
  );
}
