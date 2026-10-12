// Shared CA workbook data, kept out of test files so importing it never re-runs their tests.
import type { CaWorkbook } from "./caWorkbook";

export const totals = { bills: 1, taxable: "80396.81", cgst: "1205.95", sgst: "1205.95", igst: "0.00", round_off: "0.00", value: "82808.71" };
const heads = { igst: "0.00", cgst: "451.20", sgst: "451.20" };
export function caFixture(): CaWorkbook {
  return { scope: "All firms", period: "Sep 2026", file: "GST_Report_All_firms_Sep_2026.xlsx", summary: [{ firm: "Summary", sales: totals, purchases: { ...totals, taxable: "360960.00", cgst: "451.20", sgst: "451.20", value: "361862.40" } }], firms: [{
    firm: { id: 3, name: "Summary", gst_number: "08VRHFA2322D1ZI" }, months: [{ month: "2026-09", sales: { rows: [
      [1, "KGH/2026-27/21", "2026-09-12", "Anil Gupta", "08ABCDE1234F1Z5", "Gold Ring 22K", "711319", "3", "12.345", "gms", "6512.500", "80396.81", "1205.95", "1205.95", "0.00", "0.00", "82808.71", "cash", "B2B", "08"],
    ], totals, split: [] }, purchases: { rows: [[1, "JGE/1183", "2026-09-05", "Jaipur Gem Exports", "08…", "Diamond", "710239", "0.25", "6.400", "ct", "56400.000", "360960.00", "451.20", "451.20", "0.00", "0.00", "361862.40", "bank", "2026-10", "to_claim"]], totals: { ...totals, taxable: "360960.00", cgst: "451.20", sgst: "451.20", value: "361862.40" }, split: [] } }],
    gstr1: [{ month: "2026-09", stage: "ready", sections: { b2b: [{ bill: { invoice_number: "KGH/2026-27/21", invoice_date: "2026-09-12" }, place_of_supply: "08", rates: ["3"], ...totals, total: totals.value }], b2cl: [], b2cs: [], nil: [], by_rate: [], hsn: { b2b: [], b2c: [{ hsn: "710239", description: "Diamonds", uqc: "CTM", quantity: "6.40", rate: "0.25", taxable: "360960.00", ...heads, bills: 1 }] }, docs: [{ from: "21", to: "23", total: 3, cancelled: 1, net: 2 }], docs_notes: ["A cancelled number counts once."], cancelled: [], amendments: { b2ba: 0, b2cla: 0, b2csa: 0 } } }],
    gstr3b: [{ month: "2026-09", stage: "filed", filing: { filed_on: "2026-10-08", arn: "AA0809261234567", marked_by: { name: "Owner" } }, tables: { t31a: { ...totals, total: totals.value }, t31c: { taxable: "0.00" }, t32: [], t4a5: { bills: 1, heads }, t4b1: { bills: 0, heads: { igst: "0.00", cgst: "0.00", sgst: "0.00" } }, t4c: heads, t4d2: { bills: 0, heads: { igst: "0.00", cgst: "0.00", sgst: "0.00" } }, t5: { inter: "0.00", intra: "1200.00" }, cash: { igst: "0.00", cgst: "754.75", sgst: "754.75" }, cash_paid: { igst: "0.00", cgst: "755.00", sgst: "755.00" }, carry_in: { heads: { igst: "0.00", cgst: "0.00", sgst: "0.00" }, from: "2026-08", as_filed: true }, available: heads, used: heads, carry_on: { igst: "0.00", cgst: "0.00", sgst: "0.00" }, steps: [], to_confirm: [] } }], amendments: [],
  }] };
}
