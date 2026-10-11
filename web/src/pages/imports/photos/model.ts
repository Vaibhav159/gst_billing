import { checkGstin } from "@/core/ids";
import { lineFigures, taxFor } from "@/core/sales/maths";
import { toPaise } from "@/core/format";
import type { Firm } from "@/core/scope";
import type { Credit, ImportBody, ImportKind, ImportParty, Read } from "../batch";
export type PhotoKind = "purchase" | "sale" | "interfirm";
export type PhotoRow = {
  id: string; file: File; url: string; phase: "queued" | "reading" | "read" | "failed" | "imported";
  kind: PhotoKind; firmId: number | null; buyerFirmId: number | null; partyId: number | null;
  partyResolved?: boolean; read: Read | null; include: boolean; buyerAck: boolean; itcEligible: boolean; itcMonth: string | null;
  problems: { field: string; detail: string }[]; duplicate: { id: number; invoice_number: string } | null;
  fail?: string; purchaseId?: number; saleId?: number; credit?: Credit | null;
};
export type MayImport = { sales: boolean; purchases: boolean };
export function detect(read: Read): Pick<PhotoRow, "kind" | "firmId" | "buyerFirmId"> {
  if (read.seller_business && read.buyer.business && read.seller_business !== read.buyer.business) return { kind: "interfirm", firmId: read.seller_business, buyerFirmId: read.buyer.business };
  if (read.seller_business) return { kind: "sale", firmId: read.seller_business, buyerFirmId: null };
  return { kind: "purchase", firmId: read.buyer.business, buyerFirmId: null };
}
export { fileProblem } from "@/core/captures/files";

