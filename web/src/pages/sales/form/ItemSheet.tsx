// The phone's item sheet (PROTO pages/sales/BillForm.jsx:1128-1296): the shop's common products first (the keyboard
// stays down until asked for), a search, or an item that isn't in Products; then the weight and the rate as written on
// the paper bill, with the line's total above the keyboard. "Add and next item" keeps a run of items going.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { Check, PackagePlus, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/core/auth/AuthProvider";
import { UNITS, unitDecimals } from "@/core/format";
import { lineFigures } from "@/core/sales/maths";
import { Button, Chip, Dialog, DL, Field, Input, ListRow, Money, QtyInput, SearchInput, Select } from "@/core/ui";
import { focusNow, RateInput } from "./fields";
import { blankLine, hasContent, lineFromProduct, SLAB_OPTIONS, slabOf, type FormLine } from "./model";
import { NewItemForm } from "./NewItemForm";
import { matchProducts, quickProducts, type SaleProduct } from "./products";
import { isWeight, lineProblems, perWord, unitWord, type LineField } from "./rules";
import type { BillFormApi } from "./useBillForm";
import { useRepairBoxes } from "./useRepairBoxes";

const UNIT_OPTIONS = UNITS.map((u) => ({ value: u.value, label: u.value }));
const ORDER: LineField[] = ["hsn", "gst", "qty", "rate"];
const SAME = ["productId", "name", "hsn", "gst", "unit", "qty", "rate", "note"] as const;

export type ItemSheetProps = {
  F: BillFormApi; open: boolean;
  /** The line being changed, or null to add one. */
  lineKey: string | null;
  products: SaleProduct[] | undefined;
  productsError?: boolean;
  focusField?: LineField | "product" | "note";
  onClose: () => void;
  /** "Add and next item": the sheet opens again, empty. */
  onAgain: () => void;
  /** "Remove item": the form removes the line, closes the sheet and moves focus on, as a card's Remove does. */
  onRemove: (key: string) => void;
  /** Changes each time the sheet opens again for the next item. */
  again: number;
};

