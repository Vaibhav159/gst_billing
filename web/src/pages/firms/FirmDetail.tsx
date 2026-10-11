import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Building2, ChevronRight, Landmark, MoreHorizontal, MoreVertical, Pencil, ReceiptText, Store, Trash2 } from "lucide-react";
import { useDeleteFirm, useFirm, useRestoreFirm, type FirmDetail as Firm } from "@/core/api/firms";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { useShopSettings } from "@/core/api/sales";
import { useAuth } from "@/core/auth/AuthProvider";
import { date, dateShort, monthLabel, plural, rangeLabel } from "@/core/format";
import { stateLabel } from "@/core/ids";
import { cancelledNote, PAY_SHORT } from "@/core/sales/words";
import { useScope } from "@/core/scope";
import { Button, ButtonLink, Card, cn, ConfirmDialog, DL, Figure, IconButton, ListRow, Menu, Money, Page, QueryView, useToast, type MenuItem } from "@/core/ui";
import { useView } from "@/core/view";
import { useJustSaved } from "@/pages/customers/lib";
import { CopyButton } from "@/pages/customers/pageParts";
import { MissingRecord, SaveError, WhyNote } from "@/pages/customers/parts";
import { ReturnBadge, SignaturePreview } from "./parts";
export default function FirmDetail() {
  const raw = useParams().id ?? ""; const id = /^\d+$/.test(raw) && Number(raw) > 0 && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
  const { fy } = useScope(); const q = useFirm(id, fy);
  if (id === null || (q.isError && problemOf(q.error).kind === "notfound")) return <MissingRecord icon={Building2} title="This firm isn't on file" to="/firms" label="All firms" />;
  return <QueryView query={q} what="this firm">{(f) => <Detail f={f} />}</QueryView>;
}
function Detail({ f }: { f: Firm }) {
  const { isPhone } = useView(); const { can, whyNot } = useAuth(); const { firmId, setFirmId } = useScope(); const toast = useToast(); const navigate = useNavigate();
  const saved = useJustSaved("firm"); const shop = useShopSettings();
  const remove = useDeleteFirm(); const restore = useRestoreFirm(); const [del, setDel] = useState(false); const [error, setError] = useState<ApiProblem | null>(null);
  const x = f.figures; const owner = can("firm.edit"); const uses = Object.values(f.uses).reduce((a, n) => a + n, 0);
  const allBills = () => { setFirmId(f.id); navigate("/sales"); };
  const menu: MenuItem[] = [
    { label: `Show only ${f.short} in lists`, icon: Store, disabled: firmId === f.id, hint: firmId === f.id ? "Lists already follow this firm" : "Sets the firm picker", onSelect: () => { setFirmId(f.id); toast.show({ title: `Showing ${f.name} everywhere`, body: "Lists and figures now follow this firm. Pick All firms in the firm picker to go back.", tone: "brand" }); } },
    { divider: true }, { label: "Delete firm…", icon: Trash2, tone: "danger", disabled: !owner || uses > 0, hint: !owner ? whyNot("firm.edit", "delete firms") : uses ? "Bills, purchases, bin rows, unfinished bills, captures and GST history keep their firm" : "It has no bills", onSelect: () => setDel(true) },
  ];
  const erase = async () => {
    try { const r = await remove.mutateAsync(f.id); toast.show({ title: `${f.name} deleted`, body: "It's also in the Audit log, to restore later.", action: { label: "Undo", onClick: () => { void restore.mutateAsync(r.audit_id).then(() => toast.show({ title: `${f.name} restored` })).catch((e) => toast.show({ title: "Not restored", body: problemOf(e).message, tone: "neg" })); } } }); setDel(false); navigate("/firms", { replace: true }); }
    catch (e) { setError(problemOf(e)); }
  };
  const registration = <Card title="Registration" subtitle={isPhone ? undefined : "Printed at the top of every bill"}><div className={cn(saved === f.id && "anim-flash")}><DL rows={[
    ["Legal name", f.name], ["Short name", f.short], ["GSTIN", <span className="inline-flex items-center tnum">{f.gst_number || "None yet"}{f.gst_number ? <CopyButton value={f.gst_number} label="GSTIN" /> : null}</span>], ["PAN", <span className="inline-flex items-center tnum">{f.pan_number || "None"}{f.pan_number ? <CopyButton value={f.pan_number} label="PAN" /> : null}</span>],
    ["State", stateLabel(f.state_name)], ["Address", [f.address, [f.city, f.pin_code].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "None"], ["Phone", f.mobile_number || "None"], ["Email", f.email || "None"],
  ]} /></div></Card>;
  const bank = <Card title="Bank details" subtitle={f.has_bank ? shop.data?.show_bank === false ? "Kept here, but turned off for bills in Settings" : "Printed on every bill, under the totals" : "None yet: bills print without a bank block"} actions={f.has_bank && shop.data?.show_bank === false ? <ButtonLink size="sm" to="/settings" variant="ghost">Settings</ButtonLink> : !f.has_bank && owner ? <ButtonLink size="sm" to={`/firms/${f.id}/edit`} variant="ghost">Add bank details</ButtonLink> : null}>{f.has_bank ? <DL rows={[["Bank", f.bank_name || "None"], ["Account number", f.bank_account_number], ["IFSC", f.bank_ifsc_code || "None"], ["Branch", f.bank_branch_name || "None"]]} /> : null}</Card>;
  const numbering = <Card title="Bill numbers" subtitle="Each firm numbers its own bills, from 1 every financial year"><DL rows={[
    ["Number prefix", f.invoice_prefix || "None (bare numbers)"], ["Numbering", `${f.invoice_prefix ? `${f.invoice_prefix}/${f.numbers.fy}/` : "Bare numbers: "}1, 2, 3…`],
    ["Last bill this year", f.numbers.last ? <span>{f.numbers.last.invoice_number}<span className="block text-xs text-muted">{date(f.numbers.last.invoice_date)}</span></span> : "None yet"],
    ["Next bill number", <span className="tnum font-semibold text-brand">{f.numbers.next.invoice_number}</span>], ["Paper bills carry the full number from", f.paper_full_number_from ? date(f.paper_full_number_from) : "Not set"], ["Jurisdiction", `Subject to ${f.jurisdiction_printed} jurisdiction`],
  ]} /></Card>;
  const small = <Card title="Signature and declaration" subtitle="At the foot of every bill"><div className="flex flex-col gap-3"><SignaturePreview name={f.name} image={f.signature_url} on={f.signature_on_bills} className={isPhone ? "" : "max-w-[300px]"} /><div><p className="caps">Declaration</p><p className="text-fg2 mt-1">{f.declaration_printed}</p></div></div></Card>;
  const figures = <Card title={`FY ${x.fy} so far`} subtitle={`${rangeLabel(x.from, x.to)} · every bill counted`} actions={<ButtonLink size="sm" variant="ghost" icon={ReceiptText} to={`/reports?firm=${f.id}`}>Reports</ButtonLink>}><div className="grid grid-cols-2 gap-x-4 gap-y-5">
    <Figure label="Sales" value={x.sales.total} size={isPhone ? "lg" : "xl"} tone="sale" caption={`${plural(x.sales.bills, "bill")}${cancelledNote(x.sales.cancelled)} · incl. GST`} />
    <Figure label="Purchases" value={x.purchases.total} size={isPhone ? "lg" : "xl"} tone="amber" caption={`${plural(x.purchases.bills, "bill")} · incl. GST`} />
    <Figure label="GST on sales" value={x.sales.tax} size="lg" caption="Output tax" /><Figure label="GST on purchases" value={x.purchases.tax} size="lg" caption="Input tax credit" />
  </div><p className="text-sm text-muted mt-4">{plural(x.customers, "customer")} billed in FY {x.fy}.{x.first_bill && x.last_bill ? ` This year's numbers run ${x.first_bill.invoice_number} to ${x.last_bill.invoice_number}.` : ""}</p></Card>;
  const recent = <Card title="Latest bills" subtitle="Sales bills, newest first" actions={<Button size="sm" variant="ghost" iconRight={ChevronRight} onClick={allBills}>All {f.short} bills</Button>}>{f.recent.length ? <ul className="flex flex-col">{f.recent.map((b) => <li key={b.id} className="border-t border-rule first:border-t-0"><Link to={`/sales/${b.id}`} className={cn("flex items-baseline justify-between gap-3 hover:bg-raised/50 rounded-sm", isPhone ? "px-4 py-3 min-h-14" : "py-2")}><span className="min-w-0"><span className="block font-medium tnum truncate">{b.invoice_number}</span><span className="block text-sm text-muted truncate">{dateShort(b.invoice_date)} · {b.customer_name} · {PAY_SHORT[b.payment_mode]}</span></span><Money value={b.total_amount} className={cn("shrink-0", b.status === "cancelled" && "line-through text-muted")} /></Link></li>)}</ul> : <p className="text-fg2">No bills yet. The first one will be {f.numbers.next.invoice_number}.</p>}</Card>;
  const returns = <Card title="GST returns" subtitle={`FY ${x.fy} · month by month`} actions={!isPhone ? <ButtonLink size="sm" variant="ghost" icon={Landmark} to={`/gst?firm=${f.id}`}>Open GST returns</ButtonLink> : null}><ul className="flex flex-col">{f.months.map((m, i) => <li key={m.month} className={cn("flex items-center justify-between gap-3 py-2", i > 0 && "border-t border-rule")}><span><span className="block">{monthLabel(m.month, { long: true })}</span>{m.state === "filed" && (m.gstr1_filed_on || m.gstr3b_filed_on) ? <span className="block text-xs text-muted">GSTR-1 {date(m.gstr1_filed_on)} · GSTR-3B {date(m.gstr3b_filed_on)}</span> : null}</span><ReturnBadge state={m.state} short={isPhone} /></li>)}</ul>{isPhone ? <ListRow to={`/gst?firm=${f.id}`} title="Open GST returns" leading={<Landmark size={18} className="text-fg2" aria-hidden="true" />} /> : null}</Card>;
  return <Page icon={Building2} breadcrumbs={[{ label: "Firms", to: "/firms" }]} title={f.name} back="/firms" context={`${f.gst_number || "No GSTIN yet"} · ${stateLabel(f.state_name)} · ${f.city || "No city"}`} phoneSubtitle={`${f.gst_number || "No GSTIN"} · ${f.short}`} actions={<><Menu title={f.name} width={300} items={menu} trigger={(t) => <Button {...t} icon={MoreHorizontal}>More</Button>} />{owner ? <ButtonLink to={`/firms/${f.id}/edit`} variant="primary" icon={Pencil}>Edit firm details</ButtonLink> : <Button variant="primary" icon={Pencil} disabled title={whyNot("firm.edit", "change firm details")}>Edit firm details</Button>}</>} phoneActions={<>{owner ? <IconButton label={`Edit ${f.name}`} icon={Pencil} onClick={() => navigate(`/firms/${f.id}/edit`)} /> : null}<Menu title={f.name} items={menu} trigger={(t) => <IconButton {...t} label={`More for ${f.name}`} icon={MoreVertical} />} /></>}>
    {!owner ? <WhyNote>{whyNot("firm.edit", "change firm details")}</WhyNote> : null}
    {isPhone ? <>{figures}{recent}{registration}{bank}{numbering}{small}{returns}</> : <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-5 items-start"><div className="flex flex-col gap-5 min-w-0">{registration}{bank}{numbering}{small}</div><div className="flex flex-col gap-5 min-w-0">{figures}{recent}{returns}</div></div>}
    <ConfirmDialog open={del} busy={remove.isPending} busyLabel="Deleting…" onClose={() => { setDel(false); setError(null); }} onConfirm={() => { void erase(); }} tone="danger" title={`Delete ${f.name}?`} confirmLabel="Delete firm" record={[["Firm", f.name], ["GSTIN", f.gst_number || "None"], ["Bills", "None"]]} ack={`I understand ${f.name} goes off every list and the bill form.`} extra={<SaveError problem={error} onRetry={() => { void erase(); }} />}><p>People who work in it lose it from their list. It can be restored from the Audit log.</p></ConfirmDialog>
  </Page>;
}
