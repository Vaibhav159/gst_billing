// A customer's bills for a chosen period, as a register (PROTO pages/records/CustomerStatement.jsx). Cash and UPI bills
// were paid at billing; udhaar bills say so, because the app doesn't record payments received. The figures are the
// server's (customers/{id}/statement/); the PDF is made in the browser, once the period has bills and the firm its name.
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { Calendar, Download, FileText, Info, MoreVertical, NotebookPen, Printer, Share2, UserRound } from "lucide-react";
import { useStatement, type Customer, type PaidAs, type StatementBill, type StatementParams } from "@/core/api/customers";
import { cn } from "@/core/cn";
import { addMonths, date, dateShort, inr, lastDayOfMonth, mobileText, monthLabel, monthOf, plural, rangeLabel, todayIST } from "@/core/format";
import { formatMobile, mobileDigits, stateTitle } from "@/core/ids";
import { PAY, PAY_SHORT } from "@/core/sales/words";
import { useFirms, useScope } from "@/core/scope";
import {
  Badge, Banner, Button, Card, EmptyState, Field, Figure, IconButton, Input, ListSkeleton, Menu, Money, Page, QueryView, Segmented, Table, Td, Th, Tr, useToast, type BadgeTone,
} from "@/core/ui";
import { useView } from "@/core/view";
import { downloadFile, fyPeriod, notCounted, scopeName, SETTLED, useRouteCustomer } from "./lib";
import { MissingRecord } from "./parts";
import { printPdf, sharePdf, statementFileName, useStatementPdf } from "./statementFiles";

type Which = "fy" | "month" | "last" | "custom";
type Span = { from: string; to: string; label: string; short: string; range: string };

/** The FY picked in the top bar (so far), this month and last month (PROTO records/data.js statementPeriods). */
function periods(fy: string, today: string): Record<Exclude<Which, "custom">, Span> {
  const f = fyPeriod(fy, today);
  const ym = monthOf(today);
  const prev = addMonths(ym, -1);
  return {
    fy: { from: f.from, to: f.to, label: f.label, short: f.label, range: f.range },
    month: { from: `${ym}-01`, to: today, label: monthLabel(ym, { long: true }), short: monthLabel(ym, { year: false }), range: rangeLabel(`${ym}-01`, today) },
    last: { from: `${prev}-01`, to: lastDayOfMonth(prev), label: monthLabel(prev, { long: true }), short: monthLabel(prev, { year: false }), range: rangeLabel(`${prev}-01`, lastDayOfMonth(prev)) },
  };
}

const TONE: Record<PaidAs, BadgeTone> = { billing: "sale", udhaar: "muted", not_recorded: "muted", cancelled: "neg" };
/** How a bill was settled, in the words the PDF uses too. */
function Settled({ b }: { b: StatementBill }) {
  return <Badge tone={TONE[b.paid]} icon={b.paid === "udhaar" ? NotebookPen : undefined}>{SETTLED[b.paid]}</Badge>;
}

export default function CustomerStatement() {
  // an address that names no customer on file (/customers/c-anil/statement, or the server's 404) gets the missing-record page
  const { one, missing } = useRouteCustomer();
  if (missing) return <MissingRecord icon={UserRound} title="This customer isn't on file" to="/customers" label="All customers" />;
  if (!one.data) return <Page title="Statement" back="/customers"><QueryView query={one} what="this customer" skeleton={<ListSkeleton rows={5} what="the statement" />}>{() => null}</QueryView></Page>;
  // keyed by the customer: another customer's statement starts with its own period
  return <Statement key={one.data.id} c={one.data} />;
}

