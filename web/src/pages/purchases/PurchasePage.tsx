import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Download, Ellipsis, History, Image as ImageIcon, Lock, Paperclip, Pencil, Plus, RotateCcw, ShoppingBag, Trash2 } from "lucide-react";
import { api } from "@/core/api/client";
import { useCaptureInboxPreview } from "@/core/api/captures";
import { purchasesKeys, useCheckPurchase, useCreditMonths, useDeletePurchaseFile, useMovePurchaseCredit, usePurchase, usePurchaseFiles, useRestorePurchase } from "@/core/api/purchases";
import { problemOf } from "@/core/api/errors";
import { useAuth } from "@/core/auth/AuthProvider";
import { date, fyOf, inr, monthLabel, plural, qty, todayIST } from "@/core/format";
import { saveFile } from "@/core/print/files";
import { rateText } from "@/core/sales/words";
import type { PurchaseBinRow, PurchaseDetail, PurchaseFile } from "@/core/purchases/types";
import { beforeLedgerWords } from "@/core/purchases/words";
import { Banner, Button, ButtonLink, Card, ConfirmDialog, Dialog, DL, EmptyState, Field, IconButton, Menu, Money, Page, QueryView, Select, Table, Td, Th, Tr, useToast, type MenuItem } from "@/core/ui";
import { useView } from "@/core/view";
import { DeletePurchases, PurchaseBadges, purchaseLock } from "./bill/parts";

export default function PurchasePage() {
  const { id } = useParams();
  const query = usePurchase(/^\d+$/.test(id || "") ? Number(id) : null);
  if (!/^\d+$/.test(id || "")) return <MissingPurchase />;
  if (!query.data && query.isError && problemOf(query.error).kind === "notfound") return <MissingPurchase />;
  if (!query.data) return <Page title="Purchase" icon={ShoppingBag} back="/purchases" breadcrumbs={[{ label: "Purchases", to: "/purchases" }]}><QueryView query={query} what="this purchase">{() => null}</QueryView></Page>;
  return <QueryView query={query} what="this purchase">{(d) => d.kind === "deleted" ? <DeletedPurchase b={d.binned} /> : <Purchase p={d.purchase} />}</QueryView>;
}

export function MissingPurchase() {
  return <Page title="Purchase" icon={ShoppingBag} back="/purchases"><Card><EmptyState icon={ShoppingBag} title="This purchase isn't here" actions={<ButtonLink to="/purchases">Open Purchases</ButtonLink>}>It may have been deleted. Look in the Audit log, or search for the supplier's bill number.</EmptyState></Card></Page>;
}

function DeletedPurchase({ b }: { b: PurchaseBinRow }) {
  const restore = useRestorePurchase();
  const qc = useQueryClient();
  const { can, whyNot } = useAuth();
  const { show } = useToast();
  const [error, setError] = useState("");
  const failed = (e: unknown) => {
    const problem = problemOf(e);
    setError(problem.message);
    if (problem.code === "already_restored" || problem.kind === "notfound") void qc.refetchQueries({ queryKey: purchasesKeys.one(b.original_id) });
  };
  const why = !can("purchase.delete") ? whyNot("purchase.delete") : b.locked ? "The GSTR-3B carrying this bill is filed, so it can't be restored. Have the owner unlock its credit month in GST returns first." : "";
  return <Page icon={ShoppingBag} title={`Purchase ${b.invoice_number}`} back="/purchases" breadcrumbs={[{ label: "Purchases", to: "/purchases" }]} context={`${b.business_name} · ${date(b.invoice_date)}`}><Banner tone="neg" icon={Trash2} title="This purchase was deleted" actions={<><Button variant="primary" icon={RotateCcw} disabled={!!why} loading={restore.isPending} onClick={() => restore.mutate(b.id, { onSuccess: () => show({ title: `Restored ${b.invoice_number}`, body: "Back in Purchases and in the credit figures." }), onError: failed })}>Restore it</Button><ButtonLink to="/audit">Open the Audit log</ButtonLink></>}>
    {b.supplier.name} · {inr(b.total_amount)}. Deleted {date(b.deleted_at.slice(0, 10))}{b.deleted_by ? ` by ${b.deleted_by.name}` : ""}{b.reason ? `, because “${b.reason}”.` : ". No reason was given."} {why || "Restoring puts it back in Purchases and in its credit month's figures."}
  </Banner>{error ? <p role="alert" className="text-neg">{error}</p> : null}<Card title="What was on the bill" subtitle="Its items and photos come back with it when it's restored"><DL rows={[["Supplier", b.supplier.name], ["Supplier's bill no.", b.invoice_number], ["Bill date", date(b.invoice_date)], ["Firm", b.business_name], ["Total on the bill", <Money value={b.total_amount} key="total" />]]} /></Card></Page>;
}

