// Bills from the paper book (PROTO pages/sales/PaperBook.jsx): the shop writes its bills in the paper bill book and types
// them in later, last month's during this month. For a firm and a month the page says which numbers are in the app,
// explains the missing ones (cancelled, deleted), names the ones not entered yet, says where the month's GSTR-1 stands,
// and opens the bill form on the next number. A run then goes by keyboard: Save, then the saved bill's Next paper bill.
// The book is the server's (contract §2.13), read as it comes, and asked for once per firm and month picked: it's the
// heaviest read in Selling, on Neon's free plan.
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, BookOpenText, CheckCircle2, FileText, Info, Lock } from "lucide-react";
import { salesKeys, usePaperBook } from "@/core/api/sales";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { addMonths, date, dateShort, monthLabel, monthOf, plural, possessive, todayIST } from "@/core/format";
import { takeFresh } from "@/core/sales/fresh";
import type { PaperBook, PaperBookBill } from "@/core/sales/types";
import { useFirms, useScope, type Firm } from "@/core/scope";
import { Banner, Button, ButtonLink, Card, EmptyState, Field, Money, Page, QueryView, Select, Skeleton, Table, Td, Th, Tr } from "@/core/ui";
import { useView } from "@/core/view";
import { idParam } from "../form/model";
import { lastPaperDate } from "../form/paperDates";
import { afterText, dueTone, dueWords, explainedText, missingText, paperLink, paperMonths, runsText } from "./book";

const TITLE = "Bills from the paper book";

/**
 * /sales/paper?firm=&month=: the firm and month come from the address, which follows what's picked (Back and a shared link
 * come back here). The app's routes load it on demand (plan 1E's lazyPage), so it's this module's default.
 */
export default function PaperBookPage() {
  const { firms, loading, error } = useFirms();
  const { firmId: scope, ready } = useScope();
  const [params, setParams] = useSearchParams();
  const today = todayIST();
  const months = paperMonths(today);
  const known = (id: number | null): id is number => id !== null && firms.some((f) => f.id === id);
  const asked = idParam(params.get("firm"));
  const firmId = known(asked) ? asked : typeof scope === "number" && known(scope) ? scope : firms[0]?.id ?? null;
  const askedMonth = params.get("month") ?? "";
  const month = months.includes(askedMonth) ? askedMonth : addMonths(monthOf(today), -1);
  useEffect(() => {
    if (firmId !== null && (String(firmId) !== params.get("firm") || month !== params.get("month"))) setParams({ firm: String(firmId), month }, { replace: true });
  }, [firmId, month, params, setParams]);
  if (loading || !ready) return <BookLoading />;
  if (firmId === null) {
    return (
      <Page icon={BookOpenText} title={TITLE} breadcrumbs={[{ label: "Sales", to: "/sales" }]} back="/sales">
        <Card><EmptyState icon={BookOpenText} title={error ? "The firms couldn't load" : "No firm yet"}>
          {error ? "Each firm has its own bill book, so the page waits for the list of firms. Try again when the internet is back." : "Each firm has its own bill book. The owner adds firms in Records."}
        </EmptyState></Card>
      </Page>
    );
  }
  const pick = (next: { firm?: number; month?: string }) => setParams({ firm: String(next.firm ?? firmId), month: next.month ?? month }, { replace: true });
  return <PaperBookScreen firms={firms} firmId={firmId} month={month} months={months} today={today} onPick={pick} />;
}

function BookLoading() {
  return (
    <Page icon={BookOpenText} title={TITLE} breadcrumbs={[{ label: "Sales", to: "/sales" }]}>
      <div className="card p-5 flex flex-col gap-3 max-w-[880px]" role="status" aria-label="Loading the month's bills">
        <Skeleton w={220} h={18} /><Skeleton h={14} /><Skeleton w="70%" h={14} /><Skeleton w={160} h={44} />
      </div>
    </Page>
  );
}

type ScreenProps = { firms: Firm[]; firmId: number; month: string; months: string[]; today: string; onPick: (p: { firm?: number; month?: string }) => void };

