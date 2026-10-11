import { useCallback } from "react";
import { queryClient } from "@/core/api/query";
import { billQuery, shopSettingsQuery } from "@/core/api/sales";
import { canShareFiles, pdfCodeMissing, saveFile } from "@/core/print/files";
import { billLog, useLogPrint } from "@/core/print/log";
import type { PdfFile } from "@/core/print/make";
import { sendBankChoice, sendFile } from "@/core/print/send";
import { sharePdf, tell } from "@/core/print/ShareHost";
import { waLink } from "@/core/sales/share";
import type { BillDetail, Copies } from "@/core/sales/types";
import { useToast, type ToastInput } from "@/core/ui";
import { useView } from "@/core/view";

export type DeliverInput = { billId: number; invoiceNumber: string; mobile: string; message: string; isPhone: boolean };
/** How the bill went (the send's `via`) and the PDF's name when one was made; null when the person stopped (a share sheet closed). */
export type Delivered = { via: "whatsapp" | "share"; file: string | null } | null;

/** What a PDF can't be made without: the shop's settings (its copies and bank details), or a bill that's still there. */
class Unmade extends Error {
  constructor(readonly lack: "settings" | "bill") { super(lack === "settings" ? "The shop's settings didn't load." : "This bill was deleted."); }
}
type Made = { file: PdfFile; bill: BillDetail; copies: Copies };

/**
 * A bill's PDF as it's handed out. A send carries the Original (CGST Rule 48: the recipient's copy), with bank details
 * as the print page shows them while it's open, else as the shop's default; a share carries the shop's default copies.
 * The bill and the settings come from the app's cache when a screen already has them.
 */
async function pdfFor(billId: number, purpose: "send" | "share"): Promise<Made> {
  // a send from the print page carries the page's bank choice, so it needs nothing from the shop's settings
  const chosen = purpose === "send" ? sendBankChoice(billId) : undefined;
  const [o, settings] = await Promise.all([
    queryClient.ensureQueryData(billQuery(billId)),
    chosen === undefined ? queryClient.ensureQueryData(shopSettingsQuery).catch(() => { throw new Unmade("settings"); }) : null,
  ]);
  if (o.kind !== "bill") throw new Unmade("bill");
  const copies: Copies = purpose === "share" && settings ? settings.copies : "original";
  const { billFile } = await import("@/core/print/make");
  return { file: await billFile(o.bill, { copies, showBank: chosen ?? settings?.show_bank ?? true }), bill: o.bill, copies };
}

/** Why a PDF wasn't made, and what to do (nothing, for a deleted bill). */
function noPdf(e: unknown): { why: string; todo: string } {
  if (e instanceof Unmade && e.lack === "bill") return { why: "This bill was deleted.", todo: "" };
  if (navigator.onLine === false) return { why: "You're offline, so the PDF wasn't made.", todo: "Try again when the internet is back." };
  // react-pdf's code that didn't come (the app changed since the page opened) comes only with a reload
  if (pdfCodeMissing(e)) return { why: "The part of the app that makes PDFs didn't load.", todo: "Reload the page, then try again." };
  if (e instanceof Unmade) return { why: "The shop's settings didn't load, and the PDF needs them.", todo: "Try again in a minute." };
  return { why: "Something stopped the PDF part way.", todo: "Try again in a minute." };
}
const words = (...parts: string[]) => parts.filter(Boolean).join(" ");
/** WhatsApp's tab, which the browser stopped (window.open answered null): nothing was sent. */
const TAB_STOPPED: ToastInput = { tone: "neg", title: "WhatsApp didn't open", body: "The browser stopped the new tab, so nothing was marked as sent. Allow pop-ups for this app, then send it again." };
/**
 * While a PDF is made away from the print page (the first time, react-pdf's 1.2 MB comes first): the share sheet, the
 * dialog asking for one more press, the download or why not takes its place. next: what comes once it's made.
 */
const makingPdf = (next: string): ToastInput => ({ tone: "brand", title: "Making the PDF…", body: next, duration: 120_000 });
const SHEET_NEXT = "The share sheet opens as soon as it's ready.";

