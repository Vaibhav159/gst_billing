// The desktop form's lines (PROTO pages/sales/BillForm.jsx:598-762): a product picked by typing, its weight and unit, the
// rate as written on the paper bill (making included), its value before GST, a note that prints under it, and the
// problems under each. Enter walks weight → rate → a new line, so a bill goes by keyboard. No making or discount column:
// making charges are inside the rate (part 1 design §2).
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, StickyNote, Trash2 } from "lucide-react";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { unitDecimals } from "@/core/format";
import { Button, Combobox, IconButton, Input, Money, QtyInput, Select, type ComboItem, type ComboOption } from "@/core/ui";
import { focusNow, focusSoon, RateInput } from "./fields";
import { hasContent, lineFromProduct, SLAB_OPTIONS, slabOf, type FormLine } from "./model";
import { matchProducts, productSubtitle, UNIT_OPTIONS, type SaleProduct } from "./products";
import { isWeight, lineProblems, lineWarning, perWord, unitWord } from "./rules";
import type { BillFormApi } from "./useBillForm";
import { useRepairBoxes } from "./useRepairBoxes";

/** The product box's rows: the products matching every word typed, then "+ An item that isn't in Products…". */
export function productOptions(list: SaleProduct[] | undefined, failed: boolean, typed: string, canAdd: boolean): ComboItem<SaleProduct | null>[] {
  const t = typed.trim();
  const add: ComboOption<SaleProduct | null> = {
    key: "__new", value: null, tone: "brand", title: t ? `+ An item that isn't in Products: “${t}”…` : "+ An item that isn't in Products…",
    sub: canAdd ? "Name, HSN, GST rate, unit; keep it in Products or use it once" : "Name, HSN, GST rate, unit; used on this bill only",
  };
  // while the products load, Enter picks nothing: a fast typist never lands on "+ An item…" by mistake
  if (!list && !failed) return [{ heading: "Loading products…" }];
  if (!list) return [{ heading: "Products couldn't load: add the item by hand" }, add];
  const hits = matchProducts(list, t).slice(0, 50).map((p): ComboOption<SaleProduct | null> => ({
    key: String(p.id), value: p, title: p.name, sub: productSubtitle(p),
  }));
  return [...hits, add];
}

type LineProps = { F: BillFormApi; l: FormLine; i: number; products: SaleProduct[] | undefined; productsFailed: boolean; onNewProduct: (name: string, key: string) => void };

function ProductField({ F, l, i, products, productsFailed, onNewProduct }: LineProps) {
  const { can } = useAuth();
  const [q, setQ] = useState(l.name);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setQ(l.name); }, [l.name, editing]);
  const typed = editing && q !== l.name ? q : "";
  const canAdd = can("product.edit");
  const options = useMemo(() => productOptions(products, productsFailed, typed, canAdd), [products, productsFailed, typed, canAdd]);
  // picked by Enter: the weight box exists already, so focus moves now, before the next key ("4.5 never becomes 0.500 g")
  const pick = (o: ComboOption<SaleProduct | null>) => {
    setEditing(false);
    if (!o.value) { onNewProduct(typed.trim(), l.key); return; }
    const p = o.value;
    F.setLine(l.key, (prev) => lineFromProduct(p, prev));
    setQ(p.name);
    focusNow(`bf-${l.key}-qty`, true);
  };
  const err = F.showErr(`${l.key}-product`);
  return (
    <Combobox id={`bf-${l.key}-product`} query={q} onQuery={(t) => { setQ(t); setEditing(true); }} options={options} onPick={pick}
      ariaLabel={`Line ${i + 1} product`} listLabel="Products" invalid={Boolean(err)} describedBy={err ? `bf-${l.key}-product-error` : undefined}
      onFocus={() => setEditing(true)} onBlur={() => setEditing(false)} />
  );
}

