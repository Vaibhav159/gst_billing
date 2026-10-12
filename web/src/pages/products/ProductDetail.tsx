// Port of PROTO records/ProductDetail.jsx. All quantities, totals, history and deletion uses come from catalog/{id}/.
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Package, Pencil, Info, Plus, Trash2, MoreHorizontal, MoreVertical, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useDeleteProduct, useProduct, useRestoreProduct, type ProductDetail as Product } from "@/core/api/catalog";
import { problemOf } from "@/core/api/errors";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { date, dateShort, inr, monthLabel, plural, qty } from "@/core/format";
import { rateText } from "@/core/sales/words";
import { useFirms, useScope } from "@/core/scope";
import { Page, Card, Button, ButtonLink, IconButton, Money, Figure, Banner, EmptyState, DL, Table, Th, Td, Tr, Menu, QueryView, ConfirmDialog, useToast, type MenuItem } from "@/core/ui";
import { useView } from "@/core/view";
import { fyPeriod, notCounted, scopeName, useJustSaved } from "@/pages/customers/lib";
import { MissingRecord, SaveError, WhyNote } from "@/pages/customers/parts";
import { idParam } from "@/pages/sales/form/model";
import { KIND_LABEL, perUnit, slabSplit, soldQuantity, unitName, usualRate } from "./lib";

