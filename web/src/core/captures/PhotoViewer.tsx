import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/core/cn";
import { inr, toPaise } from "@/core/format";
import { Badge, Button, Dialog, IconButton, Segmented } from "@/core/ui";
import { useView } from "@/core/view";
import { checkWords, pendingReadGroups, readGroups, type ReadConfirmations } from "./confidence";
import type { CapturePage, PurchaseRead, ReadGroup } from "./types";

export type PhotoViewerProps = { pages: CapturePage[]; label?: string; height?: string; className?: string };

/** Real uploads only. The read contract has no page-relative OCR coordinates. */
export function PhotoViewer({ pages, label = "Bill photo", height = "62vh", className }: PhotoViewerProps) {
  const [index, setIndex] = useState(0);
  const page = pages[Math.min(index, Math.max(0, pages.length - 1))];
  const [z, setZ] = useState(1);
  const [imageAttempt, setImageAttempt] = useState(0);
  const [aspect, setAspect] = useState(820 / 600);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; l: number; t: number } | null>(null);
  const { isPhone } = useView();
  const images = page?.kind === "photo"
    ? [page.url, ...(page.preview_url && page.preview_url !== page.url ? [page.preview_url] : [])]
    : page?.preview_url ? [page.preview_url] : [];
  const imageUrl = images[imageAttempt];
  useEffect(() => { setZ(1); setImageAttempt(0); setAspect(820 / 600); }, [page?.url, page?.preview_url]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [Boolean(page)]);
  const fit = size.w ? Math.max(1, Math.min(size.w - 32, (size.h - 32) / aspect)) : 0;
  const zoomTo = (next: number) => setZ(Math.max(1, Math.min(3, next)));
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (["+", "=", "-", "_", "−", "0"].includes(event.key)) {
      event.preventDefault();
      zoomTo(event.key === "0" ? 1 : z + (["+", "="].includes(event.key) ? 0.5 : -0.5));
    }
  };
  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    if (z === 1 || event.button !== 0 || !box.current) return;
    drag.current = { x: event.clientX, y: event.clientY, l: box.current.scrollLeft, t: box.current.scrollTop };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !box.current) return;
    box.current.scrollLeft = drag.current.l - (event.clientX - drag.current.x);
    box.current.scrollTop = drag.current.t - (event.clientY - drag.current.y);
  };
  if (!page) return <p className="text-sm text-muted">No photo is attached.</p>;
  const pageLabel = `${label}, page ${page.page}`;
  return (
    <div className={cn("flex flex-col gap-2 min-w-0", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {pages.length > 1 ? <Segmented label="Page" value={Math.min(index, pages.length - 1)} onChange={(next) => { setIndex(next); setZ(1); }} options={pages.map((p, i) => ({ value: i, label: `Page ${p.page}` }))} /> : null}
        <span className="flex-1" />
        <IconButton label="Zoom out" icon={ZoomOut} size="sm" variant="secondary" onClick={() => zoomTo(z - 0.5)} disabled={z <= 1} />
        <span className={cn("tnum text-sm text-muted w-12 text-center", isPhone && "sr-only")} aria-live="polite">{Math.round(z * 100)}%</span>
        <IconButton label="Zoom in" icon={ZoomIn} size="sm" variant="secondary" onClick={() => zoomTo(z + 0.5)} disabled={z >= 3} />
        <IconButton label="Fit the whole bill" icon={Maximize2} size="sm" variant="secondary" onClick={() => zoomTo(1)} disabled={z === 1} />
      </div>
      <div ref={box} tabIndex={0} role="group" aria-label={`${label}. Use + and − to zoom, drag or scroll to move around.`} onKeyDown={onKey}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        onDoubleClick={() => zoomTo(z === 1 ? 2 : 1)} style={{ height }}
        className={cn("relative overflow-auto rounded-card border border-line bg-raised", z > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in")}>
        {imageUrl ? (
          <div className="flex justify-center items-start p-4" style={{ width: fit ? Math.max(size.w, fit * z + 32) : `${z * 100}%`, minHeight: "100%" }}>
            <div data-paper="" className="rotate-[-0.6deg] shadow-pop rounded-[3px] overflow-hidden bg-white select-none shrink-0 motion-safe:transition-[width] duration-200 ease-out" style={{ width: fit ? fit * z : "100%" }}>
              <img key={imageUrl} src={imageUrl} alt={pageLabel} draggable={false} onError={() => setImageAttempt(attempt => attempt + 1)} onLoad={(event) => {
                const img = event.currentTarget;
                if (img.naturalWidth) setAspect(img.naturalHeight / img.naturalWidth);
              }} className="block w-full h-auto" />
            </div>
          </div>
        ) : page.kind === "pdf" ? (
          <iframe key={page.url} src={`${page.url.split("#")[0]}#zoom=${Math.round(z * 100)}`} title={`${pageLabel} (PDF)`} className="block w-full h-full border-0" />
        ) : <p role="status" className="p-4 text-sm text-fg2">The preview couldn't be opened. Open the original file.</p>}
      </div>
      <a href={page.url} target="_blank" rel="noopener noreferrer" className="text-brand text-sm underline underline-offset-4 min-h-11 inline-flex items-center self-start">Open original</a>
    </div>
  );
}

export function PhotoDialog({ open, onClose, title, description, pages }: {
  open: boolean; onClose: () => void; title: string; description?: ReactNode; pages: CapturePage[];
}) {
  return <Dialog open={open} onClose={onClose} title={title} description={description} size="lg" footer={<Button variant="primary" onClick={onClose}>Close</Button>}>
    <PhotoViewer pages={pages} label={title} />
  </Dialog>;
}

/** The outlined groups are the AI's transcription, never invented locations on the photo. */
export function ReadingChecks({ read, confirmed, onConfirm, focusKey }: {
  read: PurchaseRead; confirmed: ReadConfirmations; onConfirm?: (group: ReadGroup) => void; focusKey?: ReadGroup | null;
}) {
  const id = useId();
  const pending = pendingReadGroups(read, confirmed);
  const words: Record<ReadGroup, ReactNode> = {
    supplier: read.supplier.name || "—", gstin: read.supplier.gst_number || "—", bill_no: read.invoice_number || "—",
    date: read.invoice_date || "—",
    amounts: <div className="flex flex-col gap-2">
      {read.lines.map((line, i) => <p key={i}>{line.product_name || "—"} · {line.amount_only ? `Amount only ${inr(toPaise(line.taxable))}` : `${line.quantity ?? "—"} ${line.unit} × ₹${line.rate ?? "—"}`} · GST {line.printed_rate || "—"}</p>)}
      <p>Printed total <span className="tnum">{inr(toPaise(read.printed_total))}</span></p>
      <p>Lines total <span className="tnum">{inr(toPaise(read.lines_total))}</span></p>
    </div>,
  };
  return <section aria-labelledby={id} className="flex flex-col gap-3">
    <h3 id={id} className="font-semibold">What was read</h3>
    <p className="text-sm text-muted">Compare these words and figures with the original bill.</p>
    {read.source === "e-invoice" ? <div className="text-sm text-sale"><p className="font-semibold">From the e-invoice</p><p>An IRN was read from this bill. Check the GST slab and save.</p><p className="break-all">IRN {read.irn}</p></div> : null}
    {read.notes.map((note, i) => <p key={i} className="text-sm text-fg2">{note}</p>)}
    {readGroups.map((group) => <div key={group} role="group" aria-label={checkWords[group]} data-focused={focusKey === group || undefined}
      className={cn("rounded-ctl border px-3 py-2 flex flex-col gap-2", pending.includes(group) ? "border-brand bg-brand-tint" : "border-line", focusKey === group && "ring-2 ring-brand")}>
      <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{checkWords[group]}</span>{pending.includes(group) ? <Badge tone="brand">Needs a check</Badge> : null}</div>
      <div className="text-sm text-fg2 break-words">{words[group]}</div>
      {pending.includes(group) && onConfirm ? <Button size="sm" variant="outline" className="self-start" aria-label={`Looks right: ${checkWords[group]}`} onClick={() => onConfirm(group)}>Looks right</Button> : null}
    </div>)}
  </section>;
}