/** Weight or quantity, with its unit as a small picker on the right; its unit's decimals. */
function QtyUnit({ F, l, n, describedBy, onEnter }: { F: BillFormApi; l: FormLine; n: number; describedBy?: string; onEnter: () => void }) {
  return (
    <div className="relative min-w-0">
      <QtyInput id={`bf-${l.key}-qty`} unit="" decimals={unitDecimals(l.unit)} value={l.qty} onChange={(v, t) => F.setLine(l.key, { qty: v, dotQty: /^\./.test(t || "") })}
        aria-label={`Line ${n} ${isWeight(l.unit) ? `weight in ${unitWord(l.unit)}` : `quantity in ${unitWord(l.unit)}`}`} invalid={Boolean(F.showErr(`${l.key}-qty`))} aria-describedby={describedBy}
        inputClassName="text-right tnum !pl-2.5 !pr-[60px]" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onEnter(); } }} />
      <select id={`bf-${l.key}-unit`} value={l.unit} aria-label={`Line ${n} unit`} onChange={(ev) => F.setLine(l.key, { unit: ev.target.value })}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 w-[52px] rounded-md bg-raised border border-line text-sm text-fg2 px-1 cursor-pointer">
        {UNIT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

/** The rate per unit as written on the paper bill, making included, before GST. */
function RateField({ F, l, n, describedBy, onEnter }: { F: BillFormApi; l: FormLine; n: number; describedBy?: string; onEnter: () => void }) {
  return (
    <div className="min-w-0">
      <RateInput id={`bf-${l.key}-rate`} value={l.rate} onChange={(r) => F.setLine(l.key, { rate: r })} suffix={`/${l.unit}`}
        aria-label={`Line ${n} rate per ${perWord(l.unit)}`} invalid={Boolean(F.showErr(`${l.key}-rate`))} aria-describedby={describedBy}
        inputClassName={cn("text-right tnum !pl-7", l.unit.length > 2 ? "!pr-11" : "!pr-9")} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onEnter(); } }} />
    </div>
  );
}

const LABEL: Record<string, string> = { product: "Item", hsn: "HSN", gst: "GST rate", qty: "Weight", rate: "Rate", note: "Note" };
/** A line's problems in one place under it, then what's worth a look (PROTO BillForm.jsx:656-676). */
function LineNotes({ F, l }: { F: BillFormApi; l: FormLine }) {
  const errs = ["product", "hsn", "gst", "qty", "rate", "note"].map((k) => [k, F.showErr(`${l.key}-${k}`)] as const).filter(([, t]) => t);
  const warn = lineWarning(l);
  if (!errs.length && !warn) return null;
  return (
    <div className="flex flex-col gap-1 mt-1.5 anim-rise">
      {errs.map(([k, t]) => <p key={k} id={`bf-${l.key}-${k}-error`} className="text-sm text-neg"><span className="font-medium">{k === "qty" && !isWeight(l.unit) ? "Quantity" : LABEL[k]}:</span> {t}</p>)}
      {warn ? <p id={`bf-${l.key}-qty-warn`} className="text-sm text-brand"><AlertTriangle size={14} className="inline -mt-0.5 mr-1" aria-hidden="true" />{warn}</p> : null}
    </div>
  );
}

function ProductCell(props: LineProps) {
  const { F, l, i } = props;
  const [noteOpen, setNoteOpen] = useState(Boolean(l.note));
  const e = (k: string) => F.showErr(`${l.key}-${k}`);
  const n = i + 1;
  const content = hasContent(l);
  // a one-off item's HSN and GST rate, and a product's (or a saved line's) the server won't take: a missing or short HSN,
  // a rate that isn't a slab (v2's 7%). The boxes stay while they're filled in, so they never vanish under the cursor
  // once the code or rate is right; another item picked on the line starts again
  const probs = lineProblems(l);
  const needs = content && (l.custom || Boolean(probs.hsn || probs.gst));
  const item = `${l.productId ?? ""}:${l.name}`;
  const inputs = useRepairBoxes(item, content, needs);
  return (
    <div className="min-w-0 flex flex-col gap-1.5">
      <ProductField {...props} />
      {inputs ? (
        <div className="flex flex-wrap gap-2 anim-rise">
          <Input id={`bf-${l.key}-hsn`} value={l.hsn} inputMode="numeric" maxLength={8} aria-label={`Line ${n} HSN code`} invalid={Boolean(e("hsn"))} aria-describedby={e("hsn") ? `bf-${l.key}-hsn-error` : undefined}
            className="w-[120px]" inputClassName="tnum" onChange={(ev) => F.setLine(l.key, { hsn: ev.target.value.replace(/\D/g, "") })} onBlur={() => F.setTouched((t) => ({ ...t, [`${l.key}-hsn`]: true }))} />
          {/* a rate that isn't a slab shows as none chosen, never as the first slab */}
          <Select id={`bf-${l.key}-gst`} value={slabOf(l.gst)} placeholder="GST rate: choose" options={SLAB_OPTIONS} className="flex-1 min-w-[150px]"
            aria-label={`Line ${n} GST rate`} invalid={Boolean(e("gst"))} aria-describedby={e("gst") ? `bf-${l.key}-gst-error` : undefined}
            onChange={(ev) => F.setLine(l.key, { gst: ev.target.value })} onBlur={() => F.setTouched((t) => ({ ...t, [`${l.key}-gst`]: true }))} />
        </div>
      ) : content ? <p className="text-xs text-muted">HSN {l.hsn} · GST {slabOf(l.gst)}%{l.amountOnly ? " · came in as an amount only" : ""}</p> : <p className="text-xs text-muted">Type to search products, or add an item that isn&apos;t listed</p>}
      {noteOpen ? (
        <Input id={`bf-${l.key}-note`} value={l.note} maxLength={60} aria-label={`Line ${n} note, printed under the item`} className="anim-rise" onChange={(ev) => F.setLine(l.key, { note: ev.target.value })} />
      ) : content ? <Button size="sm" variant="link" icon={StickyNote} className="self-start -my-1" onClick={() => { setNoteOpen(true); focusSoon(`bf-${l.key}-note`); }}>Note on this item</Button> : null}
    </div>
  );
}

