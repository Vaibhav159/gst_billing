// "Check the bill before saving" (PROTO pages/sales/BillForm.jsx:783-927): exactly what will be saved, to the paisa. How
// it was paid is asked here when nothing is picked; cash of ₹2,00,000 or more waits for Part cash or a tick (Income Tax
// Sec 269ST); a failed save says why first, with what to do. Sending isn't here: the saved bill's page offers Send on
// WhatsApp, focused, one press after Save (a browser blocks a chat opened after the save's wait; plan 1B's call 7).
import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { useNetwork } from "@/core/api/network";
import { cn } from "@/core/cn";
import { keepsOnDevice } from "@/core/deviceDrafts";
import { amountInWords, date, inr, monthLabel, monthOf, qty as qtyLabel } from "@/core/format";
import { counterOf } from "@/core/sales/numbers";
import { SEGMENTS, segmentOf, stateNameOf } from "@/core/sales/pos";
import { PAY, rateText, taxLines } from "@/core/sales/words";
import { Button, ButtonLink, Checkbox, Dialog, DL, FailNote, Money, Spinner } from "@/core/ui";
import { useView } from "@/core/view";
import { customerLine } from "@/pages/customers/forBills";
import { ItemsTable, type ItemLine } from "@/pages/sales/bill/ItemsTable";
import { Changes } from "./Changes";
import { CheckList, focusSoon, PayPicker, type CheckRow } from "./fields";
import { toBillInput } from "./model";
import type { BillFormApi } from "./useBillForm";
import { SAVE_WAITS, VISIT_ONLY } from "./useDraftKeeping";

/** The review's own box, by id: what focusReview finds it by. */
const BODY_ID = "rv-body";
/**
 * Puts the cursor on the review's title, for a sheet opened from its checks that closes with its opener gone (a PAN
 * added: the check and its Add PAN go). Called before the sheet lets go, the cursor never lands on the page behind.
 */
export function focusReview(): void {
  document.getElementById(BODY_ID)?.closest('[role="dialog"]')?.querySelector<HTMLElement>("[data-dialog-title]")?.focus({ preventScroll: true });
}

/**
 * onSave: the form's save (it takes the person to a field the server refused); numberId: the number box, for "Change the
 * number"; waiting: the save waits for the draft's last change to reach the shop's list (up to a request's 100 s).
 */
