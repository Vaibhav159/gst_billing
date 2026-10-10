// Customers on the server (API contract §6): v2's customers/ endpoints with part 1's additions, each customer's
// statement, and the income-tax flags on their bills (sales/?itax=1). Money arrives as decimal strings and is kept as
// integer paise here; every other field keeps the contract's name. Nothing here polls: lists wait for the firm
// (firmId !== null) and refetch only when asked for again or after a save.
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type Query, type QueryClient } from "@tanstack/react-query";
import { api } from "@/core/api/client";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { plural, toPaise } from "@/core/format";
import { effectivePan, hasGstin } from "@/core/ids";
import type { PaymentMode } from "@/core/sales/types";
import type { FirmId } from "@/core/scope";

/* ── Shapes ────────────────────────────────────────────── */
/** The effective type: the stored customer_type, else business with a GSTIN, else person (contract §0.2 CustomerRef). */
export type CustomerType = "walkin" | "person" | "business";
/** What's stored: "" means work it out from the GSTIN. */
export type StoredCustomerType = "" | CustomerType;

/** GET customers/{id}/ and each customers/ row: v2's keys plus customer_type, city, type and pan (contract §6.1). */
export type Customer = {
  id: number; name: string; address: string; city: string; state_name: string; gst_number: string; pan_number: string;
  mobile_number: string; email: string; businesses: number[]; created_at: string;
  customer_type: StoredCustomerType; type: CustomerType; pan: string;
};
/** The newest active sale in the firm scope, any date (figures.last_bill). */
export type LastBill = { id: number; invoice_number: string; invoice_date: string; total_amount: number; business: number };
/** figures=1: active sales in the firm and period; cancelled counts the ones left out. Money in paise. */
export type CustomerFigures = { bills: number; total: number; cancelled: number; udhaar_bills: number; udhaar_total: number; last_bill: LastBill | null };
export type CustomerRow = Customer & { figures: CustomerFigures | null };
/** The answer's summary over every matching customer, not just this page. */
export type CustomerSummary = { customers: number; bills: number; total: number; cancelled: number; udhaar_bills: number; udhaar_total: number };
export type CustomerPage = { count: number; next: string | null; rows: CustomerRow[]; summary: CustomerSummary | null };

/** An income-tax check on a bill (contract §0.2 ItaxFlag); never on a cancelled bill. */
export type ItaxKind = "cash_limit" | "pan" | "walkin_limit" | "b2b_address";
export type ItaxFlag = { kind: ItaxKind; short: string; text: string };
/** How a statement bill was settled: at billing (cash, UPI or both), on udhaar, not recorded (from Tally), or cancelled. */
export type PaidAs = "billing" | "udhaar" | "not_recorded" | "cancelled";
export type StatementBill = {
  id: number; business: number; business_name: string; invoice_number: string; invoice_date: string; payment_mode: PaymentMode;
  taxable: number; tax: number; total_amount: number; status: "active" | "cancelled"; cancel_reason: string; paid: PaidAs; itax: ItaxFlag[];
};
export type CountTotal = { bills: number; total: number };
/** Active bills only: "a register of bills, not a ledger". */
export type StatementTotals = { bills: number; billed: number; taxable: number; tax: number; cancelled: number; paid_at_billing: CountTotal; udhaar: CountTotal; not_recorded: CountTotal };
export type StatementCustomer = { id: number; name: string; type: CustomerType; mobile_number: string; gst_number: string; pan: string; city: string; state_name: string };
/** GET customers/{id}/statement/ (contract §6.3): bills oldest first, cancelled ones included. */
export type Statement = {
  customer: StatementCustomer; start_date: string | null; end_date: string | null; business: number | null;
  bills: StatementBill[]; totals: StatementTotals; months: { month: string; bills: number; total: number }[];
};
/** Either date, both or neither (all time); business_id: one firm, else all. */
export type StatementParams = { start_date?: string; end_date?: string; business_id?: number };
/** A bill with an income-tax flag, from sales/?customer_id=&itax=1. */
export type ItaxBill = { id: number; invoice_number: string; invoice_date: string; total_amount: number; itax: ItaxFlag[] };

