// The desktop bills list (PROTO sales/SalesList.jsx:350-681): saved views and period chips, a summary that follows
// every filter, and a keyboard-first table (one Tab stop; ↑↓ move with the preview, Enter opens, Space ticks, S sends,
// P prints, . opens the row menu, → steps into the row's buttons) beside the preview pane.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowDown, ArrowUp, ArrowUpDown, BookOpenText, CalendarDays, ChevronDown, Download, FileArchive, History, Lock, MoreHorizontal, Plus, Printer, ReceiptText, Trash2, UserRound, X } from "lucide-react";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { date, monthLabel, plural } from "@/core/format";
import type { BillDetail, BillRow } from "@/core/sales/types";
import { PAY, PAY_FILTER, STATUS, billsAnd, dayCount, dayGroups, filedRangeText, gstLabel, listFooter, timeOf, type DayGroup, type PayFilter, type StatusFilter } from "@/core/sales/words";
import { Button, ButtonLink, Card, Checkbox, Chip, IconButton, Kbd, LoadError, Menu, Money, Page, SearchInput, Select, StaleNote, Table, Td, Th, Tr, type MenuItem } from "@/core/ui";
import { useBoxWidth } from "@/core/useBoxWidth";
import { useBillDialogs } from "../actions/BillDialogs";
import { SendCell } from "../actions/SendCell";
import { StatusCell } from "../actions/StatusCell";
import { useBillMenu } from "../actions/useBillMenu";
import { useSendBill } from "../actions/useSendBill";
import { BillPreview } from "./BillPreview";
import { CustomerFilter } from "./CustomerFilter";
import { DeleteManyDialog } from "./DeleteManyDialog";
import type { ListModel, SortKey } from "./model";
import { ChipCount, DrillBanner, FilterSet, ListEmpty, ListRoleNote, ListSkeletonBlock, PastYearBanner, SavedViews, SearchScope, SummaryBlock, useFlash } from "./parts";

type Show = { byDate: boolean; compact: boolean; taxable: boolean; gst: boolean; paid: boolean; status: boolean; gstin: boolean; firm: boolean };

/** A paper bill has no time of day: it was written in the paper book and typed in later. */
function PaperTime() {
  return <span className="text-muted" title="A paper bill: no time of day"><span aria-hidden="true">—</span><span className="sr-only">paper bill</span></span>;
}

