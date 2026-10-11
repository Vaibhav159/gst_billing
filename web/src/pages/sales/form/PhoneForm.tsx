// The bill form on a phone (PROTO pages/sales/BillForm.jsx:956-1126): one guided page of cards, a sheet for the firm,
// number and date, the customer (1C's sheet: the list first, not the keyboard) and each item, and the total always in
// reach in the action bar beside Check and save.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router";
import { Check, ChevronRight, MoreHorizontal, Pencil, Plus, Trash2, UserPlus } from "lucide-react";
import { cn } from "@/core/cn";
import { date, plural, qty as qtyLabel } from "@/core/format";
import { rateText } from "@/core/sales/words";
import { Avatar, Button, Card, Dialog, Field, IconButton, Menu, Money, Page, Segmented, Textarea, type MenuItem } from "@/core/ui";
import { CustomerFixSheet, CustomerSheet, customerLine, homeState, type FixField } from "@/pages/customers/forBills";
import { checksWithFixes } from "./DesktopForm";
import { DraftBanners, DraftStatus } from "./drafts";
import { CheckList, focusNow, PayPicker } from "./fields";
import { ItemSheet, type ItemSheetProps } from "./ItemSheet";
import { slabOf, type FormLine } from "./model";
import { billCloseTo, DateBlock, NumberField, Origins, PaperSwitch, PaymentNote, PlaceOfSupply, saveFromReview, SummaryFigures } from "./parts";
import { useSaleProducts } from "./products";
import { focusReview, Review } from "./Review";
import { lineWarning, paymentNote, perWord } from "./rules";
import type { BillFormApi } from "./useBillForm";
import type { DraftKeeping } from "./useDraftKeeping";

type SheetState = { kind: "info"; numberFocus?: boolean; dateFocus?: boolean } | { kind: "customer" } | { kind: "item"; key: string | null; n: number; focusField?: ItemSheetProps["focusField"] } | null;