/** One row per line from 700 px of room (no making column); narrower, each line folds onto two rows. */
export const ONE_ROW = 700;
export const LINE_COLS = "grid-cols-[20px_minmax(200px,1fr)_140px_140px_108px_36px]";

export function LineRow(props: LineProps & { oneRow: boolean }) {
  const { F, l, i, oneRow } = props;
  const fig = F.lineFig(l.key);
  const n = i + 1;
  const slab = slabOf(l.gst);
  const remove = () => {
    F.removeLine(l.key);
    const prev = F.f.lines[i - 1] ?? F.f.lines[i + 1];
    focusSoon(prev ? `bf-${prev.key}-product` : "bf-customer");
  };
  const desc = (k: string) => [F.showErr(`${l.key}-${k}`) ? `bf-${l.key}-${k}-error` : "", k === "qty" && lineWarning(l) ? `bf-${l.key}-qty-warn` : ""].filter(Boolean).join(" ") || undefined;
  const amount = (
    <div className="text-right min-w-0">
      {fig ? <Money value={fig.taxable} strong bump /> : <span className="text-muted">—</span>}
      {fig && slab ? <span className="block text-xs text-muted mt-0.5">+ GST {slab}% <Money value={fig.tax} /></span> : null}
    </div>
  );
  // Enter walks weight → rate → a new line
  const toRate = () => focusNow(`bf-${l.key}-rate`, true);
  const next = () => { F.addLine(true); };
  const removeBtn = <IconButton icon={Trash2} label={`Remove line ${n}${l.name ? `, ${l.name}` : ""}`} variant="danger" onClick={remove} className="mt-0.5" />;
  if (oneRow) {
    return (
      <div data-line={l.key} className={cn("grid gap-x-2.5 py-3 border-b border-rule items-start", LINE_COLS, F.newKeys.has(l.key) && "anim-rise")}>
        <span className="text-sm text-muted tnum pt-3" aria-hidden="true">{n}</span>
        <ProductCell {...props} />
        <QtyUnit F={F} l={l} n={n} describedBy={desc("qty")} onEnter={toRate} />
        <RateField F={F} l={l} n={n} describedBy={desc("rate")} onEnter={next} />
        <div className="pt-2.5">{amount}</div>
        {removeBtn}
        <div className="col-start-2 col-span-4 min-w-0"><LineNotes F={F} l={l} /></div>
      </div>
    );
  }
  return (
    <div data-line={l.key} className={cn("py-3 border-b border-rule", F.newKeys.has(l.key) && "anim-rise")}>
      <div className="grid grid-cols-[20px_minmax(0,1fr)_auto_36px] gap-x-2.5 items-start">
        <span className="text-sm text-muted tnum pt-3" aria-hidden="true">{n}</span>
        <ProductCell {...props} />
        <div className="pt-2.5 min-w-[96px]">{amount}</div>
        {removeBtn}
      </div>
      <div className="grid grid-cols-[20px_repeat(2,minmax(0,1fr))] gap-x-2.5 mt-2.5">
        <span aria-hidden="true" />
        <div className="min-w-0 flex flex-col gap-1"><span className="caps" aria-hidden="true">{isWeight(l.unit) ? "Weight" : "Qty"}</span><QtyUnit F={F} l={l} n={n} describedBy={desc("qty")} onEnter={toRate} /></div>
        <div className="min-w-0 flex flex-col gap-1"><span className="caps" aria-hidden="true">Rate per {l.unit}</span><RateField F={F} l={l} n={n} describedBy={desc("rate")} onEnter={next} /></div>
      </div>
      <div className="pl-[30px]"><LineNotes F={F} l={l} /></div>
    </div>
  );
}