/** One bill in the table. Memoized: picking or previewing a row redraws that row, not forty. */
const DesktopRow = memo(function DesktopRow({ b, firmShort, cols, day, selected, previewed, tabbable, fresh, show, onKey, onFocusRow, onPreview, onToggle, menuItems }: {
  b: BillRow; firmShort: string; cols: number; day: DayGroup | null; selected: boolean; previewed: boolean; tabbable: boolean; fresh: boolean; show: Show;
  onKey: (e: KeyboardEvent<HTMLTableRowElement>) => void; onFocusRow: (e: FocusEvent<HTMLTableRowElement>) => void; onPreview: (id: number) => void;
  onToggle: (id: number, on: boolean) => void; menuItems: (b: BillRow) => MenuItem[];
}) {
  const cancelled = b.status === "cancelled";
  const flag = !cancelled && (b.checks.includes("heads_mismatch") || b.checks.includes("tax_mismatch"));
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  const time = timeOf(b.created_at);
  return (
    <>
      {day ? (
        <tr className="bg-raised/40 border-t border-rule">
          <td colSpan={cols} className="px-5 py-2 text-sm">
            <span className="font-medium text-fg2">{day.label}</span>
            {day.partial ? null : <span className="text-muted tnum"> · {dayCount(day)}</span>}
          </td>
        </tr>
      ) : null}
      <Tr data-row={b.id} tabIndex={tabbable ? 0 : -1} onKeyDown={onKey} onFocus={onFocusRow} onClick={() => onPreview(b.id)} selected={previewed || selected}
        aria-selected={selected} aria-current={previewed ? "true" : undefined} className={cn("outline-none row-focus", fresh && "anim-flash")}>
        <Td onClick={stop}><Checkbox hideLabel tabIndex={-1} data-row-ctl="" label={`Select ${b.invoice_number}`} checked={selected} onChange={(on) => onToggle(b.id, on)} /></Td>
        {show.compact ? null : (
          <Td className={cn("whitespace-nowrap", cancelled && "text-muted")}>
            {show.byDate ? (b.paper ? <PaperTime /> : <span className="tnum">{time}</span>) : <><span className="block tnum">{date(b.invoice_date)}</span><span className="block text-xs text-muted tnum">{b.paper ? "paper bill" : time}</span></>}
          </Td>
        )}
        <Td className="whitespace-nowrap">
          <Link to={`/sales/${b.id}`} tabIndex={-1} data-row-ctl="" onClick={stop} className={cn("font-medium tnum hover:text-brand hover:underline", cancelled ? "text-muted" : "text-brand")}>{b.invoice_number}</Link>
          {show.compact ? <span className="block text-xs text-muted tnum">{show.byDate ? (b.paper ? "paper bill" : time) : `${date(b.invoice_date)} · ${b.paper ? "paper bill" : time}`}</span>
            : show.firm ? <span className="block text-xs text-muted">{firmShort}</span> : null}
        </Td>
        <Td className="min-w-[150px]">
          <button type="button" tabIndex={-1} data-row-ctl="" onClick={(e) => { stop(e); onPreview(b.id); }} aria-label={`Preview ${b.invoice_number}, ${b.customer.name}`} className={cn("text-left hover:text-brand rounded-sm", cancelled && "text-muted")}>{b.customer.name}</button>
          {show.gstin ? <span className="block text-xs text-muted tnum">{b.customer.gst_number || "No GSTIN"}</span> : null}
        </Td>
        {show.taxable ? <Td align="right" className={cancelled ? "text-muted" : ""}><Money value={b.taxable} /></Td> : null}
        {show.gst ? (
          <Td align="right" className={cancelled ? "text-muted" : ""}>
            <Money value={b.tax} /><span className={cn("block text-xs whitespace-nowrap", flag ? "text-neg" : "text-muted")}>{flag ? "Tax doesn't match" : gstLabel(b)}</span>
          </Td>
        ) : null}
        <Td align="right"><Money value={b.total_amount} strong className={cancelled ? "line-through text-muted" : ""} /></Td>
        {show.paid ? <Td className={cn("whitespace-nowrap", cancelled ? "text-muted" : b.payment_mode ? "text-fg2" : "text-muted italic")}>{PAY[b.payment_mode]}</Td> : null}
        <Td align="right" onClick={stop}>
          <span className="inline-flex flex-wrap items-center justify-end gap-2">
            {show.status ? <StatusCell bill={b} hideUdhaar={show.paid} /> : null}
            <SendCell bill={b} tabIndex={-1} />
          </span>
        </Td>
        <Td onClick={stop}>
          <Menu width={280} title={`Bill ${b.invoice_number}`} items={menuItems(b)}
            trigger={(p) => <IconButton {...p} tabIndex={-1} data-row-ctl="" data-row-menu="" size="sm" label={`Actions for ${b.invoice_number}`} icon={MoreHorizontal} />} />
        </Td>
      </Tr>
    </>
  );
});

