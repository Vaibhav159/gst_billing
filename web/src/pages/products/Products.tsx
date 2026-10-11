// Port of PROTO records/Products.jsx: the server owns sold figures, filters and paging.
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Package, Plus, Upload, Download, ChevronRight, Search, MoreVertical, AlertTriangle } from "lucide-react";
import { api } from "@/core/api/client";
import { problemOf } from "@/core/api/errors";
import { useCatalog, useProduct, type CatalogFilters, type RecordRef } from "@/core/api/catalog";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { inr, plural, todayIST } from "@/core/format";
import { saveFile } from "@/core/print/files";
import { useFirms, useScope } from "@/core/scope";
import { FirmChips } from "@/core/shell/ScopePickers";
import { Page, Card, Button, ButtonLink, IconButton, Money, Badge, Banner, EmptyState, SearchInput, Segmented, Select, Table, Th, Td, Tr, ListRow, Menu, QueryView, useToast } from "@/core/ui";
import { useDebounced } from "@/core/useDebounced";
import { useView } from "@/core/view";
import { scopeName, useJustSaved, useMoreFocus, openOnEnter } from "@/pages/customers/lib";
import { cancelledNote as notCounted } from "@/pages/records/words";
import { MoreButton } from "@/pages/customers/listParts";
import { WhyNote } from "@/pages/customers/parts";
import { SLABS } from "@/pages/sales/form/model";
import { KIND_LABEL, perUnit, soldQuantity, usualRate } from "./lib";

