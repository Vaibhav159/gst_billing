// v2's old bill links (design §5: v2's number links open the v3 bill page). v2 linked a bill by its number when the
// number fit in an address (/billing/invoice/{number}, /billing/invoice/{firm slug}/{FY}/{number}), and kept
// /billing/invoice/{id} for the rest; part 0 sends /billing/invoice/{id} to /sales/{id}. As v2 did, the firm slug is the
// firm's id or its name in lower case with dashes, and several matches are offered to pick from rather than guessed.
import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { ReceiptText } from "lucide-react";
import { api } from "@/core/api/client";
import { problemOf } from "@/core/api/errors";
import { useNetwork } from "@/core/api/network";
import { salesKeys, useSalesPage, type SalesQuery } from "@/core/api/sales";
import { date, fyOf, inr, toPaise } from "@/core/format";
import { sameNumber } from "@/core/sales/numbers";
import { useFirms } from "@/core/scope";
import { ButtonLink, Card, EmptyState, ListRow, ListSkeleton, LoadError, Page, StaleNote } from "@/core/ui";
import { MissingBill } from "./MissingBill";

/** v2's firm slug: "KIRAN GOLD HOUSE (SANDBOX)" -> "kiran-gold-house-sandbox" (v2 useDataStore businessSlug). */
export function businessSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** A bill as v2's invoices/ lists it (an inward one is a purchase); total in paise. */
type V2Row = { id: number; invoice_number: string; invoice_date: string; business_name: string; customer_name: string; total: number | null };
const toV2Row = (w: Record<string, unknown>): V2Row => ({
  id: Number(w.id), invoice_number: String(w.invoice_number ?? ""), invoice_date: String(w.invoice_date ?? ""), business_name: String(w.business_name ?? ""),
  customer_name: String(w.customer_name ?? ""), total: toPaise(w.total_amount as string | number | null | undefined),
});

const inwardKey = (number: string, business: number | null) => salesKeys.v2Purchase(`${business ?? "all"}/${number}`);
/** A purchase (v2's inward bill) with this number, for a number no sales bill has: v2's links reached those too. */
function useInwardByNumber(number: string, business: number | null, enabled: boolean) {
  return useQuery({
    queryKey: inwardKey(number, business), enabled, retry: false,
    queryFn: async ({ signal }): Promise<V2Row[]> => {
      const params: Record<string, string | number> = { invoice_number: number, type_of_invoice: "inward", ...(business !== null ? { business_id: business } : {}), page_size: 20 };
      const d = (await api.get("invoices/", { params, signal })).data;
      // v2 matches a number anywhere in it: only the exact number counts here
      return (Array.isArray(d?.results) ? d.results : []).map(toV2Row).filter((r: V2Row) => sameNumber(r.invoice_number, number));
    },
  });
}

/** A lookup with no answer yet: the page's placeholder; offline before anything came (as BillPage); or failed, with Try again. */
function Asking({ title, q, retry }: { title: string; q: { isError: boolean; error: unknown; isPaused: boolean }; retry: () => void }) {
  const net = useNetwork();
  return (
    <Page icon={ReceiptText} title={title} back="/sales">
      {q.isError ? <LoadError problem={problemOf(q.error)} retry={retry} what="this bill" />
        : q.isPaused && net === "offline" ? <LoadError problem={{ kind: "offline", message: "You're offline" }} what="this bill" />
          : <ListSkeleton rows={2} what="the bill" />}
    </Page>
  );
}

