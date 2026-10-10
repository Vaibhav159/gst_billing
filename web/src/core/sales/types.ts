import type { CustomerType, ItaxFlag } from "@/core/api/customers";

// Selling's shared types (contract §0.2; plan 1B adds its own). PaymentMode: cash, bank (UPI / bank), credit (udhaar), mixed (part cash, part UPI), "" (not recorded).
export type PaymentMode = "cash" | "bank" | "credit" | "mixed" | "";

// Plan 1B's: Selling's records as the screens use them, the API contract's shapes (v3/2026-10-10-part-1-api-contract.md
// §0.2), with every money field in integer paise ("87083.21" is 8708321) and everything else as the server sends it:
// quantities, rates and GST rates stay decimal strings, exactly as stored. core/sales/wire.ts reads the server's
// answers into these; core/api/sales.ts's hooks hand them out. The customer's types are plan 1C's, re-exported here.
export type { CustomerType, ItaxFlag, ItaxKind } from "@/core/api/customers";

export type BillStatus = "active" | "cancelled";
/** GSTR-1's tables: B2B, B2CL and B2CS (shown as B2C). */
export type Segment = "b2b" | "b2cl" | "b2cs";
/** What makes a bill "Need a check" (never on a cancelled bill). */
export type CheckCode = "no_lines" | "no_hsn" | "duplicate" | "heads_mismatch" | "tax_mismatch";
/** What a bill's history row records (contract §2.2). imported: v2's Excel bulk import made the bill, "Imported from Excel" in its history (Ruling 1B-13). */
export type AuditAction = "created" | "imported" | "updated" | "cancelled" | "renumbered" | "moved" | "deleted" | "restored" | "sent" | "printed" | "exported" | "merged";
export type Copies = "original" | "duplicate" | "triplicate" | "all";
export type TransportMode = "Road" | "Rail" | "Air" | "Ship";
export type VehicleType = "Regular" | "ODC";

/** Someone who did something: the full name, else the username. Null when unknown (bulk-made bills, a deleted user). */
export type Person = { id: number; name: string } | null;
export type CustomerRef = { id: number; name: string; gst_number: string; mobile_number: string; type: CustomerType };
export type BillRef = { id: number; invoice_number: string; invoice_date: string; customer_name: string; status: BillStatus };
/** at: the first send; last_at: the latest; count: how many; to: a number typed for this bill ("" when it went to the customer's own). */
export type Sent = { at: string; last_at: string; count: number; via: "whatsapp" | "share"; to: string };

/** A bill in a list. Money in paise. counter: the number's trailing digits (null when it has none). */
export type BillRow = {
  id: number; business: number; business_name: string; invoice_number: string; counter: number | null; fy: string;
  invoice_date: string; created_at: string; paper: boolean; customer: CustomerRef; payment_mode: PaymentMode;
  taxable: number; cgst: number; sgst: number; igst: number; tax: number; total_amount: number;
  interstate: boolean; gst_percents: string[]; line_count: number; status: BillStatus; cancel_reason: string;
  sent: Sent | null; checks: CheckCode[]; itax: ItaxFlag[]; locked: boolean;
};

