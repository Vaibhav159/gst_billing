// The server's answers, read into the screens' types (types.ts): money from decimal strings into integer paise, and a
// field the server leaves out read as empty, never a crash (contract: v3/2026-10-10-part-1-api-contract.md §0.2).
// Every sales hook reads through these. Nothing is rounded to the rupee: a bill's total stays exact (Ruling 1B-12).
import { amountInWords, toPaise } from "@/core/format";
import type {
  Activity, AuditAction, BillDetail, BillRef, BillRow, BillStatus, BinPage, BinRow, CancelResult, CheckCode, CustomerOnBill, CustomerRef,
  CustomerType, Eway, FirmOnBill, HsnRow, ItaxFlag, ItaxKind, Line, MoveResult, NextNumber, NumberCheck, PaperBook, PaymentMode, Person,
  RenumberResult, SalesFacets, SalesPage, SalesSummary, Segment, Sent, ShopSettings, Slab,
} from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the server's JSON, read field by field below
type W = any;

const money = (v: W): number => toPaise(typeof v === "number" || typeof v === "string" ? v : null) ?? 0;
const text = (v: W): string => (v == null ? "" : String(v));
const whole = (v: W): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const list = (v: W): W[] => (Array.isArray(v) ? v : []);
const status = (v: W): BillStatus => (v === "cancelled" ? "cancelled" : "active");
const payment = (v: W): PaymentMode => (v === "cash" || v === "bank" || v === "credit" || v === "mixed" ? v : "");
const customerType = (v: W): CustomerType => (v === "walkin" || v === "business" ? v : "person");
const segment = (v: W): Segment => (v === "b2b" || v === "b2cl" ? v : "b2cs");
const CHECKS: CheckCode[] = ["no_lines", "no_hsn", "duplicate", "heads_mismatch", "tax_mismatch"];
const ITAX: ItaxKind[] = ["cash_limit", "pan", "walkin_limit", "b2b_address"];
const ACTIONS: AuditAction[] = ["created", "updated", "cancelled", "renumbered", "moved", "deleted", "restored", "sent", "printed", "exported", "merged"];

export function toPerson(w: W): Person {
  return w && w.id != null ? { id: whole(w.id), name: text(w.name) } : null;
}
export function toCustomerRef(w: W): CustomerRef {
  return { id: whole(w?.id), name: text(w?.name), gst_number: text(w?.gst_number), mobile_number: text(w?.mobile_number), type: customerType(w?.type) };
}
export function toBillRef(w: W): BillRef {
  return { id: whole(w?.id), invoice_number: text(w?.invoice_number), invoice_date: text(w?.invoice_date), customer_name: text(w?.customer_name), status: status(w?.status) };
}
const billRefOrNull = (w: W): BillRef | null => (w ? toBillRef(w) : null);
export function toSent(w: W): Sent | null {
  return w ? { at: text(w.at), last_at: text(w.last_at ?? w.at), count: whole(w.count) || 1, via: w.via === "share" ? "share" : "whatsapp", to: text(w.to) } : null;
}
/** A bill's income-tax flags; a kind this app doesn't know yet is left out, as plan 1C's reader does (Ruling 1B-11), never shown as another. */
const toItax = (v: W): ItaxFlag[] => list(v).filter((f: W) => ITAX.includes(f?.kind)).map((f: W) => ({ kind: f.kind, short: text(f.short), text: text(f.text) }));

