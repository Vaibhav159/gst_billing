// Print and share, /sales/:id/print (PROTO sales/BillPrint.jsx): the Tally A4 paper as it prints, the copies chosen
// each time (CGST Rule 48), bank details on or off, the owner's "Make these the default", the PDF's name, and Send,
// PDF, Print and Share. The PDF is made as soon as the choices are known, so Print and Share act within the press.
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Lock, MessageCircle, Printer, Send, Share2, SlidersHorizontal } from "lucide-react";
import { problemOf, type ApiProblem } from "@/core/api/errors";
import { useNetwork } from "@/core/api/network";
import { billQuery, useBill, useSaveShopSettings, useShopSettings } from "@/core/api/sales";
import { useAuth } from "@/core/auth/AuthProvider";
import { inr, plural } from "@/core/format";
import { printFile, saveFile } from "@/core/print/files";
import { billLog, useLogPrint } from "@/core/print/log";
import { billFile, useSendBankChoice, useSendFile } from "@/core/print/make";
import { COPY_OPTIONS, copyPages, hasBank, printBill } from "@/core/print/model";
import { Paper, PrintCopy, ScaledPaper } from "@/core/print/Paper";
import { sharePdf } from "@/core/print/ShareHost";
import { billMessage, mobileOf } from "@/core/sales/share";
import type { BillDetail, Copies } from "@/core/sales/types";
import { failText, type FailText } from "@/core/sales/words";
import { Button, Dialog, Disclosure, FailNote, Field, LoadError, Page, Segmented, Select, Skeleton, StaleNote, useToast } from "@/core/ui";
import { useView } from "@/core/view";
import { DeletedBill } from "../bill/DeletedBill";
import { MissingBill } from "../bill/MissingBill";
import { useSendBill, useSendReady } from "../actions/useSendBill";
import { WhatsAppDialog } from "../actions/WhatsAppDialog";
import { BankSwitch, useMade, whatPrints } from "./parts";

/** Until the bill comes: the paper's outline, or why it can't come, with Try again when asking again can help. */
function Preparing({ phone, problem, retry }: { phone: boolean; problem: ApiProblem | null; retry?: () => void }) {
  return (
    <Page icon={Printer} title="Print and share" back breadcrumbs={[{ label: "Sales", to: "/sales" }]}>
      {problem ? <LoadError problem={problem} retry={retry} what="this bill" /> : (
        <div className="flex justify-center" role="status" aria-label="Making the bill's preview">
          <div className="card p-8 flex flex-col gap-4" style={{ width: phone ? "100%" : 600, height: phone ? 480 : 820 }}>
            <Skeleton w="40%" h={18} className="self-center" /><Skeleton h={90} /><Skeleton h={220} /><Skeleton h={120} /><Skeleton w="60%" h={14} />
          </div>
        </div>
      )}
    </Page>
  );
}

/** /sales/:id/print: the bill to print and share, its deleted state, or that it isn't here (as the bill's own page, 1B Task 9). */
export default function PrintPage() {
  const { id: raw = "" } = useParams();
  const qc = useQueryClient();
  const net = useNetwork();
  const { isPhone } = useView();
  const id = /^\d+$/.test(raw) ? Number(raw) : null;
  const q = useBill(id);
  if (id === null) return <MissingBill id={raw} />;
  // Try again asks again through the client, as every page's does (Ruling 1B-11)
  const retry = () => { void qc.refetchQueries({ queryKey: billQuery(id).queryKey }); };
  if (q.isPending) {
    // offline before anything came: say so, rather than wait for good (it comes by itself once the internet is back)
    return <Preparing phone={isPhone} problem={q.isPaused && net === "offline" ? { kind: "offline", message: "You're offline" } : null} />;
  }
  if (q.data === undefined) {
    // nothing came, and asking failed
    const p = problemOf(q.error);
    return p.kind === "notfound" ? <MissingBill id={raw} /> : <Preparing phone={isPhone} problem={p} retry={retry} />;
  }
  // a refresh that failed, a 404 too, keeps the bill on screen and says so, as the bill's own page does
  const note = q.isError ? <StaleNote problem={problemOf(q.error)} what="this bill" retry={retry} busy={q.isFetching} /> : null;
  if (q.data.kind === "deleted") return <DeletedBill b={q.data.binned} note={note} />;
  return <PrintScreen b={q.data.bill} phone={isPhone} note={note} />;
}