/**
 * Hands a bill to WhatsApp with its PDF (PROTO core/common.jsx:57-62, sales/parts.jsx:177-184). On a computer the chat
 * opens within the press (a browser blocks a window opened after an await) and the PDF downloads beside it to attach.
 * On a phone the share sheet opens with the PDF and the message: pick WhatsApp and the chat. The print page's own
 * Original goes at once, so its share sheet opens within the press; elsewhere the PDF is made first, and a share sheet
 * that outlasts the press asks for one more (ShareHost). A tab the browser stopped, a share sheet closed, or a phone's
 * PDF that couldn't be made sends nothing (null), and says why. Once WhatsApp has the bill nothing here throws (a throw
 * says the bill wasn't sent): a PDF that wasn't made, or didn't download, comes back as no file, with a word.
 */
export async function deliver(input: DeliverInput): Promise<Delivered> {
  const sheet = input.isPhone && canShareFiles();
  const ready = sendFile(input.billId);
  if (!sheet) {
    // Opened as 1C's chat link opens one, then cut off from the app: with "noopener" window.open answers null whether
    // or not the tab opened, so one the browser stopped would count as sent
    const tab = window.open(waLink(input.mobile, input.message), "_blank");
    if (!tab) {
      tell(TAB_STOPPED);
      return null;
    }
    try { tab.opener = null; } catch { /* WhatsApp's own page already, which can't reach back */ }
    const made = ready ?? await pdfFor(input.billId, "send").then((m) => m.file, () => null);
    const without = "WhatsApp opened without it. Download it from Print and share, then attach it there.";
    if (!made) {
      tell({ tone: "neg", title: "The PDF wasn't made", body: without });
      return { via: "whatsapp", file: null };
    }
    try {
      saveFile(made.blob, made.name);
    } catch {
      tell({ tone: "neg", title: "The PDF didn't download", body: without });
      return { via: "whatsapp", file: null };
    }
    return { via: "whatsapp", file: made.name };
  }
  let made = ready;
  if (!made) {
    // made away from the print page, so it says so meanwhile (a second press of Send does nothing till then)
    const away = tell(makingPdf(SHEET_NEXT));
    try {
      made = (await pdfFor(input.billId, "send")).file;
    } catch (e) {
      const { why, todo } = noPdf(e);
      tell({ tone: "neg", title: "The bill wasn't sent", body: words(why, "Nothing was marked as sent.", todo) });
      return null;
    } finally {
      away();
    }
  }
  const r = await sharePdf(made, { title: input.invoiceNumber, text: input.message });
  if (r === "unsupported") tell({ tone: "neg", title: "The share sheet didn't open", body: "Nothing was sent. Use Print and share to download the PDF, then send it on WhatsApp." });
  return r === "shared" ? { via: "share", file: made.name } : null;
}

/**
 * "Share the PDF…" (email, Drive, a printer app), the shop's default copies: the share sheet on a phone, a download on a
 * computer, which goes into the audit log as the print page's PDF does. Not a send. "Making the PDF…" shows till then.
 */
export function useShareBill(): (b: { id: number; invoice_number: string }) => void {
  const { isPhone } = useView();
  const { show, dismiss } = useToast();
  const log = useLogPrint();
  return useCallback((b) => {
    const sheet = isPhone && canShareFiles();
    const download = ({ file, bill, copies }: Made) => {
      saveFile(file.blob, file.name);
      log(billLog("exported", bill, copies));
      show({ tone: "brand", title: `${file.name} downloaded`, body: "Attach it to an email, or put it on Drive, from your Downloads folder." });
    };
    const said = show(makingPdf(sheet ? SHEET_NEXT : "It downloads as soon as it's ready."));
    void pdfFor(b.id, "share")
      .then(async (m) => { dismiss(said); if (!sheet || (await sharePdf(m.file, { title: b.invoice_number })) === "unsupported") download(m); })
      .catch((e: unknown) => { dismiss(said); const { why, todo } = noPdf(e); show({ tone: "neg", title: "The PDF wasn't made", body: words(why, todo) }); });
  }, [isPhone, show, dismiss, log]);
}

/** "Copy link": the bill's address, for anyone signed in (PROTO sales/parts.jsx:376); where copying is refused, the link is shown instead. */
export function useCopyBillLink(): (b: { id: number; invoice_number: string }) => void {
  const { show } = useToast();
  return useCallback((b) => {
    const url = `${window.location.origin}/sales/${b.id}`;
    const shown = () => show({ tone: "brand", title: `${b.invoice_number}'s link`, body: url });
    if (!navigator.clipboard?.writeText) { shown(); return; }
    navigator.clipboard.writeText(url).then(
      () => show({ tone: "brand", title: "Link copied", body: `${b.invoice_number}'s link is copied. Anyone signed in can open the bill from it.` }),
      shown,
    );
  }, [show]);
}
