import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Clock, CircleCheck, ExternalLink, Pencil, Ban, Hourglass } from "lucide-react";
import { useAuth } from "@/core/auth/AuthProvider";
import { useFirms } from "@/core/scope";
import { useView } from "@/core/view";
import { useGstCredit, useMoveCredit } from "@/core/api/gstCredit";
import { problemOf, saveFailure } from "@/core/api/errors";
import type { Credit, CreditRiskBill, OpeningCredit } from "@/core/gst/creditTypes";
import { date, fyOf, inr, monthLabel, plural, todayIST } from "@/core/format";
import { Banner, Button, Card, cn, DL, FailNote, Field, ListRow, Money, QueryView, scrollIntoViewSafe, Select, Table, Td, Th, Tr } from "@/core/ui";
import { OpeningCreditDialog } from "./OpeningCreditDialog";

const lastDay = (deadline: string, fy: string) => `${date(deadline)}, or the day the FY ${fy} annual return (GSTR-9) is filed, if that's earlier`;

function ClaimIn({ bill }: { bill: CreditRiskBill }) {
  const { can, whyNot, me } = useAuth();
  const move = useMoveCredit();
  const allowed = can("purchase.edit");
  const p = move.error ? problemOf(move.error) : null;
  if (me?.role === "viewer" || bill.claim_months.length < 2) return <span className="text-fg2">{monthLabel(bill.credit_month, { long: true })}</span>;
  const pick = (month: string) => {
    if (!allowed || move.isPending || month === bill.credit_month || !bill.claim_months.some(m => m.month === month && !m.too_late)) return;
    move.mutate({ id: bill.id, month });
  };
  return <div className="flex flex-col gap-1">
    <Field htmlFor={`claim-${bill.id}`} error={p?.fields?.itc_month}>
      <Select id={`claim-${bill.id}`} aria-label={`Claim ${bill.bill_no}'s credit in`} value={bill.credit_month} disabled={!allowed || move.isPending} onChange={e => pick(e.target.value)}
        options={bill.claim_months.map(m => ({ value: m.month, disabled: m.too_late,
          label: `${monthLabel(m.month, { long: true })} · ${m.state === "running" ? "running" : "not filed yet"}, 3B due ${date(m.gstr3b_due).slice(0, 6)}${m.too_late ? " (after the last day)" : ""}` }))} />
    </Field>
    {!allowed ? <span className="text-xs text-muted">{whyNot("purchase.edit", "change which return claims a bill's credit")}</span> : move.isPending ? <span className="text-xs text-muted" role="status">Moving the credit…</span> : null}
    <FailNote error={p ? saveFailure(p) : null} />
  </div>;
}

