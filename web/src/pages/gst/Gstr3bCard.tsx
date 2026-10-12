import type { ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "@/core/cn";
import { addMonths, date, inr, monthLabel, plural } from "@/core/format";
import type { Gstr3b, Head, Month, PaidHeads, PurchaseRef } from "@/core/gst/types";
import { stateTitle } from "@/core/ids";
import { Card, DL, Disclosure, Money, Table, Td, Th, Tr } from "@/core/ui";

const heads: Head[] = ["igst", "cgst", "sgst"];
const tag = (text: string) => <span className="ml-1.5 inline-flex items-center rounded-md border border-line px-1.5 text-2xs font-semibold text-fg2 tnum align-[1px]">{text}</span>;
const noHeads = { igst: null, cgst: null, sgst: null };
type LedgerLine = { key: string; label: ReactNode; sub?: ReactNode; taxable?: number | null; heads: Omit<PaidHeads, "total">; total: number | null; strong?: boolean; step?: boolean; highlight?: boolean };
function PurchaseList({ rows }: { rows: PurchaseRef[] }) {
  return <ul className="text-sm flex flex-col gap-1">{rows.map((row) => <li key={row.id}><Link className="link tnum" to={`/purchases/${row.id}`}>{row.bill_no}</Link> · {row.supplier_name}{row.heads ? ` · ${inr(row.heads.total)}` : ""}</li>)}</ul>;
}

export function Gstr3bCard({ month, data, phone = false, actions }: { month: Month; data: Gstr3b; phone?: boolean; actions?: ReactNode }) {
  const name = monthLabel(month.month, { long: true, year: false });
  const nextName = monthLabel(addMonths(month.month, 1), { long: true, year: false });
  const prevName = monthLabel(data.carry_in.from, { long: true, year: false });
  const reopened = month.stage === "unlocked" && month.record.gstr3b;
  const am = data.amendments;
  const amended = am?.months.map((value) => monthLabel(value, { long: true, year: false })).join(" and ");
  // A filed month whose typed cash differs keeps the app's working and adds the recorded payment as its own row.
  const paidDiffers = data.filed && data.cash_paid && data.cash_paid.total !== data.cash.total ? data.cash_paid : null;
  const cashLabel = paidDiffers ? "Tax worked out in cash" : data.filed ? "Tax paid in cash" : reopened ? "Tax in cash on the books" : "Tax to pay in cash";
  const lines: LedgerLine[] = [
    { key: "out", label: <>Output tax on {plural(data.t31a.bills, "sales bill")}{tag("3.1(a)")}</>, sub: am && heads.some((head) => am.output[head] !== 0) ? `outward taxable supplies, from GSTR-1, with the amendments to ${amended}` : "outward taxable supplies, from GSTR-1", taxable: data.t31a.taxable, heads: data.t31a, total: data.t31a.igst + data.t31a.cgst + data.t31a.sgst, strong: true },
    ...(am && heads.some((head) => am.output[head] !== 0) ? [{ key: "am-out", label: `of which amendments to ${amended}`, sub: "bills corrected after that month was filed", heads: am.output, total: am.output.total, step: true }] : []),
    { key: "nil", label: <>Nil-rated and exempt sales{tag("3.1(c)")}</>, taxable: data.t31c.taxable, heads: noHeads, total: null },
    { key: "t32", label: <>Of which inter-state to people without a GSTIN{tag("3.2")}</>, sub: "by place of supply, from B2CL and inter-state B2C", taxable: data.t32.reduce((sum, row) => sum + row.taxable, 0), heads: { ...noHeads, igst: data.t32.reduce((sum, row) => sum + row.igst, 0) }, total: data.t32.reduce((sum, row) => sum + row.igst, 0) },
    ...data.t32.map((row) => ({ key: `t32:${row.place_of_supply}`, label: `${stateTitle(row.place_of_supply_name)} (${row.place_of_supply})`, sub: plural(row.bills, "bill"), taxable: row.taxable, heads: { ...noHeads, igst: row.igst }, total: row.igst, step: true })),
    { key: "in", label: `Carried in from ${prevName}`, sub: data.carry_in.opening ? <>the opening credit · <Link className="link" to={`/gst?tab=credit&firm=${month.business}`}>see or change it</Link></> : `left after ${prevName}'s return${data.carry_in.as_filed ? ", as filed" : ""}`, heads: data.carry_in.heads, total: data.carry_in.heads.total },
    { key: "new", label: <>On {plural(data.t4a5.bills, "purchase bill")}{tag("4(A)(5)")}</>, sub: data.t4a5.late.length ? `all other credit · includes ${plural(data.t4a5.late.length, "late bill")} (${data.t4a5.late.map((bill) => `${bill.bill_no}, ${date(bill.bill_date)}`).join("; ")}) claimed this month` : data.to_confirm.length ? `all other credit · includes ${plural(data.to_confirm.length, "bill")} to confirm (${data.to_confirm.map((bill) => bill.bill_no).join(", ")})` : "all other credit: GST paid to suppliers", heads: data.t4a5.heads, total: data.t4a5.heads.total },
    { key: "blocked", label: <>Credit not allowed{tag("4(B)(1)")}</>, sub: <>{plural(data.t4b1.bills, "bill")} with credit switched off: reported in 4(A)(5), then reversed<PurchaseList rows={data.t4b1.list} /></>, heads: data.t4b1.heads, total: data.t4b1.heads.total },
    { key: "net", label: <>Net credit{tag("4(C)")}</>, sub: "4(A)(5) less 4(B)(1)", heads: data.t4c, total: data.t4c.total, strong: true },
    { key: "lapsed", label: <>Credit too late to claim{tag("4(D)(2)")}</>, sub: <>{plural(data.t4d2.bills, "bill")} past the deadline under section 16(4); outside 4(A)<PurchaseList rows={data.t4d2.list} /></>, heads: data.t4d2.heads, total: data.t4d2.heads.total },
    ...(am && heads.some((head) => am.credit[head] !== 0) ? [{ key: "am-credit", label: `Amendments to ${amended}`, sub: "purchases corrected after that month was filed", heads: am.credit, total: am.credit.total, step: true }] : []),
    { key: "available", label: "Credit available", sub: "carried in plus net credit, with any amendments", heads: data.available, total: data.available.total, strong: true },
    ...data.steps.map((step, i) => ({ key: `step:${i}`, label: `${i + 1}. ${step.from.toUpperCase()} credit used against ${step.to.toUpperCase()}`, heads: { ...noHeads, [step.to]: step.amount }, total: step.amount, step: true })),
    { key: "used", label: <>Credit used{tag("6.1")}</>, sub: "tax paid through credit; each column is the tax it paid", heads: data.used, total: data.used.total, strong: true },
    { key: "cash", label: <>{cashLabel}{tag("6.1")}</>, sub: paidDiffers ? "the return's working; the cash recorded as paid is below" : data.filed ? "paid in cash with GSTR-3B" : reopened ? `${inr(reopened.cash?.total ?? 0)} was paid with GSTR-3B` : month.stage === "open" ? "so far; the month is still running" : `pay by ${date(month.due.gstr3b)}`, heads: data.cash, total: data.cash.total, strong: true, highlight: !paidDiffers },
    ...(paidDiffers ? [{ key: "paid", label: <>Tax paid in cash (recorded){tag("6.1")}</>, sub: "as typed when GSTR-3B was marked filed", heads: paidDiffers, total: paidDiffers.total, strong: true, highlight: true }] : []),
    { key: "carry", label: `Credit carried to ${nextName}`, sub: data.carry_on.total ? "goes into next month's return, head by head" : "all credit used", heads: data.carry_on, total: data.carry_on.total },
  ];
  const title = data.filed ? "GSTR-3B · as filed" : reopened ? "GSTR-3B · the books now" : "GSTR-3B · tax to pay";
  const filing = month.record.gstr3b;
  const reports = `/reports/tax?firm=${month.business}&from=${month.running?.from ?? `${month.month}-01`}&to=${month.running?.to ?? `${month.month}-01`}`;
  const explanation = <div className="flex flex-col gap-3 text-fg2 max-w-[72ch]">
    <ol className="list-decimal pl-5 flex flex-col gap-1.5">
      <li>Tax on sales comes from the month's sales bills, head by head: IGST on bills to other states, CGST and SGST on bills within the state. That's table 3.1(a); inter-state sales to people without a GSTIN are also listed by state in 3.2.</li>
      <li>Credit available is what was left after last month's return, plus net credit in 4(C). Purchase GST is reported in 4(A)(5), including credit not allowed, which is reversed in 4(B)(1). A bill found late counts in the month it's claimed, as long as that's by 30 November after its year ends. Credit too late to claim is reported in 4(D)(2), outside 4(A), and not used.</li>
      <li>Credit is used in the order the law sets, and so that the least cash is paid:<ul className="list-disc pl-5 mt-1 flex flex-col gap-1"><li>IGST credit goes first: against IGST, then against CGST and SGST. It goes first to the part each head's own credit can't cover, then is split to keep the CGST and SGST credit carried on even. It is used up before any other credit.</li><li>Then CGST credit: against CGST, then IGST. It can never pay SGST.</li><li>Then SGST credit: against SGST, then IGST. It can never pay CGST.</li></ul></li>
      <li>Tax that credit doesn't cover is paid in cash with GSTR-3B (table 6.1). Credit that isn't used carries to next month, head by head.</li>
      <li>Each firm has its own credit. One firm's credit can't pay another firm's tax, so there is no combined figure across firms.</li>
      <li>The ledger runs without a break from April 2025, starting from the credit the firm carried in then (change it under Credit and deadlines). A filed month hands on its credit as filed; a correction made after filing goes in the next open return as an amendment.</li>
    </ol>
    {data.cross_head ? <p className="text-sm rounded-ctl bg-field border border-line px-3 py-2.5">For example, in {monthLabel(data.cross_head.month, { long: true })} {month.firm.short} paid {inr(data.cross_head.paid_amount)} of {data.cross_head.paid.toUpperCase()} in cash while {inr(data.cross_head.left_amount)} of {data.cross_head.left.toUpperCase()} credit carried on, because {data.cross_head.left.toUpperCase()} credit can't pay {data.cross_head.paid.toUpperCase()}.</p> : null}
    <p className="text-sm">The <Link to={reports} className="link">Tax summary in Reports</Link> uses this same rule, so the figures match.</p>
  </div>;
  return <Card pad={false} id="gst-ledger" className="scroll-mt-6" title={title} subtitle={`${monthLabel(month.month, { long: true })}${month.stage === "open" ? " so far" : ""} · ${month.firm.name} · ${data.filed ? `filed ${date(filing?.filed_on || data.as_filed_at?.slice(0, 10))}${filing?.arn ? ` · ARN ${filing.arn}` : ""}` : reopened ? `filed ${date(reopened.filed_on)}; corrections go in ${nextName}'s return` : "credit carried month to month"}`} actions={<><Link to={reports} className="link text-sm">Same figures in Reports</Link>{actions}</>}>
    {!data.filed && data.late?.interest ? <p className="px-5 pt-3 text-sm text-muted">Interest in the GSTR-3B JSON: {data.interest_note}.</p> : null}
    {data.opening_missing ? <p className="px-5 pt-3 text-sm text-amber">The opening credit isn't typed yet. <Link className="link" to={`/gst?tab=credit&firm=${month.business}`}>See or change it under Credit and deadlines.</Link></p> : null}
    {phone ? <div className="px-4">{lines.map((line) => <div key={line.key} className={cn("py-3 border-t border-rule first:border-t-0", line.highlight && "bg-raised/70")}><h3 className={cn(line.strong && "font-semibold")}>{line.label}</h3>{line.sub ? <div className="text-sm text-muted mt-0.5">{line.sub}</div> : null}<DL className="mt-1 text-sm" rows={[line.taxable != null ? ["Taxable value", <Money value={line.taxable} />] : null, ...heads.map((head) => [head.toUpperCase(), line.heads[head] === null ? "—" : <Money value={line.heads[head]} />] as const), ["Total tax", line.total === null ? "—" : <Money value={line.total} strong={line.strong} />]]} /></div>)}</div> : <Table label={`GSTR-3B position by tax head, ${monthLabel(month.month, { long: true })}`}><thead><tr><Th><span className="sr-only">Line</span></Th><Th align="right">Taxable value</Th>{heads.map((head) => <Th key={head} align="right">{head.toUpperCase()}</Th>)}<Th align="right">Total tax</Th></tr></thead><tbody>{lines.map((line) => <Tr key={line.key} className={cn(line.highlight && "bg-raised/70")}><Td><span className={cn("block", line.strong && "font-semibold", line.step && "pl-3")}>{line.label}</span>{line.sub ? <div className={cn("text-xs text-muted mt-0.5", line.step && "pl-3")}>{line.sub}</div> : null}</Td><Td align="right">{line.taxable == null ? "" : <Money value={line.taxable} className="text-fg2" />}</Td>{heads.map((head) => <Td key={head} align="right">{line.heads[head] === null ? "" : <Money value={line.heads[head]} strong={line.strong} />}</Td>)}<Td align="right">{line.total === null ? "" : <Money value={line.total} strong={line.strong} tone={line.highlight && !data.filed ? "brand" : undefined} />}</Td></Tr>)}</tbody></Table>}
    {!data.steps.length ? <p className="px-5 py-2 text-muted">No credit to use this month.</p> : null}
    {data.reduction_note ? <p className="px-5 py-2 text-sm text-fg2">{data.reduction_note}</p> : null}
    <div className="px-5 py-3 border-t border-rule"><h3 className="font-medium">Exempt, nil-rated and non-GST purchases{tag("5")}</h3><DL className="text-sm" rows={[["To another state", <Money value={data.t5.inter} />], ["Within the state", <Money value={data.t5.intra} />]]} /><p className="text-sm text-muted">{data.t5_note}</p></div>
    <p className="px-5 py-3 border-t border-rule text-sm text-fg2 tnum">Output tax {inr(data.t31a.igst + data.t31a.cgst + data.t31a.sgst)} − credit used {inr(data.used.total)} = {cashLabel.toLowerCase()} <span className="text-fg font-semibold">{inr(data.cash.total)}</span></p>
    {data.to_confirm.length ? <div className="px-5 py-3 border-t border-rule"><h3 className="font-medium">GSTR-3B · credit to confirm</h3><p className="text-sm text-muted">Read from a photo, not checked yet. It's inside 4(A)(5) until someone checks it.</p><PurchaseList rows={data.to_confirm} /></div> : null}
    {data.late?.recorded ? <div className="px-5 py-3 border-t border-rule"><h3 className="font-medium">Late fee and interest recorded</h3><DL className="text-sm" rows={[["GSTR-3B late fee", <Money value={data.late.gstr3b.fee} />], ["Interest", <Money value={data.late.interest} />]]} /><p className="text-sm text-muted">As typed when GSTR-3B was marked filed.</p></div>
    : data.late ? <div className="px-5 py-3 border-t border-rule"><h3 className="font-medium">Late fee and interest so far</h3><DL className="text-sm" rows={[["GSTR-1 late fee", <Money value={data.late.gstr1.fee} />], ["GSTR-3B late fee", <Money value={data.late.gstr3b.fee} />], ["Interest", <Money value={data.late.interest} />]]} /><p className="text-sm text-muted">GSTR-1: {plural(data.late.gstr1.days, "day")} at {inr(data.late.gstr1.per_day)} a day, capped at {inr(data.late.gstr1.cap)}. GSTR-3B: {plural(data.late.gstr3b.days, "day")} at {inr(data.late.gstr3b.per_day)} a day, capped at {inr(data.late.gstr3b.cap)}. Interest is 18% a year on {inr(data.late.interest_on)} from {date(data.late.interest_from)}.</p></div> : null}
    <div className="px-5 pb-2 border-t border-rule"><Disclosure title="How this is worked out" summary="The order the law sets for using credit (Rule 88A), and the least cash it allows">{explanation}</Disclosure></div>
    {month.stage === "open" ? <p className="px-5 pb-3 text-sm text-muted">{name} is still running.</p> : null}
  </Card>;
}