export function partyOf(row: PhotoRow) {
  return row.kind === "sale" ? row.read?.buyer : row.read?.supplier;
}
export function localProblems(row: PhotoRow, may: MayImport, firms: Firm[]): string[] {
  if (!row.read || row.phase !== "read") return [];
  const r = row.read, out = row.problems.map((p) => p.detail);
  if (!r.invoice_date) out.push("Type the date printed on the bill, like 08 Oct 2026.");
  if (row.kind !== "sale" && r.invoice_date && r.invoice_date >= "2025-04-01" && row.itcMonth && row.itcMonth < "2025-04") out.push("The credit ledger starts in April 2025. Pick April 2025 or later.");
  if ((row.kind !== "purchase" && !may.sales) || (row.kind !== "sale" && !may.purchases)) out.push("Not for your role");
  const firm = firms.find((f) => f.id === row.firmId);
  if (!firm) out.push("The bill doesn't show which of your firms it's for. Pick the firm.");
  if (row.kind === "interfirm" && !firms.some((f) => f.id === row.buyerFirmId && f.id !== row.firmId)) out.push("Choose which firm bought this.");
  const party = partyOf(row);
  if (row.kind === "sale" && !row.partyId && !row.partyResolved) out.push("Checking the customer…");
  if (row.kind !== "interfirm" && !row.partyId && checkGstin(party?.gst_number).status !== "valid") out.push(`“${party?.name || "This party"}” isn't in your ${row.kind === "sale" ? "customers" : "suppliers"} and no GSTIN was read, so it can't be added automatically. Link it to a ${row.kind === "sale" ? "customer" : "supplier"} you have, or add the ${row.kind === "sale" ? "customer" : "supplier"} first.`);
  if (r.lines.some((l) => l.gst_percent === null)) {
    const printed = r.lines.filter((l) => l.gst_percent === null && l.printed_rate).map((l) => l.printed_rate);
    out.push(`Choose the slab printed on the bill (0% if it charges no GST).${printed.length ? ` The bill shows ${printed.join(", ")}, which isn't a GST rate.` : ""}`);
  }
  if (row.kind === "purchase" && !party?.gst_number) r.lines.forEach((l, i) => {
    if (l.gst_percent !== null && Number(l.gst_percent) !== 0) out.push(`Line ${i + 1}: the supplier has no GSTIN, so this purchase carries no input tax credit. Add the supplier's GSTIN to claim GST, or set the line to 0%.`);
  });
  if (row.kind === "purchase" && firm && r.buyer.gst_number && r.buyer.gst_number !== firm.gstin && !row.buyerAck) out.push(`This bill is addressed to ${r.buyer.gst_number}, not ${firm.name}. It won't match ${firm.short}'s credit in GSTR-2B.`);
  return out;
}
export function statusOf(row: PhotoRow, may: MayImport, firms: Firm[]): string {
  if (row.phase === "imported") return "Imported";
  if (row.phase === "failed") return "Couldn't read";
  if (row.phase === "reading") return "Reading…";
  if (row.phase === "queued") return "Waiting to be read";
  if (row.duplicate) return "Already entered";
  const problems = localProblems(row, may, firms);
  if (problems.includes("Not for your role")) return "Not for your role";
  if (!firms.some((f) => f.id === row.firmId)) return "Needs a firm";
  if (problems.some((p) => p.includes("can't be added automatically"))) return row.kind === "sale" ? "Needs a customer" : "Needs a supplier";
  return problems.length ? "Fix before import" : "Ready";
}
/** Amounts are previewed in paise with the same half-up helper as typed bills. */
export function totalOf(row: PhotoRow): number {
  return (row.read?.lines ?? []).reduce((sum, l) => {
    if (l.gst_percent === null) return sum;
    if (l.amount_only) { const value = toPaise(l.taxable) ?? 0; return sum + value + (taxFor(value, l.gst_percent) ?? 0); }
    return sum + (lineFigures({ quantity: l.quantity ?? "", rate: l.rate ?? "", gst_percent: l.gst_percent }, false)?.amount ?? 0);
  }, 0);
}
export function bodyFor(rows: PhotoRow[], kind: ImportKind, firms: Firm[]): ImportBody {
  const parties: ImportParty[] = [];
  const bills = rows.filter((row) => kind === "purchases" ? row.kind !== "sale" : row.kind === "sale").map((row) => {
    const r = row.read!;
    if (!r.invoice_date) throw new Error("Type the date printed on the bill, like 08 Oct 2026.");
    let party: string | number | null = row.partyId;
    if (row.kind === "interfirm") party = null;
    if (!party) {
      const p = row.kind === "interfirm" ? firms.find((f) => f.id === row.firmId)! : null;
      const who = p ? { name: p.name, gst_number: p.gstin, city: "" } : partyOf(row)!;
      const gst = checkGstin(who.gst_number);
      const prior = parties.find((x) => x.gst_number === who.gst_number);
      party = prior?.ref ?? `party-${parties.length + 1}`;
      if (!prior) parties.push({ ref: party, name: who.name, gst_number: who.gst_number, state_name: gst.status === "valid" || gst.status === "check" ? gst.state : "", city: "city" in who ? who.city : "", address: "" });
    }
    return {
      ref: row.id, business: (row.kind === "interfirm" ? row.buyerFirmId : row.firmId)!, invoice_number: r.invoice_number.trim(), invoice_date: r.invoice_date, payment_mode: r.payment_mode,
      lines: r.lines.map((l) => l.amount_only ? { product_name: l.product_name, hsn_code: l.hsn_code, gst_percent: l.gst_percent!, unit: l.unit, taxable: l.taxable, amount_only: true as const, note: "" } : { product_name: l.product_name, hsn_code: l.hsn_code, gst_percent: l.gst_percent!, quantity: l.quantity!, unit: l.unit, rate: l.rate!, note: "" }),
      ...(kind === "purchases" ? { supplier: party, itc_eligible: row.itcEligible, itc_month: r.invoice_date < "2025-04-01" ? null : row.itcMonth, buyer_gstin: r.buyer.gst_number, buyer_ack: row.buyerAck, pair: row.kind === "interfirm" ? { seller: row.firmId!, invoice_number: r.invoice_number.trim() } : null } : { customer: party, paper: true as const }),
    };
  });
  return { file_name: "", dry_run: true, [kind === "purchases" ? "suppliers" : "customers"]: parties, bills };
}
