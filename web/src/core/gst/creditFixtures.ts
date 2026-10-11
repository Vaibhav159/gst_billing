// Synthetic responses from part 3 contract §§7–8; money is decimal text on the wire.
export const openingWire = {
  business: 3, as_of: "2025-04-01", igst: "0.00", cgst: "9500.00", sgst: "9500.00", total: "19000.00",
  typed: true, updated_by: { id: 1, name: "Kailash Mehta", role: "owner" }, updated_at: "2026-10-08T09:00:00+05:30",
  carried_out_of_first_month: { month: "2025-04", heads: { igst: "0.00", cgst: "8000.00", sgst: "8000.00" } },
};
export const effectWire = {
  reaches: "2025-05", carried_out: { from: "16000.00", to: "16001.23" },
  cash: { month: "2025-05", from: "12.50", to: "11.27" }, filed_differ: { count: 2, from: "2025-06", to: "2025-07" },
};
export const creditWire = {
  business: 3, fy: "2026-27",
  at_risk: { deadline: "2026-11-30", days_left: 53, tax: "902.40", count: 1, bills: [{
    id: 77, bill_no: "JGE/1098", bill_date: "2026-02-18", entered_on: "2026-10-05",
    supplier: { id: 21, name: "Jaipur Gem Exports", gst_number: "08ABCDE1234F1Z5" }, tax: "902.40",
    credit_month: "2026-10", credit_month_due: "2026-11-20", deadline: "2026-11-30", days_left: 53,
    claim_months: [
      { month: "2026-09", state: "not_filed" as const, gstr3b_due: "2026-10-20", too_late: false },
      { month: "2026-10", state: "running" as const, gstr3b_due: "2026-11-20", too_late: false },
      { month: "2026-11", state: "running" as const, gstr3b_due: "2026-12-20", too_late: true },
    ],
  }] },
  others_at_risk: [{ business: 1, short: "Meera", count: 1 }],
  buckets: { fy: "2026-27", deadline: "2027-11-30", days_left: 418,
    claimed: { bills: 140, tax: "125678.90" }, open: { bills: 1, tax: "902.40" }, lapsed: { bills: 0, tax: "0.00" },
    none: [{ id: 88, bill_no: "XYZ/18", supplier_name: "Local Supplier", why: "not_allowed" as const }],
  },
  opening: openingWire,
};
