import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Truck, Plus, Pencil, BadgeCheck, Search, ShoppingBag } from "lucide-react";
import { useSuppliers, useSupplier } from "@/core/api/suppliers";
import type { SupplierRef, PurchaseRow, SupplierDetail as SupplierDetailData } from "@/core/purchases/types";
import { SupplierSheet } from "@/pages/purchases/suppliers/SupplierSheet";
import { PurchaseBadges } from "@/pages/purchases/bill/parts";
import { problemOf } from "@/core/api/errors";
import { useAuth } from "@/core/auth/AuthProvider";
import { date, dateShort, inr, plural, qty, toPaise } from "@/core/format";
import { stateCodeOf, stateTitle, hasGstin } from "@/core/ids";
import { autoPos, isInterState } from "@/core/sales/pos";
import { storedIgst } from "@/core/sales/words";
import { useScope, useFirms, type Firm, type FirmId } from "@/core/scope";
import { FirmChips } from "@/core/shell/ScopePickers";
import { useDebounced } from "@/core/useDebounced";
import { useView } from "@/core/view";
import { Page, Card, Button, ButtonLink, Money, Figure, SearchInput, Table, Th, Td, Tr, EmptyState, DL, ListSkeleton, QueryView, cn, useNewIds } from "@/core/ui";
import { scopeName, openOnEnter, useMoreFocus } from "@/pages/customers/lib";
import { MoreButton } from "@/pages/customers/listParts";

