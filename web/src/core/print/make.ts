// Making PDFs: one bill (memoised per answer from the server and per choice, so the print page, Send and Share don't
// make the same file twice), or many bills in one file. react-pdf and the document load on demand, the first time a
// PDF is made, so neither is in the app's first download (Ruling 1B-4).
import { createElement, useEffect } from "react";
import { api } from "@/core/api/client";
import type { BillDetail, Copies } from "@/core/sales/types";
import { copyPages, printBill, type PrintBill } from "./model";

export type PdfOptions = { copies: Copies; showBank: boolean };
/** A made PDF: the file, its name, and how many A4 sheets it has. */
export type PdfFile = { blob: Blob; name: string; sheets: number };

const signatures = new Map<string, Promise<string | null>>();
/**
 * A firm's signature as a data URL that react-pdf draws without fetching: a PNG or JPEG as it is, another kind of image
 * redrawn as PNG. null when there's none or it can't be read (the bill then prints without it, as v2's did).
 * The link is signed and changes each answer, so it's kept by its path; one that couldn't be read is asked for again.
 */
export function signatureData(url: string | null): Promise<string | null> {
  if (!url) return Promise.resolve(null);
  const key = url.split("?")[0];
  const kept = signatures.get(key);
  if (kept) return kept;
  const p = (async () => {
    const blob = (await api.get<Blob>(url.replace(/^\/api\//, ""), { responseType: "blob" })).data;
    if (blob.type === "image/png" || blob.type === "image/jpeg") return dataUrl(blob);
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext("2d")?.drawImage(bmp, 0, 0);
    return canvas.toDataURL("image/png");
  })().catch(() => { signatures.delete(key); return null; });
  signatures.set(key, p);
  return p;
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((done, fail) => {
    const r = new FileReader();
    r.onload = () => done(String(r.result));
    r.onerror = () => fail(r.error);
    r.readAsDataURL(blob);
  });
}

/** The PDF of these bills, and whether a firm's signature couldn't be read for it (it then prints without one). */
async function draw(bills: PrintBill[], copies: Copies, meta: { title: string; subject?: string }): Promise<{ blob: Blob; unsigned: boolean }> {
  const [{ pdf }, { BillDocument }, drawn] = await Promise.all([
    import("@react-pdf/renderer"),
    import("./BillDocument"),
    Promise.all(bills.map(async (b) => ({ ...b, firm: { ...b.firm, signature: await signatureData(b.firm.signature) } }))),
  ]);
  const blob = await pdf(createElement(BillDocument, { bills: drawn, copies: copyPages(copies), ...meta }) as Parameters<typeof pdf>[0]).toBlob();
  return { blob, unsigned: drawn.some((b, i) => Boolean(bills[i].firm.signature) && !b.firm.signature) };
}

/** One PDF of these bills: each bill, each copy, each page, in that order. subject: what the QR code carries (one bill). */
export async function makeBillPdf(bills: PrintBill[], copies: Copies, meta: { title: string; subject?: string }): Promise<Blob> {
  return (await draw(bills, copies, meta)).blob;
}

const made = new WeakMap<BillDetail, Map<string, Promise<PdfFile>>>();
/**
 * One bill's PDF, named by its number (billPdfName). Made once per answer from the server and choice. A failure isn't
 * kept, and nor is a file made while the firm's signature couldn't be read: it goes out without it, and the next ask
 * tries again, as the paper on screen shows the signature.
 */
export function billFile(d: BillDetail, opts: PdfOptions): Promise<PdfFile> {
  const key = `${opts.copies}|${opts.showBank}`;
  let byChoice = made.get(d);
  if (!byChoice) { byChoice = new Map(); made.set(d, byChoice); }
  const kept = byChoice.get(key);
  if (kept) return kept;
  const b = printBill(d, { showBank: opts.showBank });
  const choices = byChoice;
  const p = draw([b], opts.copies, { title: `Tax Invoice ${d.invoice_number}`, subject: b.qr }).then(({ blob, unsigned }) => {
    if (unsigned) forget();
    return { blob, name: b.file, sheets: b.pages.length * copyPages(opts.copies).length };
  });
  const forget = () => { if (choices.get(key) === p) choices.delete(key); };
  p.catch(forget);
  byChoice.set(key, p);
  return p;
}

const sendBank = new Map<number, boolean>();
/** While the print page shows a bill, a send from it carries the page's bank-details choice (deliver reads it). */
export function useSendBankChoice(billId: number, showBank: boolean): void {
  useEffect(() => {
    sendBank.set(billId, showBank);
    return () => { sendBank.delete(billId); };
  }, [billId, showBank]);
}
export function sendBankChoice(billId: number): boolean | undefined {
  return sendBank.get(billId);
}