/** The firm and month pickers stay on screen while the month loads, or if it fails, so another can be picked. */
function PaperBookScreen({ firms, firmId, month: ym, months, today, onPick }: ScreenProps) {
  const { isPhone } = useView();
  const { can, whyNot } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const book = usePaperBook(firmId, ym);
  // Try again asks again through the client, as every page's does (Ruling 1B-11): the kit's QueryView calls this refetch
  const view: typeof book = { ...book, refetch: () => qc.refetchQueries({ queryKey: salesKeys.paperBook(firmId, ym) }).then(() => book) };
  const pb = book.data;
  const firm = firms.find((f) => f.id === firmId) as Firm;
  const month = monthLabel(ym, { long: true, year: false });
  const cur = ym === monthOf(today);
  const last = addMonths(monthOf(today), -1);
  // the date it most likely has: this session's last paper bill in the month, else the server's (the bill before it)
  const remembered = lastPaperDate(firmId);
  const nextDate = pb ? (remembered.startsWith(ym) ? remembered : pb.next.invoice_date) : "";
  const blocked = pb?.locked ? `${monthLabel(ym, { long: true })} is filed for ${firm.name}, so no bill can be added until the owner unlocks it in GST returns.`
    : !can("bill.create") ? whyNot("bill.create") : "";
  const enterButton = pb ? (
    <Button variant="primary" size="lg" icon={ArrowRight} full={isPhone} disabled={Boolean(blocked)} title={blocked || undefined}
      onClick={() => navigate(paperLink(firmId, nextDate, pb.next.counter))}>
      {`Enter bill ${pb.next.counter}`}
    </Button>
  ) : null;
  const pickers = (
    <div className={cn("grid gap-4", isPhone ? "grid-cols-1" : "grid-cols-2 max-w-[560px]")}>
      <Field label="Firm" htmlFor="pb-firm" hint="Each firm has its own bill book and number series">
        <Select id="pb-firm" value={String(firmId)} onChange={(e) => onPick({ firm: Number(e.target.value) })} options={firms.map((f) => ({ value: String(f.id), label: f.name }))} />
      </Field>
      <Field label="Month" htmlFor="pb-month" hint={cur ? "This month: its bills are still being made" : "Usually last month, whose bills are being typed in"}>
        <Select id="pb-month" value={ym} onChange={(e) => onPick({ month: e.target.value })}
          options={months.map((m) => ({ value: m, label: `${monthLabel(m, { long: true })}${m === last ? " · last month" : m === monthOf(today) ? " · this month" : ""}` }))} />
      </Field>
    </div>
  );
  const loading = (
    <div className="flex flex-col gap-3 border-t border-rule pt-4" role="status" aria-label="Loading the month's bills">
      <Skeleton w={220} h={18} /><Skeleton h={14} /><Skeleton w="70%" h={14} /><Skeleton w={160} h={44} />
    </div>
  );
  return (
    <Page icon={BookOpenText} title={TITLE} breadcrumbs={[{ label: "Sales", to: "/sales" }]}
      context={`Type in ${cur ? "this month's" : `${month}'s`} bills from the paper bill book, with their own numbers and dates`}
      phoneTitle="Paper book" phoneSubtitle={`${firm.short} · ${monthLabel(ym, { long: true })}`} back
      actionBar={isPhone ? enterButton : null}>
      <div className={cn("flex flex-col gap-5", isPhone ? "" : "max-w-[880px]")}>
        <Card>
          <div className="flex flex-col gap-5">
            {pickers}
            <QueryView query={view} what="the month's bills" skeleton={loading}>
              {(data) => <BookFacts pb={data} firm={firm} ym={ym} today={today} />}
            </QueryView>
            {pb && !isPhone ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {enterButton}
                <p className="text-sm text-muted">{blocked || `Opens the bill with ${pb.next.invoice_number} and ${date(nextDate)} filled in. After each save, Next paper bill keeps the firm and date.`}</p>
              </div>
            ) : null}
          </div>
        </Card>
        {pb && isPhone && blocked ? <p className="text-sm text-muted">{blocked}</p> : null}
        {pb ? <BookBills pb={pb} firm={firm} ym={ym} /> : null}
      </div>
    </Page>
  );
}

