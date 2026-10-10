// The bills list's state, and what it asks the server (PROTO sales/SalesList.jsx:48-205). What's picked lives in the
// address (?month=&q=&paid=&status=&customer=&sort=&only=&bill=, replaced as it changes), so Back from a bill finds the
// list as it was left. The prototype's own link words still open it: when, all, from/to (start_date/end_date),
// dups/empty/no_hsn, gst_rate, segment and firm.
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { useNetwork } from "@/core/api/network";
import { rowsOf, salesKeys, useSalesFacets, useSalesList, type SalesOrdering, type SalesQuery } from "@/core/api/sales";
import { addMonths, date, dateShort, fyOf, monthLabel, rangeLabel, todayIST } from "@/core/format";
import { SEGMENTS } from "@/core/sales/pos";
import type { PaymentMode, Segment } from "@/core/sales/types";
import { PAY, PAY_FILTER, STATUS, firmsWord, type PayFilter, type StatusFilter } from "@/core/sales/words";
import { customerKeys, useCustomer } from "@/core/api/customers";
import { useFirms, useScope, type FirmId } from "@/core/scope";
import { useToast } from "@/core/ui";
import { useDebounced } from "@/core/useDebounced";
import { useView } from "@/core/view";

/** "today", a month ("2026-09"), the picked FY ("all"), or every year ("years"). */
export type Period = string;
export type SortKey = "date" | "number" | "total";
export type Sort = { key: SortKey; dir: "asc" | "desc" };
export type Quality = "dups" | "empty" | "no_hsn";
export type ListState = {
  month: Period; q: string; paid: PayFilter; status: StatusFilter; customer: number | null; sort: Sort; only: boolean;
  from: string; to: string; quality: Quality | null; gstRate: string | null; segment: Segment | null; bill: number | null;
};
export type ViewKey = "unsent" | "udhaar" | "check" | "cash";
export type View = { key: ViewKey; label: string; count: number; set: { month: Period; status: StatusFilter; paid: PayFilter } };

/** The data-quality drill-downs a link opens (PROTO sales/lib.js:266-270). */
export const QUALITY: Record<Quality, { label: string; hint: string }> = {
  dups: { label: "Bills whose number is used twice", hint: "Give one of each pair a new number; GSTR-1 can't be filed until then." },
  empty: { label: "Bills with no items", hint: "Add the items or delete the bill; a bill with no items blocks GSTR-1." },
  no_hsn: { label: "Bills with a line that has no HSN code", hint: "Add the HSN code on each line; the portal won't take a line without one." },
};
/** ?segment= as the GST checks write it (b2c is B2CS). */
export const SEGMENT_LINK: Record<string, Segment> = { b2b: "b2b", b2cl: "b2cl", b2c: "b2cs", b2cs: "b2cs" };

const SLABS = [0, 0.1, 0.25, 1, 1.5, 3, 5, 12, 18, 28, 40];
/**
 * ?gst_rate= from a link, as a percent ("3"): the GST checks send a percent (3, 0.25), other pages a fraction (0.03).
 * The 11 slabs don't overlap between the two readings, so the slab decides (PROTO sales/lib.js:188-204). A rate that's
 * no slab either way stays as written: never a guess by its size (AGENTS.md: no magnitude tests for rates).
 */
export function gstRateParam(raw: string | null): string | null {
  if (raw == null || raw.trim() === "") return null;
  const v = Number(raw.replace("%", ""));
  if (!Number.isFinite(v) || v < 0) return null;
  const pick = [v, v * 100].find((r) => SLABS.some((s) => Math.abs(s - r) < 1e-9));
  return String(Number((pick ?? v).toFixed(4)));
}

/** 1 April to 31 March of an FY ("2026-27"). */
export function fyBounds(fy: string): { from: string; to: string } {
  const y = Number(fy.slice(0, 4));
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
}

const ORDERINGS: SalesOrdering[] = ["-date", "date", "number", "-number", "total", "-total"];
export function sortOf(ordering: string | null): Sort {
  const o = ORDERINGS.find((x) => x === ordering) ?? "-date";
  return { key: o.replace("-", "") as SortKey, dir: o.startsWith("-") ? "desc" : "asc" };
}
export function orderingOf(s: Sort): SalesOrdering {
  return `${s.dir === "desc" ? "-" : ""}${s.key}` as SalesOrdering;
}