/** What a customer form sends to customers/ (POST) or customers/{id}/ (PATCH: any of these). */
export type CustomerBody = {
  name: string; mobile_number: string; email: string; customer_type: StoredCustomerType; gst_number: string; pan_number: string;
  address: string; city: string; state_name: string; businesses: number[];
};

/* ── Reading answers ───────────────────────────────────── */
type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money = (v: unknown): number => toPaise(typeof v === "string" || typeof v === "number" ? v : null) ?? 0;
const TYPES: readonly CustomerType[] = ["walkin", "person", "business"];
const isType = (v: unknown): v is CustomerType => TYPES.includes(v as CustomerType);

/** A customer as the screens use it, whatever the server left out: type and pan are worked out as the server does. */
export function toCustomer(raw: unknown): Customer {
  const d = obj(raw);
  const gst = str(d.gst_number).trim().toUpperCase();
  const stored: StoredCustomerType = isType(d.customer_type) ? d.customer_type : "";
  return {
    id: num(d.id), name: str(d.name), address: str(d.address), city: str(d.city), state_name: str(d.state_name), gst_number: gst,
    pan_number: str(d.pan_number).toUpperCase(), mobile_number: str(d.mobile_number), email: str(d.email),
    businesses: list(d.businesses).map(num), created_at: str(d.created_at), customer_type: stored,
    type: isType(d.type) ? d.type : stored || (hasGstin(gst) ? "business" : "person"),
    pan: typeof d.pan === "string" ? d.pan : effectivePan(str(d.pan_number), gst),
  };
}
function toLastBill(raw: unknown): LastBill | null {
  if (!raw || typeof raw !== "object") return null;
  const d = obj(raw);
  return { id: num(d.id), invoice_number: str(d.invoice_number), invoice_date: str(d.invoice_date), total_amount: money(d.total_amount), business: num(d.business) };
}
function toFigures(raw: unknown): CustomerFigures | null {
  if (!raw || typeof raw !== "object") return null;
  const d = obj(raw);
  return { bills: num(d.bills), total: money(d.total), cancelled: num(d.cancelled), udhaar_bills: num(d.udhaar_bills), udhaar_total: money(d.udhaar_total), last_bill: toLastBill(d.last_bill) };
}
export function toCustomerRow(raw: unknown): CustomerRow {
  return { ...toCustomer(raw), figures: toFigures(obj(raw).figures) };
}
/** A page of customers/ (paged, or an unpaged array from an older server). */
export function toCustomerPage(raw: unknown): CustomerPage {
  const d = obj(raw);
  const rows = (Array.isArray(raw) ? raw : list(d.results)).map(toCustomerRow);
  const s = d.summary && typeof d.summary === "object" ? obj(d.summary) : null;
  return {
    count: typeof d.count === "number" ? d.count : rows.length, next: typeof d.next === "string" ? d.next : null, rows,
    summary: s ? { customers: num(s.customers), bills: num(s.bills), total: money(s.total), cancelled: num(s.cancelled), udhaar_bills: num(s.udhaar_bills), udhaar_total: money(s.udhaar_total) } : null,
  };
}
function toFlags(raw: unknown): ItaxFlag[] {
  return list(raw).map(obj).filter((f) => ["cash_limit", "pan", "walkin_limit", "b2b_address"].includes(str(f.kind)))
    .map((f) => ({ kind: str(f.kind) as ItaxKind, short: str(f.short), text: str(f.text) }));
}
const countTotal = (raw: unknown): CountTotal => ({ bills: num(obj(raw).bills), total: money(obj(raw).total) });
const PAID: readonly PaidAs[] = ["billing", "udhaar", "not_recorded", "cancelled"];
export function toStatement(raw: unknown): Statement {
  const d = obj(raw);
  const c = obj(d.customer);
  const t = obj(d.totals);
  return {
    customer: {
      id: num(c.id), name: str(c.name), type: isType(c.type) ? c.type : "person", mobile_number: str(c.mobile_number), gst_number: str(c.gst_number),
      pan: str(c.pan), city: str(c.city), state_name: str(c.state_name),
    },
    start_date: typeof d.start_date === "string" ? d.start_date : null, end_date: typeof d.end_date === "string" ? d.end_date : null,
    business: typeof d.business === "number" ? d.business : null,
    bills: list(d.bills).map(obj).map((b) => ({
      id: num(b.id), business: num(b.business), business_name: str(b.business_name), invoice_number: str(b.invoice_number), invoice_date: str(b.invoice_date),
      payment_mode: str(b.payment_mode) as PaymentMode, taxable: money(b.taxable), tax: money(b.tax), total_amount: money(b.total_amount),
      status: b.status === "cancelled" ? "cancelled" : "active", cancel_reason: str(b.cancel_reason),
      paid: PAID.includes(b.paid as PaidAs) ? (b.paid as PaidAs) : b.status === "cancelled" ? "cancelled" : "not_recorded", itax: toFlags(b.itax),
    })),
    totals: {
      bills: num(t.bills), billed: money(t.billed), taxable: money(t.taxable), tax: money(t.tax), cancelled: num(t.cancelled),
      paid_at_billing: countTotal(t.paid_at_billing), udhaar: countTotal(t.udhaar), not_recorded: countTotal(t.not_recorded),
    },
    months: list(d.months).map(obj).map((m) => ({ month: str(m.month), bills: num(m.bills), total: money(m.total) })),
  };
}
function toItaxBills(raw: unknown): ItaxBill[] {
  return list(obj(raw).results).map(obj).map((b) => ({ id: num(b.id), invoice_number: str(b.invoice_number), invoice_date: str(b.invoice_date), total_amount: money(b.total_amount), itax: toFlags(b.itax) }));
}

