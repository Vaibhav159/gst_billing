// The bill on screen as it prints (PROTO sales/BillPrint.jsx:208-447): the same page breaks, words and figures as the
// PDF (both come from printBill), drawn in HTML so it shows on phones (which don't show a PDF inside a page), reads
// out to a screen reader, and scales to the space it has. Always black on white paper, in every theme. It reads only
// the print model (Ruling 1E-6): every word and figure here was worked out there, once for both drawings.
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/core/cn";
import { Button } from "@/core/ui";
import type { CopyMark, FreeText, PrintBill, PrintPage, Run } from "./model";
import { qrPath } from "./qr";

export const A4_W = 794; // 210 mm at 96 px per inch
export const A4_H = 1123;
const SERIF = '"Times New Roman", Times, "Liberation Serif", "Nimbus Roman", serif';
const GREY = "#4b4b4b";
const COLS = "30px minmax(0,1fr) 62px 96px 84px 38px 112px";
const NBSP = "\u00a0"; // PROTO's " ": an empty box or line keeps its height

/**
 * Every printed string that can hold a ₹ goes through here (Ruling 1E-5): text someone typed (names, addresses, the
 * notes, the boxes, the bank's details) and the Total with its own ₹. It shows the text as the PDF prints it: a line
 * break someone typed starts a new line (only the bill's note keeps any, and react-pdf breaks there too), and a ₹ shows
 * as it is, since the browser finds a font that has one. The PDF (BillDocument) draws the same strings through its twin
 * of this piece, which sets each ₹ in the RupeeSign font: the PDF's Times has none.
 */
function RupeeText({ children, bold }: { children: FreeText; bold?: boolean }) {
  return <span className={bold ? "font-bold" : undefined} style={{ whiteSpace: "pre-line" }}>{children}</span>;
}

/** A line in runs, the bold ones bold: a later page's short header (Ruling 1E-10). */
function Runs({ runs }: { runs: Run[] }) {
  return <>{runs.map((r, i) => <RupeeText key={i} bold={r.bold}>{r.text}</RupeeText>)}</>;
}

/** A real QR code, drawn as SVG (black on white, for the paper). */
export function QrSvg({ text, size = 78, label }: { text: string; size?: number; label: string }) {
  const q = useMemo(() => qrPath(text), [text]);
  if (!q) return null;
  return (
    <svg role="img" aria-label={label} width={size} height={size} viewBox={`0 0 ${q.size} ${q.size}`} shapeRendering="crispEdges" className="block">
      <rect width={q.size} height={q.size} fill="#fff" />
      <path d={q.d} fill="#000" />
    </svg>
  );
}

/** A row of the goods table. head: its column headings; filler: the empty row that stretches the table down the sheet. */
function Row({ cells, className, style, bold, head, filler }: { cells: ReactNode[]; className?: string; style?: CSSProperties; bold?: boolean; head?: boolean; filler?: boolean }) {
  return (
    <div role="row" aria-hidden={filler || undefined} className={cn("grid", filler && "flex-1", className)} style={{ gridTemplateColumns: COLS, ...style }}>
      {cells.map((c, i) => (
        <div key={i} role={head ? "columnheader" : "cell"} className={cn("px-1.5 py-[3px] min-w-0", i < 6 && "border-r border-black", (i === 0 || i === 2 || i === 5) && "text-center", (i === 3 || i === 4 || i === 6) && "text-right", bold && "font-bold")}>{c}</div>
      ))}
    </div>
  );
}