export function supplierTax(s: SupplierRef, firms: Firm[], firmId: FirmId | null): "none" | "local" | "inter" | "mixed" | "unknown" {
  if (!hasGstin(s.gst_number)) return "none";
  const relevant = firmId === "all" ? firms : firms.filter(f => f.id === firmId);
  const codes = relevant.map(f => autoPos(stateCodeOf(f.state), { type: "business", gst_number: f.gstin }));
  if (!s.state_code || !codes.length || codes.some(c => !c)) return "unknown";
  const inter = codes.map(code => isInterState(code, s.state_code));
  return inter.every(Boolean) ? "inter" : inter.some(Boolean) ? "mixed" : "local";
}
function useSheet() {
  const [open, setOpen] = useState(false);
  const saved = () => setOpen(false);
  return { open, setOpen, saved };
}
export function SupplierList() {
  const { firmId, setFirmId, fy } = useScope(), { firms } = useFirms(), { isPhone } = useView(), { can } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const term = useDebounced(q.trim());
  const query = useSuppliers(firmId, fy, term, "-total"), sheet = useSheet();
  const suppliers = query.data?.pages.flatMap(p => p.results) ?? [];
  const fresh = useNewIds(suppliers.map(s => String(s.id))), focusMore = useMoreFocus(suppliers.map(s => s.id));
  const scope = scopeName(firms, firmId), total = query.data?.pages[0]?.summary;
  const summary = total ? `${scope} · FY ${fy} · ${plural(total.suppliers, "supplier")}${term ? ` matching “${term}”` : ""} · purchases ${inr(total.total)} · GST on their bills ${inr(total.tax)}` : `${scope} · FY ${fy}`;
  const add = can("supplier.edit") ? <Button variant="primary" size={isPhone ? "lg" : "md"} icon={Plus} onClick={() => sheet.setOpen(true)}>Add supplier</Button> : null;
  const empty = <EmptyState icon={Search} title={term ? "No supplier matches" : "No suppliers yet"} actions={term ? <Button onClick={() => setQ("")}>Clear search</Button> : null}>{term ? "Search by name, city, state or GSTIN." : "Suppliers are added when you enter their first bill, or here."}</EmptyState>;
  return <Page icon={Truck} title="Suppliers" context={summary} phoneSubtitle={`${scope} · ${total ? plural(total.suppliers, "supplier") : `FY ${fy}`}`} back={isPhone ? "/purchases" : undefined} breadcrumbs={[{ label: "Purchases", to: "/purchases" }]} actions={isPhone ? undefined : add} actionBar={isPhone ? add : undefined}>
    {isPhone ? <FirmChips firms={firms} value={firmId} onChange={setFirmId} /> : null}
    {isPhone ? <>{total ? <Card><p className="caps">Purchases · FY {fy} · {scope}</p><div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 mt-1.5"><Money value={total.total} size="2xl" /><span className="text-right ml-auto"><span className="block text-xs text-muted">GST on their bills</span><Money value={total.tax} strong /></span></div></Card> : null}<SearchInput value={q} onChange={setQ} placeholder="Name, city or GSTIN" label="Search suppliers" /></> : null}
      <Card pad={false}>
        {!isPhone ? <div className="px-5 py-4 border-b border-rule flex flex-wrap items-center gap-3"><SearchInput className="w-[340px]" value={q} onChange={setQ} placeholder="Name, city, state or GSTIN" label="Search suppliers" data-page-search="" /><span className="text-sm text-muted">Figures follow the firm picked at the top: {scope}.</span></div> : null}
        <QueryView query={query} what="suppliers" skeleton={<ListSkeleton rows={7} what="suppliers" />}>{data => <>
        {!suppliers.length ? empty : isPhone ? suppliers.map(s => <Link key={s.id} to={`/suppliers/${s.id}`} data-row={s.id} className={cn("flex gap-3 px-4 py-3 border-t border-rule first:border-t-0 active:bg-raised/60", fresh.has(String(s.id)) && "anim-flash")}><span className="flex-1 min-w-0"><span className="block font-medium line-clamp-2 break-words">{s.name}</span><span className="block text-sm text-muted tnum break-words">{s.gst_number || "No GSTIN"} · {stateTitle(s.state_name)}</span></span><span className="text-right shrink-0">{s.figures.bills ? <Money value={s.figures.total} strong /> : <span className="text-muted text-sm">No bills</span>}<span className="block text-xs text-muted mt-0.5">{plural(s.figures.bills, "purchase bill")}</span></span></Link>) : <Table label="Suppliers by purchases this year">
          <thead><tr><Th>Supplier</Th><Th>GSTIN</Th><Th>State</Th><Th align="right">Purchase bills</Th><Th align="right">Purchases this FY</Th><Th align="right">GST on their bills</Th><Th>Last purchase</Th></tr></thead>
          <tbody>{suppliers.map(s => <Tr key={s.id} data-row={s.id} tabIndex={-1} onKeyDown={openOnEnter(() => navigate(`/suppliers/${s.id}`))} onClick={() => navigate(`/suppliers/${s.id}`)} className={cn(fresh.has(String(s.id)) && "anim-flash")}><Td><Link to={`/suppliers/${s.id}`} onClick={e => e.stopPropagation()} className="font-medium hover:text-brand">{s.name}</Link><span className="block text-xs text-muted">{s.city}</span></Td><Td className="tnum text-fg2">{s.gst_number || "None"}</Td><Td className="text-fg2">{stateTitle(s.state_name)}{supplierTax(s, firms, firmId) === "inter" ? <span className="block text-xs text-muted">IGST on their bills</span> : null}</Td><Td align="right">{s.figures.bills}</Td><Td align="right">{s.figures.bills ? <Money value={s.figures.total} strong /> : <span className="text-muted">—</span>}</Td><Td align="right">{s.figures.bills ? s.figures.tax ? <Money value={s.figures.tax} /> : <span className="text-muted">No GST</span> : <span className="text-muted">—</span>}</Td><Td className="tnum text-fg2 whitespace-nowrap">{s.figures.last ? date(s.figures.last.invoice_date) : <span className="text-muted">None this year</span>}</Td></Tr>)}</tbody>
          <tfoot><tr className="border-t-2 border-line"><th scope="row" colSpan={3} className="text-left py-3 pl-5 pr-3 font-semibold">{plural(data.pages[0].summary.suppliers, "supplier")}</th><td className="py-3 px-3 text-right tnum font-semibold">{data.pages[0].summary.bills}</td><td className="py-3 px-3 text-right tnum whitespace-nowrap"><Money value={data.pages[0].summary.total} strong /></td><td className="py-3 px-3 text-right tnum whitespace-nowrap font-semibold"><Money value={data.pages[0].summary.tax} /></td><td className="py-3 pr-5" /></tr></tfoot>
        </Table>}
        <MoreButton shown={suppliers.length} total={data.pages[0].count} what="suppliers" pageSize={100} loading={query.isFetchingNextPage} problem={query.isFetchNextPageError ? problemOf(query.error) : null} onMore={() => { focusMore(); void query.fetchNextPage(); }} />
        </>}</QueryView>
      </Card>
    <SupplierSheet open={sheet.open} onClose={() => sheet.setOpen(false)} onSaved={() => { sheet.saved(); setQ(""); }} />
  </Page>;
}

/** Read the row's stored totals; never reprice historical bills from the supplier's current state. */
function billItems(p: PurchaseRow) {
  const first = p.first_line;
  if (!first) return "No items";
  return `${first.product_name} · ${first.amount_only ? "amount only" : qty(Number(first.quantity), first.unit)}${p.line_count > 1 ? ` · ${plural(p.line_count - 1, "more item")}` : ""}`;
}
export function SupplierDetail() {
  const { id } = useParams(), number = Number(id);
  const sid = Number.isSafeInteger(number) && number > 0 ? number : null;
  const { firmId, fy } = useScope();
  const query = useSupplier(sid, firmId, fy);
  if (sid === null || query.isError && problemOf(query.error).kind === "notfound") return <Page icon={Truck} title="Supplier not found" breadcrumbs={[{ label: "Purchases", to: "/purchases" }, { label: "Suppliers", to: "/suppliers" }]} back="/suppliers"><Card><EmptyState icon={Search} title="There's no supplier with this link" actions={<ButtonLink to="/suppliers">All suppliers</ButtonLink>}>It may have been typed wrong.</EmptyState></Card></Page>;
  return <QueryView query={query} what="this supplier" skeleton={<Page icon={Truck} title="Supplier" back="/suppliers"><ListSkeleton rows={5} what="this supplier's bills" /></Page>}>{data => <SupplierContent data={data} />}</QueryView>;
}
function SupplierContent({ data }: { data: SupplierDetailData }) {
  const { supplier: s, figures: st, rates, bills } = data;
  const { firmId, setFirmId, fy } = useScope(), { firms } = useFirms(), { isPhone } = useView(), { can } = useAuth();
  const navigate = useNavigate(), sheet = useSheet();
  const scope = scopeName(firms, firmId), taxWay = supplierTax(s, firms, firmId);
  const add = `/purchases/new?supplier=${s.id}${typeof firmId === "number" ? `&firm=${firmId}` : ""}`;
  const taxWords = taxWay === "none" ? "None: no GSTIN, so no GST and no credit" : taxWay === "inter" ? "IGST: they're in another state" : taxWay === "mixed" ? "CGST + SGST for firms in their state; IGST for the others" : taxWay === "local" ? firmId === "all" ? "CGST + SGST: same state as all firms" : "CGST + SGST: same state as the firm picked" : "Pick a firm to see the tax on their bills";
  const contact = <Card title="Contact and tax"><DL rows={[
    ["GSTIN", <span key="g" className="inline-flex items-center gap-1.5 tnum">{s.gst_number || "None"}{s.gst_number && s.gstin_valid ? <BadgeCheck size={15} className="text-sale" aria-label="Checks out" /> : null}</span>],
    s.pan ? ["PAN", <span key="p" className="tnum">{s.pan}</span>] : null,
    ["State", `${stateTitle(s.state_name)}${s.state_code ? ` (${s.state_code})` : ""}`],
    s.address ? ["Address", <span key="ad" className="block text-right max-w-[220px] ml-auto">{s.address}</span>] : ["City", s.city || "—"],
    ["Phone", s.mobile_number ? <span key="ph" className="tnum">{s.mobile_number}</span> : "—"],
    s.email ? ["Email", s.email] : null,
    ["Tax on their bills", taxWords],
    s.prefix ? ["Their bill numbers", <span key="x" className="tnum">{s.prefix}…</span>] : null,
  ]} /></Card>;
  const creditNote = !st.bills ? "" : !st.tax ? "No GST, so no credit" : st.credit === st.tax ? "All of it is input tax credit" : `Credit claimed: ${inr(st.credit)}`;
  const figures = <div className={cn("grid gap-4", isPhone ? "grid-cols-2" : "grid-cols-[repeat(auto-fit,minmax(170px,1fr))]")}>
    <Figure label="Purchase bills" value={<span className="text-2xl font-semibold tnum">{st.bills}</span>} caption={st.last ? `Last on ${date(st.last.invoice_date)}` : "None this year"} />
    <Figure label="Purchases incl. GST" value={st.total} size={isPhone ? "xl" : "2xl"} tone="amber" />
    <Figure label="GST on their bills" value={st.tax} size={isPhone ? "xl" : "2xl"} caption={creditNote} className={isPhone ? "col-span-2" : ""} />
  </div>;
  const firmShort = (p: PurchaseRow) => firms.find(f => f.id === p.business)?.short ?? p.business_name;
  const list = bills.length ? <Card title="Their bills" subtitle={`${scope} · FY ${fy}${isPhone ? "" : " · newest first"}`} pad={false}>
    {isPhone ? <div className="mt-2">{bills.map(p => <Link key={p.id} to={`/purchases/${p.id}`} data-row={p.id} className="flex gap-3 px-4 py-3 border-t border-rule active:bg-raised/60"><span className="flex-1 min-w-0"><span className="block font-medium tnum break-words">{p.invoice_number}</span><span className="block text-sm text-muted">{dateShort(p.invoice_date)} · {firmShort(p)}</span><span className="block text-sm text-muted">{billItems(p)}</span><span className="block mt-1.5"><PurchaseBadges p={p} /></span></span><span className="text-right shrink-0"><Money value={p.total_amount} strong /><span className="block text-xs text-muted">{p.tax ? `GST ${inr(p.tax)}` : "No GST"}</span></span></Link>)}</div> : <Table label={`Purchase bills from ${s.name}`} className="mt-2">
      <thead><tr><Th>Date</Th><Th>Supplier's bill no. · items</Th>{firmId === "all" ? <Th>Firm</Th> : null}<Th align="right">Taxable</Th><Th align="right">GST</Th><Th align="right">Total</Th><Th align="right">Credit</Th></tr></thead>
      <tbody>{bills.map(p => <Tr key={p.id} data-row={p.id} tabIndex={-1} onKeyDown={openOnEnter(() => navigate(`/purchases/${p.id}`))} onClick={() => navigate(`/purchases/${p.id}`)}><Td className="tnum whitespace-nowrap">{date(p.invoice_date)}</Td><Td className="min-w-[180px]"><Link to={`/purchases/${p.id}`} onClick={e => e.stopPropagation()} className="font-medium hover:text-brand tnum">{p.invoice_number}</Link><span className="block text-xs text-muted">{billItems(p)}</span><span className="block mt-1"><PurchaseBadges p={p} /></span></Td>{firmId === "all" ? <Td className="text-fg2">{firmShort(p)}</Td> : null}<Td align="right"><Money value={p.taxable} /></Td><Td align="right">{p.tax ? <><Money value={p.tax} /><span className="block text-xs text-muted">{storedIgst(p) ? "IGST" : "CGST + SGST"} · {p.gst_percents.map(s => `${s}%`).join(", ")}</span></> : <span className="text-muted">No GST</span>}</Td><Td align="right"><Money value={p.total_amount} strong /></Td><Td align="right">{p.credit.eligible ? <Money value={p.credit.claimed} /> : <span className="text-muted">{p.tax ? "Not claimed" : "None"}</span>}</Td></Tr>)}</tbody>
    </Table>}
    {st.bills > bills.length ? <div className="px-5 py-3 border-t border-rule"><ButtonLink to={`/purchases?supplier=${s.id}${typeof firmId === "number" ? `&firm=${firmId}` : ""}&fy=${fy}`}>See all {st.bills} purchase bills</ButtonLink></div> : null}
  </Card> : <Card><EmptyState icon={ShoppingBag} title={`No bills from ${s.name} this year`} actions={can("purchase.create") ? <ButtonLink to={add} variant="primary" icon={Plus}>Add a purchase from them</ButtonLink> : null}>{firmId !== "all" ? <>Nothing for {scope}. <button type="button" className="link" onClick={() => setFirmId("all")}>Show all firms</button></> : "Their bills show here once entered."}</EmptyState></Card>;
  const ratesCard = rates.length ? <Card title="What you paid them" subtitle={`Average rate per unit · ${scope} · FY ${fy}`} pad={false}>
    {isPhone ? <ul className="mt-2">{rates.map(r => <li key={`${r.product_name}|${r.unit}`} className="px-4 py-3 border-t border-rule flex items-start gap-3"><span className="flex-1 min-w-0"><span className="block font-medium">{r.product_name}</span><span className="block text-sm text-muted">{qty(Number(r.quantity), r.unit)} over {plural(r.bills, "bill")} · {inr(toPaise(r.low))} to {inr(toPaise(r.high))}</span></span><span className="text-right shrink-0"><Money value={toPaise(r.average)} strong /><span className="block text-xs text-muted">per {r.unit}</span></span></li>)}</ul> : <Table label={`Average rates paid to ${s.name}`} className="mt-2"><thead><tr><Th>Item</Th><Th align="right">Bought</Th><Th align="right">Bills</Th><Th align="right">Lowest rate</Th><Th align="right">Highest rate</Th><Th align="right">Average rate</Th></tr></thead><tbody>{rates.map(r => <Tr key={`${r.product_name}|${r.unit}`}><Td className="font-medium">{r.product_name}</Td><Td align="right">{qty(Number(r.quantity), r.unit)}</Td><Td align="right">{r.bills}</Td><Td align="right"><Money value={toPaise(r.low)} /><span className="block text-xs text-muted">per {r.unit}</span></Td><Td align="right"><Money value={toPaise(r.high)} /><span className="block text-xs text-muted">per {r.unit}</span></Td><Td align="right"><Money value={toPaise(r.average)} strong /><span className="block text-xs text-muted">per {r.unit}, by weight</span></Td></Tr>)}</tbody></Table>}
  </Card> : null;
  const sheetNode = <SupplierSheet open={sheet.open} onClose={() => sheet.setOpen(false)} initial={{ id: s.id, name: s.name, gst_number: s.gst_number, state_name: s.state_name, city: s.city, address: s.address, pan_number: s.pan, mobile_number: s.mobile_number, email: s.email }} onSaved={sheet.saved} />;
  if (isPhone) return <Page title={s.name} phoneSubtitle={`${s.city || stateTitle(s.state_name)} · ${s.gst_number ? stateTitle(s.state_name) : "no GSTIN"}`} back="/suppliers" phoneActions={can("supplier.edit") ? <Button size="sm" variant="ghost" icon={Pencil} onClick={() => sheet.setOpen(true)}>Edit</Button> : null} actionBar={can("purchase.create") ? <ButtonLink to={add} variant="primary" size="lg" icon={Plus}>Add purchase</ButtonLink> : null}><FirmChips firms={firms} value={firmId} onChange={setFirmId} /><Card><p className="caps mb-3">FY {fy} · {scope}</p>{figures}</Card>{list}{ratesCard}{contact}{sheetNode}</Page>;
  return <Page icon={Truck} title={s.name} context={`GSTIN ${s.gst_number || "none"} · ${s.city}, ${stateTitle(s.state_name)} · ${scope} · FY ${fy}`} breadcrumbs={[{ label: "Purchases", to: "/purchases" }, { label: "Suppliers", to: "/suppliers" }]} actions={<>{can("supplier.edit") ? <Button icon={Pencil} onClick={() => sheet.setOpen(true)}>Edit supplier</Button> : null}{can("purchase.create") ? <ButtonLink to={add} variant="primary" icon={Plus}>Add a purchase from them</ButtonLink> : null}</>}><div className="grid grid-cols-[minmax(0,1fr)_minmax(300px,360px)] gap-5 items-start"><div className="flex flex-col gap-5 min-w-0"><Card title="Purchases from them" subtitle={`${scope} · FY ${fy} so far`}>{figures}</Card>{ratesCard}</div>{contact}</div>{list}{sheetNode}</Page>;
}