export function PhoneForm({ F, drafts, children }: { F: BillFormApi; drafts: DraftKeeping; children?: ReactNode }) {
  const navigate = useNavigate();
  const products = useSaleProducts();
  const [sheet, setSheet] = useState<SheetState>(null);
  const again = useRef(0);
  const [fix, setFix] = useState<FixField | null>(null);
  const edit = F.edit;
  const cust = F.cust;
  const custErr = F.showErr("customer");
  const infoErr = F.showErr("firm") || F.showErr("number") || F.showErr("date");
  const checks = checksWithFixes(F, setFix);
  /** Takes the person to a problem: the sheet that holds it, or the field itself. */
  const focusProblem = (k: string) => {
    if (k === "firm" || k === "number" || k === "date") setSheet({ kind: "info", numberFocus: k === "number", dateFocus: k === "date" });
    else if (k === "customer") setSheet({ kind: "customer" });
    else if (k === "pos") focusNow("bfp-pos-state", true);
    else if (k === "notes") focusNow("bfp-notes", true);
    else if (k === "lines") setSheet({ kind: "item", key: null, n: ++again.current });
    else setSheet({ kind: "item", key: k.slice(0, k.lastIndexOf("-")), n: ++again.current, focusField: k.slice(k.lastIndexOf("-") + 1) as ItemSheetProps["focusField"] });
  };
  const tryReview = () => { const r = F.openReview(); if (!r.ok) focusProblem(r.first); };
  const saveNow = (numberOverride?: string) => saveFromReview(F, focusProblem, numberOverride);
  /** Remove, on a card or in its sheet: the item goes (and its sheet), and focus moves to the next card, or Add another item. */
  const removeItem = (key: string) => {
    const at = F.filled.findIndex((l) => l.key === key);
    const next = at < 0 ? undefined : F.filled[at + 1];
    flushSync(() => { F.removeLine(key); setSheet(null); });
    focusNow(next ? `bfp-item-${next.key}` : "bfp-add");
  };
  const close = () => navigate(billCloseTo(F));
  // A narrow desktop has a keyboard too. The review handles its own Save; sheets and menus keep the shortcut held.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      if (!F.reviewOpen && !document.querySelector('[role="dialog"]:not([data-closing]), [role="menu"]:not([data-closing])')) tryReview();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const menu: MenuItem[] = [
    { label: "Firm, number and date", icon: Pencil, onSelect: () => setSheet({ kind: "info" }) },
    { divider: true },
    edit && F.bill ? { label: "Stop editing", hint: "Asks first if something changed", onSelect: () => navigate(`/sales/${F.bill?.id}`) }
      : { label: "Close", hint: F.draftId ? "Keeps the draft; finish it later" : undefined, onSelect: close },
  ];
  return (
    <Page title={edit && F.bill ? `Edit ${F.bill.invoice_number}` : F.paper ? "Paper bill" : "New bill"} phoneSubtitle={<DraftStatus F={F} drafts={drafts} />} back
      phoneActions={<Menu title="Bill" items={menu} trigger={(p) => <IconButton {...p} label="More for this bill" icon={MoreHorizontal} />} />}
      actionBar={(
        // the total never shrinks: when it and the button don't fit side by side, the button wraps to its own line
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 w-full">
          <div className="grow-[100] basis-auto min-w-fit">
            <Money value={F.figs.total} size="xl" tone="sale" bump className="block" />
            <span className="block text-xs text-muted">{plural(F.filled.length, "item")} · incl. GST</span>
          </div>
          <Button variant="primary" size="lg" icon={Check} onClick={tryReview} className="grow shrink-0">{edit ? "Check and save changes" : "Check and save"}</Button>
        </div>
      )}>
      <div className="flex flex-col gap-5">
        <Origins F={F} />
        <DraftBanners F={F} drafts={drafts} onTryReview={tryReview} />
        <div className="flex flex-col gap-1.5">
          <button id="bfp-info" type="button" onClick={() => setSheet({ kind: "info" })}
            className={cn("card w-full text-left px-4 py-3 flex items-center gap-3 min-h-14 active:scale-[0.99] transition-transform", infoErr && "border-neg-line")}>
            <span className="flex-1 min-w-0">
              <span className="block font-medium">{F.firmName || "No firm yet"}</span>
              <span className="block text-sm text-muted tnum">No. {F.stored || "not typed yet"} · {F.f.date ? date(F.f.date) : "date missing"}</span>
            </span>
            <span className="text-brand font-semibold text-sm">Change</span>
          </button>
          {infoErr ? <p className="text-sm text-neg px-1 anim-rise">{infoErr}</p> : F.dateWarn ? <p className="text-sm text-brand px-1 anim-rise">{F.dateWarn}</p> : null}
        </div>
        {edit ? null : <div className="card px-4 py-3"><PaperSwitch F={F} id="bfp-paper" /></div>}

        <section aria-labelledby="bfp-cust-h" className="flex flex-col gap-2">
          <h2 id="bfp-cust-h" className="caps px-1">Customer</h2>
          <button id="bfp-customer" type="button" onClick={() => setSheet({ kind: "customer" })}
            className={cn("card w-full text-left px-4 py-3 flex items-center gap-3 min-h-16 active:scale-[0.99] transition-transform", custErr && "border-neg-line")}>
            {cust ? <Avatar name={cust.name} size={38} tone="muted" /> : <span className="w-[38px] h-[38px] rounded-full bg-brand-tint border border-brand-line grid place-items-center text-brand shrink-0"><UserPlus size={18} aria-hidden="true" /></span>}
            <span className="flex-1 min-w-0">
              <span className={cn("block font-medium", !cust && "text-brand")}>{cust ? cust.name : "Choose customer"}</span>
              <span className="block text-sm text-muted">{cust ? customerLine(cust) : "Search, recent, walk-in or new"}</span>
            </span>
            <ChevronRight size={18} className="text-muted shrink-0" aria-hidden="true" />
          </button>
          {custErr ? <p className="text-sm text-neg px-1 anim-rise">{custErr}</p> : null}
          {cust ? <div className="px-1"><PlaceOfSupply F={F} id="bfp-pos" /></div> : null}
        </section>

        <section aria-labelledby="bfp-items-h" className="flex flex-col gap-2">
          <h2 id="bfp-items-h" className="caps px-1">Items · {F.filled.length}</h2>
          {F.filled.map((l, i) => <PhoneItemCard key={l.key} F={F} l={l} index={i} onEdit={() => setSheet({ kind: "item", key: l.key, n: ++again.current })} onRemove={() => removeItem(l.key)} />)}
          <Button id="bfp-add" variant="outline" size="lg" full icon={Plus} onClick={() => setSheet({ kind: "item", key: null, n: ++again.current })}>{F.filled.length ? "Add another item" : "Add item"}</Button>
          {F.showErr("lines") ? <p className="text-sm text-neg px-1 anim-rise">{F.errors.lines}</p> : null}
        </section>

        <section aria-labelledby="bfp-pay-h" className="flex flex-col gap-2">
          <h2 id="bfp-pay-h" className="caps px-1">Paid by</h2>
          <PayPicker labelledBy="bfp-pay-h" value={F.f.payment} onChange={F.setPayment} allowNotRecorded={edit && F.bill?.payment_mode === ""} describedBy={paymentNote(F.f.payment, F.cashOver) ? "bfp-pay-note" : undefined} />
          <PaymentNote id="bfp-pay-note" F={F} />
        </section>

        <Field label="Note on the bill" htmlFor="bfp-notes" hint="Optional. Printed under the items." error={F.showErr("notes")}>
          <Textarea id="bfp-notes" rows={2} maxLength={500} className="min-h-[64px]" value={F.f.notes} onChange={(e) => F.set({ notes: e.target.value })} />
        </Field>

        <Card title="Bill summary" subtitle={plural(F.filled.length, "item")}>
          <div className="flex flex-col gap-4">
            <SummaryFigures F={F} compact />
            <CheckList checks={checks} label="Checks on this bill" />
          </div>
        </Card>
      </div>

      <InfoSheet F={F} open={sheet?.kind === "info"} numberFocus={sheet?.kind === "info" && sheet.numberFocus} dateFocus={sheet?.kind === "info" && sheet.dateFocus} onClose={() => setSheet(null)} />
      <CustomerSheet open={sheet?.kind === "customer"} onClose={() => setSheet(null)} firmId={F.f.firmId} homeState={homeState(F.firms, F.f.firmId)} value={F.cust} onPick={F.setCustomer} />
      <ItemSheet F={F} open={sheet?.kind === "item"} lineKey={sheet?.kind === "item" ? sheet.key : null} again={sheet?.kind === "item" ? sheet.n : 0} products={products.data} productsError={products.isError}
        focusField={sheet?.kind === "item" ? sheet.focusField : undefined}
        onClose={() => setSheet(null)} onAgain={() => setSheet({ kind: "item", key: null, n: ++again.current })} onRemove={removeItem} />
      <CustomerFixSheet customer={F.cust} field={fix} open={Boolean(fix)} onClose={() => setFix(null)} onSaved={(c) => { F.set({ customer: c }); if (F.reviewOpen) focusReview(); }} />
      <Review F={F} checks={checks} numberId="bfp-number" onSave={saveNow} waiting={drafts.waiting} onChangeNumber={() => {
        // Draw the sheet inside the tap, then focus its number so the phone opens the keyboard (Ruling 1D-4).
        flushSync(() => { F.closeReview(); setSheet({ kind: "info", numberFocus: true }); });
        focusNow("bfp-number", true);
      }} />
      {children}
    </Page>
  );
}

