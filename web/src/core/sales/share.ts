// Sending a bill on WhatsApp: the shop's message filled in for the bill (PROTO core/common.jsx:13-30), the
// customer's mobile read from what was typed, the wa.me link, and what sending did, in the app's words.
import { date, inr } from "@/core/format";
import { formatMobile, mobileDigits, mobileProblem } from "@/core/ids";
import type { CustomerType } from "./types";

/** The message until the owner sets one (contract §5's default). */
export const DEFAULT_SHARE_MESSAGE = "Namaste {customer}, your bill {number} for {total} from {firm} is attached. Thank you!";

type Values = Record<"customer" | "number" | "total" | "firm" | "date", string>;
/** Fills {customer}, {number}, {total}, {firm} and {date} wherever they appear. */
export function fillMessage(template: string, values: Values): string {
  return String(template || "").replace(/\{(customer|number|total|firm|date)\}/g, (_m, k: keyof Values) => values[k] ?? "");
}

/** total: the bill's total, exact to the paisa, as the PDF prints it (Ruling 1B-12). */
export type MessageBill = { invoice_number: string; invoice_date: string; total: number; firm: string; customer: { name: string; type: CustomerType } };
/** The shop's message for a bill; a walk-in has no name, so "Namaste {customer} ji" reads "Namaste ji", not "Namaste ji ji". */
export function billMessage(template: string | null | undefined, b: MessageBill): string {
  let tpl = template && template.trim() ? template : DEFAULT_SHARE_MESSAGE;
  const walkin = b.customer.type === "walkin";
  if (walkin) tpl = tpl.replace(/\{customer\}\s+ji\b/gi, "{customer}");
  return fillMessage(tpl, { customer: walkin ? "ji" : b.customer.name, number: b.invoice_number, total: inr(b.total), firm: b.firm, date: date(b.invoice_date) });
}

/** A 10-digit Indian mobile from what was typed, as it's read out ("98290 41122"), or "" (PROTO sales/parts.jsx:161-164; 1C's check). */
export function mobileOf(text: string | null | undefined): string {
  const d = mobileDigits(text);
  return d && !mobileProblem(d) ? formatMobile(d) : "";
}
/** wa.me's form of a mobile: 91 and the 10 digits; "" when there's none. */
export function waNumber(mobile: string | null | undefined): string {
  const m = mobileOf(mobile);
  return m ? `91${m.replace(" ", "")}` : "";
}
/** The chat with this number (or WhatsApp's own chat picker, with none), the message typed in. */
export function waLink(mobile: string | null | undefined, text: string): string {
  return `https://wa.me/${waNumber(mobile)}?text=${encodeURIComponent(text)}`;
}

/**
 * What sending did, in the app's words (PROTO core/common.jsx:57-62, sales/parts.jsx:177-184). who: the customer's
 * name, "the customer" for a walk-in, or "+91 …" for a number typed for this bill; mobile: the customer's own number
 * to show beside the name (""). file: the PDF's name once 1E makes one, else null.
 */
export function sentToast({ number, again, who, mobile, file, isPhone }: { number: string; again: boolean; who: string; mobile: string; file: string | null; isPhone: boolean }): { title: string; body: string } {
  const chat = mobile ? `a chat with ${who} (+91 ${mobile})` : `a chat with ${who}`;
  const body = file
    ? (isPhone ? `Your phone's share sheet opened with ${file}; pick WhatsApp and ${who}. It counts as sent once the share goes through.` : `${file} downloads and WhatsApp opens ${chat}. Attach the PDF there.`)
    : `WhatsApp opens ${chat}, with the bill's message typed in.`;
  return { title: again ? `${number} sent again` : `${number} sent`, body };
}