function Statement({ c }: { c: Customer }) {
  const { firmId, fy } = useScope();
  const { firms, error: firmsFailed } = useFirms();
  const { isPhone } = useView();
  const { show } = useToast();
  const today = todayIST();
  const P = periods(fy, today);
  const [which, setWhich] = useState<Which>("fy");
  const [from, setFrom] = useState(P.fy.from);
  const [to, setTo] = useState(today);
  const badRange = which === "custom" && (!from || !to || from > to);
  const span = which === "custom" ? { from, to, label: badRange ? "Dates to fix" : rangeLabel(from, to), range: badRange ? "" : rangeLabel(from, to) } : P[which];
  // the bills wait for the firm's name (a firm picked on this device is known before the list of firms comes), or for
  // that list to fail, so nothing names the firm before its name is known
  const named = typeof firmId !== "number" || firms.some((f) => f.id === firmId);
  const worded = firmId !== null && (named || firmsFailed);
  const params: StatementParams | null = !worded || badRange ? null : { start_date: span.from, end_date: span.to, ...(typeof firmId === "number" ? { business_id: firmId } : {}) };
  const st = useStatement(c.id, params);
  const scope = worded ? scopeName(firms, firmId) : "";
  const file = statementFileName(c.name, span.label, which === "custom" ? { from, to } : undefined);
  const bills = badRange ? [] : st.data?.bills ?? [];
  const t = st.data?.totals;
  // the PDF of a period with bills, made once (useMemo keeps it the same object until the statement or its words change);
  // never one that would name "the firm picked"
  const data = useMemo(() => (st.data?.bills.length && !badRange && named ? {
    customer: { name: c.name, mobile: mobileText(c.mobile_number), gstin: c.gst_number, pan: c.pan, address: [c.address, c.city, stateTitle(c.state_name)].filter(Boolean).join(", ") },
    periodLabel: span.label, periodRange: span.range, scope, made: date(today), statement: st.data,
  } : null), [st.data, badRange, named, c, span.label, span.range, scope, today]);
  const pdf = useStatementPdf(data);
  // making the PDF: Share spins until it's ready (a PDF that couldn't be made says so in the buttons' titles instead)
  const making = data !== null && !pdf.blob && !pdf.failed;
  const off = !pdf.blob;
  // why Print, Download and Share are off: their titles, and the phone menu's hints
  const why = badRange ? "Fix the dates first"
    : !st.data ? (st.isError ? "The bills didn't load. Use Try again." : "Waits for the bills to load")
      : !bills.length ? "No bills in this period"
        : !named ? "The firms didn't load. Reload the page to make the PDF."
          : pdf.failed ? "The PDF couldn't be made. Reload the page and try again."
            : making ? "Making the PDF…" : undefined;

  const onPrint = () => {
    if (!pdf.blob) return;
    if (!printPdf(pdf.blob)) show({ tone: "brand", title: "The PDF didn't open", body: "The browser stopped the new tab. Allow pop-ups for this app to print from it, or use Download PDF." });
  };
  const onDownload = () => {
    if (!pdf.blob) return;
    downloadFile(pdf.blob, file);
    show({ title: `Downloaded ${file}`, body: `${plural(bills.length, "bill")} · ${span.label} · ${scope}.` });
  };
  const onShare = async () => {
    if (!pdf.blob) return;
    const r = await sharePdf(pdf.blob, file, `Statement · ${c.name}`);
    if (r !== "unsupported") return;
    // no share sheet for files here (most computers): download it, and open WhatsApp's chat with the customer to attach it
    downloadFile(pdf.blob, file);
    const digits = mobileDigits(c.mobile_number);
    const chat = /^[6-9]\d{9}$/.test(digits) ? window.open(`https://wa.me/91${digits}`, "_blank") : null;
    if (chat) chat.opener = null;
    show({ title: `Downloaded ${file}`, body: chat ? `WhatsApp opens a chat with ${c.name} (+91 ${formatMobile(digits)}). Attach the PDF there.` : "Attach it in WhatsApp, or wherever you send it." });
  };
  const periodOptions = [
    { value: "fy" as const, label: isPhone ? "This FY" : P.fy.label },
    { value: "month" as const, label: isPhone ? P.month.short : P.month.label },
    { value: "last" as const, label: isPhone ? P.last.short : P.last.label },
    { value: "custom" as const, label: isPhone ? "Dates" : "Choose dates" },
  ];

  const chooser = (
    <div className="flex flex-col gap-3">
      <Segmented label="Period" options={periodOptions} value={which} onChange={setWhich} full={isPhone} className={isPhone ? "" : "self-start"} />
      {which === "custom" ? (
        <div className={cn("grid gap-3 anim-rise", isPhone ? "grid-cols-2" : "grid-cols-[200px_200px]")}>
          <Field label="From" htmlFor="st-from" error={badRange && from && to ? "The start date is after the end date." : !from ? "Pick a start date." : ""}>
            <Input id="st-from" type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To" htmlFor="st-to" error={!to ? "Pick an end date." : ""}>
            <Input id="st-to" type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      ) : <p className="text-sm text-muted">{[span.range, scope].filter(Boolean).join(" · ")}</p>}
    </div>
  );

  const figures = t ? (
    <div className={cn("grid", isPhone ? "grid-cols-2 gap-x-4 gap-y-5" : "grid-cols-3 divide-x divide-rule -mx-5")}>
      <Figure className={isPhone ? "col-span-2" : "px-5"} label={isPhone ? "Billed" : `Billed · ${span.label}`} value={<Money value={t.billed} size="2xl" tone="sale" bump />} caption={`${plural(t.bills, "bill")}${notCounted(t.cancelled)}`} />
      <Figure className={isPhone ? "" : "px-5"} label={isPhone ? "Paid at billing" : `Paid at billing · ${span.label}`} value={<Money value={t.paid_at_billing.total} size={isPhone ? "lg" : "2xl"} bump />} caption={`${plural(t.paid_at_billing.bills, "bill")} · cash, UPI or both`} />
      <Figure className={isPhone ? "" : "px-5"} label={isPhone ? "On udhaar" : `On udhaar · ${span.label}`} value={<Money value={t.udhaar.total} size={isPhone ? "lg" : "2xl"} bump />} caption={`${plural(t.udhaar.bills, "bill")} · payment not recorded in the app`} />
      {t.not_recorded.bills ? <p className={cn("text-sm text-muted", isPhone ? "col-span-2" : "col-span-3 px-5 pt-4")}>{plural(t.not_recorded.bills, "bill")} ({inr(t.not_recorded.total)}) came in from Tally without a payment mode, so {t.not_recorded.bills === 1 ? "it isn't" : "they aren't"} counted as paid or on udhaar.</p> : null}
    </div>
  ) : null;

  const note = (
    <Banner tone="muted" icon={Info} title="A register of bills, not a ledger">
      Cash and UPI bills were paid when they were made. Udhaar bills are listed as billed on credit: the app doesn't record payments received, so it can't say what is still owed and shows no balance.
    </Banner>
  );
  const empty = (
    <EmptyState icon={Calendar} title={badRange ? "Fix the dates to see bills" : `No bills to ${c.name} in ${span.label}`}>
      {badRange ? "The start date has to be on or before the end date." : "Try a longer period, like this FY."}
    </EmptyState>
  );
  // nothing to wait for while the dates are wrong; otherwise the statement's loading, slow, offline and failed states
  const body = (rows: number, children: ReactNode) => (badRange ? children : <QueryView query={st} what="the statement" skeleton={<ListSkeleton rows={rows} what="the statement" />}>{() => children}</QueryView>);

  if (isPhone) {
    return (
      <Page title="Statement" back={`/customers/${c.id}`} phoneSubtitle={[c.name, scope].filter(Boolean).join(" · ")}
        phoneActions={<Menu title="Statement" items={[
          { label: "Print", icon: Printer, hint: why ?? "On A4, with the totals at the end", disabled: off, onSelect: onPrint },
          { label: "Download the PDF", icon: Download, hint: why ?? file, disabled: off, onSelect: onDownload },
        ]} trigger={(p) => <IconButton {...p} label="Print or download the statement" icon={MoreVertical} />} />}
        actionBar={<Button variant="primary" size="lg" icon={Share2} onClick={() => void onShare()} disabled={off} loading={making} title={why}>Share PDF</Button>}>
        {chooser}
        {body(5, <>
          {figures ? <Card title={span.label} subtitle={`${which === "custom" ? "" : `${span.range} · `}${scope}`}>{figures}</Card> : null}
          {note}
          <Card title={`Bills · ${span.label}`} subtitle="Oldest first" pad={false}>
            {bills.length ? (
              <ul className="mt-2">
                {bills.map((b) => (
                  <li key={b.id} className="border-t border-rule">
                    <Link to={`/sales/${b.id}`} className="flex flex-col gap-1.5 px-4 py-3 min-h-16 hover:bg-raised/60">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="font-medium tnum break-all">{b.invoice_number}</span>
                        <Money value={b.total_amount} className={cn("font-medium", b.status === "cancelled" && "line-through text-muted")} />
                      </span>
                      <span className="text-sm text-muted">{dateShort(b.invoice_date)} · {firms.find((f) => f.id === b.business)?.short ?? b.business_name} · {PAY_SHORT[b.payment_mode] ?? PAY_SHORT[""]}</span>
                      <span><Settled b={b} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : empty}
          </Card>
        </>)}
      </Page>
    );
  }

  return (
    <Page icon={FileText} breadcrumbs={[{ label: "Customers", to: "/customers" }, { label: c.name, to: `/customers/${c.id}` }]} title="Statement" back={`/customers/${c.id}`}
      context={[c.name, mobileText(c.mobile_number), "bills register", scope].filter(Boolean).join(" · ")}
      actions={<>
        <Button icon={Printer} onClick={onPrint} disabled={off} title={why}>Print</Button>
        <Button icon={Download} onClick={onDownload} disabled={off} title={why}>Download PDF</Button>
        <Button variant="primary" icon={Share2} onClick={() => void onShare()} disabled={off} loading={making} title={why}>Share PDF</Button>
      </>}>
      <Card>
        <div className="flex flex-col gap-5">
          {chooser}
          {figures && !badRange ? <div className="border-t border-rule pt-5">{figures}</div> : null}
        </div>
      </Card>
      {note}
      {body(6, (
        <Card title={`Bills · ${span.label}`} subtitle={[plural(bills.length, "bill"), "oldest first", scope].filter(Boolean).join(" · ")} pad={false}>
          {bills.length && t ? (
            <Table label={`Bills to ${c.name}, ${span.label}`} className="mt-2">
              <thead><tr><Th>Date</Th><Th>Bill no.</Th><Th>Firm</Th><Th>Payment mode</Th><Th align="right">Amount</Th><Th>Payment</Th></tr></thead>
              <tbody>
                {bills.map((b) => (
                  <Tr key={b.id}>
                    <Td className="tnum whitespace-nowrap">{date(b.invoice_date)}</Td>
                    <Td><Link to={`/sales/${b.id}`} className="font-medium text-brand hover:underline tnum">{b.invoice_number}</Link></Td>
                    <Td className="text-fg2">{b.business_name}</Td>
                    <Td className={b.payment_mode === "" ? "text-muted" : "text-fg2"}>{PAY[b.payment_mode] ?? PAY[""]}</Td>
                    <Td align="right" className={cn(b.status === "cancelled" && "line-through text-muted")}><Money value={b.total_amount} strong={b.status !== "cancelled"} /></Td>
                    <Td><Settled b={b} /></Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line">
                  <Td colSpan={4} className="font-semibold">Billed · {plural(t.bills, "bill")}</Td>
                  <Td align="right"><Money value={t.billed} strong tone="sale" /></Td>
                  <Td className="text-sm text-muted">{inr(t.paid_at_billing.total)} paid at billing · {inr(t.udhaar.total)} on udhaar{t.not_recorded.bills ? ` · ${inr(t.not_recorded.total)} not recorded` : ""}</Td>
                </tr>
              </tfoot>
            </Table>
          ) : empty}
        </Card>
      ))}
    </Page>
  );
}