export function CreditView({ businessId, fy }: { businessId: number; fy: string }) {
  const q = useGstCredit(businessId, fy);
  const { firms } = useFirms();
  const firm = firms.find(f => f.id === businessId);
  return <QueryView query={q} what="credit and deadlines">{data => <>
    <RiskCard data={data} firmName={firm?.name ?? "This firm"} fy={fy} />
    <BucketsCard data={data} firmName={firm?.name ?? "This firm"} />
    <OpeningCard opening={data.opening} businessId={businessId} firmName={firm?.name ?? "This firm"} firmGstin={firm?.gstin ?? ""} />
  </>}</QueryView>;
}
function RiskCard({ data, firmName, fy }: { data: Credit; firmName: string; fy: string }) {
  const { isPhone } = useView();
  const { firms } = useFirms();
  const navigate = useNavigate();
  const risk = data.at_risk;
  const elsewhere = data.others_at_risk;
  const other = elsewhere.length ? <p className="text-sm text-muted">{elsewhere.map(f => firms.find(x => x.id === f.business)?.name ?? f.short).join(" and ")} {elsewhere.length === 1 ? "has" : "have"} credit at risk too. <Button size="sm" variant="link" onClick={() => navigate(`/gst?tab=credit&firm=${elsewhere[0].business}&fy=${fy}`)}>Show {elsewhere[0].short}</Button></p> : null;
  const first = risk.bills[0];
  if (!first) return <Card><div className="flex items-start gap-3">
    <CircleCheck size={22} className="text-sale shrink-0 mt-0.5" aria-hidden="true" />
    <div className="flex flex-col gap-1"><p className="font-semibold">No credit at risk for {firmName}</p>
      <p className="text-fg2">No purchase bill from last year has credit waiting to be claimed before its deadline. A bill's credit must be in a return filed by 30 November after its year ends, or by the day that year's annual return (GSTR-9) is filed, if that's earlier (Sec 16(4)). Late bills show here with their last day.</p>{other}</div>
  </div></Card>;
  const earliest = first.claim_months.find(m => !m.too_late);
  const inTime = first.credit_month_due <= first.deadline;
  return <Card pad={false} title={`Last year's credit to claim · by ${date(first.deadline)}`} subtitle={`${firmName} · ${plural(risk.count, "purchase bill")} · ${inr(risk.tax)} of credit · Sec 16(4)`}>
    <div className={cn("pb-3", isPhone ? "px-4" : "px-5")}>
      <Banner tone={first.days_left <= 30 ? "neg" : "muted"} icon={Hourglass} title={`${inr(risk.tax)} of credit: last day ${lastDay(first.deadline, fyOf(first.bill_date))}`}>
        {inTime ? `It's set to go in ${monthLabel(first.credit_month, { long: true })}'s GSTR-3B, due ${date(first.credit_month_due)}: in time, if that return is filed on time.` : `${monthLabel(first.credit_month, { long: true })}'s GSTR-3B is due after the last day; claim it in an earlier return.`}
        {earliest && earliest.month < first.credit_month ? ` The earliest open return is ${monthLabel(earliest.month, { long: true })}'s (3B due ${date(earliest.gstr3b_due)}), the safer choice; pick it below.` : ""}
      </Banner>
    </div>
    {isPhone ? <div className="border-t border-rule">
      {risk.bills.map(b => <ListRow key={b.id} to={`/purchases/${b.id}`} title={<span className="whitespace-normal">{b.supplier.name} · <span className="tnum">{b.bill_no}</span></span>}
        subtitle={<span className="whitespace-normal">Dated {date(b.bill_date)} · entered {date(b.entered_on)} · claim in {monthLabel(b.credit_month)}</span>}
        right={<Money value={b.tax} tone="amber" />} rightSub={<span className={b.days_left <= 3 ? "text-neg font-semibold" : b.days_left <= 15 ? "text-brand font-medium" : "text-fg2"}>{plural(b.days_left, "day")} left</span>} />)}
      <div className="px-4 py-3 border-t border-rule flex flex-col gap-2">{risk.bills.map(b => <div key={b.id}><p className="text-sm text-fg2 mb-1">Claim {b.bill_no}'s credit in</p><ClaimIn bill={b} /></div>)}</div>
    </div> : <Table label="Purchase bills with credit at risk">
      <thead><tr><Th>Supplier's bill</Th><Th>Supplier</Th><Th>Entered</Th><Th align="right">Credit</Th><Th>Claimed in</Th><Th>Last day</Th><Th><span className="sr-only">Open</span></Th></tr></thead>
      <tbody>{risk.bills.map(b => <Tr key={b.id}>
        <Td><span className="block font-medium tnum">{b.bill_no}</span><span className="block text-xs text-muted tnum">{date(b.bill_date)}</span></Td>
        <Td>{b.supplier.name}<span className="block text-xs text-muted tnum">{b.supplier.gst_number}</span></Td>
        <Td className="text-fg2">{date(b.entered_on)}</Td><Td align="right"><Money value={b.tax} strong tone="amber" /></Td>
        <Td className="min-w-[220px]"><ClaimIn bill={b} /><span className="block text-xs text-muted mt-1">GSTR-3B due {date(b.credit_month_due)}</span></Td>
        <Td className="whitespace-nowrap">{date(b.deadline)}<span className={cn("block text-xs", b.days_left <= 3 ? "text-neg font-semibold" : b.days_left <= 15 ? "text-brand font-medium" : "text-fg2")}>{b.days_left >= 0 ? `${plural(b.days_left, "day")} left` : `${plural(-b.days_left, "day")} late`}</span></Td>
        <Td><Button size="sm" variant="link" iconRight={ExternalLink} onClick={() => navigate(`/purchases/${b.id}`)}>Open</Button></Td>
      </Tr>)}</tbody>
    </Table>}
    {other ? <div className={cn("py-3 border-t border-rule", isPhone ? "px-4" : "px-5")}>{other}</div> : null}
  </Card>;
}
function BucketsCard({ data, firmName }: { data: Credit; firmName: string }) {
  const { isPhone } = useView();
  const b = data.buckets;
  const cells = [
    { key: "claimed" as const, label: "Claimed in filed returns", tone: "text-file", icon: CircleCheck, sub: "" },
    { key: "open" as const, label: b.fy === fyOf(todayIST()) ? "In returns still to file" : `To claim by ${date(b.deadline)}`, tone: "text-brand", icon: Clock, sub: `last day ${date(b.deadline)}${b.open.bills ? ` · ${plural(b.days_left, "day")} left` : ""}` },
    { key: "lapsed" as const, label: "Lapsed", tone: b.lapsed.bills ? "text-neg" : "text-muted", icon: Ban, sub: b.lapsed.bills ? "past the deadline: this credit can't be claimed" : "nothing lapsed" },
  ];
  return <Card title={`Credit on FY ${b.fy} purchase bills`} subtitle={`${firmName} · each bill's credit must be in a return filed by ${lastDay(b.deadline, b.fy)}`}>
    <div className={cn("grid gap-4", isPhone ? "grid-cols-1" : "grid-cols-3")}>{cells.map(c => <div key={c.key} className="rounded-ctl border border-line bg-field px-4 py-3 flex flex-col gap-1">
      <span className="flex items-center gap-2 caps"><c.icon size={14} className={c.tone} aria-hidden="true" />{c.label}</span>
      <Money value={b[c.key].tax} size="xl" className={b[c.key].bills ? "" : "text-muted"} />
      <span className="text-sm text-muted">{plural(b[c.key].bills, "purchase bill")}{c.sub ? ` · ${c.sub}` : ""}</span>
    </div>)}</div>
    {b.none.length ? <p className="text-sm text-muted mt-4">No credit on {plural(b.none.length, "bill")}: {b.none.map(p => `${p.supplier_name} (${p.bill_no}, ${{ no_gstin: "no GSTIN", no_gst: "no GST charged", not_allowed: "credit not allowed" }[p.why]})`).join("; ")}.</p> : null}
  </Card>;
}
function OpeningCard({ opening: o, businessId, firmName, firmGstin }: { opening: OpeningCredit; businessId: number; firmName: string; firmGstin: string }) {
  const { can } = useAuth();
  const location = useLocation();
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (location.hash === "#opening") { scrollIntoViewSafe(anchor.current); anchor.current?.focus({ preventScroll: true }); } }, [location.hash, businessId]);
  const h = o.carried_out_of_first_month.heads;
  return <div ref={anchor} tabIndex={-1}>
    <Card id="opening" title="Credit carried into FY 2025-26" subtitle={`${firmName} · as of ${date(o.as_of)}, when the app's records start`}
      actions={can("settings.edit") ? <Button icon={Pencil} onClick={() => setOpen(true)}>{o.typed ? "Edit opening credit" : "Type it"}</Button> : null}>
      <div className="flex flex-col gap-3">
        <DL rows={[["IGST credit", <Money key="i" value={o.igst} tone={o.igst ? undefined : "muted"} />], ["CGST credit", <Money key="c" value={o.cgst} tone={o.cgst ? undefined : "muted"} />], ["SGST credit", <Money key="s" value={o.sgst} tone={o.sgst ? undefined : "muted"} />], ["Total", <Money key="t" value={o.total} strong />, { strong: true }]]} />
        {!o.typed ? <p className="text-sm text-muted">The opening credit isn't typed yet, so the credit carried in may be too low.</p> : null}
        <p className="text-sm text-muted">April 2025's return starts from this; every month after carries on from the one before. A change here moves only the months before the first filed GSTR-3B. April 2025 ended with {inr(h.igst + h.cgst + h.sgst)} carried on.</p>
        {o.updated_by && o.updated_at ? <p className="text-sm text-muted">Last changed by {o.updated_by.name} on {date(todayIST(new Date(o.updated_at)))}.</p> : null}
      </div>
      <OpeningCreditDialog opening={o} businessId={businessId} firmName={firmName} firmGstin={firmGstin} open={open} onClose={() => setOpen(false)} />
    </Card>
  </div>;
}