const toId = (v: string | null): number | null => (v && /^\d+$/.test(v) && Number(v) > 0 ? Number(v) : null);
const MONTH = /^\d{4}-\d{2}$/;
const PAY_KEYS = PAY_FILTER.map((p) => p.value);

/** The list as the address says. Phones open on this month; a link that asks for something gets the whole year (PROTO SalesList.jsx:61-63). */
export function readList(p: URLSearchParams, { today, fy, isPhone }: { today: string; fy: string; isPhone: boolean }): ListState {
  const cur = today.slice(0, 7);
  const quality = (Object.keys(QUALITY) as Quality[]).find((k) => p.get(k) === "1") ?? null;
  const gstRate = gstRateParam(p.get("gst_rate"));
  const segment = SEGMENT_LINK[p.get("segment") ?? ""] ?? null;
  const from = p.get("from") || p.get("start_date") || "";
  const to = p.get("to") || p.get("end_date") || "";
  const paidRaw = p.get("paid") ?? "";
  const paid = (PAY_KEYS.find((k) => k === paidRaw) ?? "any") as PayFilter;
  const statusRaw = p.get("status") ?? "";
  const status = (Object.keys(STATUS).find((k) => k === statusRaw) ?? "any") as StatusFilter;
  const customer = toId(p.get("customer"));
  const q = p.get("q") ?? "";
  const asked = gstRate != null || segment != null || customer != null || paid !== "any" || status !== "any" || q.trim() !== "";
  const m = p.get("month") ?? "";
  const when = p.get("when");
  const month = when === "today" ? "today" : when === "month" ? cur
    : m === "today" || m === "all" || m === "years" || MONTH.test(m) ? m
      : quality || p.get("all") === "1" ? "years" : from || to || asked ? "all" : isPhone && fy === fyOf(today) ? cur : "all";
  return { month, q, paid, status, customer, sort: sortOf(p.get("sort")), only: p.get("only") === "1", from, to, quality, gstRate, segment, bill: toId(p.get("bill")) };
}

/** The list's own words in the address, the drill-down words (dups, gst_rate, segment, from, to…) left as they are. */
const OWN = ["month", "q", "paid", "status", "customer", "sort", "only", "bill", "when", "all"];
export function writeList(prev: URLSearchParams, s: ListState): URLSearchParams {
  const p = new URLSearchParams(prev);
  for (const k of OWN) p.delete(k);
  p.set("month", s.month);
  if (s.q) p.set("q", s.q);
  if (s.paid !== "any") p.set("paid", s.paid);
  if (s.status !== "any") p.set("status", s.status);
  if (s.customer != null) p.set("customer", String(s.customer));
  if (orderingOf(s.sort) !== "-date") p.set("sort", orderingOf(s.sort));
  if (s.only) p.set("only", "1");
  if (s.bill != null) p.set("bill", String(s.bill));
  return p;
}

const STATUS_QUERY: Record<StatusFilter, SalesQuery> = {
  any: {}, unsent: { unsent: true }, credit: { credit: true }, cancelled: { status: "cancelled" }, check: { check: true }, itax: { itax: true }, cash: { cash: true },
};

/**
 * What the server is asked. A typed search looks through the whole FY, not just the picked month or today, unless
 * "only" narrows it back (PROTO SalesList.jsx:100-105); it also asks for the other years' matches (facets' elsewhere).
 */
export function queryOf(s: ListState, { today, fy, q }: { today: string; fy: string; q: string }): { query: SalesQuery; effMonth: Period; widened: boolean } {
  const searching = q.trim() !== "";
  const widened = searching && !s.only && s.month !== "years" && s.month !== "all";
  const effMonth = widened ? "all" : s.month;
  const query: SalesQuery = { ordering: orderingOf(s.sort), ...STATUS_QUERY[s.status] };
  if (effMonth === "today") { query.start_date = today; query.end_date = today; }
  else if (MONTH.test(effMonth)) query.month = effMonth;
  else if (effMonth === "all") {
    if (s.from || s.to) { if (s.from) query.start_date = s.from; if (s.to) query.end_date = s.to; }
    else query.fy = fy;
  }
  if (s.customer != null) query.customer_id = s.customer;
  if (s.paid !== "any") query.payment_mode = s.paid;
  if (s.quality) query[s.quality] = true;
  if (s.gstRate != null) query.gst_rate = s.gstRate;
  if (s.segment) query.segment = s.segment;
  if (searching) { query.q = q.trim(); query.facets = true; }
  return { query, effMonth, widened };
}

