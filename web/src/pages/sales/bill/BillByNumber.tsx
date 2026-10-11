// v2's old bill links (design §5: v2's number links open the v3 bill page). v2 linked a bill by its number when the
// number fit in an address (/billing/invoice/{number}, /billing/invoice/{firm slug}/{FY}/{number}), and kept
// /billing/invoice/{id} for the rest; part 0 sends /billing/invoice/{id} to /sales/{id}. As v2 did, the firm slug is the
// firm's id or its name in lower case with dashes, a number is looked for among sales and purchases at once (v2 kept both
// in one table), and several matches are offered to pick from rather than guessed (Rulings 1B-19, 1B-20).
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
import { cancelledMark } from "@/core/sales/words";
import { useFirms } from "@/core/scope";
import { Badge, Banner, Button, ButtonLink, Card, EmptyState, ListRow, ListSkeleton, LoadError, Page, StaleNote } from "@/core/ui";
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
const rowsOf = (d: unknown): Record<string, unknown>[] => { const r = (d as { results?: unknown } | null)?.results; return Array.isArray(r) ? r : []; };

/** The most rows v2's invoices/ gives in one answer (its pagination's max_page_size). */
const V2_MOST = 1000;
/** The link's FY as v2's date filter: "2026-27" -> 2026-04-01 to 2027-03-31. */
const fyDates = (fy: string) => (/^\d{4}-\d{2}$/.test(fy) ? { start_date: `${fy.slice(0, 4)}-04-01`, end_date: `${Number(fy.slice(0, 4)) + 1}-03-31` } : {});
const inwardKey = (number: string, business: number | null, fy: string) => salesKeys.v2Purchase(`${business ?? "all"}/${fy}/${number}`);
/** The purchases (v2's inward bills) with exactly this number, or tooMany when over 1000 have it somewhere in theirs. */
type Inward = { rows: V2Row[]; tooMany: false } | { rows: null; tooMany: true };
function useInwardByNumber(number: string, business: number | null, fy: string, enabled: boolean) {
  return useQuery({
    queryKey: inwardKey(number, business, fy), enabled, retry: false,
    queryFn: async ({ signal }): Promise<Inward> => {
      const params = { invoice_number: number, type_of_invoice: "inward", ...(business !== null ? { business_id: business } : {}), ...fyDates(fy) };
      const ask = async (page_size: number) => (await api.get("invoices/", { params: { ...params, page_size }, signal })).data;
      let d = await ask(20);
      // v2 matches the number anywhere in a bill's number, newest first, so an older exact one can lie past these rows:
      // the rest are asked for once (each ask follows a person opening a link: nothing asks on a timer)
      const count = Number((d as { count?: unknown } | null)?.count) || 0;
      if (count > rowsOf(d).length) {
        if (count > V2_MOST) return { rows: null, tooMany: true };
        d = await ask(count);
      }
      // only the exact number counts here
      return { rows: rowsOf(d).map(toV2Row).filter((r) => sameNumber(r.invoice_number, number)), tooMany: false };
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
  const { firms, loading: firmsLoading } = useFirms();
  const firmId = /^\d+$/.test(firmSlug) ? Number(firmSlug) : null;
  // the firm a link names by its slug, from the firm list, so v2 asks that firm only (null when none matches: then
  // every firm is asked, and matched by name here)
  const linkFirm = firmId ?? (firmSlug ? firms.find((f) => businessSlug(f.name) === firmSlug)?.id ?? null : null);
  const query: SalesQuery = { number, ...(fy ? { fy } : {}) };
  const page = useSalesPage(firmId ?? "all", query, 20);
  // a link names a sale or a purchase, so both are asked for at once (Ruling 1B-20); a firm named by its slug first
  const inward = useInwardByNumber(number, linkFirm, fy, firmId !== null || !firmSlug || !firmsLoading);
  const named = (r: { business_name: string }) => !firmSlug || firmId !== null || businessSlug(r.business_name) === firmSlug;
  const bills = (page.data?.results ?? []).filter(named);
  const title = `Bill ${number}`;
  // Try again asks through the client (Ruling 1B-11)
  const again = (queryKey: QueryKey) => () => { void qc.refetchQueries({ queryKey }); };
  const pageKey = salesKeys.page(firmId ?? "all", query, 20);
  const inKey = inwardKey(number, linkFirm, fy);
  if (!page.data) return <Asking title={title} q={page} retry={again(pageKey)} />;
  const firm = firms.find((f) => f.id === linkFirm)?.name;
  const sales = bills.map((b): Choice => ({ kind: "Sale", to: `/sales/${b.id}`, number: b.invoice_number, total: b.total_amount,
    line: `${b.business_name} · ${date(b.invoice_date)} · ${b.customer.name}${cancelledMark(b.status)}` }));
  // a refresh that failed keeps what was shown, and says so (part 0's rule, as BillPage's)
  const stale = (q: { isError: boolean; error: unknown; isFetching: boolean }, key: QueryKey) => (q.isError
    ? <StaleNote problem={problemOf(q.error)} what="the bills with this number" retry={again(key)} busy={q.isFetching} /> : null);
  // the purchases can't be known (their lookup failed, or over 1000 have numbers like it): the one sale with the number
  // opens, several are offered with a line saying the purchases aren't among them, and with none the page says it
  // couldn't tell (Rulings 1B-20, 1B-22). A failed lookup asked again (Try again, or a later visit while the failure is
  // still kept) is pending once more, error gone (TanStack's way with a failed query that has nothing loaded), so only
  // its failures counted say it failed before: several sales stay on offer through it, but the one sale waits for the
  // answer, since a purchase found then is offered beside it
  const tooMany = inward.data?.tooMany === true;
  const failed = !inward.data && inward.isError;
  const failedBefore = !inward.data && inward.errorUpdateCount > 0;
  if (sales.length === 1 && (tooMany || failed)) return <Navigate to={sales[0].to} replace />;
  if (sales.length > 1 && (tooMany || failedBefore)) {
    return <PickBill number={number} choices={sales} note={<>{stale(page, pageKey)}<Unchecked failed={!inward.data} retry={again(inKey)} busy={inward.isFetching} number={number} firm={firm} fy={fy} /></>} />;
  }
  if (!inward.data) return <Asking title={title} q={inward} retry={again(inKey)} />;
  if (inward.data.tooMany) return <TooMany number={number} firm={firm} fy={fy} />;
  // the link's firm and year, which v2 matched on its side (its list filters by a firm's id and dates only)
  const purchases = inward.data.rows.filter((r) => named(r) && (!fy || (r.invoice_date !== "" && fyOf(r.invoice_date) === fy)));
  const choices: Choice[] = [
    ...sales,
    ...purchases.map((p): Choice => ({ kind: "Purchase", to: `/purchases/${p.id}`, number: p.invoice_number, total: p.total, line: `${p.business_name} · ${date(p.invoice_date)} · ${p.customer_name}` })),
  ];
  // one bill of either kind opens; several are offered
  if (choices.length === 1) return <Navigate to={choices[0].to} replace />;
  const note = stale(page, pageKey) ?? stale(inward, inKey);
  if (choices.length > 1) return <PickBill number={number} choices={choices} note={note} />;
  return (
    <Page icon={ReceiptText} title={title} breadcrumbs={[{ label: "Sales", to: "/sales" }]} back="/sales">
      {note}
      <Card><EmptyState icon={ReceiptText} title="No bill has this number" actions={<FindIt number={number} />}>
        No sales bill{firm ? ` of ${firm}` : ""} has the number “{number}”{fy ? ` in FY ${fy}` : ""}. It may have been renumbered or deleted; search for it, or look in the Audit log.
      </EmptyState></Card>
    </Page>
  );
}

function FindIt({ number }: { number: string }) {
  return (
    <>
      <ButtonLink to={`/sales?q=${encodeURIComponent(number)}&month=years`} variant="primary">Search every year</ButtonLink>
      <ButtonLink to="/sales">Go to Sales</ButtonLink>
    </>
  );
}

/** Over 1000 purchases have the number somewhere in theirs: more than v2 gives at once, so this page can't say there's none (Ruling 1B-19). */
function TooMany({ number, firm, fy }: { number: string; firm?: string; fy: string }) {
  return (
    <Page icon={ReceiptText} title={`Bill ${number}`} breadcrumbs={[{ label: "Sales", to: "/sales" }]} back="/sales">
      <Card><EmptyState icon={ReceiptText} title="Too many bills to check" actions={<FindIt number={number} />}>
        Over 1,000 purchases{firm ? ` of ${firm}` : ""}{fy ? ` in FY ${fy}` : ""} have numbers like “{number}”, too many to check here, so this page can&apos;t tell which bill the link means. Search for it, or look in the Audit log.
      </EmptyState></Card>
    </Page>
  );
}

/** Several sales have the number and the purchases with it can't be known: why they aren't in the list (Ruling 1B-22). */
function Unchecked({ failed, retry, busy, number, firm, fy }: { failed: boolean; retry: () => void; busy: boolean; number: string; firm?: string; fy: string }) {
  return failed
    ? <Banner tone="neg" title="The app couldn't check purchases just now, so this list has only the sales with this number." actions={<Button size="sm" loading={busy} onClick={retry}>Try again</Button>} />
    : <Banner tone="muted" title={`Over 1,000 purchases${firm ? ` of ${firm}` : ""}${fy ? ` in FY ${fy}` : ""} have numbers like “${number}”, too many to check here, so this list has only the sales with this number.`} />;
}

type Choice = { kind: "Sale" | "Purchase"; to: string; number: string; line: string; total: number | null };
/** Several bills share the number (another firm, another year, a sale and a purchase, several suppliers'): pick one, as v2 did. */
function PickBill({ number, choices, note }: { number: string; choices: Choice[]; note: ReactNode }) {
  const sales = choices.filter((c) => c.kind === "Sale").length;
  // each row says what it is when the list has both kinds (v2's picker had OUTWARD and INWARD)
  const mixed = sales > 0 && sales < choices.length;
  const [title, subtitle, label] = sales === 0
    ? [`${choices.length} purchases have this number`, "No sales bill has it. Pick the purchase you want: each supplier numbers its own bills.", "Purchases with this number"]
    : [`${choices.length} bills have this number`, mixed ? "Pick the one you want: sales and purchases can share a number." : "Pick the one you want: each firm has its own series, every year.", "Bills with this number"];
  return (
    <Page icon={ReceiptText} title={`Bill ${number}`} breadcrumbs={[{ label: "Sales", to: "/sales" }]} back="/sales">
      {note}
      <Card title={title} subtitle={subtitle} pad={false}>
        <ul className="mt-1" aria-label={label}>
          {choices.map((c) => (
            <li key={c.to}>
              <ListRow to={c.to} title={<><span className="tnum">{c.number}</span>{mixed ? <> <Badge tone={c.kind === "Sale" ? "sale" : "muted"}>{c.kind}</Badge></> : null}</>}
                subtitle={c.line} right={inr(c.total)} />
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
