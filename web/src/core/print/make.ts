// Making PDFs: one bill (memoised per answer from the server and per choice, so the print page, Send and Share don't
// make the same file twice), or many bills in one file. react-pdf and the document load on demand, the first time a
// PDF is made, so neither is in the app's first download (Ruling 1B-4).
import { isAxiosError } from "axios";
import { createElement } from "react";
import { api, noAppReply } from "@/core/api/client";
import type { BillDetail, Copies } from "@/core/sales/types";
import { copyPages, printBill, type PrintBill } from "./model";

export { pdfCodeMissing } from "./files";
export { sendBankChoice, sendFile, useSendBankChoice, useSendFile } from "./send";

export type PdfOptions = { copies: Copies; showBank: boolean };
/**
 * A made PDF: the file, its name, and how many A4 sheets it has. again: it went without a firm's signature that may
 * come next time (Signature's `again`), so a page holding it asks again once it can (a link signed afresh).
 */
export type PdfFile = { blob: Blob; name: string; sheets: number; again?: boolean };

/**
 * A firm's signature for the PDF. src: a data URL that react-pdf draws without fetching, a PNG or JPEG as it is and another
 * kind of image redrawn as PNG; null when there's none or it can't be read (the bill then prints without it, as v2's did).
 * again: it may come next time. It got no reply from the app (none at all, or only the proxy's 502, 503 or 504, as the
 * api client reads them), or the app's own error (500): the server may be back by then. A refusal (a file that's gone,
 * 404) or an image that won't decode won't.
 */
export type Signature = { src: string | null; again: boolean };
const signatures = new Map<string, Promise<Signature>>();
/** The link is signed and changes each answer, so a signature is kept by its path; one that couldn't be read is asked for again. */
export function signatureData(url: string | null): Promise<Signature> {
  if (!url) return Promise.resolve({ src: null, again: false });
  const key = url.split("?")[0];
  const kept = signatures.get(key);
  if (kept) return kept;
  const p = (async (): Promise<Signature> => {
    const blob = (await api.get<Blob>(url.replace(/^\/api\//, ""), { responseType: "blob" })).data;
    if (blob.type === "image/png" || blob.type === "image/jpeg") return { src: await dataUrl(blob), again: false };
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext("2d")?.drawImage(bmp, 0, 0);
    return { src: canvas.toDataURL("image/png"), again: false };
  })().catch((e: unknown) => {
    signatures.delete(key);
    return { src: null, again: isAxiosError(e) && (noAppReply(e) || (e.response?.status ?? 0) >= 500) };
  });
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

/** The PDF of these bills, and whether a firm's signature it went without may come next time (Signature's `again`). */
async function draw(bills: PrintBill[], copies: Copies, meta: { title: string; subject?: string }): Promise<{ blob: Blob; again: boolean }> {
  const [{ pdf }, { BillDocument }, signs] = await Promise.all([
    import("@react-pdf/renderer"),
    import("./BillDocument"),
    Promise.all(bills.map((b) => signatureData(b.firm.signature))),
  ]);
  const drawn = bills.map((b, i) => ({ ...b, firm: { ...b.firm, signature: signs[i].src } }));
  const blob = await pdf(createElement(BillDocument, { bills: drawn, copies: copyPages(copies), ...meta }) as Parameters<typeof pdf>[0]).toBlob();
  return { blob, again: signs.some((s) => s.again) };
}

/** One PDF of these bills: each bill, each copy, each page, in that order. subject: what the QR code carries (one bill). */
export async function makeBillPdf(bills: PrintBill[], copies: Copies, meta: { title: string; subject?: string }): Promise<Blob> {
  return (await draw(bills, copies, meta)).blob;
}

const made = new WeakMap<BillDetail, Map<string, Promise<PdfFile>>>();
/**
 * One bill's PDF, named by its number (billPdfName). Made once per answer from the server and choice. A failure isn't
 * kept, and nor is a file made without a signature that may come next time (Signature's `again`): one that got no reply
 * from the app (none at all, or only the proxy's 502, 503 or 504) or the app's own error (500). That file goes out
 * without it, saying so (its `again`), and the next ask tries again, as the paper on screen shows the signature. A
 * refusal (a 403, or a file that's gone, 404) or an image that won't decode won't come next time, so that file is kept,
 * and Download, Print and Share hand it out at once.
 */
export function billFile(d: BillDetail, opts: PdfOptions): Promise<PdfFile> {
  const key = `${opts.copies}|${opts.showBank}`;
  let byChoice = made.get(d);
  if (!byChoice) { byChoice = new Map(); made.set(d, byChoice); }
  const kept = byChoice.get(key);
  if (kept) return kept;
  const b = printBill(d, { showBank: opts.showBank });
  const choices = byChoice;
  const p = draw([b], opts.copies, { title: `Tax Invoice ${d.invoice_number}`, subject: b.qr }).then(({ blob, again }) => {
    if (again) forget();
    return { blob, name: b.file, sheets: b.pages.length * copyPages(opts.copies).length, again };
  });
  const forget = () => { if (choices.get(key) === p) choices.delete(key); };
  p.catch(forget);
  byChoice.set(key, p);
  return p;
}
