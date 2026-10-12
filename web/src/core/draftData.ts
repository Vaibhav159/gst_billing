// The shared shapes and readers for unfinished bills, independent of device storage and draft synchronization.
import { toCustomer, type Customer } from "@/core/api/customers";
import type { PaymentMode, Person } from "@/core/sales/types";
import { toPerson } from "@/core/sales/wire";
import { PAY } from "@/core/sales/words";

/** A line as an unfinished bill keeps it: what was typed, as typed (rate in rupees, up to 3 decimals; gst a percent). */
export type DraftLine = { productId: number | null; name: string; hsn: string; gst: string | null; unit: string; qty: number | null; rate: string; note: string; custom: boolean; kind?: string | null; purity?: string };
/**
 * An unfinished bill's own state (the server only keeps it): the firm, the customer as picked, the number and date as
 * typed or suggested, paper or not, the place of supply chosen (null: the usual), payment (null: not picked yet),
 * the note and the lines. replaces: the cancelled bill it makes again.
 */
export type DraftData = {
  v: 1; firmId: number | null; customer: Customer | null; date: string; number: string; numberTyped: boolean; paper: boolean;
  posOverride: string | null; payment: PaymentMode | null; notes: string; lines: DraftLine[]; replaces: number | null;
};
/** One unfinished bill on the server. started_by stays the person who started it, whoever changes it later. */
export type Draft = { id: string; business: number | null; started_by: Person; data: DraftData; created_at: string; updated_at: string };
/**
 * The shop's list as read, and when it was asked for (ms): a draft that reached the server after that may not be on it
 * yet. complete: fewer than the server's cap came back, so a draft missing from it isn't on the server.
 */
export type DraftList = { drafts: Draft[]; askedAt: number; complete: boolean };
/** What the form lists: the shop's unfinished bills and this device's own. onDevice: this device has a change the server hasn't. */
export type UnfinishedBill = Draft & { onDevice: boolean };
/**
 * Where a keep left the bill: on the shop's list ("server"); on this device until the server can take it ("device");
 * only until this page closes, as the browser refuses storage ("visit"); or nowhere (null), as it was saved as a bill
 * already. refusal: the server's words when it turned the draft away.
 */
export type KeepResult = { kept: "server" | "device" | "visit" | null; refusal?: string };

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const idOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);
/** Every payment mode: PAY words each one ("" is "not recorded", a choice; null is not picked yet). */
const PAYMENTS = Object.keys(PAY) as PaymentMode[];

/** An unfinished bill's data, whoever wrote it and whatever it left out: a field it doesn't have reads as empty. */
export function toDraftData(raw: unknown): DraftData {
  const d = obj(raw);
  const lines = Array.isArray(d.lines) ? d.lines.map(obj) : [];
  return {
    v: 1, firmId: idOrNull(d.firmId), customer: d.customer && typeof d.customer === "object" ? toCustomer(d.customer) : null,
    date: str(d.date), number: str(d.number), numberTyped: d.numberTyped === true, paper: d.paper === true,
    posOverride: typeof d.posOverride === "string" ? d.posOverride : null,
    payment: PAYMENTS.includes(d.payment as PaymentMode) ? (d.payment as PaymentMode) : null, notes: str(d.notes),
    lines: lines.map((l) => ({
      productId: idOrNull(l.productId), name: str(l.name), hsn: str(l.hsn), gst: typeof l.gst === "string" && l.gst ? l.gst : null, unit: str(l.unit) || "gms",
      qty: typeof l.qty === "number" && Number.isFinite(l.qty) ? l.qty : null, rate: str(l.rate).replace(/^\./, "0."), note: str(l.note), custom: l.custom === true,
      ...(typeof l.kind === "string" || l.kind === null ? { kind: l.kind } : {}),
      ...(typeof l.purity === "string" ? { purity: l.purity } : {}),
    })),
    replaces: idOrNull(d.replaces),
  };
}
export function toDraft(raw: unknown): Draft {
  const d = obj(raw);
  return { id: str(d.id), business: idOrNull(d.business), started_by: toPerson(d.started_by), data: toDraftData(d.data), created_at: str(d.created_at), updated_at: str(d.updated_at) };
}