const SHOW = [{ value: "all", label: "All" }, { value: "sold", label: "On sales bills" }, { value: "bought", label: "Bought only" }] as const;
function CaseTwins({ twins }: { twins: RecordRef[][] }) {
  const { can } = useAuth();
  const g = twins[0];
  return g ? <Banner tone="brand" icon={AlertTriangle} title={`${g.map((p) => `“${p.name}”`).join(" and ")} differ only in capital letters`}
    actions={can("product.edit") ? <ButtonLink size="sm" to={`/products/${g[1].id}/edit`}>Rename one</ButtonLink> : undefined}>
    Both came from older data. The bill form can pick the wrong one, so rename one (or mark it Bought only). Both can still be edited.{twins.length > 1 ? ` ${twins.length - 1} more ${twins.length === 2 ? "pair" : "pairs"} like this.` : ""}
  </Banner> : null;
}
export default function Products() {
  const { firmId, setFirmId, fy } = useScope();
  const { firms } = useFirms();
  const { isPhone } = useView();
  const navigate = useNavigate();
  const { can, whyNot } = useAuth();
  const toast = useToast();
  const flash = useJustSaved("product");
  const [q, setQ] = useState("");
  const typed = useDebounced(q);
  const [show, setShow] = useState<CatalogFilters["show"]>("all");
  const [rate, setRate] = useState("");
  const [sort, setSort] = useState<CatalogFilters["ordering"]>("name");
  const [exporting, setExporting] = useState(false);
  const query = useCatalog({ firmId, fy, q: typed, show, gst_rate: rate, ordering: sort });
  const saved = useProduct(flash, { firmId, fy });
  const first = query.data?.pages[0];
  const loaded = query.data?.pages.flatMap((p) => p.results) ?? [];
  // The newly added product flashes even when its name sorts after the first page.
  const rows = saved.data && !q.trim() && show === "all" && !rate && !loaded.some((p) => p.id === flash) ? [saved.data, ...loaded].slice(0, loaded.length || 1) : loaded;
  const moreFocus = useMoreFocus(rows.map((p) => p.id));
  const scope = scopeName(firms, firmId);
  const clear = () => { setQ(""); setShow("all"); setRate(""); };
  const describe = [show !== "all" && SHOW.find((s) => s.value === show)?.label, rate && `GST ${rate}%`, q.trim() && `matching “${q.trim()}”`].filter(Boolean).join(", ");
  const exportList = async () => {
    if (exporting) return;
    setExporting(true);
    try { const r = await api.get("exports/products/", { responseType: "blob", timeout: 600_000 }); saveFile(r.data, `Products_${todayIST()}.csv`); }
    catch (e) { toast.show({ tone: "neg", title: "The products weren't exported", body: problemOf(e).message }); }
    finally { setExporting(false); }
  };
  const exportLabel = first ? `Export ${plural(first.total_products, "product")}` : "Export";
  const actions = <>{can("product.edit") ? <ButtonLink to="/import?type=products" icon={Upload}>Import</ButtonLink> : null}
    <Button icon={Download} onClick={() => void exportList()} disabled={!first} loading={exporting}>{exportLabel}</Button>
    {can("product.edit") ? <ButtonLink to="/products/new?from=list" variant="primary" icon={Plus}>Add product</ButtonLink> : <Button variant="primary" icon={Plus} disabled title={whyNot("product.edit")}>Add product</Button>}</>;
  const filters = <><SearchInput value={q} onChange={setQ} placeholder={isPhone ? "Name, HSN or purity" : "Name, HSN, purity or description"} label={isPhone ? "Search products" : "Search products (press /)"} className={isPhone ? "" : "w-[300px]"} data-page-search />
    {isPhone ? <FirmChips firms={firms} value={firmId} onChange={setFirmId} /> : null}
    <Segmented label="Show" full={isPhone} options={SHOW} value={show} onChange={setShow} />
    <Select aria-label="GST rate" value={rate} onChange={(e) => setRate(e.target.value)} className={isPhone ? "" : "w-[170px]"} options={[{ value: "", label: "Every GST rate" }, ...[...SLABS].sort((a, b) => Number(a) - Number(b)).map((s) => ({ value: s, label: `GST ${s}%` }))]} />
    {<><div className="flex-1" /><Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as CatalogFilters["ordering"])} className={isPhone ? "" : "w-[190px]"} options={[{ value: "name", label: "Sort: Name" }, { value: "-sold", label: "Sort: Most sold" }, { value: "hsn", label: "Sort: HSN" }]} /></>}</>;
  const empty = <EmptyState icon={Search} title={q.trim() ? `No product matches “${q.trim()}”` : "No products match these filters"} actions={<><Button onClick={clear}>Clear search and filters</Button>{can("product.edit") ? <ButtonLink variant="primary" icon={Plus} to={`/products/new?from=list${q.trim() && !/^\d+$/.test(q.trim()) ? `&name=${encodeURIComponent(q.trim())}` : ""}`}>Add a product</ButtonLink> : null}</>}>Search looks at names, HSN codes, purity (22K, 999) and descriptions.</EmptyState>;
  return <Page icon={Package} title="Products" back={isPhone ? "/more" : undefined} context={first ? `${plural(first.total_products, "product")} · HSN, GST rate and unit print on every bill · sold figures for FY ${fy}, ${scope}` : "Loading the list…"}
    phoneSubtitle={first ? `${plural(first.total_products, "product")} · sold in FY ${fy} · ${scope}` : "Loading…"} actions={actions}
    phoneActions={<Menu title="Products" items={[{ label: "Import products", icon: Upload, disabled: !can("product.edit"), hint: can("product.edit") ? "From a spreadsheet, checked before anything is added" : whyNot("product.edit"), to: "/import?type=products" }, { label: exportLabel, icon: Download, disabled: !first || exporting, onSelect: () => void exportList() }]} trigger={(p) => <IconButton {...p} label="Import or export products" icon={MoreVertical} />} />}
    actionBar={can("product.edit") ? <ButtonLink to="/products/new?from=list" variant="primary" size="lg" icon={Plus}>Add product</ButtonLink> : undefined}>
    {!can("product.edit") ? <WhyNote>{whyNot("product.edit")}</WhyNote> : null}
    {isPhone ? filters : <div className="flex flex-wrap items-center gap-3">{filters}</div>}
    <QueryView query={query} what="products">{(data) => {
      const page = data.pages[0]; const s = page.summary;
      return <><CaseTwins twins={page.twins} /><Card pad={false}>
        <div className="px-5 py-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-sm border-b border-rule">
          <p className="text-fg2"><span className="font-semibold text-fg">{page.count === page.total_products ? plural(page.count, "product") : `${page.count} of ${plural(page.total_products, "product")} match`}</span>{describe ? ` · ${describe}` : ""}{describe ? <button type="button" onClick={clear} className="link ml-2">Clear</button> : null}</p>
          {s ? <p className="text-muted">Sold · FY {fy} · {scope}: <Money value={s.taxable} strong className="text-fg" /> before GST, in {plural(s.bills, "bill")}{s.no_items_count ? ` with items (${s.no_items.map((b) => b.invoice_number).join(", ")}${s.no_items_count > 2 ? ` and ${s.no_items_count - 2} more` : ""} ${s.no_items_count === 1 ? "has" : "have"} none)` : ""}{notCounted(s.cancelled)}</p> : null}
        </div>
        {!rows.length ? empty : isPhone ? rows.map((p) => <ListRow key={p.id} data-row={p.id} tabIndex={-1} to={`/products/${p.id}`} className={cn(p.id === flash && "anim-flash")} title={p.name}
          subtitle={`HSN ${p.hsn_code} · ${p.slab_ok ? `${p.gst_percent}%` : "Not a GST rate"}${p.purity ? ` · ${p.purity}` : ""} · ${perUnit(p.unit)}`}
          right={p.purchase_only ? <span className="text-muted">Bought only</span> : p.sold?.bills ? soldQuantity(p.sold, p.unit) : <span className="text-muted">Not sold</span>}
          rightSub={p.purchase_only ? null : p.sold?.bills ? inr(p.sold.taxable) : `FY ${fy}`} />) : <Table label="Products"><thead><tr><Th>Product</Th><Th>HSN</Th><Th>GST</Th><Th className="hidden xl:table-cell">Unit</Th><Th className="hidden xl:table-cell">Purity</Th><Th align="right">Usual rate</Th><Th align="right">Sold · FY {fy}</Th><Th align="right">Value before GST</Th><Th align="right">Bills</Th><Th className="w-10"><span className="sr-only">Open</span></Th></tr></thead>
          <tbody>{rows.map((p) => <Tr key={p.id} data-row={p.id} tabIndex={-1} onKeyDown={openOnEnter(() => navigate(`/products/${p.id}`))} onClick={() => navigate(`/products/${p.id}`)} className={cn(p.id === flash && "anim-flash")}>
            <Td><Link to={`/products/${p.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:text-brand">{p.name}</Link><span className="block text-xs text-muted mt-0.5 max-w-[280px] truncate">{[KIND_LABEL[p.kind_effective], p.description].filter(Boolean).join(" · ")}</span></Td><Td className="tnum">{p.hsn_code}</Td><Td><Badge>{p.slab_ok ? `${p.gst_percent}%` : "Not a GST rate"}</Badge></Td><Td className="text-fg2 hidden xl:table-cell">{p.unit}</Td><Td className="text-fg2 hidden xl:table-cell">{p.purity || "None"}</Td><Td align="right">{usualRate(p)}</Td>
            <Td align="right">{p.purchase_only ? <Badge>Bought only</Badge> : p.sold?.bills ? soldQuantity(p.sold, p.unit) : <span className="text-muted">Not sold</span>}</Td><Td align="right">{p.sold?.bills ? <Money value={p.sold.taxable} /> : "—"}</Td><Td align="right">{p.sold?.bills ?? 0}</Td><Td><ChevronRight size={18} className="text-muted" aria-hidden="true" /></Td></Tr>)}</tbody></Table>}
        <MoreButton shown={rows.length} total={page.count} what="products" pageSize={20} loading={query.isFetchingNextPage} problem={query.isFetchNextPageError ? problemOf(query.error) : null} onMore={() => { moreFocus(); void query.fetchNextPage(); }} />
      </Card></>;
    }}</QueryView>
    <p className="text-sm text-muted">Sold quantities and values are added up from the lines of every sales bill in the period (cancelled bills left out). “Bought only” products don't show when making a sales bill.</p>
  </Page>;
}