export function DesktopList({ m }: { m: ListModel }) {
  const { can, whyNot } = useAuth();
  const navigate = useNavigate();
  const dialogs = useBillDialogs();
  const billMenu = useBillMenu();
  const sendBill = useSendBill();
  const rows = m.rows;
  const flash = useFlash(useMemo(() => rows.map((r) => r.id), [rows]));
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());
  const [focusId, setFocusId] = useState<number | null>(null);
  const [bulkDelete, setBulkDelete] = useState<BillRow[] | null>(null);
  // the table picks its columns from the space it has (Ruling 1E-3: one useBoxWidth, in core)
  const [area, areaW] = useBoxWidth();
  const previewId = m.state.bill;
  const pIndex = previewId == null ? -1 : rows.findIndex((r) => r.id === previewId);
  const days = useMemo(() => new Map(dayGroups(rows, m.today, m.complete).map((g) => [g.date, g])), [rows, m.today, m.complete]);
  const byDate = m.state.sort.key === "date";
  // the preview takes 340-400 px; the table keeps the columns that fit and hides the rest behind it
  const paneW = areaW >= 1240 ? 400 : 340;
  const hasPreview = previewId != null;
  const tableW = hasPreview ? areaW - paneW - 20 : areaW;
  const show = useMemo<Show>(() => ({
    byDate,
    // narrow (the preview open at 1,100 px): the time goes under the bill number instead of a column of its own
    compact: tableW < 760,
    taxable: !hasPreview && tableW >= 1130,
    gst: !hasPreview && tableW >= 900,
    paid: !hasPreview && tableW >= 1210,
    status: tableW >= 760,
    gstin: tableW >= 1000,
    firm: m.firmId === "all" && tableW >= 960,
  }), [byDate, hasPreview, tableW, m.firmId]);
  const cols = 6 + Number(show.taxable) + Number(show.gst) + Number(show.paid) - Number(show.compact);
  const setPreview = useCallback((id: number | null) => m.set({ bill: id }), [m.set]); // eslint-disable-line react-hooks/exhaustive-deps

  // a new filter starts a new selection; a bill that left the list (deleted, cancelled away) leaves it too
  useEffect(() => { setSelected(new Set()); }, [m.firmId, m.effMonth, m.state.customer, m.state.paid, m.state.status, m.dq]);
  const seen = useRef(new Set<number>());
  useEffect(() => {
    const ids = new Set(rows.map((r) => r.id));
    setSelected((s) => { const n = new Set([...s].filter((id) => ids.has(id))); return n.size === s.size ? s : n; });
    // the previewed bill left the rows it was in (deleted, or filtered out): close it. A link's bill past the first page stays
    if (previewId != null && seen.current.has(previewId) && !ids.has(previewId)) setPreview(null);
    seen.current = ids;
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const rowEl = (id: number) => document.querySelector<HTMLElement>(`tr[data-row="${id}"]`);
  /** Move the row focus (and the preview, when it's open or asked for) to row j. */
  const goRow = (j: number, { openPreview = false } = {}) => {
    const n = rows[Math.max(0, Math.min(rows.length - 1, j))];
    if (!n) return;
    setFocusId(n.id);
    if (hasPreview || openPreview) setPreview(n.id);
    requestAnimationFrame(() => { const el = rowEl(n.id); el?.focus({ preventScroll: true }); el?.scrollIntoView({ block: "nearest" }); });
  };
  const move = (d: -1 | 1) => { if (pIndex >= 0) goRow(pIndex + d, { openPreview: true }); };
  const toggle = useCallback((id: number, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; }), []);
  // one send per press, as the row's own Send: a second press of the preview's Send (or S) before the list shows the bill
  // as sent sends nothing (two chats, two records); the list's news frees it, as does a send not recorded or gone wrong
  const sendingId = useRef<number | null>(null);
  useEffect(() => { sendingId.current = null; }, [rows]);
  const send = (b: BillRow | BillDetail) => {
    if (sendingId.current === b.id) return;
    sendingId.current = b.id;
    const free = () => { if (sendingId.current === b.id) sendingId.current = null; };
    void sendBill(b, { onNeedNumber: () => dialogs.open("whatsapp", b) }).then((ok) => { if (!ok) free(); }, free);
  };

  /** Keys on a focused row (Linear-style). Inside the row, ← → step through its own buttons. */
  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tr = e.currentTarget;
    const i = rows.findIndex((r) => String(r.id) === tr.getAttribute("data-row"));
    const b = rows[i];
    if (!b) return;
    if (e.target !== tr) {
      const ctls = [...tr.querySelectorAll<HTMLElement>("[data-row-ctl], [data-row-send]")];
      const at = ctls.indexOf((e.target as Element).closest<HTMLElement>("[data-row-ctl], [data-row-send]") as HTMLElement);
      if (e.key === "ArrowRight" && at >= 0) { e.preventDefault(); ctls[Math.min(ctls.length - 1, at + 1)].focus(); }
      else if (e.key === "ArrowLeft" && at >= 0) { e.preventDefault(); if (at === 0) tr.focus(); else ctls[at - 1].focus(); }
      else if (e.key === "Escape") { e.preventDefault(); tr.focus(); }
      return;
    }
    const k = e.key;
    if (k === "ArrowDown" || k === "j" || k === "J") { e.preventDefault(); goRow(i + 1, { openPreview: true }); }
    else if (k === "ArrowUp" || k === "k" || k === "K") { e.preventDefault(); goRow(i - 1, { openPreview: true }); }
    else if (k === "Home") { e.preventDefault(); goRow(0); }
    else if (k === "End") { e.preventDefault(); goRow(rows.length - 1); }
    else if (k === "Enter") { e.preventDefault(); navigate(`/sales/${b.id}`); }
    else if (k === " ") { e.preventDefault(); toggle(b.id, !selected.has(b.id)); }
    else if (k === "s" || k === "S") { e.preventDefault(); if (b.status !== "cancelled") send(b); }
    else if (k === "p" || k === "P") { e.preventDefault(); navigate(`/sales/${b.id}/print`); }
    else if (k === ".") { e.preventDefault(); tr.querySelector<HTMLElement>("[data-row-menu]")?.click(); }
    else if (k === "ArrowRight") { e.preventDefault(); tr.querySelector<HTMLElement>("[data-row-ctl], [data-row-send]")?.focus(); }
    else if (k === "Escape" && hasPreview) { e.preventDefault(); setPreview(null); }
  };
  // one handler for every row, so a memoized row doesn't redraw when the list does
  const keyRef = useRef(onRowKey);
  keyRef.current = onRowKey;
  const onKeyStable = useCallback((e: KeyboardEvent<HTMLTableRowElement>) => keyRef.current(e), []);
  const onFocusRow = useCallback((e: FocusEvent<HTMLTableRowElement>) => { if (e.target === e.currentTarget) setFocusId(Number(e.currentTarget.getAttribute("data-row"))); }, []);
  const tabId = focusId != null && rows.some((r) => r.id === focusId) ? focusId : pIndex >= 0 ? previewId : rows[0]?.id ?? null;
  // Esc closes the preview from anywhere outside a field
  useEffect(() => {
    if (!hasPreview) return undefined;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || e.key !== "Escape") return;
      if ((e.target as Element | null)?.closest?.("input, textarea, select, [role=dialog], [role=menu], [role=listbox]")) return;
      setPreview(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasPreview, setPreview]);
  const menuItems = useCallback((b: BillRow) => billMenu(b, dialogs.open, { shareIt: true, eway: true }), [billMenu, dialogs.open]);

  const selBills = rows.filter((r) => selected.has(r.id));
  const selTotal = selBills.filter((b) => b.status !== "cancelled").reduce((a, b) => a + b.total_amount, 0);
  const allShownSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = (on: boolean) => setSelected(on ? new Set(rows.map((r) => r.id)) : new Set());

  const month = /^\d{4}-\d{2}$/.test(m.effMonth) ? `&month=${m.effMonth}` : "";
  const exportItems: MenuItem[] = [
    { heading: `${m.scope} · ${m.periodText}` },
    { label: "PDFs or print all…", icon: FileArchive, hint: "Opens Bulk PDFs with this firm and month", onSelect: () => navigate(`/sales/export?firm=${m.firmId ?? "all"}${month}`) },
  ];
  const sortButton = (key: SortKey, label: string) => {
    const on = m.state.sort.key === key;
    const Icon = on ? (m.state.sort.dir === "desc" ? ArrowDown : ArrowUp) : ArrowUpDown;
    const next = on ? { key, dir: m.state.sort.dir === "desc" ? "asc" : "desc" } as const : { key, dir: key === "number" ? "asc" : "desc" } as const;
    return (
      <button type="button" onClick={() => m.set({ sort: next })} className={cn("caps inline-flex items-center gap-1 hover:text-fg rounded-sm", on && "text-fg2")}>
        {label}<Icon size={13} aria-hidden="true" />
      </button>
    );
  };
  const sortOf = (...keys: SortKey[]) => (keys.includes(m.state.sort.key) ? (m.state.sort.dir === "desc" ? "descending" : "ascending") : "none");
  const sortHeader = (key: SortKey, label: string, align?: "right") => <Th align={align} aria-sort={sortOf(key)}>{sortButton(key, label)}</Th>;
  const filed = filedRangeText(m.months);
  const s = m.summary;
  const cancelledOnly = m.state.status === "cancelled";
  const left = s ? s.bills + s.cancelled - rows.length : 0;
  const foot = s ? listFooter(s.bills, s.cancelled, rows, { cancelledOnly, newest: byDate && m.state.sort.dir === "desc", step: left > 160 }) : null;
  const firmShort = (b: BillRow) => m.firms.find((f) => f.id === b.business)?.short ?? b.business_name;

  return (
    <Page icon={ReceiptText} title="Sales" context={`Sales bills of ${m.inView} · ${m.state.month === "years" ? "all years" : `FY ${m.fy}`}`}
      actions={<>
        {/* plan 1E puts "Check a QR code" first here */}
        <ButtonLink to="/sales/paper" icon={BookOpenText} title="Type in bills from the paper bill book, with their own numbers and dates">Paper bills</ButtonLink>
        <Menu width={340} title="Export" items={exportItems} trigger={(p) => <Button {...p} icon={Download} iconRight={ChevronDown} disabled={!m.load.ready} title={m.load.failed ? "Exports the bills, so it waits until they load" : undefined}>Export</Button>} />
        {can("bill.create")
          ? <ButtonLink to="/sales/new" variant="primary" icon={Plus} title="New bill (Alt N)">New bill</ButtonLink>
          : <Button variant="primary" icon={Plus} disabled title={whyNot("bill.create")}>New bill</Button>}
      </>}>
      <ListRoleNote />
      <PastYearBanner m={m} />
      <DrillBanner m={m} />
      <FilterSet m={m} className="gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput data-page-search="" value={m.state.q} onChange={(q) => m.set({ q })} placeholder="Name, phone, bill no. or GSTIN" label="Search sales bills (press / to jump here; ↓ goes to the bills)" className="flex-1 min-w-[260px]"
            onKeyDown={(e) => { if (e.key === "ArrowDown" && rows.length) { e.preventDefault(); goRow(0); } }} />
          <Select aria-label="Firm (same as the top bar)" value={String(m.firmId ?? "")} onChange={(e) => m.setFirmId(e.target.value === "all" ? "all" : Number(e.target.value))} className="w-[170px]"
            options={[{ value: "all", label: "All firms" }, ...m.firms.map((f) => ({ value: String(f.id), label: f.name }))]} />
          <CustomerFilter m={m} />
          <Select aria-label="Paid by" value={m.state.paid} onChange={(e) => m.set({ paid: e.target.value as PayFilter })} className="w-[170px]" options={PAY_FILTER} />
          <Select aria-label="Status" value={m.state.status} onChange={(e) => m.set({ status: e.target.value as StatusFilter })} className="w-[170px]"
            options={Object.entries(STATUS).map(([value, label]) => ({ value, label }))} />
        </div>
        <SavedViews m={m} />
        <div className="flex flex-col gap-2.5 -mt-1">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Period">
            {m.current ? <Chip selected={m.effMonth === "today"} onClick={() => m.set({ month: "today" })} icon={CalendarDays}>Today <ChipCount on={m.effMonth === "today"} n={m.effMonth === "today" ? s?.bills ?? null : null} /></Chip> : null}
            <Chip selected={m.effMonth === "all"} onClick={() => m.set({ month: "all" })}>FY {m.fy} <ChipCount on={m.effMonth === "all"} n={m.facets ? m.fyCount : null} /></Chip>
            {m.months.map((x) => (
              <Chip key={x.month} selected={m.effMonth === x.month} onClick={() => m.set({ month: x.month })} icon={x.locked ? Lock : undefined}
                aria-label={`${monthLabel(x.month, { long: true })}: ${plural(x.bills, "bill")}${x.locked ? ", filed" : x.note ? `, ${x.note}` : ""}`}>
                {monthLabel(x.month, { year: false })}
                <ChipCount on={m.effMonth === x.month} n={x.bills} />
                {x.note ? <span className={cn("text-xs", x.month === m.cur ? "text-muted" : "text-file")}>· {x.note}</span> : null}
              </Chip>
            ))}
            <Chip selected={m.effMonth === "years"} onClick={() => m.set({ month: "years" })} icon={History}
              aria-label={`All years${m.effMonth === "years" && s ? `: ${plural(s.bills, "bill")}` : ""}; search and filters reach every year`}>
              All years <ChipCount on={m.effMonth === "years"} n={m.effMonth === "years" ? s?.bills ?? null : null} />
            </Chip>
            {m.state.customer != null ? (
              <Chip selected onClick={() => m.set({ customer: null })} icon={UserRound} aria-label={`Showing only ${m.customerName ?? "one customer"}. Remove this filter`}>
                {m.customerName ?? "One customer"}<X size={14} aria-hidden="true" />
              </Chip>
            ) : null}
            {m.anyFilter ? <Button size="sm" variant="ghost" onClick={m.clearFilters}>Clear filters</Button> : null}
          </div>
          <SearchScope m={m} />
          {filed && m.state.month !== "years" ? <p className="text-sm text-muted flex items-center gap-1.5"><Lock size={14} className="text-file" aria-hidden="true" />Filed for {m.inView}: {filed}{m.current ? "" : ` of FY ${m.fy}`}. Bills in those months can&apos;t be changed or deleted.</p> : null}
        </div>
      </FilterSet>
      {m.load.stale ? <StaleNote problem={m.load.stale} what="the sales bills" retry={m.load.retry} busy={m.list.isFetching} /> : null}

      <div ref={area} className="grid gap-5 items-start" style={{ gridTemplateColumns: hasPreview ? `minmax(0,1fr) ${paneW}px` : "minmax(0,1fr)" }}>
        <Card pad={false} className="min-w-0">
          {m.load.failed ? <div className="p-4"><LoadError problem={m.load.failed} retry={m.load.retry} what="sales bills" className="border-0" /></div> : !m.load.ready ? <ListSkeletonBlock /> : (
            <>
              <SummaryBlock m={m} />
              {selBills.length ? (
                <div className="flex flex-wrap items-center gap-2 px-5 py-3 bg-brand-tint border-b border-brand-line anim-rise" role="region" aria-label="Selected bills">
                  <p className="mr-2"><span className="font-semibold">{billsAnd(selBills)} selected</span> <span className="text-fg2">· <Money value={selTotal} /></span></p>
                  <Button size="sm" icon={Printer} onClick={() => navigate(`/sales/batch?ids=${selBills.map((b) => b.id).join(",")}`)}>{`Print ${selBills.length}…`}</Button>
                  <Button size="sm" variant="danger-outline" icon={Trash2} disabled={!can("bill.delete")} title={whyNot("bill.delete") || undefined} onClick={() => setBulkDelete(selBills)}>{`Delete ${billsAnd(selBills)}…`}</Button>
                  <span className="flex-1" />
                  {m.complete && rows.length > selBills.length ? <Button size="sm" variant="link" onClick={() => setSelected(new Set(rows.map((r) => r.id)))}>{`Select all ${rows.length} in this view`}</Button> : null}
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>
                </div>
              ) : null}
              {rows.length === 0 ? <ListEmpty m={m} /> : (
                <Table label={`Sales bills, ${m.scope}, ${m.periodText}. One Tab stop: arrow keys move between bills.`}>
                  <thead>
                    <tr>
                      <Th className="w-12"><Checkbox hideLabel label={`Select all ${billsAnd(rows)} shown`} checked={allShownSelected} onChange={toggleAll} /></Th>
                      {show.compact ? (
                        <Th aria-sort={sortOf("number", "date")}>
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">{sortButton("number", "Bill no.")}<span className="text-muted" aria-hidden="true">·</span>{sortButton("date", byDate ? "Time" : "Date")}</span>
                        </Th>
                      ) : <>{sortHeader("date", byDate ? "Time" : "Date")}{sortHeader("number", "Bill no.")}</>}
                      <Th>Customer</Th>
                      {show.taxable ? <Th align="right">Taxable</Th> : null}
                      {show.gst ? <Th align="right">GST</Th> : null}
                      {sortHeader("total", "Total", "right")}
                      {show.paid ? <Th>Paid by</Th> : null}
                      <Th align="right">{show.status ? "Status" : "Sent"}</Th>
                      <Th className="w-12"><span className="sr-only">Actions</span></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((b, i) => (
                      <DesktopRow key={b.id} b={b} firmShort={firmShort(b)} cols={cols}
                        day={byDate && (i === 0 || rows[i - 1].invoice_date !== b.invoice_date) ? days.get(b.invoice_date) ?? null : null}
                        selected={selected.has(b.id)} previewed={previewId === b.id} tabbable={tabId === b.id} fresh={flash.has(b.id)} show={show}
                        onKey={onKeyStable} onFocusRow={onFocusRow} onPreview={setPreview} onToggle={toggle} menuItems={menuItems} />
                    ))}
                  </tbody>
                </Table>
              )}
              {rows.length && foot ? (
                <div className="px-5 py-3 border-t border-rule flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-muted" aria-live="polite">{foot.text}</p>
                    {foot.more ? <Button loading={m.list.isFetchingNextPage} onClick={() => { void (left > 160 ? m.loadMore() : m.loadRest()); }}>{foot.more}</Button> : null}
                  </div>
                  <p className="text-xs text-muted flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <span className="sr-only">Keys in the list: </span>
                    <Kbd>↑</Kbd><Kbd>↓</Kbd> move · <Kbd>Enter</Kbd> open · <Kbd>Space</Kbd> tick · <Kbd>S</Kbd> send · <Kbd>P</Kbd> print · <Kbd>.</Kbd> more · <Kbd>→</Kbd> the row&apos;s buttons
                  </p>
                </div>
              ) : null}
            </>
          )}
        </Card>
        {previewId != null ? (
          <BillPreview key="preview" id={previewId} row={rows[pIndex] ?? null} index={pIndex} total={rows.length} openDialog={dialogs.open} send={send} onMove={move}
            onClose={() => { const id = previewId; setPreview(null); requestAnimationFrame(() => rowEl(id)?.focus({ preventScroll: true })); }} />
        ) : null}
      </div>
      {dialogs.element}
      <DeleteManyDialog bills={bulkDelete} onClose={() => setBulkDelete(null)} onDone={() => setSelected(new Set())} />
    </Page>
  );
}