function PrintScreen({ b, phone, note }: { b: BillDetail; phone: boolean; note: ReactNode }) {
  const { can, whyNot } = useAuth();
  const { show } = useToast();
  const net = useNetwork();
  const settings = useShopSettings();
  const saveDefaults = useSaveShopSettings();
  const send = useSendBill();
  const ready = useSendReady();
  const log = useLogPrint();
  const [ask, setAsk] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [fail, setFail] = useState<FailText | null>(null);
  // the shop's defaults until a choice is made here (they arrive with the page, or soon after)
  const [picked, setPicked] = useState<{ copies?: Copies; showBank?: boolean }>({});
  const s = settings.data;
  const copies = picked.copies ?? s?.copies ?? "original";
  const showBank = picked.showBank ?? s?.show_bank ?? true;
  useSendBankChoice(b.id, showBank);
  // the tab names the bill ("Print KGH/2026-27/31"); the heading stays "Print and share". Runs after Page's own title.
  useEffect(() => { document.title = `Print ${b.invoice_number} · GST Billing`; }, [b.invoice_number]);

  const paper = useMemo(() => printBill(b, { showBank }), [b, showBank]);
  // what the PDF prints: a refresh that changed the bill on paper makes it again, one that changed nothing on it keeps it
  const prints = useMemo(() => whatPrints(paper), [paper]);
  const copyList = copyPages(copies);
  const sheets = paper.pages.length * copyList.length;
  // made once the shop's defaults are in, so the first file is the one wanted; offline, with the choices on screen.
  // Each file keeps the signature's link it was made with
  const sign = paper.firm.signature;
  const made = useMade(settings.isPending && !settings.isPaused ? null : `${copies}|${prints}`, async () => ({ pdf: await billFile(b, { copies, showBank }), sign }));
  const file = made.value?.pdf ?? null;
  // a PDF that went without the signature, which may come next time (it got no answer: offline, or the server failing),
  // is made again once the bill comes back with the link signed afresh (a refresh, as the paper on screen loads it);
  // made again without it, it waits for the next. Meanwhile the one made is handed out
  const { remake } = made;
  const unsignedWith = made.value?.pdf.again ? made.value.sign : null;
  useEffect(() => { if (unsignedWith !== null && unsignedWith !== sign) remake(); }, [unsignedWith, sign, remake]);
  const cancelled = b.status === "cancelled";
  const canSend = can("bill.send");
  const sendable = !cancelled && canSend;
  // A send carries the Original (CGST Rule 48): this page's own file when that's the choice. On a phone, whose share
  // sheet opens only within a press, the page makes it too, once its own is made (a computer's chat opens at once, and
  // its download can wait), so a send from here hands it out within the press itself
  const sendsOwn = copies === "original";
  const original = useMade(phone && sendable && !sendsOwn && file ? `original|${prints}` : null, () => billFile(b, { copies: "original", showBank }));
  useSendFile(b.id, sendsOwn ? file : original.value);
  // v2's "Share PDF" links (…/print?share=1, followed here with their query) asked for the share sheet at once. It
  // opens only within a press, so Share takes the focus once the PDF is made, unless the person has put it somewhere
  const askedShare = useSearchParams()[0].get("share") === "1";
  const shareRef = useRef<HTMLButtonElement>(null);
  const focusedShare = useRef(false);
  useEffect(() => {
    if (!askedShare || !file || focusedShare.current) return;
    focusedShare.current = true;
    const a = document.activeElement;
    if (a && a !== document.body && !a.hasAttribute("data-page-title")) return;
    shareRef.current?.focus({ preventScroll: true });
  }, [askedShare, file]);
  const c = b.customer;
  // where a send goes, as useSendBill decides: the customer's mobile, else the number this bill went to before (a landline isn't one)
  const own = mobileOf(c.mobile_number);
  const before = mobileOf(b.sent?.to);
  const hasNumber = Boolean(own || before);
  const differs = Boolean(s) && (copies !== s?.copies || showBank !== s?.show_bank);
  const making = !file && !made.failed;
  const waitWhy = made.failed ? "The PDF couldn't be made. Try again." : making ? "Making the PDF…" : undefined;
  // a Try again keeps the note on screen, busy, until the PDF is made or fails again
  const pdfFail = made.failed || made.retrying ? { title: "The PDF wasn't made", body: net === "offline" ? "You're offline, so the PDF wasn't made. It needs the internet; try again when you're back." : "Something stopped it part way. Try again." } : null;
  // every Send waits for the shop's message, so it never goes with the standard one instead
  const sendWait = ready ? undefined : "Getting the shop's WhatsApp message";
  // the bill's exact total, as the PDF prints it (Ruling 1B-12), and the firm's name as useSendBill sends it
  const message = billMessage(s?.share_message, { invoice_number: b.invoice_number, invoice_date: b.invoice_date, total: b.total_amount, firm: b.business_name, customer: c });

  // a PDF downloaded goes into the audit log, from PDF or from Share's download
  const exported = () => log(billLog("exported", b, copies));
  const download = () => {
    if (!file) return;
    saveFile(file.blob, file.name);
    exported();
    show({ title: `Downloaded ${file.name}`, body: `${plural(sheets, "A4 page")}${copyList.length > 1 ? " (Original, Duplicate and Triplicate)" : `, ${copyList[0].label} copy`}.` });
  };
  const print = () => {
    if (!file) return;
    if (!printFile(file.blob)) { show({ tone: "brand", title: "The PDF didn't open", body: "The browser stopped the new tab. Allow pop-ups for this app to print from it, or use PDF." }); return; }
    log(billLog("printed", b, copies));
  };
  const share = () => {
    if (!file) return;
    void sharePdf(file, { title: b.invoice_number }).then((r) => {
      if (r !== "unsupported") return;
      saveFile(file.blob, file.name);
      exported();
      show({ tone: "brand", title: `${file.name} downloaded`, body: "Attach it to an email, or put it on Drive, from your Downloads folder." });
    });
  };
  // useSendBill holds the bill while its send is on its way, whichever button pressed it. The second click of a double
  // click (detail 2; a key press is 0) sends nothing: a quick record turns Send into Send again under the pointer
  const sendPress = (e: MouseEvent) => {
    if (e.detail > 1) return;
    void send(b, { onNeedNumber: () => setAsk(true) });
  };
  const makeDefault = () => {
    setFail(null);
    saveDefaults.mutate({ copies, show_bank: showBank }, {
      onSuccess: () => show({ title: "Saved as the default", body: "Every bill opens with these copies and bank setting." }),
      // nothing was typed on this page, so the words don't say it's still here ("saved" does)
      onError: (e) => setFail(failText(problemOf(e), "saved as the default")),
    });
  };
  const defaults = !differs ? null : can("settings.edit")
    ? <Button size="sm" variant="link" className="self-start -mt-3 anim-rise" loading={saveDefaults.isPending} onClick={makeDefault}>{saveDefaults.isPending ? "Saving…" : "Make these the default for every bill"}</Button>
    : <p className="text-sm text-muted -mt-3">For this print only. {whyNot("settings.edit", "set the print defaults")}</p>;
  const copiesNote = copyList.length > 1 ? "Original, Duplicate and Triplicate, each labelled at the top right." : `Marked “${copyList[0].tag}”.`;
  const paperStack = (
    <div key={`${copies}-${showBank}`} className="flex flex-col items-center gap-6 anim-rise min-w-0 w-full">
      {copyList.flatMap((cp, ci) => paper.pages.map((pg, pi) => (
        <div key={`${cp.value}-${pi}`} className="flex flex-col gap-2 min-w-0 w-full items-center">
          {sheets > 1 ? <p className="text-sm text-muted self-start">Page {ci * paper.pages.length + pi + 1} of {sheets}{copyList.length > 1 ? ` · ${cp.label.toLowerCase()} copy${paper.pages.length > 1 ? `, its page ${pi + 1} of ${paper.pages.length}` : ""}` : ""}</p> : null}
          <ScaledPaper b={paper} copy={cp} page={pg} />
        </div>
      )))}
    </div>
  );
  // the WhatsApp number dialog, and the papers again at full size for the browser's own print (Ctrl P)
  const extras = <>
    <WhatsAppDialog bill={ask ? b : null} onClose={() => setAsk(false)} />
    <PrintCopy>{copyList.flatMap((cp) => paper.pages.map((pg) => <Paper key={`${cp.value}-${pg.index}`} b={paper} copy={cp} page={pg} />))}</PrintCopy>
  </>;
  // a paper bill's customer has it already: its copy is offered, never the main step
  const sendLabel = b.sent ? "Send again" : b.paper ? "Send a copy on WhatsApp" : "Send on WhatsApp";
  const messageBox = <Disclosure title="Message sent with the PDF" summary={own ? `To ${c.name} (${own})` : before ? `To +91 ${before}` : "No number on record"}><p className="text-fg2">{message}</p></Disclosure>;

  if (phone) {
    return (
      <Page title="Print and share" phoneSubtitle={`${b.invoice_number} · ${c.name}`} back={`/sales/${b.id}`}
        actionBar={<>
          <Button size="lg" icon={SlidersHorizontal} onClick={() => setOptionsOpen(true)}>Options</Button>
          {/* a touch screen never shows a title: the PDF on its way shows on the button itself */}
          <Button ref={shareRef} size="lg" icon={Share2} variant={sendable && !b.paper ? "secondary" : "primary"} disabled={!file} loading={making} title={waitWhy} onClick={share}>Share</Button>
          {sendable ? <Button size="lg" variant={b.paper ? "secondary" : "primary"} icon={hasNumber ? Send : MessageCircle} disabled={!ready} title={sendWait} onClick={sendPress} {...(hasNumber ? {} : { "aria-label": `${b.sent ? "Resend" : "Send"} to a WhatsApp number` })}>{b.sent ? "Resend" : "Send"}</Button> : null}
        </>}>
        {note}
        <p className="text-sm text-muted">{copyList.length > 1 ? "All three copies" : `${copyList[0].label} copy`} · {plural(sheets, "page")} · {hasBank(b.firm) ? `bank details ${showBank ? "shown" : "hidden"}` : "no bank account saved"} · {paper.file}</p>
        {!canSend && !cancelled ? <p className="text-sm text-muted flex items-start gap-1.5 -mt-2"><Lock size={15} className="shrink-0 mt-0.5" aria-hidden="true" />Sending on WhatsApp marks the bill sent. {whyNot("bill.send")}</p> : null}
        <FailNote error={pdfFail} onRetry={made.retry} busy={made.retrying} />
        {paperStack}
        <Dialog open={optionsOpen} onClose={() => setOptionsOpen(false)} title="Print options"
          footer={<>
            <Button icon={Download} disabled={!file} loading={making} title={waitWhy} onClick={() => { setOptionsOpen(false); download(); }}>Download PDF</Button>
            <Button icon={Printer} disabled={!file} loading={making} title={waitWhy} onClick={() => { setOptionsOpen(false); print(); }}>Print</Button>
            <Button variant="primary" onClick={() => setOptionsOpen(false)}>Done</Button>
          </>}>
          <div className="flex flex-col gap-4">
            <Field label="Copies" htmlFor="pr-copies" hint="Chosen each time you print. All three makes a set for each copy, labelled at the top right.">
              <Select id="pr-copies" value={copies} onChange={(e) => setPicked((p) => ({ ...p, copies: e.target.value as Copies }))} options={COPY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
            </Field>
            <BankSwitch firm={b.firm} firmId={b.business} checked={showBank} onChange={(v) => setPicked((p) => ({ ...p, showBank: v }))} />
            {defaults ? <div className="mt-3 flex flex-col">{defaults}</div> : null}
            <FailNote error={fail} onRetry={makeDefault} busy={saveDefaults.isPending} />
            {messageBox}
          </div>
        </Dialog>
        {extras}
      </Page>
    );
  }

  return (
    <Page icon={Printer} title="Print and share" breadcrumbs={[{ label: "Sales", to: "/sales" }, { label: b.invoice_number, to: `/sales/${b.id}` }]}
      context={`${b.invoice_number} · ${c.name} · ${inr(b.total_amount)}`}>
      {note}
      <div className="grid gap-6 items-start grid-cols-[minmax(0,1fr)_320px] min-[1240px]:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 flex justify-center">{paperStack}</div>
        <aside aria-label="Print and share options" className="card p-5 sticky top-6 flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h2 className="text-md font-semibold">Copies</h2>
            <Segmented label="Copies" options={COPY_OPTIONS} value={copies} onChange={(v) => setPicked((p) => ({ ...p, copies: v }))} className="grid grid-cols-2" />
            <p className="text-sm text-muted">{copiesNote} Chosen each time you print.</p>
          </div>
          <BankSwitch firm={b.firm} firmId={b.business} checked={showBank} onChange={(v) => setPicked((p) => ({ ...p, showBank: v }))} />
          {defaults}
          <FailNote error={fail} onRetry={makeDefault} busy={saveDefaults.isPending} />
          <div className="rounded-ctl border border-line bg-field px-4 py-3">
            <p className="caps">PDF file</p>
            <p className="font-medium tnum mt-0.5 break-all">{paper.file}</p>
            <p className="text-sm text-muted">{plural(sheets, "A4 page")}{paper.pages.length > 1 ? ` (${paper.pages.length} per copy)` : ""} · named by its number, so no two files clash</p>
          </div>
          <FailNote error={pdfFail} onRetry={made.retry} busy={made.retrying} />
          {cancelled ? <p className="text-sm text-neg">This bill is cancelled, so it isn&apos;t sent. The printout carries a CANCELLED stamp.</p>
            : canSend ? (hasNumber
              ? <Button variant={b.paper ? "secondary" : "primary"} size="lg" full icon={Send} disabled={!ready} title={sendWait} onClick={sendPress}>{sendLabel}</Button>
              : (
                <div className="flex flex-col gap-1.5">
                  <Button variant="primary" size="lg" full icon={Printer} disabled={!file} title={waitWhy} onClick={print}>Print</Button>
                  <Button full icon={MessageCircle} disabled={!ready} title={sendWait} onClick={sendPress}>Send to a WhatsApp number</Button>
                  <p className="text-sm text-muted">{c.type === "walkin" ? "A walk-in has" : `${c.name} has`} no number on record, so printing comes first.</p>
                </div>
              ))
              : (
                <div className="flex flex-col gap-1.5">
                  <Button size="lg" full icon={Lock} disabled aria-describedby="pr-send-why">Send on WhatsApp</Button>
                  <p id="pr-send-why" className="text-sm text-muted">Sending marks the bill sent. {whyNot("bill.send")} PDF, Print and Share still work.</p>
                </div>
              )}
          <div className="grid grid-cols-3 gap-2">
            <Button icon={Download} disabled={!file} title={waitWhy} onClick={download}>PDF</Button>
            <Button icon={Printer} disabled={!file} title={waitWhy} onClick={print}>Print</Button>
            <Button ref={shareRef} icon={Share2} disabled={!file} title={waitWhy} onClick={share}>Share</Button>
          </div>
          {messageBox}
          <p className="text-sm text-muted border-t border-rule pt-4">One bill style for every firm, with a QR code anyone can check against your records.</p>
        </aside>
      </div>
      {extras}
    </Page>
  );
}
