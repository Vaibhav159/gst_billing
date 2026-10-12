import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Camera, ChevronDown, Download, Ellipsis, FileArchive, FileSpreadsheet, Plus, ShoppingBag, SlidersHorizontal, Trash2 } from "lucide-react";
import { useCaptureInboxPreview } from "@/core/api/captures";
import { problemOf } from "@/core/api/errors";
import { purchasesParams } from "@/core/api/purchases";
import { useAuth } from "@/core/auth/AuthProvider";
import { date, inr, monthLabel, plural, qty } from "@/core/format";
import { purchaseExport } from "@/core/purchases/export";
import type { PurchaseRow } from "@/core/purchases/types";
import { Badge, Button, ButtonLink, Card, Checkbox, Chip, Dialog, EmptyState, Field, IconButton, Input, ListSkeleton, Menu, Money, Page, QueryView, SearchInput, Select, Sheet, Table, Td, Th, Tr, type MenuItem } from "@/core/ui";
import { useBoxWidth } from "@/core/useBoxWidth";
import { useView } from "@/core/view";
import { rateText } from "@/core/sales/words";
import { DeletePurchases, PurchaseBadges, purchaseLock } from "./bill/parts";
import { usePurchaseList } from "./list/model";
import { SupplierPicker } from "./suppliers/SupplierPicker";

