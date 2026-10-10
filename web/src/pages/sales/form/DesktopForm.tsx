// The bill form on a desktop (PROTO pages/sales/BillForm.jsx:446-552): one keyboard-fast page. The Bill card (paper
// switch, firm, number, date, customer, place of supply), the items, payment and a note, and beside them the Bill summary
// with the checks and Check and save. Ctrl S checks and saves; Ctrl Enter adds a line.
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { AlertTriangle, BookOpenText, FilePlus2, Plus, SquarePen } from "lucide-react";
import { useAuth } from "@/core/auth/AuthProvider";
import { cn } from "@/core/cn";
import { date, monthOf, plural } from "@/core/format";
import { Button, ButtonLink, Card, Field, Kbd, Page, Select, Sheet, Textarea } from "@/core/ui";
import { useBoxWidth } from "@/core/useBoxWidth";
import { CustomerFixSheet, CustomerPicker, homeState, NewCustomerSheet, type FixField } from "@/pages/customers/forBills";
import { CheckList, focusNow, focusSoon, LabelSpacer, PayPicker, type CheckRow } from "./fields";
import { LineRow, ONE_ROW, LINE_COLS } from "./lines";
import { hasContent } from "./model";
import { NewItemForm, type NewItem } from "./NewItemForm";
import { DateBlock, NumberField, Origins, PaperSwitch, paperBookTo, PaymentNote, PlaceOfSupply, SummaryFigures } from "./parts";
import { useSaleProducts } from "./products";
import { paymentNote } from "./rules";
import type { BillFormApi } from "./useBillForm";

/** The element a problem's key points at on the desktop form (a line's field falls back to its product box). */
export function desktopFieldId(F: BillFormApi, k: string): string {
  const fixed: Record<string, string> = { firm: "bf-firm", number: "bf-number", date: "bf-date", customer: "bf-customer", pos: "bf-pos-state", notes: "bf-notes" };
  if (fixed[k]) return fixed[k];
  if (k === "lines") return `bf-${F.f.lines[0].key}-product`;
  return `bf-${k}`;
}
/** Takes the person to a problem: scrolled to, and focused. */
export function focusProblem(F: BillFormApi, k: string) {
  const id = desktopFieldId(F, k);
  const el = document.getElementById(id) ?? document.getElementById(`bf-${k.slice(0, k.lastIndexOf("-"))}-product`);
  if (el) { el.scrollIntoView({ block: "center" }); el.focus(); }
}
/** The checks, with "Add PAN" or "Add the address" beside the ones a customer's record fixes. */
export function checksWithFixes(F: BillFormApi, open: (f: FixField) => void): CheckRow[] {
  return F.checks.map((c) => (c.fix && F.cust && F.cust.type !== "walkin" ? { ...c, action: { label: c.fix === "pan" ? "Add PAN" : "Add the address", onClick: () => open(c.fix as FixField) } } : c));
}