function Purchase({ p }: { p: PurchaseDetail }) {
  const { can, whyNot, me } = useAuth();
  const { isPhone } = useView();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const checked = useCheckPurchase();
  const attach = usePurchaseFiles();
  const removeFile = useDeletePurchaseFile();
  const [deleting, setDeleting] = useState(false);
  const [moving, setMoving] = useState(false);
  const [photo, setPhoto] = useState<PurchaseFile | null>(null);
  const [removing, setRemoving] = useState<PurchaseFile | null>(null);
  const [error, setError] = useState("");
  const [fileError, setFileError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const month = p.credit.month ? monthLabel(p.credit.month, { long: true }) : "";
  const beforeLedger = p.credit.state === "outside";
  const noGst = !p.supplier.gst_number && !p.tax;
  const editWhy = p.locked ? purchaseLock(p) : !can("purchase.edit") ? whyNot("purchase.edit") : "";
  const ownsRecent = me?.id === p.history.created_by?.id && Date.now() - Date.parse(p.created_at) <= 86_400_000;
  const canAttach = !p.locked && (can("purchase.edit") || can("purchase.create") && ownsRecent);
  const canEdit = can("purchase.edit") && !p.locked;
  const hasSource = p.files.some((file) => file.id === "src");
  const exportFile = async (file: PurchaseFile) => {
    setError("");
    // a signed original on this app only (never the app's authorization to another host), under the client's /api/ base once
    if (!file.url.startsWith("/api/media/")) { setError("The original wasn't downloaded. Open the purchase again and retry."); return; }
    try { const { data } = await api.get<Blob>(file.url.replace(/^\/api\//, ""), { responseType: "blob" }); saveFile(data, file.name); }
    catch (e) { setError(`The original wasn't downloaded. ${problemOf(e).message}`); }
  };
  const menu: MenuItem[] = [
    ...(can("purchase.create") ? [{ label: `Add another from ${p.supplier.name}`, icon: Plus, to: `/purchases/new?from=${p.id}` }] : []),
    { label: "Open supplier", to: `/suppliers/${p.supplier.id}`, hint: `${p.supplier.name} · every purchase this year` },
    ...(p.files.length ? [{ label: "Open bill photo", icon: ImageIcon, onSelect: () => setPhoto(p.files[0]) }, { label: "Download original", icon: Download, onSelect: () => void exportFile(p.files[0]) }] : []),
    ...(can("purchase.create") || can("purchase.edit") ? [{ label: "Edit", icon: Pencil, disabled: !!editWhy, hint: editWhy || undefined, to: `/purchases/${p.id}/edit` }] : []),
    ...(can("purchase.delete") ? [{ divider: true as const }, { label: `Delete purchase ${p.invoice_number}…`, icon: Trash2, tone: "danger" as const, disabled: p.locked, hint: p.locked ? purchaseLock(p, "deleted") : "Asks first. Restore from the Audit log.", onSelect: () => setDeleting(true) }] : []),
  ];
  const actions = <>{p.files.length ? <Button icon={Download} onClick={() => void exportFile(p.files[0])}>Download original</Button> : null}{can("purchase.create") || can("purchase.edit") ? <Button icon={Pencil} variant="primary" disabled={!!editWhy} title={editWhy || undefined} onClick={() => navigate(`/purchases/${p.id}/edit`)}>Edit</Button> : null}<Menu items={menu} trigger={(props) => <IconButton {...props} label="More actions for this purchase" icon={Ellipsis} />} /></>;
  const source = p.capture ? `From a photo captured on ${date(p.capture.captured_at.slice(0, 10))}${p.capture.captured_by ? ` by ${p.capture.captured_by.name}` : ""}` : p.source === "photos" ? "Imported from bill photos" : p.source === "excel" ? "Imported from Excel or CSV" : p.files.length ? "Typed by hand · file attached" : "Typed by hand · no file attached";
  const quantity = (line: PurchaseDetail["lines"][number]) => `${qty(Number(line.quantity), line.unit)} at ${rateText(line.rate)} per ${line.unit}`;
  return <Page icon={ShoppingBag} title={`Purchase ${p.invoice_number}`} phoneTitle="Purchase" phoneSubtitle={`${p.invoice_number} · ${p.firm.short}`} context={`${p.supplier.name} → ${p.firm.name} · ${date(p.invoice_date)}`} back="/purchases" breadcrumbs={[{ label: "Purchases", to: "/purchases" }]} actions={actions} phoneActions={<Menu items={menu} trigger={(props) => <IconButton {...props} label="More actions for this purchase" icon={Ellipsis} />} />} actionBar={can("purchase.create") || can("purchase.edit") ? <><Button icon={Pencil} disabled={!!editWhy} onClick={() => navigate(`/purchases/${p.id}/edit`)}>Edit</Button>{p.files.length ? <Button icon={ImageIcon} onClick={() => setPhoto(p.files[0])}>Photo</Button> : null}</> : undefined}>
    {params.get("from") === "capture" ? <SavedCapture p={p} /> : params.get("saved") === "new" ? <Banner tone="sale" title="Purchase saved" actions={<ButtonLink to={`/purchases/new?firm=${p.business}`} icon={Plus}>Add another</ButtonLink>}>{p.credit.claimed ? <>It's in the purchases, and {p.firm.short}'s input tax credit for {month} goes up by <Money value={p.credit.claimed} />.</> : "It's in the purchases. It carries no input tax credit."}</Banner> : params.get("saved") === "edit" ? <Banner tone="sale" title="Changes saved">The change is in the Audit log.</Banner> : null}
    {error ? <p role="alert" className="text-neg">{error}</p> : null}
    {p.needs_review ? <Banner tone="brand" title="Needs a check" actions={canEdit ? <><Button size="sm" variant="primary" onClick={() => navigate(`/purchases/${p.id}/edit`)}>Check it now</Button><Button size="sm" loading={checked.isPending} onClick={() => checked.mutate(p.id, { onError: (e) => setError(problemOf(e).message) })}>Looks right</Button></> : undefined}>Read from a photo and saved before every figure was confirmed. Compare the GST slab, quantities and rates with the photo.</Banner> : null}
    {!beforeLedger && p.credit.late ? <Banner tone="file" icon={CalendarClock} title={`Credit in ${month}'s GSTR-3B${p.locked ? " (filed)" : ""}`}>The bill is dated {date(p.invoice_date)}, and was entered on {date(p.created_at.slice(0, 10))}. Its credit, <Money value={p.credit.claimed} />, goes in {month}'s GSTR-3B.{p.fy !== fyOf(todayIST()) ? ` The last day to claim it is ${date(p.credit.deadline)}, or the day FY ${p.fy}'s annual return (GSTR-9) is filed, if that's earlier.` : ""}</Banner> : null}
    {beforeLedger ? <Banner tone="file" title="Before the credit ledger">{beforeLedgerWords}</Banner> : p.credit.lapsed ? <Banner tone="neg" title="Credit lapsed">Too late to claim: no return open now can carry this bill's credit. The bill still counts in purchases.</Banner> : null}
    {p.locked ? <Banner tone="file" icon={Lock} title={`${month}'s GSTR-3B is filed`}>{purchaseLock(p)}{p.credit.filed_on ? ` Filed ${date(p.credit.filed_on)}.` : ""}</Banner> : !can("purchase.edit") && can("purchase.create") ? <p className="text-muted text-sm">{whyNot("purchase.edit")}</p> : null}
    {p.buyer_ack && p.buyer_gstin && p.buyer_gstin !== p.firm.gst_number ? <Banner tone="muted" title={`Billed to ${p.buyer_gstin}, recorded for ${p.firm.name}`}>The bill names GSTIN {p.buyer_gstin}. It was recorded anyway, so it won't match {p.firm.short}'s credit in GSTR-2B until the supplier corrects it.</Banner> : null}
    {isPhone ? <Card><p className="text-lg font-semibold">{p.supplier.name}</p><p className="text-sm text-muted">{p.invoice_number} · {date(p.invoice_date)} · {p.business_name}</p><div className="flex justify-between my-3"><div><span className="caps block">Total</span><Money value={p.total_amount} size="3xl" /></div><div><span className="caps block">Credit</span><Money value={p.credit.claimed} size="lg" tone="file" /></div></div><PurchaseBadges p={p} /></Card> : null}
    <div className={isPhone ? "flex flex-col gap-4" : "grid grid-cols-[minmax(0,1fr)_340px] gap-5 items-start"}>
      <div className="flex flex-col gap-5 min-w-0"><Card title="Items" subtitle={`${plural(p.lines.length, "item")} · ${noGst ? "no GST" : p.interstate ? "IGST" : "CGST + SGST"}`} pad={false}>
        {isPhone ? <ul>{p.lines.map((line) => <li key={line.id} className="p-4 border-t border-rule flex justify-between gap-3"><div><b>{line.product_name}</b><p className="text-sm text-muted">{line.note === "Amount only" ? "Amount only: the file had no weight or rate" : quantity(line)}</p><p className="text-sm text-muted">HSN {line.hsn_code || "missing"} · GST {line.gst_percent}%</p></div><Money value={line.taxable} strong /></li>)}</ul> : <Table label={`Items on purchase ${p.invoice_number}`}><thead><tr><Th>Item</Th><Th align="right">Taxable</Th><Th align="right">GST</Th><Th align="right">Amount</Th></tr></thead><tbody>{p.lines.map((line) => <Tr key={line.id}><Td><b>{line.product_name}</b><span className="block text-xs text-fg2 tnum">{line.note === "Amount only" ? "Amount only: no weight or rate on the file" : quantity(line)}</span><span className={`block text-xs ${line.hsn_code ? "text-muted" : "text-neg"}`}>{line.hsn_code ? `HSN ${line.hsn_code}` : "No HSN code"}</span></Td><Td align="right"><Money value={line.taxable} /></Td><Td align="right">{noGst ? "No GST" : <><Money value={line.tax} /><span className="block text-xs text-muted">{p.interstate ? "IGST" : "CGST + SGST"} · {line.gst_percent}%</span></>}</Td><Td align="right"><Money value={line.amount} strong /></Td></Tr>)}</tbody></Table>}
        {!p.lines.length ? <p className="p-4 text-neg">This purchase has no items. Edit it to add them, or delete it.</p> : null}
      </Card><Card title="Tax and total" subtitle={noGst ? `${p.supplier.name} has no GSTIN, so there's no GST on this bill` : p.interstate ? `${p.supplier.name} is in ${p.supplier.state_name}, so it's IGST` : `Same state as ${p.firm.short} (${p.firm.state_name}), so it's CGST + SGST`}><DL rows={[["Taxable value", <Money key="taxable" value={p.taxable} />], ...(noGst ? [["GST", `No GST: ${p.supplier.name} isn't registered`]] as [string, string][] : p.interstate ? [["IGST", <Money key="igst" value={p.igst} />]] as [string, React.ReactNode][] : [["CGST", <Money key="cgst" value={p.cgst} />], ["SGST", <Money key="sgst" value={p.sgst} />]] as [string, React.ReactNode][]), ["Total on the bill", <Money key="total" value={p.total_amount} size="xl" />, { strong: true }]]} />{noGst ? <p className="mt-3 text-sm text-fg2">No input tax credit: there's no GST on a bill from a supplier without a GSTIN.</p> : <div className="mt-3 rounded-ctl border border-file-line bg-file-tint px-4 py-3 flex justify-between gap-3"><div><span className="caps block">Input tax credit</span><span className="text-sm text-fg2">{beforeLedger ? "Outside the credit ledger" : p.credit.lapsed ? "Credit lapsed" : p.credit.eligible ? `In ${p.firm.short}'s GSTR-3B for ${month}${p.credit.late ? " (entered late)" : ""}` : "Not claimed on this bill"}</span></div><Money value={p.credit.claimed} tone="file" size="lg" /></div>}</Card>
      <Card title="Activity" subtitle="From the Audit log" pad={false} actions={<Link className="link text-sm min-h-11 inline-flex items-center" to="/audit">Audit log</Link>}><ol>{p.history.activity.map((activity, index) => <li key={`${activity.at}-${index}`} className="flex gap-3 px-5 py-3 border-t border-rule"><History size={16} aria-hidden="true" className="text-muted mt-0.5" /><span className="flex-1"><span className="block font-medium">{({ created: "Entered", imported: "Imported", updated: "Changed", checked: "Checked", credit_set: "Credit moved", deleted: "Deleted", restored: "Restored", exported: "Exported" })[activity.action]} by {activity.by || "someone"}</span><span className="block text-sm text-muted">{activity.details}</span></span><span className="text-sm text-muted">{date(activity.at.slice(0, 10))}</span></li>)}</ol></Card></div>
      <div className="flex flex-col gap-5 min-w-0"><Card title="Supplier" actions={<Link className="link text-sm min-h-11 inline-flex items-center" to={`/suppliers/${p.supplier.id}`}>All their bills</Link>}><DL rows={[["Name", p.supplier.name], ["GSTIN", p.supplier.gst_number || "None (unregistered)"], ["State", p.supplier.state_name || "—"], [p.supplier.address ? "Address" : "City", p.supplier.address || p.supplier.city || "—"], ["Phone", p.supplier.mobile_number || "—"]]} /></Card>
      <Card title="Bill details"><DL rows={[["Firm", p.firm.name], ["Supplier's bill no.", p.invoice_number], ["Bill date", date(p.invoice_date)], ["Paid by", p.payment_mode || "Not recorded"], ["Credit month", beforeLedger ? "Not assigned (before April 2025)" : `${month} · ${p.locked ? "GSTR-3B filed" : "not filed yet"}`], ["Entered by", p.history.created_by?.name || "—"], ...(p.linked_sale ? [["Same bill as", <span key="sale">{p.linked_sale.status !== "deleted" || me?.role === "owner" ? <Link className="link" to={`/sales/${p.linked_sale.id}`}>{p.linked_sale.invoice_number}</Link> : p.linked_sale.invoice_number}{p.linked_sale.status === "deleted" ? <span className="block text-sm text-muted">Deleted</span> : null}</span>]] as [string, React.ReactNode][] : [])]} />{canEdit && !beforeLedger ? <Button size="sm" icon={CalendarClock} onClick={() => setMoving(true)}>Move credit to another month</Button> : null}</Card>
      <Card title="Source"><p className="font-medium">{source}</p><p className="text-muted text-sm">{p.capture?.note ? `Note: “${p.capture.note}”` : p.capture?.hint ? `Supplier noted at capture: ${p.capture.hint}` : p.files.length ? "The supplier's bill is kept with the purchase." : "Attach the supplier's bill to keep it with the purchase."}</p><div className="flex flex-col gap-3 mt-3">{p.files.map((file) => <div key={file.id} className="rounded-ctl border border-line p-2"><button className="w-full text-left min-h-11" onClick={() => setPhoto(file)} aria-label={`Open ${file.name}`}>{file.preview_url ? <img src={file.preview_url} alt={`Bill page ${file.page}`} className="max-h-[260px] max-w-full mx-auto object-contain" /> : <Paperclip aria-hidden="true" />}{file.name}</button><div className="flex gap-2"><Button size="sm" icon={Download} onClick={() => void exportFile(file)}>Download original</Button>{file.id === "src" && canEdit ? <Button size="sm" variant="ghost" onClick={() => { setFileError(""); setRemoving(file); }}>Remove</Button> : null}</div></div>)}</div>{canAttach && !hasSource ? <Button className="mt-3" size="sm" icon={Paperclip} loading={attach.isPending} onClick={() => input.current?.click()}>Attach a photo or PDF</Button> : null}<input hidden ref={input} aria-label="Bill photo or PDF" type="file" accept="image/jpeg,image/png,image/heic,image/heif,application/pdf" disabled={!canAttach || hasSource} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (!file || !canAttach || hasSource || attach.isPending) return; setError(""); if (file.size > 20 * 1024 * 1024) { setError(`${file.name} is ${Math.ceil(file.size / 1024 / 1024)} MB. The most is 20 MB.`); return; } attach.mutate({ id: p.id, file }, { onError: (error) => setError(problemOf(error).message) }); }} /></Card></div>
    </div>
    {deleting ? <DeletePurchases bills={[p]} onClose={() => setDeleting(false)} onDone={() => navigate("/purchases", { replace: true })} /> : null}
    {moving && !beforeLedger ? <MoveCredit p={p} onClose={() => setMoving(false)} /> : null}
    {photo ? <Dialog open title={`Bill photo · ${p.invoice_number}`} description={`${p.supplier.name} · ${photo.name}`} size="lg" onClose={() => setPhoto(null)} footer={<Button icon={Download} onClick={() => void exportFile(photo)}>Download original</Button>}>{photo.kind === "pdf" ? <iframe title={photo.name} src={photo.url} className="w-full h-[60vh]" /> : <img src={photo.preview_url || photo.url} alt={`Photo of bill ${p.invoice_number}, page ${photo.page}`} className="w-full max-h-[70vh] object-contain" />}</Dialog> : null}
    {removing ? <ConfirmDialog open onClose={() => setRemoving(null)} onConfirm={() => removeFile.mutate({ id: p.id, fileId: removing.id }, { onSuccess: () => setRemoving(null), onError: (e) => setFileError(problemOf(e).message) })} extra={fileError ? <p role="alert" className="text-neg">{fileError}</p> : undefined} busy={removeFile.isPending} title={`Remove ${removing.name}?`} tone="danger" confirmLabel="Remove file">The purchase and its figures stay. This removes its attached file.</ConfirmDialog> : null}
  </Page>;
}

function MoveCredit({ p, onClose }: { p: PurchaseDetail; onClose(): void }) {
  const q = useCreditMonths(p.business, p.invoice_date);
  const move = useMovePurchaseCredit();
  const [month, setMonth] = useState(p.credit.month ?? "");
  const [error, setError] = useState("");
  return <Dialog open title="Claim the credit in" description={`Purchase ${p.invoice_number} · ${p.supplier.name}`} onClose={move.isPending ? () => {} : onClose} footer={<><Button disabled={move.isPending} onClick={onClose}>Keep this month</Button><Button variant="primary" loading={move.isPending} disabled={!q.data || month === p.credit.month || !q.data.options.some((o) => o.month === month && o.in_time)} onClick={() => move.mutate({ id: p.id, itc_month: month }, { onSuccess: onClose, onError: (e) => setError(problemOf(e).message) })}>Move credit</Button></>}><QueryView query={q} what="open credit months">{(data) => <Field label="Claim the credit in" htmlFor="move-credit"><Select id="move-credit" value={month} onChange={(e) => setMonth(e.target.value)} options={data.options.map((o) => ({ value: o.month, label: `${monthLabel(o.month, { long: true })} (not filed yet, 3B due ${date(o.due)})`, disabled: !o.in_time }))} /></Field>}</QueryView><p className="text-sm text-muted">The earliest return not filed yet: the safer choice.</p>{error ? <p role="alert" className="text-neg">{error}</p> : null}</Dialog>;
}

function SavedCapture({ p }: { p: PurchaseDetail }) {
  const q = useCaptureInboxPreview("all");
  const next = q.data?.results.find((c) => c.status === "ready");
  const navigate = useNavigate();
  const { isPhone } = useView();
  useEffect(() => {
    if (!next || isPhone) return;
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key.toLowerCase() !== "n" || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('[role="dialog"]')) return;
      if (e.target instanceof HTMLElement && (e.target.closest("input,textarea,select") || e.target.isContentEditable)) return;
      e.preventDefault(); navigate(`/purchases/inbox/${next.id}`);
    };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, [next, isPhone, navigate]);
  return <Banner tone="sale" title="Saved as a purchase" actions={<>{next ? <ButtonLink variant="primary" to={`/purchases/inbox/${next.id}`} aria-keyshortcuts={isPhone ? undefined : "N"}>Fill in the next one</ButtonLink> : null}<ButtonLink to="/purchases/inbox">Open the inbox</ButtonLink></>}>The photo left the inbox{p.needs_review ? " and the bill is marked “Needs a check”" : ""}.{q.data ? ` ${plural(q.data.count, "captured bill")} ${q.data.count === 1 ? "is" : "are"} still waiting.` : ""}</Banner>;
}