/** What the month holds: how many bills and which numbers, why some are missing, what's not entered yet, and GSTR-1. */
function BookFacts({ pb, firm, ym, today }: { pb: PaperBook; firm: Firm; ym: string; today: string }) {
  const month = monthLabel(ym, { long: true, year: false });
  const cur = ym === monthOf(today);
  // bills whose numbers are all outside the span (odd shapes, Ruling 1A-29) have no runs: the count says it alone
  const summary = pb.entered ? `${plural(pb.entered, "bill")} entered${pb.runs.length ? ` · numbers ${runsText(pb.runs)}` : ""}` : `No bill entered yet for ${month}`;
  const after = afterText(pb.after, pb.after_months, pb.next.counter);
  const tone = dueTone(pb.gstr1_due, today);
  return (
    <>
      <div className="flex flex-col gap-3 border-t border-rule pt-4">
        <p className="text-lg font-semibold tnum">{summary}</p>
        <ul className="flex flex-col gap-2" aria-label={`What's in ${month}`}>
          {pb.explained.map((x) => {
            const t = explainedText(x);
            // keyed by its own bill or bin row: two can share a kind and a number
            return (
              <li key={x.kind === "deleted" ? `bin-${x.bin_id}` : `bill-${x.id}`} className="flex items-start gap-2 text-sm text-fg2">
                <Info size={16} className="text-muted shrink-0 mt-0.5" aria-hidden="true" />
                <span>{x.kind === "cancelled" ? <Link to={`/sales/${x.id}`} className="link tnum">{t.number}</Link> : <span className="tnum">{t.number}</span>}: {t.why}</span>
              </li>
            );
          })}
          {pb.twice.map((n) => {
            // each of the bills, by its own link: the Sales list's dups=1 matches whole numbers across the year, the book
            // number parts in the month, so it could show neither
            const on = pb.bills.filter((b) => b.counter === n);
            return (
              <li key={`twice-${n}`} className="flex items-start gap-2 text-sm text-neg">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
                <span className="flex flex-col items-start gap-1">
                  <span><span className="tnum">{n}</span> is on {on.length > 2 ? on.length : "two"} bills: give one a new number before filing.</span>
                  <span className="flex flex-wrap gap-x-4 -ml-1">
                    {on.map((b) => <ButtonLink key={b.id} size="sm" variant="link" to={`/sales/${b.id}`}>{`${b.invoice_number} · ${b.customer_name}`}</ButtonLink>)}
                  </span>
                </span>
              </li>
            );
          })}
          {pb.missing.length ? (
            <li className="flex items-start gap-2 text-sm text-brand">
              <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
              <span>Not entered yet: <span className="tnum">{missingText(pb.missing, pb.missing_count)}</span></span>
            </li>
          ) : pb.entered ? (
            <li className="flex items-start gap-2 text-sm text-fg2">
              <CheckCircle2 size={16} className="text-sale shrink-0 mt-0.5" aria-hidden="true" />
              <span>{pb.explained.length ? "Every other number in between is entered." : "No number in between is missing."}</span>
            </li>
          ) : null}
          {after ? (
            <li className="flex items-start gap-2 text-sm text-fg2">
              <Info size={16} className="text-muted shrink-0 mt-0.5" aria-hidden="true" />
              <span>{after} Type the number written on the paper bill if it&apos;s different.</span>
            </li>
          ) : null}
        </ul>
      </div>
      {pb.locked ? (
        <Banner tone="file" icon={Lock} title={`${month}'s GSTR-1 is filed`}>
          {possessive(firm.name)} {month} is filed and locked: bills can&apos;t be added until the owner unlocks the month in GST returns. A bill found later goes into next month&apos;s return as an amendment; ask your CA.
        </Banner>
      ) : (
        <p className={cn("text-sm flex items-start gap-2", tone === "neg" ? "text-neg" : "text-fg2")}>
          <span aria-hidden="true" className={cn("mt-1.5 w-2 h-2 rounded-full shrink-0", tone === "neg" ? "bg-neg" : tone === "brand" ? "bg-brand" : "bg-muted")} />
          {`${month}'s GSTR-1 is due ${dueWords(pb.gstr1_due, today)}${cur ? "" : ": enter the rest before filing"}.`}
        </p>
      )}
    </>
  );
}