/* ── Query keys ────────────────────────────────────────── */
// Everything under "customers", so a save refreshes all of it. A customer's PAN or address changes the income-tax flags
// on their bills, so a save refreshes "sales" too (the bill screens' queries).
export const customerKeys = {
  all: ["customers"] as const,
  list: (params: Record<string, string | number>) => ["customers", "list", params] as const,
  count: () => ["customers", "count"] as const,
  one: (id: number) => ["customers", "one", id] as const,
  statement: (id: number, params: StatementParams) => ["customers", "statement", id, params] as const,
  itax: (id: number) => ["customers", "itax", id] as const,
  search: (term: string, size: number) => ["customers", "search", term, size] as const,
  recent: (firm: FirmId) => ["customers", "recent", firm] as const,
  walkin: () => ["customers", "walkin"] as const,
};
/** A customer row already in the cache (a list, a search, recent customers), so its page can show the name at once. */
function cachedCustomer(qc: QueryClient, id: number): Customer | undefined {
  for (const [key, data] of qc.getQueriesData<unknown>({ queryKey: customerKeys.all })) {
    const kind = key[1];
    const rows = kind === "list" ? (data as InfiniteData<CustomerPage> | undefined)?.pages.flatMap((p) => p.rows) ?? []
      : kind === "search" || kind === "recent" ? ((data as CustomerRow[] | undefined) ?? []) : [];
    const hit = rows.find((r) => r.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/* ── Reading ───────────────────────────────────────────── */
export type CustomerSort = "recent" | "name" | "sales";
export type CustomerListFilters = {
  /** The firm the figures count (null: not known yet, so nothing is asked); from and to: the figures' period. */
  firmId: FirmId | null; from: string; to: string;
  q: string; gst: "any" | "yes" | "no"; state: string; usualFirm: number | null; sort: CustomerSort;
};
export const LIST_PAGE = 20;
const ORDERING: Record<CustomerSort, string> = { recent: "-last_bill", name: "name", sales: "-sales" };

/** What search is asked for: a phone number typed in groups, or with +91, as its digits. */
export function searchTerm(q: string): string {
  const t = q.trim();
  return /^\+?[\d\s-]+$/.test(t) && t.replace(/\D/g, "").length >= 3 ? t.replace(/^\+91/, "").replace(/\D/g, "") : t;
}
/** All the customers a list's filters match, every page (page_size 1000), for an export. */
export async function fetchAllCustomers(params: Record<string, string | number>): Promise<CustomerRow[]> {
  const rows: CustomerRow[] = [];
  for (let page = 1; ; page++) {
    const p = toCustomerPage((await api.get("customers/", { params: { ...params, page, page_size: 1000 } })).data);
    rows.push(...p.rows);
    if (!p.next) return rows;
  }
}
/** customers/'s parameters for the list (contract §6.1). */
export function customerListParams(f: CustomerListFilters): Record<string, string | number> {
  const p: Record<string, string | number> = { figures: 1, page_size: LIST_PAGE, start_date: f.from, end_date: f.to, ordering: ORDERING[f.sort] };
  if (typeof f.firmId === "number") p.figures_business_id = f.firmId;
  if (f.q.trim()) p.search = searchTerm(f.q);
  if (f.gst !== "any") p.has_gstin = f.gst === "yes" ? 1 : 0;
  if (f.state) p.state_name = f.state;
  if (f.usualFirm !== null) p.business_id = f.usualFirm;
  return p;
}
/**
 * The customers list, LIST_PAGE at a time (fetchNextPage for the next), with figures and the summary. A new search or
 * filter keeps the rows on screen until its answer comes, so the search box never gives way to a skeleton mid-word.
 */
export function useCustomerList(f: CustomerListFilters) {
  const params = customerListParams(f);
  return useInfiniteQuery({
    queryKey: customerKeys.list(params), enabled: f.firmId !== null, initialPageParam: 1, placeholderData: keepPreviousData,
    queryFn: async ({ pageParam, signal }) => toCustomerPage((await api.get("customers/", { params: { ...params, page: pageParam }, signal })).data),
    getNextPageParam: (last, _all, page) => (last.next ? page + 1 : undefined),
  });
}
/** How many customers there are, filters aside ("3 of 29 match"). */
export function useCustomerCount() {
  return useQuery({ queryKey: customerKeys.count(), queryFn: async ({ signal }) => toCustomerPage((await api.get("customers/", { params: { page_size: 1 }, signal })).data).count });
}
/** One customer. A row already on screen stands in while it loads, so the page names them at once. */
export function useCustomer(id: number | null) {
  const qc = useQueryClient();
  return useQuery<Customer>({
    queryKey: customerKeys.one(id ?? 0), enabled: id !== null,
    queryFn: async ({ signal }) => toCustomer((await api.get(`customers/${id}/`, { signal })).data),
    placeholderData: () => (id === null ? undefined : cachedCustomer(qc, id)),
  });
}
/** A customer's statement for a period and firm (null params: not ready to ask, like a firm not known yet). */
export function useStatement(id: number | null, params: StatementParams | null) {
  return useQuery({
    queryKey: customerKeys.statement(id ?? 0, params ?? {}), enabled: id !== null && params !== null,
    queryFn: async ({ signal }) => toStatement((await api.get(`customers/${id}/statement/`, { params, signal })).data),
  });
}
/** A customer's bills with an income-tax flag, every firm and year, newest first (200 at most). */
export function useItaxBills(customerId: number | null) {
  return useQuery({
    queryKey: customerKeys.itax(customerId ?? 0), enabled: customerId !== null,
    // ponytail: one page of 200 flagged bills; a customer with more would show the first 200's numbers and counts
    queryFn: async ({ signal }) => toItaxBills((await api.get("sales/", { params: { customer_id: customerId, itax: 1, ordering: "-date", page_size: 200 }, signal })).data),
  });
}
/** Customers whose name, phone or GSTIN has `term` in it (from 2 characters), with their last bill in any firm. */
export function useCustomerSearch(term: string, { size = 8, enabled = true }: { size?: number; enabled?: boolean } = {}) {
  const t = term.trim();
  return useQuery({
    queryKey: customerKeys.search(t, size), enabled: enabled && t.length >= 2, staleTime: 30_000,
    queryFn: async ({ signal }) => toCustomerPage((await api.get("customers/", { params: { search: searchTerm(t), figures: 1, page_size: size }, signal })).data).rows,
  });
}
/** The five customers a firm billed last (never the walk-in record). Waits for the firm. */
export function useRecentCustomers(firmId: FirmId | null) {
  return useQuery({
    queryKey: customerKeys.recent(firmId ?? "all"), enabled: firmId !== null, staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const params: Record<string, string | number> = { figures: 1, ordering: "-last_bill", page_size: 6 };
      if (typeof firmId === "number") params.figures_business_id = firmId;
      return toCustomerPage((await api.get("customers/", { params, signal })).data).rows.filter((r) => r.type !== "walkin" && r.figures?.last_bill).slice(0, 5);
    },
  });
}
/** The walk-in record (customer_type walkin), or null while none is marked. */
export function useWalkin() {
  return useQuery({
    queryKey: customerKeys.walkin(), staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => toCustomerPage((await api.get("customers/", { params: { type: "walkin", page_size: 1 }, signal })).data).rows[0] ?? null,
  });
}

/* ── Writing ───────────────────────────────────────────── */
const refreshedBySave = (keep?: number) => (q: Query) =>
  q.queryKey[0] === "sales" || (q.queryKey[0] === "customers" && !(q.queryKey[1] === "one" && q.queryKey[2] === keep));
/** Adds a customer (no id) or changes one (PATCH, any fields). Answers the saved customer. */
export function useSaveCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id?: number; body: Partial<CustomerBody> }) =>
      toCustomer((id ? await api.patch(`customers/${id}/`, body) : await api.post("customers/", body)).data),
    onSuccess: (c) => {
      qc.setQueryData(customerKeys.one(c.id), c);
      void qc.invalidateQueries({ predicate: refreshedBySave(c.id) });
    },
  });
}
/** Deletes a customer with no bills (owner: customer.merge). The server refuses one with bills (409). */
export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => { await api.delete(`customers/${id}/`); },
    // the lists only: the page being left still holds this customer until it has gone
    onSuccess: () => { void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === "customers" && ["list", "count", "search", "recent", "walkin"].includes(String(q.queryKey[1])) }); },
  });
}

