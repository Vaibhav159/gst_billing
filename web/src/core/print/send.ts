// The print page's current choices and Original, read synchronously inside a Send press. No PDF-making code here.
import { useEffect } from "react";
import type { PdfFile } from "./make";

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

const sendFiles = new Map<number, PdfFile>();
/**
 * While the print page shows a bill, the Original it made, as the page shows it: a send from the page hands it out at
 * once, so a phone's share sheet opens within the press itself, and a refresh that changed nothing on paper keeps it. One
 * that went without the firm's signature isn't handed out: the send makes it again, to try for the signature.
 */
export function useSendFile(billId: number, file: PdfFile | null): void {
  useEffect(() => {
    if (!file || file.again) return undefined;
    sendFiles.set(billId, file);
    return () => { if (sendFiles.get(billId) === file) sendFiles.delete(billId); };
  }, [billId, file]);
}
export function sendFile(billId: number): PdfFile | undefined {
  return sendFiles.get(billId);
}
