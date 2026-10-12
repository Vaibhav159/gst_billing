import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { BarChart3, FileQuestion, FileSpreadsheet, Gem, Hash, Landmark, ReceiptText, ShoppingBag, Users } from "lucide-react";
import { useReport, type ReportQuery } from "@/core/api/gstReports";
import { useAuth } from "@/core/auth/AuthProvider";
import { inr, plural } from "@/core/format";
import type { ReportData, ReportKind, ReportMap } from "@/core/gst/reportTypes";
import { useFirms, useScope } from "@/core/scope";
import { useBoxWidth } from "@/core/useBoxWidth";
import { useView } from "@/core/view";
import { Button, Card, EmptyState, Field, ListRow, Page, QueryView, Select, cn } from "@/core/ui";
import { CaWorkbookDialog } from "@/pages/gst/CaWorkbookDialog";
import { PeriodBar } from "./PeriodBar";
import { periodLabel, useReportPeriod, useSplitPreference } from "./period";
import { CustomersView, HsnView, MonthsView, ProductsView, PurchasesView, SalesView, TaxView, type ReportContext } from "./ReportViews";

export const REPORTS = [
  { kind: "sales", name: "Sales register", icon: ReceiptText }, { kind: "purchases", name: "Purchase register", icon: ShoppingBag },
  { kind: "tax", name: "Tax summary", icon: Landmark }, { kind: "hsn", name: "HSN summary", icon: Hash },
  { kind: "customers", name: "Top customers", icon: Users }, { kind: "products", name: "Top products", icon: Gem },
  { kind: "months", name: "Month by month", icon: BarChart3 },
] as const;
export default function Reports() {
  const { kind } = useParams();
  const { isPhone } = useView();
  if (kind && !REPORTS.some(r => r.kind === kind)) return <Page title="Reports" phoneSubtitle="Report not found" back="/reports"><Card><EmptyState icon={FileQuestion} title={`There's no report called "${kind}"`} actions={<Link className="link" to="/reports">See all reports</Link>}>The link may be old. Every report is listed on the Reports page.</EmptyState></Card></Page>;
  return <ReportPage kind={kind as ReportKind | undefined ?? (isPhone ? null : "sales")} />;
}
function summary(kind: ReportKind, data: ReportData): string {
  if (kind === "sales" || kind === "purchases") { const d = data as ReportMap["sales"] | ReportMap["purchases"]; return `${plural(d.totals.bills, "bill")} · ${inr(d.totals.total)}`; }
  if (kind === "hsn") return `${plural((data as ReportMap["hsn"]).rows.length, "row")} with portal unit codes`;
  if (kind === "customers") { const first = (data as ReportMap["customers"]).rows[0]; return first ? `${first.customer.name} · ${inr(first.total)}` : "No named customers in this period"; }
  if (kind === "products") { const first = (data as ReportMap["products"]).rows[0]; return first ? `${first.name} · ${first.quantity.map(q => `${q.quantity} ${q.unit}`).join(" · ")}` : "No sales in this period"; }
  if (kind === "tax") return `${plural((data as ReportMap["tax"]).firms.length, "firm")} · tax and credit kept apart`;
  return "Sales and purchases by month, to scale";
}
function ReportSummary({ kind, query }: { kind: ReportKind; query: ReportQuery }) {
  const q = useReport(kind, query, "sales", false);
  const descriptions: Record<ReportKind, string> = { sales: "Bill by bill · oldest first", purchases: "GST paid is by bill date", tax: "Each firm (GSTIN) on its own", hsn: "Rows with portal unit codes", customers: "Ranked by sales", products: "Ranked by taxable value", months: "Sales and purchases by month, to scale" };
  return <span>{q.data ? summary(kind, q.data) : descriptions[kind]}</span>;
}
function ChosenReport({ kind, query, ctx }: { kind: ReportKind; query: ReportQuery; ctx: ReportContext }) {
  const [side, setSide] = useState<"sales" | "purchases">("sales");
  const q = useReport(kind, query, side);
  return <QueryView query={q} what="this report">{data => {
    switch (kind) {
      case "sales": return <SalesView ctx={ctx} data={data as ReportMap["sales"]} />;
      case "purchases": return <PurchasesView ctx={ctx} data={data as ReportMap["purchases"]} />;
      case "tax": return <TaxView ctx={ctx} data={data as ReportMap["tax"]} />;
      case "hsn": return <HsnView ctx={ctx} data={data as ReportMap["hsn"]} side={side} onSide={setSide} />;
      case "customers": return <CustomersView ctx={ctx} data={data as ReportMap["customers"]} />;
      case "products": return <ProductsView ctx={ctx} data={data as ReportMap["products"]} />;
      case "months": return <MonthsView ctx={ctx} data={data as ReportMap["months"]} />;
    }
  }}</QueryView>;
}
function ReportPage({ kind }: { kind: ReportKind | null }) {
  const { isPhone } = useView(), navigate = useNavigate();
  const { firmId, setFirmId, fy, setFy, fyChoices } = useScope();
  const { firms } = useFirms();
  const [search] = useSearchParams();
  const linkedFy = search.get("fy");
  useEffect(() => { if (linkedFy && fyChoices.includes(linkedFy) && linkedFy !== fy) setFy(linkedFy); }, [linkedFy, fy, fyChoices, setFy]);
  const period = useReportPeriod(kind, fy), [split, setSplit] = useSplitPreference();
  const [caOpen, setCaOpen] = useState(false), [box, width] = useBoxWidth();
  const { can, whyNot } = useAuth();
  const scopeName = firmId === "all" ? "All firms" : firms.find(f => f.id === firmId)?.name ?? "Loading firm";
  const short = periodLabel(period);
  const ctx: ReportContext = { businessId: firmId ?? "all", scopeName, period: short, from: period.from, to: period.to, split };
  const query = { businessId: firmId, from: period.from, to: period.to, split };
  const selected = REPORTS.find(r => r.kind === kind);
  const ca = <Button variant="primary" icon={FileSpreadsheet} disabled={!can("reports.export") || firmId === null} title={!can("reports.export") ? whyNot("reports.export") : undefined} full={isPhone} onClick={() => setCaOpen(true)}>Excel for the CA…</Button>;
  const view = kind ? <ChosenReport key={kind} kind={kind} query={query} ctx={ctx} /> : null;
  return <div ref={box}><Page icon={BarChart3} title={isPhone && selected ? selected.name : "Reports"} context={`${short} · ${scopeName}`} back={isPhone ? kind ? "/reports" : "/more" : undefined} actions={!isPhone ? ca : undefined}>
    <PeriodBar period={period} fy={fy} firmId={firmId} firms={firms} setFirmId={setFirmId} onChange={period.set} split={split} setSplit={setSplit} />
    {isPhone ? kind ? view : <Card pad={false}>{REPORTS.map(r => <ListRow key={r.kind} to={`/reports/${r.kind}`} onClick={period.carry} title={r.name} subtitle={<ReportSummary kind={r.kind} query={query} />} leading={<span className="w-9 h-9 rounded-ctl bg-raised grid place-items-center text-fg2"><r.icon size={18} aria-hidden="true" /></span>} />)}</Card> : width >= 1340 ? <div className="grid grid-cols-[236px_minmax(0,1fr)] gap-5 items-start"><nav aria-label="Reports" className="card p-1.5 flex flex-col gap-0.5 sticky top-6">{REPORTS.map(r => <Link key={r.kind} to={`/reports/${r.kind}`} replace aria-current={r.kind === kind ? "page" : undefined} onClick={period.carry} className={cn("flex items-start gap-3 rounded-ctl px-3 py-2.5 transition-colors duration-150", r.kind === kind ? "bg-brand-sel" : "hover:bg-raised/60")}><r.icon size={18} className={cn("mt-0.5 shrink-0", r.kind === kind ? "text-brand" : "text-fg2")} aria-hidden="true" /><span className="min-w-0"><span className={cn("block font-medium", r.kind === kind && "text-brand")}>{r.name}</span><span className="block text-xs text-muted mt-0.5"><ReportSummary kind={r.kind} query={query} /></span></span></Link>)}</nav><div className="min-w-0 flex flex-col gap-5">{view}</div></div> : <><Field label="Report" htmlFor="rep-kind" className="max-w-[420px]"><Select id="rep-kind" value={kind ?? "sales"} options={REPORTS.map(r => ({ value: r.kind, label: r.name }))} onChange={e => { period.carry(); navigate(`/reports/${e.target.value}`, { replace: true }); }} /></Field><div className="min-w-0 flex flex-col gap-5">{view}</div></>}
    {isPhone ? <Card><p className="font-medium">Sales and purchases in one Excel file</p><p className="text-sm text-muted mt-1 mb-3">A summary sheet and a sheet per firm, month by month, one row per item: the workbook your CA uses.</p>{ca}</Card> : null}
    <CaWorkbookDialog open={caOpen} onClose={() => setCaOpen(false)} businessId={firmId} from={period.from} to={period.to} split={split} />
  </Page></div>;
}