/** One model for the desktop table and the phone's cards. */
export function useListModel() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isPhone } = useView();
  const { show } = useToast();
  const net = useNetwork();
  const { firmId, setFirmId, fy, setFy, fyChoices } = useScope();
  const { firms } = useFirms();
  const today = todayIST();
  const cur = today.slice(0, 7);
  const current = fy === fyOf(today);
  const ctx = useMemo(() => ({ today, fy, isPhone }), [today, fy, isPhone]);
  const state = useMemo(() => readList(params, ctx), [params, ctx]);
  const set = useCallback((patch: Partial<ListState>) => {
    setParams((prev) => {
      const next = { ...readList(prev, ctx), ...patch };
      // a cleared search forgets "only this month"
      if (patch.q !== undefined && !patch.q.trim()) next.only = false;
      return writeList(prev, next);
    }, { replace: true });
  }, [setParams, ctx]);

  // typing stays instant; the server is asked once it has rested (the database is Neon's free plan)
  const dq = useDebounced(state.q.trim(), 300);
  const { query, effMonth, widened } = queryOf(state, { today, fy, q: dq });
  const list = useSalesList(firmId, query);
  const facets = useSalesFacets(firmId, fy);
  // the customer a link or a pick narrowed the list to, by name (1C's useCustomer: a row already loaded names them at once)
  const customerName = useCustomer(state.customer).data?.name || null;

  // a link can name a firm, or a month in another FY: the whole app follows it, as the top bar would (PROTO SalesList.jsx:82-86)
  const linkFirm = useRef(params.get("firm"));
  useEffect(() => {
    const want = linkFirm.current;
    if (!want || !firms.length) return;
    linkFirm.current = null;
    const id: FirmId | null = want === "all" ? "all" : firms.some((f) => f.id === Number(want)) ? Number(want) : null;
    if (id !== null) setFirmId(id);
    // the firm is the app's, not the list's: the address keeps only the list's own words
    setParams((prev) => { const p = new URLSearchParams(prev); p.delete("firm"); return p; }, { replace: true });
  }, [firms]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!MONTH.test(state.month)) return;
    const linkFy = fyOf(`${state.month}-01`);
    if (linkFy !== fy && fyChoices.includes(linkFy)) setFy(linkFy);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // another FY picked in the top bar: a month (or Today) from the old year would contradict it (PROTO SalesList.jsx:87-98)
  const lastFy = useRef(fy);
  useEffect(() => {
    if (lastFy.current === fy) return;
    lastFy.current = fy;
    const stale = (state.month === "today" && fy !== fyOf(today)) || (MONTH.test(state.month) && fyOf(`${state.month}-01`) !== fy);
    if (!stale) return;
    set({ month: "all" });
    // the same title as the top bar's own toast, so this one replaces it: one message per FY change
    show({ tone: "brand", title: `Showing FY ${fy}`, body: state.month === "today" ? "Today isn't in that year, so the list covers the whole year." : "The month you had picked was in the other year, so the list covers the whole year." });
  }, [fy]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => rowsOf(list.data), [list.data]);
  const first = list.data?.pages[0];
  const summary = first?.summary ?? null;
  const elsewhere = first?.facets?.elsewhere ?? [];
  // the months of the picked FY so far, with a short note (PROTO sales/lib.js:88-100)
  const months = useMemo(() => (facets.data?.months ?? []).map((x) => ({
    ...x, note: x.month === cur ? `1 to ${Number(today.slice(8))} ${monthLabel(cur, { year: false })}` : x.locked ? "" : `file by ${dateShort(`${addMonths(x.month, 1)}-11`)}`,
  })), [facets.data, cur, today]);
  const fyCount = months.reduce((a, x) => a + x.bills, 0);

  // saved views: one click sets the filters; the counts follow the firm and the FY (PROTO SalesList.jsx:181-193)
  const v = facets.data?.views;
  const views: View[] = [];
  if (current) views.push({ key: "unsent", label: "Not sent today", count: v?.unsent_today ?? 0, set: { month: "today", status: "unsent", paid: "any" } });
  if (current) views.push({ key: "udhaar", label: "Udhaar this month", count: v?.credit_month ?? 0, set: { month: cur, status: "any", paid: "credit" } });
  views.push({ key: "check", label: "Needs a check", count: v?.check ?? 0, set: { month: "all", status: "check", paid: "any" } });
  views.push({ key: "cash", label: "Cash ≥ ₹2 lakh", count: v?.cash ?? 0, set: { month: "all", status: "cash", paid: "any" } });
  const viewOn = views.find((x) => x.set.month === state.month && x.set.status === state.status && x.set.paid === state.paid && state.customer == null && !state.q.trim())?.key ?? null;
  const pickView = (x: View) => {
    if (viewOn === x.key) { set({ month: isPhone && current ? cur : "all", status: "any", paid: "any" }); return; }
    set({ ...x.set, customer: null, q: "" });
  };

  const firm = typeof firmId === "number" ? firms.find((f) => f.id === firmId) : undefined;
  const scope = firmId === "all" ? "All firms" : firm?.name ?? "This firm";
  /** The firms in view, in a sentence: "all three firms", "both firms", or the firm's name. */
  const inView = firmId === "all" ? (firms.length ? firmsWord(firms.length) : "all firms") : scope;
  const periodOf = (mo: Period) => (mo === "years" ? "All years" : mo === "today" ? `Today, ${date(today)}`
    : mo === cur ? `${monthLabel(cur, { long: true, year: false })} so far, ${rangeLabel(`${cur}-01`, today)}`
      : mo !== "all" ? monthLabel(mo, { long: true })
        : state.from || state.to ? rangeLabel(state.from || fyBounds(fy).from, state.to || today) : `FY ${fy}`);
  const drillText = [
    state.quality ? QUALITY[state.quality].label : "",
    state.gstRate != null ? `bills with ${state.gstRate}% lines` : "",
    state.segment ? `${SEGMENTS[state.segment].label} bills` : "",
  ].filter(Boolean);
  const extras = [
    state.paid !== "any" ? (state.paid === "none" ? "payment not recorded" : `paid by ${PAY[state.paid as PaymentMode]}`) : "",
    state.status !== "any" ? STATUS[state.status].toLowerCase() : "",
    state.customer != null ? customerName ?? "one customer" : "",
    dq ? `matching “${dq}”` : "",
  ].filter(Boolean);
  const filterCount = Number(state.paid !== "any") + Number(state.status !== "any") + Number(state.customer != null);

  // waiting for the firm (firmId null) or offline before anything came: the prototype's offline state, not "loading"
  const waiting = list.isPending && list.fetchStatus === "idle";
  const failed: ApiProblem | null = list.isError && !list.data ? problemOf(list.error)
    : list.isPending && (list.isPaused || waiting) && net === "offline" ? { kind: "offline", message: "You're offline" } : null;
  const load = {
    ready: Boolean(list.data), loading: !list.data && !failed, failed,
    // a later page or a refresh that failed: what's shown stays, with why (StaleNote)
    stale: list.isError && list.data ? problemOf(list.error) : null,
    // asks again for everything the page shows (the bills, the period chips and views, the customer picked, the bill in
    // the preview), through the client: a list still waiting for its firm (skipToken) is passed over, where a hook's own
    // refetch() would end it in an error (Ruling 1B-11)
    retry: () => { for (const queryKey of [salesKeys.all, customerKeys.all]) void qc.refetchQueries({ queryKey, type: "active" }); },
  };
  /** Every page still on the server (a "Show all" of 160 bills or fewer: four requests at most). */
  const loadRest = async () => {
    let r = await list.fetchNextPage();
    while (r.hasNextPage && !r.isError) r = await r.fetchNextPage();
  };
  const loadMore = async () => { await list.fetchNextPage(); };

  return {
    today, cur, current, fy, fyChoices, firmId, setFirmId, firms, scope, inView, state, set, dq, effMonth, widened, list, rows, summary, elsewhere,
    facets: facets.data ?? null, months, fyCount, views, viewOn, pickView, customerName, load, loadRest, loadMore,
    periodText: periodOf(effMonth), pickedText: periodOf(state.month), drillText, extras, filterCount,
    anyFilter: filterCount > 0 || state.q.trim() !== "", drill: drillText.length > 0, complete: !list.hasNextPage,
    clearFilters: () => set({ paid: "any", status: "any", customer: null, q: "" }),
    clearDrill: () => navigate("/sales", { replace: true }),
    backToThisYear: () => setFy(fyChoices[0]),
  };
}
export type ListModel = ReturnType<typeof useListModel>;
