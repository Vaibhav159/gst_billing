// The prototype's firm cards; the server supplies every figure and next number.
import { Building2, ChevronRight, Pencil, Plus } from "lucide-react";
import { Link } from "react-router";
import { useFirmList } from "@/core/api/firms";
import { useAuth } from "@/core/auth/AuthProvider";
import { date, monthLabel, plural } from "@/core/format";
import { stateLabel } from "@/core/ids";
import { useScope } from "@/core/scope";
import { cancelledNote } from "@/core/sales/words";
import { Badge, Button, ButtonLink, Card, cn, DL, EmptyState, Figure, Money, Page, QueryView } from "@/core/ui";
import { useView } from "@/core/view";
import { fyPeriod, useJustSaved } from "@/pages/customers/lib";
import { WhyNote } from "@/pages/customers/parts";
import { ReturnBadge } from "./parts";
export default function Firms() {
  const { fy } = useScope(); const query = useFirmList(fy); const { can, whyNot } = useAuth(); const { isPhone } = useView();
 const saved = useJustSaved("firm"); const period = fyPeriod(fy);
  const add = can("firm.edit") ? <ButtonLink to="/firms/new" variant="primary" icon={Plus} size={isPhone ? "lg" : "md"}>Add a firm</ButtonLink> : <Button variant="primary" icon={Plus} disabled title={whyNot("firm.edit", "add firms")}>Add a firm</Button>;
  return <Page icon={Building2} title="Firms" back="/more" context={`${query.data ? plural(query.data.length, "GST registration") : "GST registrations"}, one set of customers and products · figures count every bill of ${period.label} so far (${period.range})`} phoneSubtitle={`${query.data ? plural(query.data.length, "firm") : "Firms"} · ${period.label} so far`} actions={add} actionBar={isPhone && can("firm.edit") ? add : null}>
    {!can("firm.edit") ? <WhyNote>{whyNot("firm.edit", "add or change firms")}</WhyNote> : null}
    <QueryView query={query} what="firms">{(firms) => firms.length ? <div className={cn("grid gap-5 items-stretch", isPhone ? "grid-cols-1 gap-4" : "grid-cols-2 xl:grid-cols-3")}>
      {firms.map((f) => { const x = f.figures!; return <Card key={f.id} pad={false} className="flex flex-col"><div className={cn("flex flex-col gap-4 h-full rounded-card", isPhone ? "p-4" : "p-5", f.id === saved && "anim-flash")}>
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="text-lg font-semibold leading-snug">{isPhone ? f.name : <Link to={`/firms/${f.id}`} className="hover:text-brand">{f.name}</Link>}</h2><p className="text-sm text-muted tnum mt-0.5">{f.gst_number || "No GSTIN yet"} · {stateLabel(f.state_name)}</p></div><Badge title="Bill number prefix">{f.invoice_prefix || "No prefix"}</Badge></div>
        <div className="flex flex-col gap-2">{isPhone ? <p className="caps">{period.label} so far</p> : null}<div className="grid grid-cols-2 gap-4">
          <Figure label={isPhone ? "Sales" : `Sales · ${period.label}`} value={<Money value={x.sales.total} size="xl" tone="sale" />} caption={`${plural(x.sales.bills, "sales bill")}${cancelledNote(x.sales.cancelled)}`} />
          <Figure label={isPhone ? "Purchases" : `Purchases · ${period.label}`} value={<Money value={x.purchases.total} size="xl" tone="amber" />} caption={plural(x.purchases.bills, "purchase bill")} />
        </div></div>
        <DL className="border-t border-rule" rows={[["Next bill number", <span className="tnum font-medium">{f.numbers?.next.invoice_number}</span>], ["Last filed month", x.last_filed ? <span>{monthLabel(x.last_filed.month, { long: true })}{x.last_filed.gstr3b_filed_on ? <span className="block text-xs text-muted">GSTR-3B filed {date(x.last_filed.gstr3b_filed_on)}</span> : null}</span> : "None yet"], [`${monthLabel(x.previous_month.month, { long: !isPhone })} returns`, <ReturnBadge {...x.previous_month} short={isPhone} />]]} />
        <div className="flex flex-wrap gap-2 mt-auto"><ButtonLink to={`/firms/${f.id}`} variant="secondary" iconRight={ChevronRight} className={isPhone ? "flex-1" : ""}>Open</ButtonLink>{can("firm.edit") ? <ButtonLink to={`/firms/${f.id}/edit`} variant="ghost" icon={Pencil} className={isPhone ? "flex-1" : ""}>Edit</ButtonLink> : null}</div>
      </div></Card>; })}
    </div> : <Card><EmptyState icon={Building2} title="No firms yet" actions={can("firm.edit") ? <ButtonLink to="/firms/new?first=1" variant="primary" icon={Plus}>Add your first business</ButtonLink> : null}>A firm is a GST registration: its GSTIN, address and bill numbers print on every bill.</EmptyState></Card>}</QueryView>
    <p className="text-sm text-muted">{isPhone ? "The firm chips on Home and the lists decide" : "The firm picker in the top bar decides"} which firm's bills the other screens show. Each firm numbers its bills on its own, starting again at 1 every financial year.</p>
  </Page>;
}