export function toBillRow(w: W): BillRow {
  return {
    id: whole(w?.id), business: whole(w?.business), business_name: text(w?.business_name), invoice_number: text(w?.invoice_number),
    counter: w?.counter == null ? null : whole(w.counter), fy: text(w?.fy), invoice_date: text(w?.invoice_date), created_at: text(w?.created_at),
    paper: Boolean(w?.paper), customer: toCustomerRef(w?.customer), payment_mode: payment(w?.payment_mode),
    taxable: money(w?.taxable), cgst: money(w?.cgst), sgst: money(w?.sgst), igst: money(w?.igst), tax: money(w?.tax), total_amount: money(w?.total_amount),
    interstate: Boolean(w?.interstate), gst_percents: list(w?.gst_percents).map(text), line_count: whole(w?.line_count),
    status: status(w?.status), cancel_reason: text(w?.cancel_reason), sent: toSent(w?.sent),
    checks: list(w?.checks).filter((c: W) => CHECKS.includes(c)), itax: toItax(w?.itax), locked: Boolean(w?.locked),
  };
}
export function toLine(w: W): Line {
  return {
    id: whole(w?.id), product_name: text(w?.product_name), hsn_code: text(w?.hsn_code), quantity: text(w?.quantity), unit: text(w?.unit) || "gms",
    rate: text(w?.rate), gst_percent: text(w?.gst_percent), taxable: money(w?.taxable), cgst: money(w?.cgst), sgst: money(w?.sgst), igst: money(w?.igst),
    tax: money(w?.tax), amount: money(w?.amount), note: text(w?.note),
  };
}
const toFirm = (w: W): FirmOnBill => ({
  name: text(w?.name), address: text(w?.address), gst_number: text(w?.gst_number), state_name: text(w?.state_name), state_code: text(w?.state_code),
  pan_number: text(w?.pan_number), mobile_number: text(w?.mobile_number), email: text(w?.email), bank_name: text(w?.bank_name),
  bank_account_number: text(w?.bank_account_number), bank_ifsc_code: text(w?.bank_ifsc_code), bank_branch_name: text(w?.bank_branch_name),
  invoice_prefix: text(w?.invoice_prefix), signature_url: w?.signature_url ? text(w.signature_url) : null, frozen: Boolean(w?.frozen),
});
const toCustomerOnBill = (w: W): CustomerOnBill => ({
  ...toCustomerRef(w), address: text(w?.address), city: text(w?.city), state_name: text(w?.state_name), state_code: text(w?.state_code),
  gstin_valid: w?.gstin_valid == null ? null : Boolean(w.gstin_valid), pan_number: text(w?.pan_number), pan: text(w?.pan), email: text(w?.email),
});
const toSlab = (w: W): Slab => ({ gst_percent: text(w?.gst_percent), taxable: money(w?.taxable), cgst: money(w?.cgst), sgst: money(w?.sgst), igst: money(w?.igst), tax: money(w?.tax) });
const toHsn = (w: W): HsnRow => ({ ...toSlab(w), hsn_code: text(w?.hsn_code), unit: text(w?.unit), quantity: text(w?.quantity) });
const toEway = (w: W): Eway => ({
  eway_bill_number: text(w?.eway_bill_number), transporter_name: text(w?.transporter_name), transporter_gstin: text(w?.transporter_gstin),
  vehicle_number: text(w?.vehicle_number), vehicle_type: w?.vehicle_type === "ODC" ? "ODC" : "Regular",
  transport_mode: w?.transport_mode === "Rail" || w?.transport_mode === "Air" || w?.transport_mode === "Ship" ? w.transport_mode : "Road",
  distance_km: w?.distance_km == null ? null : whole(w.distance_km), may_be_needed: Boolean(w?.may_be_needed),
});
const toActivity = (w: W): Activity => ({ at: text(w?.at), by: w?.by == null ? null : text(w.by), action: ACTIONS.includes(w?.action) ? w.action : "updated", details: text(w?.details) });