/** A bill's line: quantity, rate and GST percent as stored ("12.345", "6512.500", "3"); its money in paise. */
export type Line = {
  id: number; product_name: string; hsn_code: string; quantity: string; unit: string; rate: string; gst_percent: string;
  taxable: number; cgst: number; sgst: number; igst: number; tax: number; amount: number; note: string;
};
/** The firm as frozen on the bill at create or move (frozen: true), or the live firm for older bills (frozen: false). */
export type FirmOnBill = {
  name: string; address: string; gst_number: string; state_name: string; state_code: string; pan_number: string; mobile_number: string;
  email: string; bank_name: string; bank_account_number: string; bank_ifsc_code: string; bank_branch_name: string; invoice_prefix: string;
  signature_url: string | null; frozen: boolean;
};
/** The live customer. gstin_valid: null without a GSTIN; pan: the PAN to print (typed, or from a GSTIN that checks out). */
export type CustomerOnBill = CustomerRef & {
  address: string; city: string; state_name: string; state_code: string; gstin_valid: boolean | null; pan_number: string; pan: string; email: string;
};
export type Slab = { gst_percent: string; taxable: number; cgst: number; sgst: number; igst: number; tax: number };
export type HsnRow = { hsn_code: string; gst_percent: string; unit: string; quantity: string; taxable: number; cgst: number; sgst: number; igst: number; tax: number };
export type Eway = {
  eway_bill_number: string; transporter_name: string; transporter_gstin: string; vehicle_number: string; vehicle_type: VehicleType;
  transport_mode: TransportMode; distance_km: number | null; may_be_needed: boolean;
};
export type Activity = { at: string; by: string | null; action: AuditAction; details: string };
/** One bill, also the print data. Its total stays exact to the paisa: nothing rounds it to the rupee (Ruling 1B-12). */
export type BillDetail = Omit<BillRow, "customer"> & {
  customer: CustomerOnBill; place_of_supply: string; place_of_supply_name: string; place_of_supply_chosen: string | null; segment: Segment;
  notes: string; replaces: BillRef | null; replaced_by: BillRef | null; cancelled_at: string | null; cancelled_by: Person;
  firm: FirmOnBill; lines: Line[]; slabs: Slab[]; hsn_summary: HsnRow[];
  total_in_words: string; tax_in_words: string; eway: Eway; duplicates: BillRef[];
  history: { created_by: Person; activity: Activity[] };
};
/** A deleted bill in the bin. id: the bin row's (Restore and Undo use it); original_id: the bill's own id. */
export type BinRow = {
  id: number; original_id: number; kind: "deleted" | "cancelled"; business: number; business_name: string; invoice_number: string;
  invoice_date: string; fy: string; customer: { id: number; name: string }; total_amount: number; reason: string; deleted_at: string;
  deleted_by: Person; locked: boolean;
};
/** The figures of a whole filtered list, not one page: active bills, or the cancelled ones when only they are asked for. */
export type SalesSummary = {
  of: "active" | "cancelled"; bills: number; taxable: number; cgst: number; sgst: number; igst: number; tax: number; total_amount: number;
  average: number | null; cancelled: number;
};
export type MonthFacet = { month: string; bills: number; locked: boolean };
export type SalesFacets = {
  months: MonthFacet[]; views: { unsent_today: number; credit_month: number; check: number; cash: number }; elsewhere: { fy: string; bills: number }[];
};
export type SalesPage = { count: number; next: string | null; previous: string | null; results: BillRow[]; summary: SalesSummary; facets: SalesFacets | null };
export type BinPage = { count: number; next: string | null; previous: string | null; results: BinRow[] };
export type NextNumber = { business: number; fy: string; invoice_date: string; counter: number; invoice_number: string; full_number: boolean };
export type NumberCheck = {
  invoice_number: string; counter: number | null; code: "" | "shape" | "number_taken" | "number_deleted"; problem: string;
  bill: BillRef | null; binned: { id: number; original_id: number; invoice_number: string; invoice_date: string; reason: string; deleted_at: string } | null;
  note: string; same_counter: BillRef | null; next: { counter: number; invoice_number: string };
};
export type PaperBookBill = { id: number; invoice_number: string; counter: number | null; invoice_date: string; customer_name: string; total_amount: number; status: BillStatus; paper: boolean; sent: boolean };
export type PaperBookExplained =
  | { counter: number; kind: "cancelled"; id: number; invoice_number: string; reason: string }
  | { counter: number; kind: "deleted"; bin_id: number; invoice_number: string; reason: string; deleted_at: string };
export type PaperBook = {
  business: number; month: string; fy: string; bills: PaperBookBill[]; entered: number; runs: [number, number][]; missing: number[];
  explained: PaperBookExplained[]; twice: number[]; after: number[]; after_months: string[];
  next: { counter: number; invoice_number: string; invoice_date: string }; locked: boolean; gstr1_due: string;
};
export type ShopSettings = { copies: Copies; show_bank: boolean; share_message: string; updated_at: string | null; updated_by: Person };
export type CancelResult = { id: number; invoice_number: string; status: "cancelled"; cancel_reason: string; cancelled_at: string; cancelled_by: Person };
export type RenumberResult = { id: number; invoice_number: string; previous: string };
export type MoveResult = { id: number; business: number; invoice_number: string; previous: { business: number; invoice_number: string } };
/** A line as POST and PUT sales/ take it: decimals as typed (at most 3 places), a unit from UNITS. */
export type LineInput = { product_name: string; hsn_code: string; gst_percent: string; quantity: string; unit: string; rate: string; note: string };
/** What POST sales/ and PUT sales/{id}/ take (contract §2.3). paper, replaces and draft_id are POST only. */
export type BillInput = {
  business: number; customer: number; invoice_number: string; invoice_date: string; payment_mode: PaymentMode; place_of_supply: string | null;
  notes: string; paper?: boolean; replaces?: number | null; draft_id?: string | null; lines: LineInput[];
};
/** PUT sales/{id}/eway/: what's sent replaces what's stored. */
export type EwayInput = Partial<{
  eway_bill_number: string; transport_mode: TransportMode; transporter_name: string; transporter_gstin: string; vehicle_number: string;
  vehicle_type: VehicleType; distance_km: number | null;
}>;