export default function PurchaseList() {
  const m = usePurchaseList();
  const { can, whyNot } = useAuth();
  const { isPhone } = useView();
  const navigate = useNavigate();
  const [box, width] = useBoxWidth();
  const compact = width < 1240;
  const [sheet, setSheet] = useState(false);
  const [dates, setDates] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState<PurchaseRow[] | null>(null);
  const [rowId, setRowId] = useState<number | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportError, setExportError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const current = JSON.stringify(m.query) + m.firmId;
  useEffect(() => { setTicked(new Set()); setRowId(null); }, [current]);
  useEffect(() => () => controller.current?.abort(), []);
  const loaded = m.first !== undefined && !m.list.isPlaceholderData;
  const summary = loaded ? m.first?.summary : undefined;
  const facets = m.first?.facets;
  const selected = m.rows.filter((p) => ticked.has(p.id));
  const totals = selected.reduce((t, p) => ({ total: t.total + p.total_amount, tax: t.tax + p.tax, credit: t.credit + p.credit.claimed }), { total: 0, tax: 0, credit: 0 });
  const toggle = (id: number) => setTicked((before) => { const next = new Set(before); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const goRow = (index: number) => { const p = m.rows[Math.max(0, Math.min(m.rows.length - 1, index))]; if (p) { setRowId(p.id); document.querySelector<HTMLElement>(`[data-purchase-row="${p.id}"]`)?.focus(); } };
  const rowKey = (event: KeyboardEvent<HTMLTableRowElement>, p: PurchaseRow, index: number) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); goRow(index + (event.key === "ArrowDown" ? 1 : -1)); }
    if (event.key === "Home" || event.key === "End") { event.preventDefault(); goRow(event.key === "Home" ? 0 : m.rows.length - 1); }
    if (event.key === " ") { event.preventDefault(); toggle(p.id); }
    if (event.key === "Enter") { event.preventDefault(); navigate(`/purchases/${p.id}`); }
    if (event.key === ".") { event.preventDefault(); event.currentTarget.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.click(); }
  };
  const exportAs = async (kind: "csv" | "xlsx" | "ca", ids?: number[]) => {
    if (m.firmId === null || exporting) return;
    controller.current = new AbortController();
    setExportError(""); setExporting("Preparing the register…");
    try { await purchaseExport(kind, purchasesParams(m.firmId, m.query), ids, { signal: controller.current.signal, onProgress: ({ done, total, stage }) => setExporting(`${stage === "files" ? "Bill photos" : "Purchase bills"}: ${done} of ${total}`) }); }
    catch (e) { if (!controller.current.signal.aborted) setExportError(e instanceof Error ? e.message : problemOf(e).message); }
    finally { setExporting(null); controller.current = null; }
  };
  const exportItems: MenuItem[] = [
    { heading: `Export ${plural(summary?.bills ?? 0, "purchase bill")} shown` },
    { label: "As a CSV file", icon: Download, hint: "Opens in Excel or Google Sheets", disabled: !summary?.bills, onSelect: () => void exportAs("csv") },
    { label: "As an Excel workbook", icon: FileSpreadsheet, hint: "A sheet per month, with totals and credit", disabled: !summary?.bills, onSelect: () => void exportAs("xlsx") },
    { divider: true }, { label: "Register and bill photos for the CA", icon: FileArchive, hint: "One ZIP: the register plus every bill photo, named by supplier and number", disabled: !summary?.bills, onSelect: () => void exportAs("ca") },
  ];
  const addTo = `/purchases/new${m.firmId !== "all" && m.firmId ? `?firm=${m.firmId}` : ""}`;
  const actions = <><Menu title="Export" items={exportItems} trigger={(props) => <Button {...props} icon={Download} iconRight={ChevronDown} disabled={!loaded || !!exporting}>Export</Button>} />{can("capture") ? <ButtonLink to="/purchases/capture" icon={Camera}>Capture a bill</ButtonLink> : null}{can("purchase.create") ? <ButtonLink to={addTo} icon={Plus} variant="primary">Add purchase</ButtonLink> : null}{can("purchase.import") ? <Menu title="Import" items={[{ label: "Import bill photos", to: "/purchases/ai-import" }, { label: "From Excel or Tally", to: "/import?type=purchases" }]} trigger={(props) => <Button {...props} iconRight={ChevronDown}>Import</Button>} /> : null}</>;
  const changePeriod = (month?: string, credit?: string) => m.set({ month, credit, from: undefined, to: undefined });
  const flag = (key: string) => m.set({ [key]: m.params.get(key) === "1" ? undefined : "1", ...(key === "check" || key === "photo" ? { status: undefined } : {}) });
  const filters = <fieldset disabled={!loaded} className="min-w-0 flex flex-col gap-3">
    <Field label="Supplier" htmlFor="purchase-supplier-filter"><SupplierPicker id="purchase-supplier-filter" value={m.query.supplier_id ?? null} onChange={(supplier) => m.set({ supplier: String(supplier.id) })} disabled={!loaded} /></Field>
    <div className="flex flex-wrap gap-2"><Chip selected={!m.credit && !m.params.get("month") && !m.params.get("from") && !m.params.get("to")} onClick={() => changePeriod()}>All of FY {m.fy}</Chip>{[...(facets?.months || [])].reverse().map((month) => <Chip key={month.month} selected={m.params.get("month") === month.month} count={month.bills} disabled={!month.bills && m.params.get("month") !== month.month} onClick={() => changePeriod(month.month)}>{monthLabel(month.month, { year: false })}</Chip>)}<Chip selected={!!m.params.get("from") || !!m.params.get("to")} onClick={() => { setFrom(m.params.get("from") || ""); setTo(m.params.get("to") || ""); setDates(true); }}>From – to</Chip></div>
    <Select aria-label="Credit claimed in" value={m.credit} onChange={(e) => changePeriod(undefined, e.target.value || undefined)} options={[{ value: "", label: "Credit claimed in: any month" }, ...[...new Set([m.credit, ...(facets?.months || []).map((v) => v.month), ...(facets?.credit_months || []).map((v) => v.month)].filter(Boolean))].sort().reverse().map((month) => ({ value: month, label: `Credit claimed in ${monthLabel(month)}` }))]} />
    <div className="flex flex-wrap gap-2"><Chip selected={!!m.query.check} count={facets?.checks.needs_review} onClick={() => flag("check")}>Needs a check</Chip><Chip selected={!!m.query.photo} count={facets?.checks.photo} onClick={() => flag("photo")}>From a photo</Chip><Chip selected={m.query.eligible === 0} onClick={() => m.set({ eligible: m.query.eligible === 0 ? undefined : "0" })}>Credit not allowed</Chip></div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Record checks"><span className="text-muted">Checks</span><Chip selected={!!m.query.dups} count={facets?.checks.duplicate} onClick={() => flag("dups")}>Same bill twice</Chip><Chip selected={!!m.query.empty} count={facets?.checks.no_lines} onClick={() => flag("empty")}>No items</Chip><Chip selected={!!m.query.no_hsn} count={facets?.checks.no_hsn} onClick={() => flag("no_hsn")}>No HSN code</Chip></div>
    {m.query.supplier_id ? <Chip selected onClick={() => m.set({ supplier: undefined })}>Supplier filter · clear</Chip> : null}
    {m.filtered ? <Button variant="ghost" size="sm" onClick={m.clear}>Clear filters</Button> : null}
  </fieldset>;
  const groups = [...new Set(m.rows.map((p) => p.invoice_date.slice(0, 7)))];
  const menu = (p: PurchaseRow) => <Menu title={`Purchase ${p.invoice_number}`} items={[
    { label: "Open purchase", to: `/purchases/${p.id}` }, { label: "Open supplier", to: `/suppliers/${p.supplier.id}` },
    ...(can("purchase.create") ? [{ label: `Add another from ${p.supplier.name}`, to: `/purchases/new?from=${p.id}` }] : []),
    ...(can("purchase.create") || can("purchase.edit") ? [{ label: p.needs_review ? "Edit and check" : "Edit", disabled: p.locked || !can("purchase.edit"), hint: p.locked ? purchaseLock(p) : !can("purchase.edit") ? whyNot("purchase.edit") : undefined, to: `/purchases/${p.id}/edit` }] : []),
    ...(can("purchase.delete") ? [{ label: "Delete…", icon: Trash2, tone: "danger" as const, disabled: p.locked, hint: p.locked ? purchaseLock(p, "deleted") : "Asks first. Restorable from the Audit log.", onSelect: () => setDeleting([p]) }] : []),
  ]} trigger={(props) => <IconButton {...props} label={`Actions for purchase ${p.invoice_number}`} icon={Ellipsis} />} />;
  return <Page icon={ShoppingBag} title="Purchases" context={`${m.firm} · ${m.period}${m.credit ? "" : " · purchases only"}${summary ? `: ${plural(summary.bills, "purchase bill")} · ${m.credit ? `credit ${inr(summary.credit)}` : `${inr(summary.total_amount)} · GST on these bills ${inr(summary.tax)}`}` : ""}`} actions={actions} phoneActions={can("purchase.create") ? <ButtonLink to={addTo} icon={Plus} size="sm">Add</ButtonLink> : undefined}>
    <InboxStrip firmId={m.firmId} />
    {exporting ? <div role="status" className="card p-4 flex justify-between">{exporting}<Button size="sm" onClick={() => controller.current?.abort()}>Cancel export</Button></div> : null}
    {exportError ? <p role="alert" className="text-neg">{exportError}</p> : null}
    <Card pad={false}><div ref={box}><div className="p-4 border-b border-rule flex flex-col gap-3"><div className="flex flex-wrap items-center gap-3"><SearchInput label="Search purchases (press / to jump here; ↓ goes to the bills)" value={m.params.get("q") || ""} onChange={(q) => m.set({ q: q || undefined })} placeholder="Supplier, GSTIN, bill no. or item" disabled={!loaded} data-page-search="" onKeyDown={(e) => { if (e.key === "ArrowDown" && m.rows.length) { e.preventDefault(); goRow(0); } }} /><Link className="link min-h-11 inline-flex items-center" to="/suppliers">Suppliers</Link>{isPhone ? <Button icon={SlidersHorizontal} onClick={() => setSheet(true)} disabled={!loaded}>Filters</Button> : null}</div>{isPhone ? null : filters}</div>
      {m.credit && summary ? <p className="p-4 text-sm text-fg2 bg-file-tint/40">The bills carried in {monthLabel(m.credit, { long: true })}'s GSTR-3B, dated in any month or year: credit <Money value={summary.credit} />. Bills with no credit remain in their reporting month.</p> : null}
      <QueryView query={m.list} what="purchase bills">{() => m.list.isPlaceholderData ? <ListSkeleton what="purchase bills" /> : m.rows.length ? <>
        {isPhone ? <div>{groups.map((month) => <section key={month} aria-label={monthLabel(month, { long: true })}><h2 className="px-4 py-3 bg-raised/40 font-semibold">{monthLabel(month, { long: true })}</h2>{m.rows.filter((p) => p.invoice_date.startsWith(month)).map((p) => <Link key={p.id} className="block p-4 border-t border-rule" to={`/purchases/${p.id}`}><span className="flex justify-between gap-3"><b>{p.supplier.name}</b><Money value={m.credit ? p.credit.claimed : p.total_amount} strong /></span><span className="block text-muted text-sm">{p.invoice_number} · {date(p.invoice_date)} · {p.business_name}</span><span className="block text-sm">GST on these bills <Money value={p.tax} /></span><PurchaseBadges p={p} /></Link>)}</section>)}</div> : <Table label="Purchase bills by month, newest first"><thead><tr><Th><Checkbox hideLabel label={`Tick all ${plural(m.rows.length, "loaded purchase bill")}`} checked={m.rows.length > 0 && selected.length === m.rows.length} onChange={(v) => setTicked(v ? new Set(m.rows.map((p) => p.id)) : new Set())} /></Th><Th>Date</Th><Th>Supplier</Th><Th>Supplier's bill no. · items</Th>{!compact ? <Th>Firm · paid by</Th> : null}<Th align="right">Taxable · GST</Th><Th align="right">Total</Th><Th align="right">Credit</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>{groups.map((month) => {
          const rows = m.rows.filter((p) => p.invoice_date.startsWith(month));
          const late = facets?.months.find((x) => x.month === month);
          const total = rows.reduce((sum, p) => sum + p.total_amount, 0);
          const tax = rows.reduce((sum, p) => sum + p.tax, 0);
          const credit = rows.reduce((sum, p) => sum + p.credit.claimed, 0);
          const bought = new Map<string, number>();
          for (const row of rows) for (const weight of row.weights) bought.set(weight.unit, (bought.get(weight.unit) || 0) + Math.round(Number(weight.quantity) * 1000));
          return <tbody key={month}><tr className="bg-raised/40"><th scope="rowgroup" colSpan={compact ? 8 : 9} className="p-3 text-left font-semibold">{monthLabel(month, { long: true })} · {plural(rows.length, "loaded purchase bill")} · {inr(total)} · GST {inr(tax)}{m.credit ? ` · credit ${inr(credit)}` : ""}{bought.size ? ` · bought ${[...bought].map(([unit, amount]) => `${(amount / 1000).toFixed(3)} ${unit}`).join(", ")}` : ""}{late?.late_in && !m.filtered ? <button className="link text-sm ml-2" onClick={() => changePeriod(undefined, month)}>+ {plural(late.late_in, "late bill")} with credit claimed in {monthLabel(month)} ({inr(late.late_in_credit)})</button> : null}</th></tr>{rows.map((p) => <Tr key={p.id} data-row={p.id} data-purchase-row={p.id} tabIndex={(rowId ?? m.rows[0]?.id) === p.id ? 0 : -1} onFocus={() => setRowId(p.id)} onKeyDown={(e) => rowKey(e, p, m.rows.indexOf(p))} onClick={() => navigate(`/purchases/${p.id}`)} selected={ticked.has(p.id)} className="focus:outline-none focus:shadow-[inset_0_0_0_2px_var(--brand)]"><Td onClick={(e) => e.stopPropagation()}><Checkbox hideLabel label={`Tick ${p.invoice_number}`} checked={ticked.has(p.id)} onChange={() => toggle(p.id)} /></Td><Td>{date(p.invoice_date)}</Td><Td><b>{p.supplier.name}</b><span className="block text-xs text-muted">{p.supplier.gst_number || "No GSTIN"}{compact ? ` · ${p.business_name}` : ""}</span></Td><Td><span className="block tnum font-medium">{p.invoice_number}</span><span className="block text-sm text-muted">{p.first_line?.product_name || "No items"}{p.line_count > 1 ? ` + ${p.line_count - 1}` : ""}</span>{p.first_line ? <span className="block text-xs text-muted">{p.first_line.amount_only ? "Amount only" : `${qty(Number(p.first_line.quantity), p.first_line.unit)} at ${rateText(p.first_line.rate)}`}</span> : null}<PurchaseBadges p={p} /></Td>{!compact ? <Td>{p.business_name}<span className="block text-xs text-muted">{p.payment_mode || "Not recorded"}</span></Td> : null}<Td align="right"><Money value={p.taxable} /><span className="block text-xs text-muted">GST {inr(p.tax)}</span></Td><Td align="right"><Money value={p.total_amount} strong /></Td><Td align="right"><Money value={p.credit.claimed} tone="file" />{p.credit.late && p.credit.month ? <span className="block text-xs">in {monthLabel(p.credit.month)}</span> : null}</Td><Td onClick={(e) => e.stopPropagation()}>{menu(p)}</Td></Tr>)}</tbody>;
        })}</Table>}
        {m.list.hasNextPage ? <div className="p-4"><Button loading={m.list.isFetchingNextPage} onClick={() => void m.list.fetchNextPage()}>Show more purchase bills</Button><span className="ml-3 text-sm text-muted">{m.rows.length} of {m.first?.count}. Totals count them all.</span></div> : null}
      </> : <EmptyState icon={ShoppingBag} title={m.filtered ? "No purchase bills match" : "No purchases yet"} actions={m.filtered ? <Button onClick={m.clear}>Clear filters</Button> : can("purchase.create") ? <ButtonLink to={addTo}>Add purchase</ButtonLink> : undefined}>{m.filtered ? "Try another month or supplier, or clear the filters to see the whole year." : "Every supplier's bill you enter shows here by month, with its GST and the input tax credit it gives. Capture a photo on the counter phone, or type one in."}{facets?.elsewhere.map((x) => <p key={x.fy}>{plural(x.bills, "bill")} in FY {x.fy} {x.bills === 1 ? "matches" : "match"}. <Button size="sm" variant="ghost" onClick={() => { m.set({ fy: x.fy, month: undefined, credit: undefined }); }}>Show that year</Button></p>)}</EmptyState>}</QueryView>
    </div></Card>
    {selected.length ? <div role="region" aria-label="Ticked purchases" className="card p-4 flex flex-wrap gap-3 items-center"><p className="flex-1"><b>{plural(selected.length, "purchase bill")} ticked</b> · <Money value={totals.total} /> · GST <Money value={totals.tax} /> · credit <Money value={totals.credit} /></p>{(["csv", "xlsx", "ca"] as const).map((kind) => <Button key={kind} size="sm" disabled={!!exporting} onClick={() => void exportAs(kind, selected.map((p) => p.id))}>{kind === "csv" ? "CSV" : kind === "xlsx" ? "Excel" : "For the CA"}</Button>)}{can("purchase.delete") ? <Button size="sm" variant="danger-outline" onClick={() => setDeleting(selected)}>Delete…</Button> : null}<Button size="sm" variant="ghost" onClick={() => setTicked(new Set())}>Untick</Button></div> : null}
    <Sheet open={sheet} onClose={() => setSheet(false)} title="Filter purchases" footer={<Button variant="primary" onClick={() => setSheet(false)}>Show {plural(summary?.bills ?? 0, "purchase bill")}</Button>}>{filters}</Sheet>
    <Dialog open={dates} onClose={() => setDates(false)} title="Purchase bills between two dates" description={`Within FY ${m.fy}. The summary and totals follow.`} footer={<><Button onClick={() => { m.set({ from: undefined, to: undefined }); setDates(false); }}>Clear dates</Button><Button variant="primary" disabled={!!from && !!to && from > to || !from && !to} onClick={() => { m.set({ from: from || undefined, to: to || undefined, month: undefined, credit: undefined }); setDates(false); }}>Show these dates</Button></>}><Field label="From" htmlFor="pl-from"><Input id="pl-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="To" htmlFor="pl-to"><Input id="pl-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>{from && to && from > to ? <p role="alert">The end date must be on or after the start date.</p> : null}</Dialog>
    {deleting ? <DeletePurchases bills={deleting} onClose={() => setDeleting(null)} onDone={() => setTicked(new Set())} /> : null}
  </Page>;
}

function InboxStrip({ firmId }: { firmId: number | "all" | null }) {
  const { can } = useAuth();
  const q = useCaptureInboxPreview(firmId);
  if (!q.data?.count) return null;
  return <Card title={`${plural(q.data.count, "captured bill")} waiting to be filled in`} subtitle="Photos and PDFs captured at the counter. They aren't in purchases or the credit until someone fills them in." actions={<ButtonLink to="/purchases/inbox">Open the inbox</ButtonLink>}><div className="flex flex-wrap gap-3">{q.data.results.slice(0, 3).map((c) => <div className="p-3 rounded-ctl border border-line" key={c.id}><p className="font-medium">{c.hint || c.label}</p><p className="text-muted text-sm">{c.business_name || "Firm not decided"}</p><Badge>{c.status === "reading" ? "Reading the bill…" : c.status === "failed" ? "Could not read" : "Ready to fill in"}</Badge>{can("purchase.create") ? <ButtonLink size="sm" to={`/purchases/inbox/${c.id}`}>Fill in</ButtonLink> : null}</div>)}</div>{q.data.results.some((c) => c.status === "reading") ? <Button size="sm" onClick={() => void q.refetch()}>Check again</Button> : null}</Card>;
}
