import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Truck, Plus, Search } from "lucide-react";
import { useSuppliers } from "@/core/api/suppliers";
import type { SupplierRef } from "@/core/purchases/types";
import { SupplierSheet } from "@/pages/purchases/suppliers/SupplierSheet";
import { problemOf } from "@/core/api/errors";
import { useAuth } from "@/core/auth/AuthProvider";
import { date, inr, plural } from "@/core/format";
import { stateCodeOf, stateTitle, hasGstin } from "@/core/ids";
import { autoPos, isInterState } from "@/core/sales/pos";
import { useScope, useFirms, type Firm, type FirmId } from "@/core/scope";
import { FirmChips } from "@/core/shell/ScopePickers";
import { useDebounced } from "@/core/useDebounced";
import { useView } from "@/core/view";
import { Page, Card, Button, Money, SearchInput, Table, Th, Td, Tr, EmptyState, ListSkeleton, QueryView, cn, useNewIds } from "@/core/ui";
import { scopeName, openOnEnter, useMoreFocus } from "@/pages/customers/lib";
import { MoreButton } from "@/pages/customers/listParts";

function supplierTax(s: SupplierRef, firms: Firm[], firmId: FirmId | null): "none" | "local" | "inter" | "mixed" | "unknown" {
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

