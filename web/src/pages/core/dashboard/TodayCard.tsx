import { Printer } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { cn } from "@/core/cn";
import type { DashboardData } from "@/core/dashboard/types";
import { date, dateShort, inr, plural } from "@/core/format";
import { shortName, useFirms } from "@/core/scope";
import { PAY, PAY_SHORT, timeOf } from "@/core/sales/words";
import { ButtonLink, Card, Money, Table, Td, Th, Tr } from "@/core/ui";
import { SendCell } from "@/pages/sales/actions/SendCell";

/** Billed, not received: totals and payment splits cover every bill, including rows beyond the server's cap. */
function PaySplit({ data, className }: { data: DashboardData; className?: string }) {
  if (!data.today.by_payment.length) return null;
  return <p className={cn("text-sm text-fg2 tnum", className)}>
    <span className="text-muted">Billed today: </span>
    {data.today.by_payment.map((x, i) => <span key={x.mode}>{i ? " · " : ""}{PAY_SHORT[x.mode]} <Money value={x.total} /></span>)}
  </p>;
}

export function TodayCard({ data, scope, allFirms, phone = false }: { data: DashboardData; scope: string; allFirms: boolean; phone?: boolean }) {
  const navigate = useNavigate();
  const { firms } = useFirms();
  const today = data.today;
  const hasToday = today.count > 0;
  const recent = today.recent.slice(0, 5);
  const shown = today.bills.slice(0, 5);
  const firmShort = (id: number, name: string) => firms.find(f => f.id === id)?.short ?? shortName(name);
  if (phone) return <Card pad={false}>
    <div className="dashboard-today-total px-4 pt-4 pb-3 flex items-end justify-between gap-3">
      <div><p className="caps">Sales today</p><Money value={today.total} size="3xl" tone="sale" bump className="block mt-1" /></div>
      <p className="text-sm text-muted text-right pb-1">{plural(today.count, "bill")}<br />incl. GST</p>
    </div>
    <PaySplit data={data} className="px-4 pb-3 -mt-1" />
    {hasToday ? <ul>
      {shown.map(b => <li key={b.id} data-row={b.id} className="dashboard-bill-row flex items-center gap-2 pl-4 pr-2 border-t border-rule min-h-16">
        <Link to={`/sales/${b.id}`} className="flex-1 min-w-0 py-3">
          <span className="block font-medium line-clamp-2">{b.customer.name}</span>
          <span className="block text-sm text-muted tnum">No. {b.counter ?? b.invoice_number} · {timeOf(b.created_at)} · {PAY_SHORT[b.payment_mode]}{allFirms ? ` · ${firmShort(b.business, b.business_name)}` : ""}</span>
        </Link>
        {b.line_count ? <Money value={b.total_amount} className="font-medium text-sale" /> : <span className="text-neg font-medium text-sm">No items</span>}
        {b.line_count ? <SendCell bill={b} compact /> : <ButtonLink to={`/sales/${b.id}`} size="sm" variant="ghost">Fix it</ButtonLink>}
      </li>)}
    </ul> : <>
      <p className="px-4 pb-2 text-sm text-fg2">No bills yet today.{recent.length ? ` The last ${recent.length === 1 ? "bill" : `${recent.length} bills`}:` : ""}</p>
      <ul>{recent.map(b => <li key={b.id} data-row={b.id} className="dashboard-bill-row flex items-center gap-2 pl-4 pr-2 border-t border-rule min-h-16">
        <Link to={`/sales/${b.id}`} className="flex-1 min-w-0 py-3">
          <span className="block font-medium line-clamp-2">{b.customer.name}</span>
          <span className="block text-sm text-muted tnum">No. {b.counter ?? b.invoice_number} · {dateShort(b.invoice_date)}{allFirms ? ` · ${firmShort(b.business, b.business_name)}` : ""}</span>
        </Link>
        {b.line_count ? <Money value={b.total_amount} className="font-medium text-sale" /> : <span className="text-neg font-medium text-sm">No items</span>}
        {b.line_count ? <ButtonLink to={`/sales/${b.id}/print`} size="sm" variant="ghost" icon={Printer} aria-label={`Print ${b.invoice_number}`} className="min-w-11 px-2"><span className="sr-only">Print</span></ButtonLink>
          : <ButtonLink to={`/sales/${b.id}`} size="sm" variant="ghost">Fix it</ButtonLink>}
      </li>)}</ul>
    </>}
    <div className="border-t border-rule px-4"><Link to={hasToday ? "/sales?when=today" : "/sales"} className="link inline-flex items-center min-h-12">
      {today.count > shown.length ? `All ${today.count} bills today · ${inr(today.total)}` : hasToday ? "Today's bills" : "All bills"}
    </Link></div>
  </Card>;
  if (!hasToday) return <Card title="Today's sales" subtitle={`${scope} · ${dateShort(today.date)} · no bills yet`} pad={false}>
    <p className="px-5 pt-1 pb-3 text-fg2">No bills yet today{allFirms ? "" : ` for ${scope}`}.{recent.length ? ` The last ${recent.length === 1 ? "bill" : `${recent.length} bills`}:` : ""}</p>
    {recent.length ? <Table label="The last five sales bills">
      <thead><tr><Th>Date</Th><Th>Bill</Th><Th>Customer</Th><Th>Paid by</Th><Th align="right">Total</Th><Th align="right"><span className="sr-only">Print</span></Th></tr></thead>
      <tbody>{recent.map(b => <Tr key={b.id} onClick={() => navigate(`/sales/${b.id}`)}>
        <Td className="text-fg2 tnum whitespace-nowrap">{b.invoice_date.slice(0, 4) === today.date.slice(0, 4) ? dateShort(b.invoice_date) : date(b.invoice_date)}</Td>
        <Td><Link to={`/sales/${b.id}`} onClick={e => e.stopPropagation()} className="font-medium hover:text-brand tnum whitespace-nowrap">{b.invoice_number}</Link></Td>
        <Td>{b.customer.name}</Td><Td className="text-fg2">{PAY[b.payment_mode]}</Td>
        <Td align="right">{b.line_count ? <Money value={b.total_amount} strong /> : <span className="text-neg font-medium">No items</span>}</Td>
        <Td align="right" onClick={e => e.stopPropagation()}>{b.line_count ? <ButtonLink size="sm" variant="ghost" icon={Printer} to={`/sales/${b.id}/print`} aria-label={`Print ${b.invoice_number}`}>Print</ButtonLink> : <ButtonLink size="sm" variant="ghost" to={`/sales/${b.id}`}>Fix it</ButtonLink>}</Td>
      </Tr>)}</tbody>
    </Table> : null}
    <div className="px-5 py-3 border-t border-rule"><Link to="/sales" className="link">All sales bills</Link></div>
  </Card>;
  return <Card title="Today's sales" subtitle={`${scope} · ${dateShort(today.date)}`} pad={false}
    actions={<span className="text-right"><Money value={today.total} size="xl" tone="sale" bump /><span className="block text-sm text-muted">{plural(today.count, "bill")} · incl. GST</span></span>}>
    <Table label="Today's sales bills" className="mt-2">
      <thead><tr><Th>Time</Th><Th>Bill</Th><Th>Customer</Th><Th>Paid by</Th><Th align="right">Total</Th><Th align="right"><span className="sr-only">Send</span></Th></tr></thead>
      <tbody>{today.bills.map(b => <Tr key={b.id} onClick={() => navigate(`/sales/${b.id}`)}>
        <Td className="text-muted tnum">{timeOf(b.created_at)}</Td>
        <Td><Link to={`/sales/${b.id}`} onClick={e => e.stopPropagation()} className="font-medium hover:text-brand tnum whitespace-nowrap">{b.invoice_number}</Link>{allFirms ? <span className="block text-xs text-muted">{firmShort(b.business, b.business_name)}</span> : null}</Td>
        <Td><span className="block">{b.customer.name}</span><span className="block text-xs text-muted">{b.customer.mobile_number || "No phone"}</span></Td>
        <Td className="text-fg2">{PAY[b.payment_mode]}</Td>
        <Td align="right">{b.line_count ? <Money value={b.total_amount} strong /> : <span className="text-neg font-medium">No items</span>}</Td>
        <Td align="right" onClick={e => e.stopPropagation()}>{b.line_count ? <SendCell bill={b} /> : <ButtonLink size="sm" variant="ghost" to={`/sales/${b.id}`}>Fix it</ButtonLink>}</Td>
      </Tr>)}</tbody>
    </Table>
    {today.more > 0 ? <div className="px-5 py-3 border-t border-rule"><Link to="/sales?when=today" className="link">and {today.more} more</Link></div> : null}
    <div className="px-5 py-3 border-t border-rule flex flex-wrap items-center justify-between gap-x-6 gap-y-2"><PaySplit data={data} /><Link to="/sales?when=today" className="link">Today's bills in Sales</Link></div>
  </Card>;
}