export function ItemSheet({ F, open, lineKey, products, productsError, focusField, onClose, onAgain, onRemove, again }: ItemSheetProps) {
  const { can } = useAuth();
  const existing = lineKey ? F.f.lines.find((x) => x.key === lineKey) ?? null : null;
  const [line, setLine] = useState<FormLine>(() => (existing ? { ...existing } : blankLine()));
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"item" | "product">("item");
  const [tried, setTried] = useState(false);
  const [formTyped, setFormTyped] = useState(false);
  const [productBusy, setProductBusy] = useState(false);
  const [opened, setOpened] = useState({ open, lineKey, again });
  const problemField = useRef<HTMLElement | null>(null);
  const productList = useRef<HTMLDivElement>(null);
  // what the line was before anything was typed: the line being changed, or the product just picked
  const base = useRef<FormLine>(line);
  // Reset before committing the new sheet: the previous item's fields must never flash or take focus.
  if (opened.open !== open || opened.lineKey !== lineKey || opened.again !== again) {
    setOpened({ open, lineKey, again });
    if (open) {
      const st = existing ? { ...existing } : blankLine();
      base.current = st;
      setLine(st); setQ(""); setTried(false); setMode("item"); setFormTyped(false);
    }
  }
  const chosen = hasContent(line) || line.custom;
  // Add and next removes the field with focus: return to the list with the keyboard down.
  useEffect(() => { if (open && !chosen && mode === "item") productList.current?.focus({ preventScroll: true }); }, [open, chosen, mode, again]);
  const t = q.trim();
  const list = t && products ? matchProducts(products, t).slice(0, 30) : [];
  const slab = slabOf(line.gst);
  const fig = lineFigures({ quantity: line.qty ?? 0, rate: line.rate || 0, gst_percent: slab || "0" }, F.tt.inter) ?? { taxable: 0, tax: 0, amount: 0 };
  const err = lineProblems(line);
  // A refusal belongs to the value sent; local typing clears that field's words without losing the other refusals.
  const sourceError = (k: LineField | "product" | "note") => {
    const field = k === "product" ? "name" : k;
    return lineKey && line[field] === existing?.[field] ? F.serverErrors[`${lineKey}-${k}`] ?? "" : "";
  };
  const show = (k: LineField) => sourceError(k) || (tried || (lineKey && F.tried) ? err[k] ?? "" : "");
  const productError = sourceError("product");
  const noteError = sourceError("note");
  // As on a desktop line, keep the repair boxes while typing, even once the HSN and GST rate are valid.
  const item = `${line.productId ?? ""}:${line.name}`;
  const needs = chosen && (line.custom || Boolean(err.hsn || err.gst || show("hsn") || show("gst")));
  const repair = useRepairBoxes(item, chosen, needs, base.current);
  const pick = (p: SaleProduct) => {
    flushSync(() => setLine((l) => { const nl = lineFromProduct(p, l); if (!lineKey) base.current = nl; return nl; }));
    focusNow("is-qty", true);
  };
  // a drag, Esc, the scrim or ✕ asks before a typed weight, rate or item is thrown away
  const typed = mode === "product" ? formTyped : SAME.some((k) => (line[k] ?? null) !== (base.current[k] ?? null));
  const commit = (more: boolean) => {
    const first = ORDER.find((k) => err[k]);
    if (first) { flushSync(() => setTried(true)); focusNow(`is-${first}`, true); return; }
    if (lineKey) F.setLine(lineKey, line); else F.addLine(false, line);
    if (more) onAgain(); else onClose();
  };
  const remove = () => { if (lineKey) onRemove(lineKey); else onClose(); };
  const enterTo = (id: string | null) => (e: KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); if (id) focusNow(id, true); else commit(false); } };
  const idx = lineKey ? F.f.lines.findIndex((x) => x.key === lineKey) + 1 : F.filled.length + 1;
  const footer = chosen && mode === "item" ? (
    <>
      {lineKey ? <Button variant="danger-outline" icon={Trash2} onClick={remove}>Remove item</Button> : <Button icon={Plus} onClick={() => commit(true)}>Add and next item</Button>}
      <Button variant="primary" size="lg" icon={Check} onClick={() => commit(false)}>{lineKey ? "Save item" : "Add to bill"}</Button>
    </>
  ) : undefined;
  return (
    <Dialog open={open} ghostGuardKey={again} initialFocus={focusField ? problemField : undefined} onClose={productBusy ? () => {} : onClose} title={mode === "product" ? "An item that isn't in Products" : lineKey ? `Item ${idx}` : `Add item ${idx}`} footer={footer}
      confirmClose={!productBusy && typed ? (lineKey && mode !== "product" ? "Discard the changes to this item?" : "Discard this item?") : undefined}>
      {mode === "product" ? (
        <NewItemForm initialName={t} idBase="npp" onCancel={() => setMode("item")} onTyped={setFormTyped} onBusy={setProductBusy}
          onDone={(r) => { flushSync(() => { setLine((l) => ({ ...l, productId: r.productId, name: r.line.name, hsn: r.line.hsn, gst: r.line.gst, unit: r.line.unit, rate: r.line.rate || l.rate, note: r.line.description || l.note, custom: r.productId === null })); setMode("item"); }); focusNow("is-qty", true); }} />
      ) : !chosen ? (
        // opens on the common products, not the search box: the keyboard stays down until asked for
        <div ref={productList} className="flex flex-col gap-3 outline-none" tabIndex={-1} data-autofocus="">
          {!t && products ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Common products">
              {quickProducts(products, 8).map((p) => <Chip key={p.id} onClick={() => pick(p)}>{p.name.replace(/ 22K$/, "")}</Chip>)}
            </div>
          ) : null}
          {productsError && !products ? <p className="text-fg2">Products couldn't load: add the item by hand</p> : null}
          <SearchInput value={q} onChange={setQ} placeholder="Search products or HSN" label="Search products" enterKeyHint="search" />
          {t ? (
            <div className="-mx-5 flex flex-col">
              {list.map((p) => <ListRow key={p.id} onClick={() => pick(p)} title={p.name} subtitle={`HSN ${p.hsn_code || "missing"} · GST ${p.gst_percent != null ? `${p.gst_percent}%` : "rate not set"} · per ${perWord(p.unit)}`} chevron={false} />)}
              {!list.length && (products || !productsError) ? <p className="px-5 py-3 text-fg2">{products ? `No product matches “${t}”.` : "Products are still loading."}</p> : null}
            </div>
          ) : null}
          <Button variant="outline" full icon={PackagePlus} onClick={() => setMode("product")}>{t ? `“${t}” isn't in Products` : "An item that isn't in Products"}</Button>
          {!can("product.edit") ? <p className="text-sm text-muted -mt-1">Such an item is used on this bill only. The owner adds products to the list.</p> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-4" ref={(node) => { problemField.current = focusField ? node?.querySelector<HTMLElement>(`#is-${focusField}`) ?? null : null; }}>
          <div className="flex items-center gap-3">
            <span className="flex-1 min-w-0">
              <span className="block font-semibold">{line.name}</span>
              <span className="block text-sm text-muted">{line.custom ? "Used on this bill only" : `HSN ${line.hsn || "missing"} · GST ${slab ? `${slab}%` : "not set"} · per ${perWord(line.unit)}`}</span>
            </span>
            <Button id="is-product" size="sm" variant="ghost" aria-describedby={productError ? "is-product-error" : undefined}
              onClick={() => setLine((l) => ({ ...blankLine(), key: l.key, qty: l.qty }))}>Change</Button>
          </div>
          {productError ? <p id="is-product-error" className="text-sm text-neg">{productError}</p> : null}
          {repair ? (
            <div className="grid grid-cols-2 gap-3 anim-rise">
              <Field label="HSN code" htmlFor="is-hsn" error={show("hsn")}>
                <Input id="is-hsn" value={line.hsn} inputMode="numeric" maxLength={8} invalid={Boolean(show("hsn"))} onChange={(e) => setLine((l) => ({ ...l, hsn: e.target.value.replace(/\D/g, "") }))} />
              </Field>
              <Field label="GST rate" htmlFor="is-gst" error={show("gst")}>
                <Select id="is-gst" value={slabOf(line.gst)} placeholder="Choose" options={SLAB_OPTIONS} invalid={Boolean(show("gst"))} onChange={(e) => setLine((l) => ({ ...l, gst: e.target.value || null }))} />
              </Field>
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-[minmax(0,1fr)_104px] gap-3">
              <Field label={isWeight(line.unit) ? `Weight in ${unitWord(line.unit)}` : `How many ${unitWord(line.unit)}`} htmlFor="is-qty" error={show("qty")}>
                <QtyInput id="is-qty" unit="" decimals={unitDecimals(line.unit)} value={line.qty} onChange={(v, txt) => setLine((l) => ({ ...l, qty: v, dotQty: /^\./.test(txt) }))}
                  invalid={Boolean(show("qty"))} inputClassName="h-14 text-2xl tnum" enterKeyHint="next" onKeyDown={enterTo("is-rate")} />
              </Field>
              <Field label="Unit" htmlFor="is-unit">
                <Select id="is-unit" value={line.unit} options={UNIT_OPTIONS} onChange={(e) => setLine((l) => ({ ...l, unit: e.target.value }))} className="[&_select]:h-14" />
              </Field>
            </div>
            {/* the line's total sits with the weight, above the keyboard */}
            <p className="text-sm text-fg2 flex items-baseline justify-between gap-3" aria-live="polite"><span>Line total incl. GST</span><Money value={fig.amount} strong tone="sale" bump /></p>
          </div>
          <Field label={`Rate per ${perWord(line.unit)}`} htmlFor="is-rate" error={show("rate")} hint={show("rate") ? undefined : "As written on the paper bill, making included, before GST."}>
            <RateInput id="is-rate" value={line.rate} onChange={(r) => setLine((l) => ({ ...l, rate: r }))} invalid={Boolean(show("rate"))} inputClassName="h-12 text-lg tnum" enterKeyHint="done" onKeyDown={enterTo(null)} />
          </Field>
          <Field label="Note on this item" htmlFor="is-note" error={noteError} hint="Optional: size, design or a hallmark number. Printed under the item.">
            <Input id="is-note" value={line.note} maxLength={60} invalid={Boolean(noteError)} onChange={(e) => setLine((l) => ({ ...l, note: e.target.value }))} />
          </Field>
          <div className="rounded-ctl border border-line bg-field px-4 py-2">
            <DL rows={[
              ["Before GST", <Money key="b" value={fig.taxable} bump />],
              [slab ? `GST ${slab}%${F.tt.inter ? " (IGST)" : ""}` : "GST rate not chosen", <Money key="g" value={fig.tax} bump />],
            ]} />
          </div>
        </div>
      )}
    </Dialog>
  );
}
