// Contract-shaped synthetic firm, shared by the records page and hook tests.
export const FIRM_DETAIL = {
  id: 3, name: "KIRAN GOLD HOUSE", short: "Kiran", short_name: "", gst_number: "08VRHFA2322D1ZI", gstin_valid: true, pan_number: "VRHFA2322D", state_code: "08", state_name: "RAJASTHAN",
  address: "12, Bapu Bazar", city: "Udaipur", pin_code: "313001", mobile_number: "9414122018", email: "",
  bank_name: "State Bank of India", bank_account_number: "38741120965", bank_ifsc_code: "SBIN0UDR014", bank_branch_name: "Bapu Bazar", has_bank: true,
  invoice_prefix: "KGH", paper_full_number_from: "2027-04-01", signature_url: null, signature_on_bills: true, jurisdiction: "", jurisdiction_printed: "Udaipur", declaration: "",
  declaration_printed: "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.",
  numbers: { fy: "2026-27", last: null, next: { counter: 34, invoice_number: "KGH/2026-27/34" }, full_number: false },
  figures: { fy: "2026-27", from: "2026-04-01", to: "2026-10-08", sales: { bills: 104, total: "1000.01", tax: "30.00", cancelled: 1 }, purchases: { bills: 37, total: "100.00", tax: "3.00" }, customers: 29, first_bill: null, last_bill: null, last_filed: { month: "2026-08", gstr1_filed_on: "2026-09-10", gstr3b_filed_on: "2026-09-18" }, previous_month: { month: "2026-09", state: "open", blocker: "" } },
  recent: [], months: [{ month: "2026-09", state: "open", gstr1_filed_on: null, gstr3b_filed_on: null }],
  uses: { sales: 104, cancelled: 1, purchases: 37, bin: 0, drafts: 0, captures: 0, filing_records: 0, filing_months: 0, filed_periods: 0, opening_credits: 0 }, plain_after_full_date: 14, updated_at: "2026-10-08T10:00:00+05:30",
};