/** A form field a save can refuse. */
export type CustomerField = "name" | "phone" | "email" | "gstin" | "pan" | "address" | "city" | "state" | "firms" | "type";
const FIELD_OF: Record<string, CustomerField> = {
  name: "name", mobile_number: "phone", email: "email", gst_number: "gstin", pan_number: "pan", address: "address", city: "city",
  state_name: "state", businesses: "firms", customer_type: "type",
};
/**
 * A refused save, in the form's terms: the server's words under each field it names (DRF's own "already exists" for a
 * name in the app's words), and the problem as a whole for what no field shows.
 */
export function customerSaveErrors(error: unknown, typedName = ""): { problem: ApiProblem; fields: Partial<Record<CustomerField, string>> } {
  const problem = problemOf(error);
  const fields: Partial<Record<CustomerField, string>> = {};
  for (const [k, v] of Object.entries(problem.fields ?? {})) {
    const f = FIELD_OF[k];
    if (!f) continue;
    fields[f] = f === "name" && /already exists/i.test(v) ? `There's already a customer called ${typedName.trim() || "that"}. Add the area or the father's name to tell them apart.` : v;
  }
  return { problem, fields };
}
/** Why a delete didn't happen: the prototype's words when the server counted the bills (v2's 409 has `protected`). */
export function deleteRefusal(error: unknown): string {
  const res = (error as { response?: { status?: number; data?: unknown } } | null)?.response;
  const n = res?.status === 409 ? Number(obj(res.data).protected) : NaN;
  if (Number.isFinite(n) && n > 0) return `Has ${plural(n, "bill")}. Merge it into the right customer instead.`;
  const p = problemOf(error);
  if (p.kind === "offline") return "Not deleted: you're offline. Nothing was changed; try again when the internet is back.";
  if (p.kind === "unreachable" || p.kind === "server") return "Not deleted: the app couldn't get through. Nothing was changed; try again in a minute.";
  return p.message;
}