function HsnOnBills({ p }: { p: Product }) {
  const { can, whyNot } = useAuth();
  const { groups, lines, blocking } = p.hsn_on_bills;
  const none = groups.find((g) => !g.hsn_code);
  const other = groups.filter((g) => g.hsn_code && !g.matches);
  const odd = groups.some((g) => !g.matches);
  const returns = [...new Set(blocking.map((b) => `${b.business.short}'s ${monthLabel(b.month, { long: true }).split(" ")[0]}`))];
  const fix = blocking[0]?.bill;
  return <Card title="HSN on bills" subtitle={lines ? `${plural(lines, "bill line")} with this product, every year` : "No bill lines yet"}>
    {!lines ? <p className="text-fg2">Bills made with this product will show which HSN they carried.</p> : !odd ? <p className="text-fg2 flex items-start gap-2"><CheckCircle2 size={16} className="text-sale mt-0.5 shrink-0" aria-hidden="true" />Every bill line used HSN {p.hsn_code}, as set here.</p> : <div className="flex flex-col gap-3">
      {none ? <Banner tone="neg" icon={AlertTriangle} title={`${plural(none.lines, "line")} ${none.lines === 1 ? "has" : "have"} no HSN code`} actions={fix && can("bill.edit") ? <ButtonLink size="sm" to={`/sales/${fix.id}/edit`}>Add the HSN code</ButtonLink> : undefined}>
        {returns.length ? `${returns.join(" and ")} GSTR-1 can't be filed until it's added${blocking.length > 1 ? ` (${blocking.map((b) => b.bill.invoice_number).join(", ")})` : ""}.` : "Every return those lines are in is filed already; add the code if the bill is corrected."}{fix && !can("bill.edit") ? ` ${whyNot("bill.edit")}` : ""}
      </Banner> : null}
      {other.length ? <p className="text-fg2 flex items-start gap-2"><AlertTriangle size={16} className="text-neg mt-0.5 shrink-0" aria-hidden="true" /><span>{plural(other.reduce((a, g) => a + g.lines, 0), "line")} used another HSN. GSTR-1's HSN summary lists them under that code; fix them on the bill if they're wrong.</span></p> : null}
      <ul className="flex flex-col divide-y divide-rule">{groups.map((g) => <li key={g.hsn_code || "none"} className="py-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className={cn("font-medium tnum", !g.matches && "text-neg")}>{g.hsn_code ? `HSN ${g.hsn_code}` : "No HSN"}{g.matches ? <span className="text-muted font-normal"> · as set here</span> : null}</span>
        <p className="text-sm text-muted">{plural(g.lines, "line")}{!g.matches ? <>{g.sales.map((b) => <span key={`s${b.id}`}> · <Link to={`/sales/${b.id}`} className="link tnum">{b.invoice_number}</Link></span>)}{g.purchases.map((b) => <span key={`p${b.id}`}> · <Link to={`/purchases/${b.id}`} className="link">{b.bill_no}</Link></span>)}</> : null}</p>
      </li>)}</ul>
    </div>}
  </Card>;
}
export default function ProductDetail() {
  const { id } = useParams();
  const pid = idParam(id ?? null);
  const { firmId, fy } = useScope();
  const [all, setAll] = useState(false);
  const query = useProduct(pid, { firmId, fy }, all);
  if (pid === null || (query.isError && problemOf(query.error).kind === "notfound")) return <MissingRecord icon={Package} title="This product isn't on file" to="/products" label="All products" />;
  return <QueryView query={query} what="the product">{(p) => <Detail key={p.id} p={p} all={all} setAll={setAll} />}</QueryView>;
}
function Detail({ p, all, setAll }: { p: Product; all: boolean; setAll: (v: boolean) => void }) {
  const { firmId, fy: year } = useScope();
  const { firms } = useFirms();
  const { isPhone } = useView();
  const navigate = useNavigate();
  const { can, whyNot } = useAuth();
  const flash = useJustSaved("product") === p.id;
  const [del, setDel] = useState(false);
  const remove = useDeleteProduct();
  const restore = useRestoreProduct();
  const toast = useToast();
  const fy = fyPeriod(year);
  const scope = scopeName(firms, firmId);
  const owner = can("product.edit");
  const { sold, bought } = p;
  const used = Object.values(p.uses).some((n) => n > 0);
  const doDelete = async () => {
    if (remove.isPending) return;
    try {
      const answer = await remove.mutateAsync(p.id);
      toast.show({ title: `${p.name} deleted`, body: "It's also in the Audit log, to restore later.", action: { label: "Undo", onClick: () => {
        void restore.mutateAsync(answer.audit_id).then((r) => { toast.show({ title: `${p.name} restored` }); navigate(r.link); }).catch((e) => toast.show({ tone: "neg", title: "The product wasn't restored", body: problemOf(e).message }));
      } } });
      navigate("/products", { replace: true });
    } catch { /* The mutation's words stay in the confirmation. */ }
  };
  const menu: MenuItem[] = [
    { label: "Edit product", icon: Pencil, disabled: !owner, hint: owner ? undefined : whyNot("product.edit"), to: `/products/${p.id}/edit` },
    { divider: true },
    { label: "Delete product…", icon: Trash2, tone: "danger", disabled: !owner || used, hint: !owner ? whyNot("product.edit") : used ? `On ${plural(p.uses.sales, "sales bill")}, ${plural(p.uses.cancelled, "cancelled bill")}, ${plural(p.uses.purchases, "purchase bill")} and ${plural(p.uses.bin, "bill")} in the bin. Mark it Bought only to hide it instead.` : "It's on no bills", onSelect: () => setDel(true) },
  ];
  const details = <DL rows={[
    ["HSN code", <span key="h"><span className="tnum">{p.hsn_code}</span><span className="block text-xs text-muted">{p.hsn_text || "Printed on every bill line"}</span></span>],
    ["GST rate", <span key="g"><span className="font-semibold">{p.slab_ok ? `${p.gst_percent}%` : "Not a GST rate"}</span><span className="block text-xs text-muted">{slabSplit(p.gst_percent)}</span></span>],
    ["Unit", unitName(p.unit)], ["Purity", p.purity || "None"],
    ["Usual rate", <span key="r">{usualRate(p)}<span className="block text-xs text-muted">Shown on the product; bills take the rate written on the paper bill</span></span>],
    ["Kind", KIND_LABEL[p.kind_effective]], ["On sales bills", p.purchase_only ? "No · bought only" : "Yes"],
    p.description ? ["Description", <span key="d" className="text-fg2">{p.description}</span>] : null,
    p.earlier_names.length ? ["Earlier names", p.earlier_names.join(", ")] : null,
  ]} />;
  const soldFigures = <div className={cn("grid gap-x-4 gap-y-5", isPhone ? "grid-cols-2" : "grid-cols-4 divide-x divide-rule -mx-5 gap-x-0")}>
    <Figure className={isPhone ? "" : "px-5"} label="Quantity sold" value={<span className="text-2xl font-semibold tnum">{soldQuantity(sold, p.unit)}</span>} caption={`in ${plural(sold.bills, "bill")}${notCounted(sold.cancelled ?? 0)}`} />
    <Figure className={isPhone ? "" : "px-5"} label="Value before GST" value={<Money value={sold.taxable} size={isPhone ? "xl" : "2xl"} tone="sale" />} caption="Taxable value" />
    <Figure className={isPhone ? "" : "px-5"} label={`GST charged · ${p.gst_percent}%`} value={<Money value={sold.tax} size={isPhone ? "lg" : "2xl"} />} caption={`Bills total ${inr(sold.taxable + sold.tax)}`} />
    <Figure className={isPhone ? "" : "px-5"} label="Average rate" value={<span className="text-2xl font-semibold tnum">{p.average_rate ? rateText(p.average_rate) : "—"}</span>} caption={`${perUnit(p.unit)}, as billed`} />
  </div>;
  const boughtLine = <p className="text-sm text-fg2">Bought · {fy.label} · {scope}: {bought.bills ? <><span className="tnum font-medium text-fg">{soldQuantity(bought, p.unit)}</span> in {plural(bought.bills, "purchase bill")}, <Money value={bought.taxable} className="text-fg" /> before GST, <Money value={bought.tax} /> GST paid (input tax credit)</> : "nothing on purchase bills"}</p>;
  const byFirm = <Card title="By firm" subtitle={`${fy.label} · sold and bought`} pad={false}>{isPhone ? <ul className="mt-2">{p.by_firm.map(({ business: f, sold: s }) => <li key={f.id} className="flex items-baseline justify-between gap-3 px-4 py-3 border-t border-rule"><span className="min-w-0"><span className="block font-medium">{f.name}</span>{s.bills ? <span className="block text-sm text-muted">{plural(s.bills, "bill")}</span> : null}</span>{s.bills ? <span className="text-right"><span className="block tnum">{soldQuantity(s, p.unit)}</span><Money value={s.taxable} className="text-sm text-fg2" /></span> : <span className="text-muted">Not sold</span>}</li>)}</ul> : <Table label={`${p.name} by firm`} className="mt-2"><thead><tr><Th>Firm</Th><Th align="right">Sold</Th><Th align="right">Value before GST</Th><Th align="right">Bills</Th><Th align="right">Bought</Th><Th align="right">Purchase value</Th></tr></thead><tbody>{p.by_firm.map(({ business: f, sold: s, bought: b }) => <Tr key={f.id}><Td className="font-medium">{f.name}</Td><Td align="right">{s.bills ? soldQuantity(s, p.unit) : "—"}</Td><Td align="right">{s.bills ? <Money value={s.taxable} /> : "—"}</Td><Td align="right">{s.bills}</Td><Td align="right">{b.bills ? soldQuantity(b, p.unit) : "—"}</Td><Td align="right">{b.bills ? <Money value={b.taxable} /> : "—"}</Td></Tr>)}</tbody></Table>}</Card>;
  const lines = <Card title={isPhone ? "Latest sales bill lines" : `Sales bill lines · ${fy.label}`} subtitle={`${plural(p.line_count, "line")} in ${plural(sold.bills, "bill")}${notCounted(sold.cancelled ?? 0)} · newest first · ${scope}`} pad={false}>
    {p.lines.length ? isPhone ? <ul className="mt-2">{p.lines.map((l, i) => <li key={`${l.bill.id}:${i}`} className="border-t border-rule"><Link to={`/sales/${l.bill.id}`} className="flex items-baseline justify-between gap-3 px-4 py-3 min-h-14 hover:bg-raised/60"><span className="min-w-0"><span className="block font-medium tnum truncate">{l.bill.invoice_number}</span><span className="block text-sm text-muted truncate">{dateShort(l.bill.invoice_date)} · {l.bill.customer_name}</span></span><span className="text-right shrink-0"><span className="block tnum">{qty(Number(l.quantity), l.unit)}</span><Money value={l.taxable} className="text-sm text-fg2" /></span></Link></li>)}</ul> : <Table label={`Sales bill lines with ${p.name}`} className="mt-2"><thead><tr><Th>Date</Th><Th>Bill no.</Th><Th>Customer</Th><Th>Firm</Th><Th align="right">Quantity</Th><Th align="right">Rate</Th><Th align="right">Value before GST</Th></tr></thead><tbody>{p.lines.map((l, i) => <Tr key={`${l.bill.id}:${i}`} onClick={() => navigate(`/sales/${l.bill.id}`)}><Td className="tnum whitespace-nowrap">{date(l.bill.invoice_date)}</Td><Td><Link to={`/sales/${l.bill.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-brand hover:underline tnum">{l.bill.invoice_number}</Link></Td><Td>{l.bill.customer_name}</Td><Td className="text-fg2">{l.business.short}</Td><Td align="right">{qty(Number(l.quantity), l.unit)}</Td><Td align="right">{rateText(l.rate)}</Td><Td align="right"><Money value={l.taxable} strong /></Td></Tr>)}</tbody></Table> : <EmptyState icon={Package} title={p.purchase_only ? "Not on sales bills" : `Not sold in ${fy.label}`}>{p.purchase_only ? "Bought-only products never appear on sales bills." : firmId !== "all" ? `Only ${scope}'s bills are counted. Pick All firms in the firm picker to see the rest.` : "Sales bills with this product will list here."}</EmptyState>}
    {p.line_count > 8 ? <div className="border-t border-rule px-5 py-3"><Button variant="link" onClick={() => setAll(!all)}>{all ? "Show the latest 8" : p.line_count > 200 ? "Show the latest 200 lines" : `Show all ${p.line_count} lines`}</Button>{all && p.line_count > 200 ? <p className="text-sm text-muted">Showing the latest 200 of {p.line_count} lines.</p> : null}</div> : null}
  </Card>;
  return <Page icon={Package} breadcrumbs={[{ label: "Products", to: "/products" }]} title={p.name} back={isPhone ? "/products" : undefined} context={`HSN ${p.hsn_code} · GST ${p.gst_percent}% · ${perUnit(p.unit)}${p.purity ? ` · ${p.purity}` : ""}`} phoneSubtitle={`HSN ${p.hsn_code} · ${p.gst_percent}% · ${perUnit(p.unit)}`}
    actions={<>{owner ? <ButtonLink to={`/products/${p.id}/edit`} icon={Pencil}>Edit</ButtonLink> : <Button icon={Pencil} disabled title={whyNot("product.edit")}>Edit</Button>}<Menu title={p.name} width={300} items={menu.slice(2)} trigger={(t) => <Button {...t} icon={MoreHorizontal}>More</Button>} />{!p.purchase_only && can("bill.create") ? <ButtonLink to={`/sales/new?product=${p.id}`} variant="primary" icon={Plus}>New bill</ButtonLink> : null}</>}
    phoneActions={<>{owner ? <IconButton label={`Edit ${p.name}`} icon={Pencil} onClick={() => navigate(`/products/${p.id}/edit`)} /> : null}<Menu title={p.name} items={menu} trigger={(t) => <IconButton {...t} label={`More for ${p.name}`} icon={MoreVertical} />} /></>}>
    {p.purchase_only ? <Banner tone="muted" icon={Info} title="Bought only, never sold">It doesn't show when making a sales bill. Purchase bills still use it, so its input tax credit is counted.</Banner> : null}
    {!owner ? <WhyNote>{whyNot("product.edit")}</WhyNote> : null}
    <div className={isPhone ? "flex flex-col gap-5" : "grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-5 items-start"}>
      <div className="flex flex-col gap-5 min-w-0"><Card title={isPhone ? undefined : "On every bill line"}><div className={cn("rounded-ctl -mx-2 px-2", flash && "anim-flash")}>{details}</div></Card>{!isPhone ? <HsnOnBills p={p} /> : null}</div>
      <div className="flex flex-col gap-5 min-w-0"><Card title={`Sold · ${fy.label}`} subtitle={`${fy.range} · ${scope} · from the lines of every sales bill`}>{soldFigures}<div className="border-t border-rule mt-5 pt-4">{boughtLine}</div></Card>{byFirm}</div>
    </div>
    {isPhone ? <HsnOnBills p={p} /> : null}{lines}
    <ConfirmDialog open={del} busy={remove.isPending} busyLabel="Deleting…" onClose={() => { setDel(false); remove.reset(); }} onConfirm={() => void doDelete()} tone="danger" title={`Delete ${p.name}?`} confirmLabel="Delete product" record={[["Product", p.name], ["HSN · GST", `${p.hsn_code} · ${p.gst_percent}%`], ["On bills", "None"]]} extra={<SaveError problem={remove.isError ? problemOf(remove.error) : null} onRetry={() => void doDelete()} />}>
      <p>It goes off the product list and the bill form. It can be restored from the Audit log.</p>
    </ConfirmDialog>
  </Page>;
}