export function DesktopForm({ F, children }: { F: BillFormApi; children?: ReactNode }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const products = useSaleProducts();
  const [nc, setNc] = useState<{ name: string } | null>(null);
  const [np, setNp] = useState<{ name: string; key: string } | null>(null);
  // a save to Products on its way: the sheet stays until it lands, or the product would be saved but left off the line
  const [npBusy, setNpBusy] = useState(false);
  const [fix, setFix] = useState<FixField | null>(null);
  // until a box is measured (and in tests, where nothing lays out) it reads as 1400 px: the wide layout (Ruling 1E-3)
  const [page, pageW] = useBoxWidth();
  const [lines, linesW] = useBoxWidth();
  const oneRow = linesW >= ONE_ROW;
  const side = pageW >= 1240 ? 360 : 300;
  const edit = F.edit;
  const firstOpenLine = () => (F.f.lines.find((l) => !hasContent(l)) ?? F.f.lines[0]).key;
  const errCount = F.tried ? Object.keys(F.errors).length : 0;
  const checks = checksWithFixes(F, setFix);
  /** Check and save: the review, or the first problem, scrolled to and focused. */
  const onTryReview = () => { const r = F.openReview(); if (!r.ok) focusProblem(F, r.first); };
  // Ctrl S: check and save (and save from the review). Ctrl Enter: add a line, focus moving at once.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() === "s") { e.preventDefault(); if (!F.reviewOpen) onTryReview(); }
      else if (e.key === "Enter") { if (document.querySelector('[role="dialog"]:not([data-closing])')) return; e.preventDefault(); F.addLine(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const ym = F.f.date ? monthOf(F.f.date) : "";
  const close = () => navigate(F.paper && ym && F.f.firmId !== null ? paperBookTo(F.f.firmId, ym) : "/sales");
  const onNewItem = (key: string) => (r: NewItem) => {
    F.setLine(key, (prev) => ({ productId: r.productId, name: r.line.name, hsn: r.line.hsn, gst: r.line.gst, unit: r.line.unit, rate: r.line.rate || prev.rate, note: r.line.description || prev.note, custom: r.productId === null }));
    setNp(null);
    focusSoon(`bf-${key}-qty`, true);
  };
  return (
    <Page icon={edit ? SquarePen : F.paper ? BookOpenText : FilePlus2} title={edit && F.bill ? `Edit ${F.bill.invoice_number}` : F.paper ? "Bill from the paper book" : "New sales bill"}
      breadcrumbs={[{ label: "Sales", to: "/sales" }, ...(edit && F.bill ? [{ label: F.bill.invoice_number, to: `/sales/${F.bill.id}` }] : [])]}
      context={<>{F.firmName || "No firm yet"} · No. <span className="tnum">{F.stored || "not typed yet"}</span> · {F.f.date ? date(F.f.date) : "no date yet"}</>}
      actions={edit && F.bill ? <ButtonLink to={`/sales/${F.bill.id}`}>Cancel</ButtonLink> : <Button onClick={close} title={F.draftId ? "Keeps the draft; finish it later" : undefined}>Close</Button>}>
      <Origins F={F} />
      <div ref={page} className="grid gap-5 items-start" style={{ gridTemplateColumns: `minmax(0,1fr) ${side}px` }}>
        <div className="flex flex-col gap-5 min-w-0">
          <Card title="Bill">
            <div className="flex flex-col gap-5">
              {edit ? null : <PaperSwitch F={F} id="bf-paper" />}
              <div className={cn("grid gap-4", linesW && linesW < 600 ? "grid-cols-2" : "grid-cols-3")}>
                <Field label="Firm" htmlFor="bf-firm" hint={F.firmHint} error={F.showErr("firm")} aside={<LabelSpacer />}>
                  <Select id="bf-firm" value={F.f.firmId === null ? "" : String(F.f.firmId)} disabled={edit && !F.canMove} onChange={(e) => F.setFirm(Number(e.target.value))}
                    options={F.firms.map((fm) => ({ value: String(fm.id), label: fm.gstin ? `${fm.name} · ${fm.gstin}` : fm.name }))} />
                </Field>
                <NumberField F={F} id="bf-number" />
                <DateBlock F={F} id="bf-date" />
              </div>
              <CustomerPicker firmId={F.f.firmId} value={F.cust} error={F.showErr("customer")} autoFocus={!F.cust && !edit}
                onPick={(c) => { F.setCustomer(c); focusNow(`bf-${firstOpenLine()}-product`); }} onNew={(name) => setNc({ name })} />
              {F.cust ? <PlaceOfSupply F={F} id="bf-pos" /> : null}
            </div>
          </Card>

          <Card title={`Items · ${F.filled.length}`} subtitle="Type each rate as written on the paper bill: per gram, carat or piece, making included, before GST."
            actions={<span className="text-sm text-muted inline-flex items-center gap-1"><Kbd>Ctrl</Kbd><Kbd>Enter</Kbd> adds a line</span>}>
            <div ref={lines} role="group" aria-label="Items on the bill">
              {oneRow ? (
                <div aria-hidden="true" className={cn("grid gap-x-2.5 pb-2 border-b border-rule caps", LINE_COLS)}>
                  <span>#</span><span>Product</span><span className="text-right">Weight or qty</span><span className="text-right">Rate per unit</span><span className="text-right">Before GST</span><span />
                </div>
              ) : <div className="border-b border-rule" />}
              {F.f.lines.map((l, i) => <LineRow key={l.key} F={F} l={l} i={i} oneRow={oneRow} products={products.data} productsFailed={products.isError} onNewProduct={(name, key) => setNp({ name, key })} />)}
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <Button icon={Plus} onClick={() => F.addLine(true)}>Add line</Button>
              {F.showErr("lines") ? <p className="text-sm text-neg anim-rise">{F.errors.lines}</p> : <p className="text-sm text-muted">Pick a product to fill its HSN, GST rate and unit.</p>}
            </div>
          </Card>

          <Card title="Payment and note">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <span id="bf-pay-label" className="text-sm font-medium text-fg2">Paid by</span>
                <PayPicker id="bf-pay" labelledBy="bf-pay-label" value={F.f.payment} onChange={F.setPayment} allowNotRecorded={edit && F.bill?.payment_mode === ""}
                  describedBy={paymentNote(F.f.payment, F.cashOver) ? "bf-pay-note" : undefined} />
                <PaymentNote F={F} id="bf-pay-note" />
              </div>
              <Field label="Note on the bill" htmlFor="bf-notes" hint="Optional. Printed under the items, for example an order number." error={F.showErr("notes")}>
                <Textarea id="bf-notes" rows={2} maxLength={500} className="min-h-[64px]" value={F.f.notes} onChange={(e) => F.set({ notes: e.target.value })} />
              </Field>
            </div>
          </Card>
        </div>

        <aside aria-label="Bill summary" className="card p-5 sticky top-6 flex flex-col gap-4 min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-md font-semibold">Bill summary</h2>
            <span className="text-sm text-muted">{plural(F.filled.length, "item")}</span>
          </div>
          <SummaryFigures F={F} />
          <CheckList checks={checks} label="Checks on this bill" />
          {errCount ? <p className="text-sm text-neg anim-rise flex items-start gap-1.5" role="alert"><AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />{plural(errCount, "thing")} to fix before saving. Each is marked under its field.</p> : null}
          <Button variant="primary" size="lg" full onClick={onTryReview}>{edit ? "Check and save changes" : "Check and save"}</Button>
          <p className="text-xs text-muted text-center -mt-2 inline-flex items-center justify-center gap-1"><Kbd>Ctrl</Kbd><Kbd>S</Kbd> check and save</p>
          {edit ? <p className="text-sm text-muted border-t border-rule pt-3" aria-live="polite">{F.dirty ? "Changes not saved yet" : "No changes yet"}</p> : null}
        </aside>
      </div>
      <NewCustomerSheet open={Boolean(nc)} initialName={nc?.name ?? ""} homeState={homeState(F.firms, F.f.firmId)} onClose={() => setNc(null)}
        // the cursor goes to the items before the sheet lets go of it, so it never passes back through the customer box
        // (whose list opens on focus): a sheet leaves the cursor where it is once it has moved on
        onSaved={(c) => { F.setCustomer(c); focusNow(`bf-${firstOpenLine()}-product`); setNc(null); }} />
      <Sheet open={Boolean(np)} onClose={npBusy ? () => {} : () => setNp(null)} title="An item that isn't in Products"
        description={can("product.edit") ? "Use it on this bill, and keep it in Products if you like." : "Used on this bill only. The owner adds products to the list."}>
        {np ? <NewItemForm key={`${np.key}${np.name}`} initialName={np.name} idBase="np" onCancel={() => setNp(null)} onDone={onNewItem(np.key)} onBusy={setNpBusy} /> : null}
      </Sheet>
      <CustomerFixSheet customer={F.cust} field={fix} open={Boolean(fix)} onClose={() => setFix(null)} onSaved={(c) => F.set({ customer: c })} />
      {children}
    </Page>
  );
}