/** One sheet: a page of one copy of one bill. Lines are keyed by their place: an address can repeat a line. */
export function Paper({ b, copy, page }: { b: PrintBill; copy: CopyMark; page: PrintPage }) {
  const multi = page.count > 1;
  const label = (t: string) => <span style={{ fontSize: 10, color: GREY }}>{t}</span>;
  const cell = (i: number, k: string, v: FreeText, extra: string) => (
    <div key={i} className={cn("px-2 py-1 min-h-[34px] border-black", extra)}>{label(k)}<div className="font-bold"><RupeeText>{v || NBSP}</RupeeText></div></div>
  );
  // a firm without a GSTIN leaves it out of the code's name, as the code leaves its field empty
  const qrName = `QR code: ${[b.number, b.firm.gstin, b.dated, `₹${b.total.amount}`].filter(Boolean).join(", ")}`;
  return (
    <div role="document" data-paper="" aria-label={`Bill ${b.number} on paper, ${copy.label.toLowerCase()} copy${multi ? `, page ${page.index + 1} of ${page.count}` : ""}`}
      className="relative bg-white text-black shadow-pop shrink-0" style={{ width: A4_W, minHeight: A4_H, padding: "18px 28px 24px", fontFamily: SERIF, fontSize: 12, lineHeight: 1.35 }}>
      <div className="flex justify-between items-end mb-1" style={{ fontSize: 9.5 }}>
        <span style={{ color: GREY }}>{multi ? `Page ${page.index + 1} of ${page.count}` : NBSP}</span>
        <span style={{ fontStyle: "italic" }}>({copy.tag})</span>
      </div>
      <div className="border border-black flex flex-col" style={{ minHeight: A4_H - 66 }}>
        <div className="grid border-b border-black" style={{ gridTemplateColumns: page.first ? "92px minmax(0,1fr) 92px" : "minmax(0,1fr)" }}>
          {page.first ? <span aria-hidden="true" /> : null}
          <div role="heading" aria-level={2} className="text-center self-center py-1.5">
            <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "0.03em" }}>Tax Invoice</span>
            {!page.first ? <span style={{ fontSize: 11, color: GREY }}> (continued, page {page.index + 1})</span> : null}
          </div>
          {page.first ? (
            <div className="border-l border-black flex flex-col items-center justify-center py-1">
              <QrSvg text={b.qr} label={qrName} />
              <span style={{ fontSize: 8, color: GREY }}>Scan to check</span>
            </div>
          ) : null}
        </div>

        {page.first ? (
          <div className="grid border-b border-black" style={{ gridTemplateColumns: "minmax(0,1fr) 310px" }}>
            <div className="border-r border-black flex flex-col">
              <div className="px-2 py-1.5 border-b border-black">
                <div style={{ fontSize: 14.5, fontWeight: 700 }}><RupeeText>{b.firm.name}</RupeeText></div>
                {b.firm.lines.map((l, i) => <div key={i}><RupeeText>{l}</RupeeText></div>)}
              </div>
              {b.parties.map((p, i) => (
                <div key={i} className={cn("px-2 py-1.5", i === 0 && "border-b border-black")}>
                  {label(p.label)}
                  <div className="font-bold"><RupeeText>{p.name}</RupeeText></div>
                  {p.lines.map((l, j) => <div key={j}><RupeeText>{l}</RupeeText></div>)}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 content-start">
              {b.meta.map(([k, v], i) => cell(i, k, v, cn(i % 2 === 0 && "border-r", i < b.meta.length - 2 && "border-b")))}
            </div>
          </div>
        ) : (
          <div className="grid border-b border-black px-2 py-1.5 gap-x-4" style={{ gridTemplateColumns: "minmax(0,1fr) auto", fontSize: 11.5 }}>
            {b.short.map((runs, i) => <div key={i} className={i % 2 ? "text-right" : undefined}><Runs runs={runs} /></div>)}
          </div>
        )}

        <div role="table" aria-label="Goods" className="flex-1 flex flex-col">
          <Row head bold className="border-b border-black" style={{ background: "#f2f2f2" }} cells={["Sl No.", "Description of Goods", "HSN/SAC", "Quantity", "Rate", "per", "Amount"]} />
          {page.lines.map((i) => {
            const l = b.lines[i];
            return (
              <Row key={i} cells={[l.sl, (
                <span key="n">
                  <span className="font-bold"><RupeeText>{l.name}</RupeeText></span>
                  {l.note ? <span className="block" style={{ fontStyle: "italic", fontSize: 10.5, paddingLeft: 14 }}><RupeeText>{l.note}</RupeeText></span> : null}
                </span>
              ), l.hsn, l.qty, l.rate, l.per, <span key="a" className="font-bold">{l.amount}</span>]} />
            );
          })}
          {page.last ? (
            <>
              {b.taxes.map((t) => <Row key={t.key} cells={["", <span key="l" className="block text-right font-bold" style={{ fontStyle: "italic" }}>{t.head}</span>, "", "", t.rate, "", <span key="a" className="font-bold">{t.amount}</span>]} />)}
              {b.note ? <Row cells={["", <span key="n" style={{ fontStyle: "italic", fontSize: 11 }}>Note: <RupeeText>{b.note}</RupeeText></span>, "", "", "", "", ""]} /> : null}
            </>
          ) : null}
          <Row filler cells={["", "", "", "", "", "", ""]} />
          {page.last ? (
            <Row bold className="border-t border-black" cells={["", <span key="t" className="block text-right">Total</span>, "", b.total.qty, "", "", <span key="g" style={{ fontSize: 13 }}><RupeeText>{`₹ ${b.total.amount}`}</RupeeText></span>]} />
          ) : (
            <Row className="border-t border-black" cells={["", <span key="t" className="block text-right" style={{ fontStyle: "italic" }}>continued on page {page.index + 2}</span>, "", "", "", "", ""]} />
          )}
        </div>

        {page.last ? (
          <>
            <div className="border-t border-b border-black px-2 py-1">
              <div className="flex justify-between">{label("Amount Chargeable (in words)")}<span style={{ fontSize: 10, fontStyle: "italic" }}>E. & O.E</span></div>
              <div className="font-bold">{b.words}</div>
            </div>
            <table aria-label="Tax by HSN/SAC" className="w-full border-collapse" style={{ fontSize: 11 }}>
              <thead style={{ background: "#f2f2f2" }}>
                <tr>{(b.igst ? ["HSN/SAC", "Taxable Value", "IGST Rate", "IGST Amount", "Total Tax Amount"] : ["HSN/SAC", "Taxable Value", "CGST Rate", "CGST Amount", "SGST/UTGST Rate", "SGST/UTGST Amount", "Total Tax Amount"])
                  .map((h, i, a) => <th key={h} scope="col" className={cn("font-bold px-1.5 py-1 border-b border-black text-center", i < a.length - 1 && "border-r")}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {[...b.hsn, b.hsnTotal].map((h) => {
                  const total = h === b.hsnTotal;
                  const cells = b.igst ? [h.hsn, h.taxable, h.rate, h.igst, h.tax] : [h.hsn, h.taxable, h.rate, h.cgst, h.rate, h.sgst, h.tax];
                  return (
                    <tr key={h.key} className={total ? "font-bold" : ""}>
                      {cells.map((v, i) => {
                        const rate = i === 2 || (i === 4 && !b.igst);
                        return <td key={i} className={cn("px-1.5 py-[3px] border-b border-black", i < cells.length - 1 && "border-r", total || i > 0 ? (rate && !total ? "text-center" : "text-right") : "text-left")}>{v}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-2 py-1 border-b border-black" style={{ fontSize: 11 }}>Tax Amount (in words) : <span className="font-bold">{b.taxWords}</span></div>
            <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) 330px", fontSize: 11 }}>
              <div className="border-r border-black px-2 py-1.5 flex flex-col justify-between gap-3">
                <div>Company&apos;s PAN : <span className="font-bold">{b.firm.pan}</span></div>
                <div>
                  <div role="heading" aria-level={3} className="font-bold underline">Declaration</div>
                  <div style={{ fontSize: 10.5 }}>{b.declaration}</div>
                </div>
              </div>
              <div className="flex flex-col">
                {b.firm.bank ? (
                  <div className="px-2 py-1.5 border-b border-black">
                    <div>Company&apos;s Bank Details</div>
                    <div className="grid" style={{ gridTemplateColumns: "112px minmax(0,1fr)" }}>
                      {b.firm.bank.map(([k, v], i) => [<span key={`${i}k`}>{k}</span>, <span key={`${i}v`} className="font-bold">: <RupeeText>{v}</RupeeText></span>])}
                    </div>
                  </div>
                ) : null}
                <div className="px-2 py-1.5 flex-1 flex flex-col justify-between text-right min-h-[78px]">
                  <div className="font-bold">for <RupeeText>{b.firm.name}</RupeeText></div>
                  {b.firm.signature ? <img src={b.firm.signature} alt={`Signature for ${b.firm.name}`} className="self-end object-contain" style={{ maxHeight: 42, maxWidth: 150 }} /> : null}
                  <div>Authorised Signatory</div>
                </div>
              </div>
            </div>
            <div className="border-t border-black text-center py-1" style={{ fontSize: 10.5 }}>SUBJECT TO {b.jurisdiction.toUpperCase()} JURISDICTION</div>
            <div className="border-t border-black text-center py-1" style={{ fontSize: 10, color: GREY }}>This is a Computer Generated Invoice</div>
          </>
        ) : null}
      </div>
      {b.cancelled ? (
        <div aria-label="Cancelled" role="img" className="absolute pointer-events-none" style={{ top: 420, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
          <span style={{ transform: "rotate(-16deg)", border: "4px solid #c62828", color: "#c62828", fontSize: 64, fontWeight: 700, letterSpacing: "0.12em", padding: "4px 26px", opacity: 0.8, fontFamily: SERIF }}>CANCELLED</span>
        </div>
      ) : null}
    </div>
  );
}

/** The paper, scaled to the space it has (a phone, a narrow window); a button shows it full size. */
export function ScaledPaper({ b, copy, page }: { b: PrintBill; copy: CopyMark; page: PrintPage }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(358);
  const [full, setFull] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const measure = () => setW(el.clientWidth || 358);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = Math.min(1, w / A4_W);
  return (
    <div ref={box} className="w-full flex flex-col gap-2">
      <div {...(full ? { className: "scroll-x -mx-4 px-4", tabIndex: 0, role: "region", "aria-label": "The bill at full size" } : {})}>
        <div style={full ? undefined : { zoom: scale }}><Paper b={b} copy={copy} page={page} /></div>
      </div>
      {scale < 1 ? <Button size="sm" variant="ghost" icon={full ? Minimize2 : Maximize2} onClick={() => setFull(!full)} className="self-center">{full ? "Fit to the screen" : "See it full size"}</Button> : null}
    </div>
  );
}

/**
 * The papers again, full size and outside the app, for printing from the browser (Ctrl P): on screen they're hidden,
 * and in print styles.css shows only them, a sheet each (the scaled ones above are zoomed and boxed in by the app).
 * While it's mounted the printed sheet is A4 without margins (the paper has its own); other pages keep the browser's.
 */
export function PrintCopy({ children }: { children: ReactNode }) {
  return createPortal(
    <div data-print-copy="" aria-hidden="true">
      <style>{"@media print { @page { size: A4; margin: 0 } }"}</style>
      {children}
    </div>,
    document.body,
  );
}