/** One bill, also the print data. Its total and its words are exact to the paisa: there is no payable or round-off (Ruling 1B-12). */
export function toBillDetail(w: W): BillDetail {
  const row = toBillRow(w);
  return {
    ...row, customer: toCustomerOnBill(w?.customer),
    place_of_supply: text(w?.place_of_supply), place_of_supply_name: text(w?.place_of_supply_name),
    place_of_supply_chosen: w?.place_of_supply_chosen == null ? null : text(w.place_of_supply_chosen), segment: segment(w?.segment),
    notes: text(w?.notes), replaces: billRefOrNull(w?.replaces), replaced_by: billRefOrNull(w?.replaced_by),
    cancelled_at: w?.cancelled_at ? text(w.cancelled_at) : null, cancelled_by: toPerson(w?.cancelled_by),
    firm: toFirm(w?.firm), lines: list(w?.lines).map(toLine), slabs: list(w?.slabs).map(toSlab), hsn_summary: list(w?.hsn_summary).map(toHsn),
    total_in_words: text(w?.total_in_words) || amountInWords(row.total_amount), tax_in_words: text(w?.tax_in_words) || amountInWords(row.tax),
    eway: toEway(w?.eway), duplicates: list(w?.duplicates).map(toBillRef),
    history: { created_by: toPerson(w?.history?.created_by), activity: list(w?.history?.activity).map(toActivity) },
  };
}
export function toBinRow(w: W): BinRow {
  return {
    id: whole(w?.id), original_id: whole(w?.original_id), kind: w?.kind === "cancelled" ? "cancelled" : "deleted", business: whole(w?.business),
    business_name: text(w?.business_name), invoice_number: text(w?.invoice_number), invoice_date: text(w?.invoice_date), fy: text(w?.fy),
    customer: { id: whole(w?.customer?.id), name: text(w?.customer?.name) }, total_amount: money(w?.total_amount), reason: text(w?.reason),
    deleted_at: text(w?.deleted_at), deleted_by: toPerson(w?.deleted_by), locked: Boolean(w?.locked),
  };
}
export function toSummary(w: W): SalesSummary {
  return {
    of: w?.of === "cancelled" ? "cancelled" : "active", bills: whole(w?.bills), taxable: money(w?.taxable), cgst: money(w?.cgst), sgst: money(w?.sgst),
    igst: money(w?.igst), tax: money(w?.tax), total_amount: money(w?.total_amount), average: w?.average == null ? null : money(w.average), cancelled: whole(w?.cancelled),
  };
}
export function toFacets(w: W): SalesFacets {
  return {
    months: list(w?.months).map((m: W) => ({ month: text(m?.month), bills: whole(m?.bills), locked: Boolean(m?.locked) })),
    views: { unsent_today: whole(w?.views?.unsent_today), credit_month: whole(w?.views?.credit_month), check: whole(w?.views?.check), cash: whole(w?.views?.cash) },
    elsewhere: list(w?.elsewhere).map((e: W) => ({ fy: text(e?.fy), bills: whole(e?.bills) })),
  };
}
export function toSalesPage(w: W): SalesPage {
  const results = list(w?.results).map(toBillRow);
  return { count: w?.count == null ? results.length : whole(w.count), next: w?.next ?? null, previous: w?.previous ?? null, results, summary: toSummary(w?.summary), facets: w?.facets ? toFacets(w.facets) : null };
}
export function toBinPage(w: W): BinPage {
  const results = list(w?.results).map(toBinRow);
  return { count: w?.count == null ? results.length : whole(w.count), next: w?.next ?? null, previous: w?.previous ?? null, results };
}
export function toNextNumber(w: W): NextNumber {
  return { business: whole(w?.business), fy: text(w?.fy), invoice_date: text(w?.invoice_date), counter: whole(w?.counter), invoice_number: text(w?.invoice_number), full_number: Boolean(w?.full_number) };
}
export function toNumberCheck(w: W): NumberCheck {
  const code = w?.code === "shape" || w?.code === "number_taken" || w?.code === "number_deleted" ? w.code : "";
  return {
    invoice_number: text(w?.invoice_number), counter: w?.counter == null ? null : whole(w.counter), code, problem: text(w?.problem), bill: billRefOrNull(w?.bill),
    binned: w?.binned ? { id: whole(w.binned.id), original_id: whole(w.binned.original_id), invoice_number: text(w.binned.invoice_number), invoice_date: text(w.binned.invoice_date), reason: text(w.binned.reason), deleted_at: text(w.binned.deleted_at) } : null,
    note: text(w?.note), same_counter: billRefOrNull(w?.same_counter), next: { counter: whole(w?.next?.counter), invoice_number: text(w?.next?.invoice_number) },
  };
}
export function toPaperBook(w: W): PaperBook {
  return {
    business: whole(w?.business), month: text(w?.month), fy: text(w?.fy),
    bills: list(w?.bills).map((b: W) => ({ id: whole(b?.id), invoice_number: text(b?.invoice_number), counter: b?.counter == null ? null : whole(b.counter), invoice_date: text(b?.invoice_date),
      customer_name: text(b?.customer_name), total_amount: money(b?.total_amount), status: status(b?.status), paper: Boolean(b?.paper), sent: Boolean(b?.sent) })),
    entered: whole(w?.entered), runs: list(w?.runs).map((r: W) => [whole(r?.[0]), whole(r?.[1])] as [number, number]),
    missing: list(w?.missing).map(whole),
    explained: list(w?.explained).map((x: W) => (x?.kind === "deleted"
      ? { counter: whole(x.counter), kind: "deleted" as const, bin_id: whole(x.bin_id), invoice_number: text(x.invoice_number), reason: text(x.reason), deleted_at: text(x.deleted_at) }
      : { counter: whole(x?.counter), kind: "cancelled" as const, id: whole(x?.id), invoice_number: text(x?.invoice_number), reason: text(x?.reason) })),
    twice: list(w?.twice).map(whole), after: list(w?.after).map(whole), after_months: list(w?.after_months).map(text),
    next: { counter: whole(w?.next?.counter), invoice_number: text(w?.next?.invoice_number), invoice_date: text(w?.next?.invoice_date) },
    locked: Boolean(w?.locked), gstr1_due: text(w?.gstr1_due),
  };
}
export function toShopSettings(w: W): ShopSettings {
  const copies = w?.copies === "duplicate" || w?.copies === "triplicate" || w?.copies === "all" ? w.copies : "original";
  return { copies, show_bank: w?.show_bank !== false, share_message: text(w?.share_message), updated_at: w?.updated_at ? text(w.updated_at) : null, updated_by: toPerson(w?.updated_by) };
}
export function toCancelResult(w: W): CancelResult {
  return { id: whole(w?.id), invoice_number: text(w?.invoice_number), status: "cancelled", cancel_reason: text(w?.cancel_reason), cancelled_at: text(w?.cancelled_at), cancelled_by: toPerson(w?.cancelled_by) };
}
export function toRenumberResult(w: W): RenumberResult {
  return { id: whole(w?.id), invoice_number: text(w?.invoice_number), previous: text(w?.previous) };
}
export function toMoveResult(w: W): MoveResult {
  return { id: whole(w?.id), business: whole(w?.business), invoice_number: text(w?.invoice_number), previous: { business: whole(w?.previous?.business), invoice_number: text(w?.previous?.invoice_number) } };
}