/** The month's bills in number order, as in the bill book; bills just saved flash once. */
function BookBills({ pb, firm, ym }: { pb: PaperBook; firm: Firm; ym: string }) {
  const { isPhone } = useView();
  const month = monthLabel(ym, { long: true, year: false });
  const [fresh, setFresh] = useState<Set<number>>(() => new Set());
  const ids = pb.bills.map((b) => b.id).join(",");
  useEffect(() => { const got = takeFresh(ids ? ids.split(",").map(Number) : []); if (got.size) setFresh(got); }, [ids]);
  return (
    <Card title={`${month}'s bills · ${firm.short}`} subtitle={pb.bills.length ? "In number order, as in the bill book" : undefined} pad={false}>
      {!pb.bills.length ? (
        <div className="px-5 pb-5"><EmptyState icon={BookOpenText} title={`No ${month} bills for ${firm.name} yet`}>The first paper bill you type in shows here.</EmptyState></div>
      ) : isPhone ? (
        <ul className="flex flex-col mt-2" aria-label={`${month}'s bills`}>
          {pb.bills.map((b) => (
            <li key={b.id} className={cn("border-t border-rule first:border-t-0 flex items-center gap-3 px-4 py-3", fresh.has(b.id) && "anim-flash")}>
              <Link to={`/sales/${b.id}`} className="flex-1 min-w-0 min-h-11 flex flex-col justify-center no-underline">
                <span className="block font-medium tnum">{b.invoice_number}</span>
                <span className="block text-sm text-muted">{dateShort(b.invoice_date)} · {b.customer_name}</span>
              </Link>
              <span className="flex flex-col items-end gap-0.5 shrink-0">
                <Money value={b.total_amount} strong className={b.status === "cancelled" ? "line-through text-muted" : ""} />
                <BillState b={b} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-2">
          <Table label={`${month}'s bills for ${firm.name}, in number order`}>
            <thead><tr><Th>No.</Th><Th>Date</Th><Th>Customer</Th><Th align="right">Total</Th><Th align="right">State</Th></tr></thead>
            <tbody>
              {pb.bills.map((b) => (
                <Tr key={b.id} className={fresh.has(b.id) ? "anim-flash" : ""}>
                  <Td className="whitespace-nowrap"><Link to={`/sales/${b.id}`} className={cn("font-medium tnum hover:underline", b.status === "cancelled" ? "text-muted" : "text-brand")}>{b.invoice_number}</Link></Td>
                  <Td className="whitespace-nowrap tnum text-fg2">{dateShort(b.invoice_date)}</Td>
                  <Td>{b.customer_name}</Td>
                  <Td align="right"><Money value={b.total_amount} className={b.status === "cancelled" ? "line-through text-muted" : ""} /></Td>
                  <Td align="right"><BillState b={b} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  );
}

/** Cancelled, On paper, Sent or Not sent: said in words, never a button that nags (the customer has the paper bill). */
function BillState({ b }: { b: PaperBookBill }) {
  if (b.status === "cancelled") return <span className="text-sm text-neg">Cancelled</span>;
  if (b.paper && !b.sent) return <span className="inline-flex items-center gap-1 text-sm text-muted" title="Entered from the paper bill book: the customer has the paper bill"><FileText size={15} aria-hidden="true" />On paper</span>;
  if (b.sent) return <span className="text-sm text-sale font-medium">Sent</span>;
  return <span className="text-sm text-muted">Not sent</span>;
}