/** An item on the phone: its name, weight × rate, HSN and GST, its value before GST, and Edit and Remove. */
function PhoneItemCard({ F, l, index, onEdit, onRemove }: { F: BillFormApi; l: FormLine; index: number; onEdit: () => void; onRemove: () => void }) {
  const fig = F.lineFig(l.key);
  const slab = slabOf(l.gst);
  const probs = (["qty", "rate", "gst", "hsn"] as const).map((k) => F.showErr(`${l.key}-${k}`)).filter(Boolean);
  const warn = lineWarning(l);
  return (
    <div className={cn("card", probs.length && "border-neg-line", F.newKeys.has(l.key) && "anim-rise")}>
      <button id={`bfp-item-${l.key}`} type="button" onClick={onEdit} className="w-full text-left px-4 pt-3 pb-2.5 flex items-start gap-3" aria-label={`Item ${index + 1}: ${l.name}. Edit`}>
        <span className="flex-1 min-w-0">
          <span className="block font-medium">{l.name}</span>
          <span className="block text-sm text-muted tnum">{l.qty != null ? qtyLabel(l.qty, l.unit) : "Weight missing"} × {Number(l.rate) > 0 ? `${rateText(l.rate)}/${perWord(l.unit)}` : "rate missing"}</span>
          <span className="block text-xs text-muted mt-0.5">HSN {l.hsn || "missing"} · GST {slab ? `${slab}%` : "not set"}{l.note ? ` · ${l.note}` : ""}</span>
          {probs.length ? <span className="block text-sm text-neg mt-1">{probs[0]}</span> : warn ? <span className="block text-sm text-brand mt-1">{warn}</span> : null}
        </span>
        <span className="text-right shrink-0">{fig ? <Money value={fig.taxable} strong bump /> : null}<span className="block text-xs text-muted">before GST</span></span>
      </button>
      <div className="flex border-t border-rule">
        <Button variant="ghost" icon={Pencil} className="flex-1 rounded-none rounded-bl-card" onClick={onEdit}>Edit</Button>
        <Button variant="ghost" icon={Trash2} className="flex-1 rounded-none rounded-br-card text-neg" onClick={onRemove} aria-label={`Remove item ${index + 1}, ${l.name}`}>Remove</Button>
      </div>
    </div>
  );
}

/** Firm, number and date, in one sheet. */
function InfoSheet({ F, open, onClose, numberFocus, dateFocus }: { F: BillFormApi; open: boolean; onClose: () => void; numberFocus?: boolean; dateFocus?: boolean }) {
  const numberRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onClose={onClose} initialFocus={numberFocus ? numberRef : dateFocus ? dateRef : undefined} title="Firm, number and date" footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg2">Firm</span>
          <Segmented full label="Firm" value={F.f.firmId ?? 0} onChange={(v) => F.setFirm(v)}
            options={F.firms.map((fm) => ({ value: fm.id, label: fm.short, disabled: F.edit && !F.canMove }))} />
          <p className="text-sm text-muted">{F.firm ? `${F.firm.name}${F.firm.gstin ? ` · ${F.firm.gstin}` : ""}. ` : ""}{F.firmHint}</p>
        </div>
        <NumberField F={F} id="bfp-number" inputRef={numberRef} />
        <DateBlock F={F} id="bfp-date" inputRef={dateRef} />
      </div>
    </Dialog>
  );
}
