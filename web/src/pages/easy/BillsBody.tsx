import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { ReceiptText, SearchX } from "lucide-react";
import { rowsOf, type useSalesList } from "@/core/api/sales";
import { useNetwork } from "@/core/api/network";
import { dateLong, fyOf, monthLabel, monthOf, plural, rangeLabel, todayIST } from "@/core/format";
import type { BillRow } from "@/core/sales/types";
import { useDebounced } from "@/core/useDebounced";
import { Checkbox, EmptyState, Field, ListSkeleton, LoadError, Money, QueryView, SearchInput, Segmented, Skeleton } from "@/core/ui";

const WHEN = ["today", "month", "year"] as const;
type When = typeof WHEN[number];
export type BillsRead = (firmId: number | null, filters: { when: When; q?: string; lastYear?: boolean }, today: string) => ReturnType<typeof useSalesList>;
export type BillsBodyProps = {
  useBills: BillsRead;
  firmId: number | null;
  renderRows: (rows: BillRow[], options: { withDate: boolean; longDate: boolean }) => ReactNode;
};

/** The first 40 rows only; the server summary is the whole filtered period. */
export function BillsBody({ firmId, renderRows, useBills }: BillsBodyProps) {
  const net = useNetwork();
  const [params, setParams] = useSearchParams();
  const today = todayIST();
  const ym = monthOf(today);
  const fy = fyOf(today);
  const start = `${fy.slice(0, 4)}-04-01`;
  const lastStart = `${Number(fy.slice(0, 4)) - 1}-04-01`;
  const lastFy = fyOf(lastStart);
  const [q, setQ] = useState(params.get("q") ?? "");
  const rawWhen = params.get("when");
  const [when, setWhen] = useState<When>(WHEN.includes(rawWhen as When) ? rawWhen as When : "today");
  const [withLast, setWithLast] = useState(params.get("last") === "1" || (!params.has("last") && ["04", "05"].includes(today.slice(5, 7))));
  const term = useDebounced(q.trim(), 300);
  const bills = useBills(firmId, { when, q: term, lastYear: withLast }, today);
  const first = bills.isPlaceholderData ? undefined : bills.data?.pages[0];
  const change = (key: string, value: string) => setParams((old) => { const next = new URLSearchParams(old); if (value) next.set(key, value); else next.delete(key); return next; }, { replace: true });
  const label = term ? `Bills for “${term}”` : when === "today" ? "Today" : when === "month" ? `${monthLabel(ym, { long: true, year: false })} so far` : "This year";
  const sub = term ? `${withLast ? `FY ${fy} and ${lastFy}` : `FY ${fy}`}, newest first` : when === "today" ? dateLong(today) : when === "month" ? rangeLabel(`${ym}-01`, today) : `${rangeLabel(start, today)} · FY ${fy}`;
  return <>
    <div className="flex flex-col gap-2">
      <Field label="Find a bill by name, phone or number" htmlFor="easy-find">
        <SearchInput id="easy-find" label={null} value={q} onChange={(value) => { setQ(value); change("q", value); }} placeholder="Like Anil or 31" />
      </Field>
      {q.trim() ? <Checkbox label={`Show last year's bills too (FY ${lastFy})`} checked={withLast} onChange={(value) => { setWithLast(value); change("last", value ? "1" : "0"); }} className="[&_input]:!w-5 [&_input]:!h-5" /> : null}
    </div>
    {q.trim() ? null : <Segmented label="Which bills" full value={when} onChange={(value) => { setWhen(value); change("when", value); }} className="[&_button]:!min-h-12" options={[{ value: "today", label: "Today" }, { value: "month", label: "This month" }, { value: "year", label: "This year" }]} />}
    <section aria-labelledby="easy-bills-t" className="card">
      <div className="px-4 pt-4 pb-3">
        <h2 id="easy-bills-t" className="text-xl font-semibold leading-snug">{label}{first ? <>: <span className="whitespace-nowrap">{plural(first.summary.bills, "bill")}{first.summary.bills ? " ·" : ""}</span>{first.summary.bills ? <> <Money value={first.summary.total_amount} tone="sale" /></> : null}</> : null}</h2>
        <p className="text-md text-muted mt-0.5">{sub}{first?.summary.bills ? " · incl. GST" : ""}{first?.summary.cancelled ? ` · ${plural(first.summary.cancelled, "cancelled bill")} not counted` : ""}</p>
      </div>
      <QueryView query={bills} what="the bill list" skeleton={<div className="flex flex-col gap-3"><Skeleton w="70%" h={26} /><ListSkeleton rows={4} what="sales bills" /></div>}>
        {(data) => {
          if (bills.isPlaceholderData) return bills.isPaused && net === "offline"
            ? <LoadError problem={{ kind: "offline", message: "You're offline" }} what="the bill list" />
            : <ListSkeleton rows={4} what="sales bills" />;
          const page = data.pages[0];
          const rows = rowsOf(data).slice(0, 40);
          return <>
          {rows.length ? <div className="border-t border-rule">{renderRows(rows, { withDate: Boolean(term) || when !== "today", longDate: Boolean(term) })}</div>
            : term ? <EmptyState icon={SearchX} title={`No bills for “${term}”${withLast ? "" : " this year"}`} className="border-t border-rule">{withLast ? "Try part of the name, the phone number, or a bill number like 31." : "Try part of the name or the phone number, or tick “Show last year's bills too”."}</EmptyState>
              : <EmptyState icon={ReceiptText} title={when === "today" ? "No bills yet today" : when === "month" ? "No bills this month yet" : "No bills this year yet"} className="border-t border-rule">Tap New bill below to make one. It takes two steps.</EmptyState>}
          {page.count > 40 ? <p className="px-4 py-3 border-t border-rule text-md text-muted">Showing the newest 40 of {page.count}. Search to find older ones.</p> : null}
        </>; }}
      </QueryView>
    </section>
    <p className="text-md text-muted text-center px-2">Sent means the bill was shared on WhatsApp. To send one again, open the bill.</p>
  </>;
}