export function BillByNumber({ number, firmSlug = "", fy = "" }: { number: string; firmSlug?: string; fy?: string }) {
  const qc = useQueryClient();
  const { firms } = useFirms();
  const firmId = /^\d+$/.test(firmSlug) ? Number(firmSlug) : null;
  const query: SalesQuery = { number, ...(fy ? { fy } : {}) };
  const page = useSalesPage(firmId ?? "all", query, 20);
  // a firm the link names, rather than gives the id of, is matched by its slug
  const named = (r: { business_name: string }) => !firmSlug || firmId !== null || businessSlug(r.business_name) === firmSlug;
  const bills = (page.data?.results ?? []).filter(named);
  const none = Boolean(page.data) && bills.length === 0;
  const inward = useInwardByNumber(number, firmId, none);
  // the link's firm and year, which v2 matched on its side and its inward bills' list doesn't
  const purchases = inward.data?.filter((r) => named(r) && (!fy || (r.invoice_date !== "" && fyOf(r.invoice_date) === fy)));
  const title = `Bill ${number}`;
  // Try again asks through the client (Ruling 1B-11)
  const again = (queryKey: QueryKey) => () => { void qc.refetchQueries({ queryKey }); };
  const pageKey = salesKeys.page(firmId ?? "all", query, 20);
  if (!page.data) return <Asking title={title} q={page} retry={again(pageKey)} />;
  // a refresh that failed keeps what was shown, and says so (part 0's rule, as BillPage's)
  const stale = page.isError ? { q: page, key: pageKey } : inward.isError && inward.data ? { q: inward, key: inwardKey(number, firmId) } : null;
  const note = stale ? <StaleNote problem={problemOf(stale.q.error)} what="the bills with this number" retry={again(stale.key)} busy={stale.q.isFetching} /> : null;
  if (bills.length === 1) return <Navigate to={`/sales/${bills[0].id}`} replace />;
  if (bills.length > 1) {
    return (
      <PickBill number={number} note={note} label="Bills with this number" title={`${bills.length} bills have this number`} subtitle="Pick the one you want: each firm has its own series, every year."
        choices={bills.map((b) => ({ to: `/sales/${b.id}`, number: b.invoice_number, total: b.total_amount,
          line: `${b.business_name} · ${date(b.invoice_date)} · ${b.customer.name}${b.status === "cancelled" ? " · cancelled" : ""}` }))} />
    );
  }
  if (!purchases) return <Asking title={title} q={inward} retry={again(inwardKey(number, firmId))} />;
  if (purchases.length === 1) return <Navigate to={`/purchases/${purchases[0].id}`} replace />;
  if (purchases.length > 1) {
    return (
      <PickBill number={number} note={note} label="Purchases with this number" title={`${purchases.length} purchases have this number`}
        subtitle="No sales bill has it. Pick the purchase you want: each supplier numbers its own bills."
        choices={purchases.map((p) => ({ to: `/purchases/${p.id}`, number: p.invoice_number, total: p.total, line: `${p.business_name} · ${date(p.invoice_date)} · ${p.customer_name}` }))} />
    );
  }
  const firm = firmId !== null ? firms.find((f) => f.id === firmId)?.name : firms.find((f) => businessSlug(f.name) === firmSlug)?.name;
  return (
    <Page icon={ReceiptText} title={title} breadcrumbs={[{ label: "Sales", to: "/sales" }]} back="/sales">
      {note}
      <Card><EmptyState icon={ReceiptText} title="No bill has this number" actions={<>
        <ButtonLink to={`/sales?q=${encodeURIComponent(number)}&month=years`} variant="primary">Search every year</ButtonLink>
        <ButtonLink to="/sales">Go to Sales</ButtonLink>
      </>}>
        No sales bill{firm ? ` of ${firm}` : ""} has the number “{number}”{fy ? ` in FY ${fy}` : ""}. It may have been renumbered or deleted; search for it, or look in the Audit log.
      </EmptyState></Card>
    </Page>
  );
}

type Choice = { to: string; number: string; line: string; total: number | null };
/** Several bills share the number (another firm, another year; with no sale, several suppliers' bills): pick one, as v2 did. */
function PickBill({ number, label, title, subtitle, choices, note }: { number: string; label: string; title: string; subtitle: string; choices: Choice[]; note: ReactNode }) {
  return (
    <Page icon={ReceiptText} title={`Bill ${number}`} breadcrumbs={[{ label: "Sales", to: "/sales" }]} back="/sales">
      {note}
      <Card title={title} subtitle={subtitle} pad={false}>
        <ul className="mt-1" aria-label={label}>
          {choices.map((c) => (
            <li key={c.to}>
              <ListRow to={c.to} title={<span className="tnum">{c.number}</span>} subtitle={c.line} right={inr(c.total)} />
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}

/** An id that isn't a sale (sales/ answered 404): v2 kept purchases in the same table, so its invoices/{id}/ says whether it's one. */
export function NotASale({ id }: { id: number }) {
  const qc = useQueryClient();
  const v2 = useQuery({
    queryKey: salesKeys.v2Invoice(id), retry: false,
    queryFn: async ({ signal }) => String((await api.get(`invoices/${id}/`, { signal })).data?.type_of_invoice ?? ""),
  });
  if (v2.data === "inward") return <Navigate to={`/purchases/${id}`} replace />;
  // v2 has no bill with this id either, or not a purchase: it isn't here. Not knowing (no answer) is said, with Try again
  if (v2.data !== undefined || (v2.isError && problemOf(v2.error).kind === "notfound")) return <MissingBill id={String(id)} />;
  return <Asking title="Sales bill" q={v2} retry={() => { void qc.refetchQueries({ queryKey: salesKeys.v2Invoice(id) }); }} />;
}
