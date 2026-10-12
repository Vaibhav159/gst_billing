// Part 3 contract §§7–8. Generic money permits one wire shape and a paise-based UI.
export type OpeningCreditValue<M> = {
  business: number; as_of: string; igst: M; cgst: M; sgst: M; total: M; typed: boolean;
  updated_by: { id: number; name: string; role: string } | null; updated_at: string | null;
  first_filed_3b: string | null;
  carried_out_of_first_month: { month: string; heads: { igst: M; cgst: M; sgst: M } };
};
export type OpeningEffectValue<M> = {
  reaches: string; carried_out: { from: M; to: M }; cash: { month: string; from: M; to: M };
  filed_differ: { count: number; from: string | null; to: string | null };
};
export type CreditRiskBillValue<M> = {
  id: number; bill_no: string; bill_date: string; entered_on: string;
  supplier: { id: number; name: string; gst_number: string }; tax: M;
  credit_month: string; credit_month_due: string; deadline: string; days_left: number;
  claim_months: { month: string; state: "not_filed" | "running"; gstr3b_due: string; too_late: boolean }[];
};
export type CreditValue<M> = {
  business: number; fy: string;
  at_risk: { deadline: string | null; days_left: number | null; tax: M; count: number; bills: CreditRiskBillValue<M>[] };
  others_at_risk: { business: number; short: string; count: number }[];
  buckets: {
    fy: string; deadline: string; days_left: number;
    claimed: { bills: number; tax: M }; open: { bills: number; tax: M }; lapsed: { bills: number; tax: M };
    before_ledger: { count: number; tax: M };
    none: { id: number; bill_no: string; supplier_name: string; why: "no_gstin" | "no_gst" | "not_allowed" }[];
  };
  opening: OpeningCreditValue<M>;
};
export type OpeningCredit = OpeningCreditValue<number>;
export type OpeningEffect = OpeningEffectValue<number>;
export type CreditRiskBill = CreditRiskBillValue<number>;
export type Credit = CreditValue<number>;
export type OpeningInput = { business: number; igst: number; cgst: number; sgst: number };