export function Review({ F, checks, numberId, onSave, waiting = false }: { F: BillFormApi; checks: CheckRow[]; numberId: string; onSave: (numberOverride?: string) => void; waiting?: boolean }) {
  const { isPhone } = useView();
  const offline = useNetwork() === "offline";
  const saveRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const wayRef = useRef<HTMLAnchorElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // after the change has drawn: Save may only now be enabled (cash under the limit), and a box that held focus may be gone
  const focusSave = () => setTimeout(() => saveRef.current?.focus(), 0);
  const edit = F.edit;
  const err = F.saveError;
  const failed = Boolean(err && err.kind !== "payment" && err.kind !== "cash");
  const clash = err?.kind === "clash";
  // a refusal saving again can't change (Ruling 1D-12): the bill a draft became, a bill cancelled or deleted meanwhile, or
  // a remake refused. No Try again: the way on is that bill (its link), else only back to the form
  const final = err?.kind === "draft_saved" || err?.kind === "cancelled" || err?.kind === "gone" || err?.kind === "replaces";
  const way = final ? err?.link : undefined;
  const offlineNew = offline && !edit;
  const askPay = F.f.payment == null;
  const noChange = edit && F.changes.length === 0;
  const held = F.saving && waiting;
  // a suggested number taken meanwhile is offered the next free one: the server's, or the next number asked for again
  // once it has moved past that (another counter took it too). The review shows the number Save sends, as it is now
  const offer = clash && err?.next ? ((counterOf(F.stored) ?? 0) > (counterOf(err.next) ?? 0) ? F.stored : err.next) : "";
  const sending = offer || F.stored;
  // the next number asked for again (a PAN added from the checks marks every bill query): Save waits for it, never
  // closing the review onto the number box (Ruling 1D-15)
  const waits = F.waitingForNext;
  const numberShown = sending ? <span key="n" className="tnum">{sending}</span> : <span key="n" className="text-muted">{waits ? "Getting the next number" : "—"}</span>;
  // a failure is said first, at the top, and the sheet scrolls to it; so is a save that waits
  useEffect(() => { if ((failed || held) && body.current) body.current.closest("[role=dialog]")?.querySelector(".overflow-y-auto")?.scrollTo({ top: 0 }); }, [failed, err, held]);
  // Save goes with such a refusal, and the cursor with it: it goes to the way on, else to Go back and edit
  useEffect(() => { if (final) (wayRef.current ?? backRef.current)?.focus(); }, [final]);
  // Ctrl S presses Save (as a click would: not while it's off, nor in the dialog's first moments), from the review itself
  // only: the one dialog open, or the one the cursor is in. A sheet opened over it (a PAN added from its checks) and a
  // menu keep their keys, and a key held down doesn't save the review it opened. The browser's Save page never opens
  useEffect(() => {
    if (!F.reviewOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      if (e.repeat) return;
      const mine = body.current?.closest('[role="dialog"]');
      const open = document.querySelectorAll('[role="dialog"]:not([data-closing])');
      if (!mine || document.querySelector('[role="menu"]:not([data-closing])')) return;
      if ((open.length === 1 && open[0] === mine) || mine.contains(document.activeElement)) saveRef.current?.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [F.reviewOpen]);
  if (!F.cust) return null;
  const c = F.cust;
  const month = F.f.date ? monthLabel(monthOf(F.f.date), { long: true, year: false }) : "";
  const seg = SEGMENTS[segmentOf(c.gst_number, F.tt.inter, F.figs.total)].label;
  const nextText = edit && F.bill
    ? (sending !== F.bill.invoice_number ? `${sending ? `It becomes ${sending}` : "It takes its new number"}. The change is written to the audit log.` : "The bill keeps its number. The change is written to the audit log.")
    : `It goes into ${month}'s GSTR-1 as a ${seg} sale${sending ? ` as ${sending}` : ""}.`;
  const primaryLabel = F.saving ? "Saving…" : clash ? (offer ? `Save as ${offer}` : "Change the number") : failed ? "Try again" : edit ? "Save changes" : "Save bill";
  // the paper bill's own number never changes by itself: a typed number that's taken is changed by hand
  const changeNumber = () => { F.closeReview(); focusSoon(numberId, true); };
  const primary = clash ? (offer ? () => onSave(offer) : changeNumber) : () => onSave();
  const blocked = noChange || waits || offlineNew || F.cashBlock;
  const total = (
    <div className={cn("flex flex-col min-w-0", isPhone ? "" : "mr-auto")}>
      <span className="flex items-baseline gap-2"><span className="text-sm text-fg2">Total</span><Money value={F.figs.total} size="2xl" tone="sale" /></span>
      {/* the words wrap rather than being cut: they're read out to the customer */}
      <span className={cn("text-xs text-muted", isPhone ? "" : "max-w-[360px]")}>{amountInWords(F.figs.total)}</span>
    </div>
  );
  const footer = (
    <>
      {isPhone ? null : total}
      <Button ref={backRef} onClick={F.closeReview} disabled={F.saving}>Go back and edit</Button>
      {final ? (way ? <ButtonLink ref={wayRef} to={way.to} variant="primary">{way.label}</ButtonLink> : null)
        : <Button ref={saveRef} variant="primary" icon={offer ? Check : undefined} onClick={primary} disabled={blocked} loading={F.saving}
            title={noChange ? "Nothing has changed yet" : waits ? "Getting the next number" : offlineNew ? "Saving needs the internet" : undefined}>{primaryLabel}</Button>}
      {isPhone ? total : null}
    </>
  );
  const posName = F.pos ? `${stateNameOf(F.pos)} (${F.pos})` : "Not chosen";
  const taxWord = F.tt.inter ? "Inter-state · IGST" : "Local · CGST + SGST";
  // the lines exactly as they're sent, from the save's own body (toBillInput), each beside its figures to the paisa
  const sent = toBillInput(F.f, { mode: F.mode, pos: F.pos, number: sending, draftId: null, replaces: F.start.replaces }).lines;
  const items: ItemLine[] = sent.map((l, i) => ({ ...l, id: F.filled[i].key, taxable: F.figs.lines[i]?.taxable ?? 0, tax: F.figs.lines[i]?.tax ?? 0 }));
  const warn = checks.filter((x) => x.ok === "warn" && x.key !== "cash");
  const paidBy = F.f.payment == null ? <span className="text-brand">Not picked yet</span> : PAY[F.f.payment];
  // a browser that refuses storage keeps it only while the page is open, never "on this device" (Task 1's review)
  const keptOffline = keepsOnDevice() ? "It's kept on this device as an unfinished bill." : VISIT_ONLY;
  return (
    <Dialog open={F.reviewOpen} onClose={F.closeReview} size="lg" initialFocus={askPay || failed ? undefined : saveRef} footer={footer}
      title={edit && F.bill ? `Check the changes to ${F.bill.invoice_number}` : F.paper ? (isPhone ? "Check the paper bill" : "Check the paper bill before saving") : isPhone ? "Check the bill" : "Check the bill before saving"}
      description="This is exactly what will be saved, to the paisa. Nothing on it is rounded.">
      <div ref={body} id={BODY_ID} className="flex flex-col gap-4">
        {held ? <p role="status" className="rounded-ctl border border-line px-4 py-3 text-sm text-fg2 flex items-center gap-2 anim-rise"><Spinner size={14} />{SAVE_WAITS}</p> : null}
        {failed && err ? (
          <div id="rv-fail" className="flex flex-col gap-2">
            <FailNote error={err} />
            {offer ? <p className="text-sm text-fg2">Save as {offer} takes the next free number in one step.</p> : null}
          </div>
        ) : null}
        {offlineNew ? <FailNote error={{ title: "You're offline: this bill can't be saved yet", body: `${keptOffline} Save it when the internet is back.` }} /> : null}
        {askPay || err?.kind === "payment" ? (
          <div className={cn("rounded-ctl border px-4 py-3 flex flex-col gap-2 anim-rise", err?.kind === "payment" ? "border-neg-line bg-neg-tint" : "border-brand-line bg-brand-tint")}>
            <p id="rv-pay-label" className="font-semibold">How was it paid?</p>
            <PayPicker labelledBy="rv-pay-label" value={F.f.payment} autoFocus onChange={(v) => { F.setPayment(v); focusSave(); }} invalid={err?.kind === "payment"} />
            <p className={cn("text-sm", err?.kind === "payment" ? "text-neg" : "text-fg2")}>{err?.kind === "payment" ? "Pick one to save. It goes on the bill and in your cash and bank split." : "Nothing is picked for you. One tap, then Save."}</p>
          </div>
        ) : null}
        {F.cashOver ? (
          <div className={cn("rounded-ctl border px-4 py-3 flex flex-col gap-2 anim-rise", err?.kind === "cash" ? "border-neg-line bg-neg-tint" : "border-brand-line bg-brand-tint")}>
            <p className="font-semibold">{inr(F.figs.total)} in cash from one person isn&apos;t allowed</p>
            <p className="text-sm text-fg2">Income Tax Sec 269ST: no one may take ₹2,00,000 or more in cash for one sale; the penalty equals the cash taken. Take part of it by UPI or bank.</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Button size="sm" variant="primary" onClick={() => { F.setPayment("mixed"); focusSave(); }}>Change to Part cash, part UPI</Button>
              <Checkbox label="Save it as all cash anyway" checked={F.cashAnyway} onChange={F.setCashAnyway} />
            </div>
          </div>
        ) : null}
        <Changes F={F} />
        {isPhone ? (
          <DL rows={[
            ["Bill no.", numberShown], ["Date", date(F.f.date)], ["Firm", F.firmName], ["Customer", c.name],
            ["Place of supply", posName], ["Tax type", <span key="t" className="text-sale">{taxWord}</span>], ["Paid by", paidBy],
          ]} />
        ) : (
          <>
            <div className="grid grid-cols-2 rounded-ctl border border-line divide-x divide-rule">
              <div className="px-4 py-3 min-w-0"><p className="caps">From</p><p className="font-semibold mt-1">{F.firmName}</p>{F.firm?.gstin ? <p className="text-sm text-fg2 tnum">GSTIN {F.firm.gstin}</p> : null}<p className="text-sm text-muted">{stateNameOf(F.firmState)} ({F.firmState})</p></div>
              <div className="px-4 py-3 min-w-0"><p className="caps">Bill to</p><p className="font-semibold mt-1">{c.name}</p><p className="text-sm text-fg2">{customerLine(c)}</p>{c.address ? <p className="text-sm text-muted">{c.address}</p> : null}</div>
            </div>
            <div className="rounded-ctl border border-line divide-y divide-rule">
              <div className="grid grid-cols-3 divide-x divide-rule">
                {([["Bill no.", numberShown], ["Date", date(F.f.date)], ["Paid by", paidBy]] as const).map(([k, v]) => (
                  <div key={k} className="px-4 py-2.5 min-w-0"><p className="caps">{k}</p><div className="mt-0.5">{v}</div></div>
                ))}
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] divide-x divide-rule">
                <div className="px-4 py-2.5 min-w-0"><p className="caps">Place of supply</p><p className="mt-0.5">{posName}</p></div>
                <div className="px-4 py-2.5 min-w-0"><p className="caps">Tax type</p><p className="mt-0.5"><span className="text-sale font-medium">{taxWord}</span> <span className="text-sm text-muted">· {F.tt.why}</span></p></div>
              </div>
            </div>
          </>
        )}
        {isPhone ? (
          <div className="flex flex-col gap-2">
            <p className="caps">Items · {items.length}</p>
            {items.map((l) => (
              <div key={l.id} className="flex items-start justify-between gap-3 border-t border-rule pt-2 first-of-type:border-t-0">
                <span className="min-w-0"><span className="block font-medium">{l.product_name}</span><span className="block text-sm text-muted tnum">{`${qtyLabel(Number(l.quantity), l.unit)} × ${rateText(l.rate)} · HSN ${l.hsn_code} · ${l.gst_percent}%`}</span>{l.note ? <span className="block text-xs text-muted">{l.note}</span> : null}</span>
                <Money value={l.taxable} />
              </div>
            ))}
          </div>
        ) : <div className="rounded-ctl border border-line pt-1"><ItemsTable bill={{ lines: items, igst: F.figs.igst, cgst: F.figs.cgst, sgst: F.figs.sgst, interstate: F.tt.inter }} label="Items that will be saved" /></div>}
        <div className={cn("grid gap-5", isPhone ? "grid-cols-1" : "grid-cols-2")}>
          {!isPhone ? <div><p className="caps mb-2">Checked</p><CheckList checks={checks.filter((x) => x.key !== "tax" && x.key !== "pay" && x.key !== "cash")} label="Checked before saving" /></div> : null}
          {/* the total itself sits in the footer, next to Save (said once) */}
          <DL rows={[["Taxable value", <Money key="tx" value={F.figs.taxable} />], ...taxLines({ ...F.figs, interstate: F.tt.inter }).map((t) => [t.label, <Money key={t.key} value={t.value} />] as const)]} />
        </div>
        {isPhone && warn.length ? <CheckList checks={warn} label="Worth a look" /> : null}
        <p className="text-sm text-muted">{nextText}</p>
      </div>
    </Dialog>
  );
}
