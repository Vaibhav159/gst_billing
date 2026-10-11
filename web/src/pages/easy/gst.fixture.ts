import type { Filing, Stage } from "@/core/gst/types";
import type { MonthForEasy } from "./gst";
const heads = (total: number) => ({ igst: total, cgst: 0, sgst: 0, total });
export function gstFixture(stage: Stage = "blocked"): MonthForEasy {
  const filing = (kind: "gstr1" | "gstr3b"): Filing => ({
    id: kind === "gstr1" ? 80 : 81, business: 3, month: "2026-09", kind,
    filed_on: kind === "gstr1" ? "2026-10-10" : "2026-10-19", arn: "",
    cash: null, cash_worked_out: null, late_fee: null, interest: null, credit_left: null,
    marked_by: { id: 1, name: "Owner" }, marked_at: "2026-10-19T17:00:00+05:30",
    updated_by: null, updated_at: null, legacy: false,
  });
  return {
    business: 3, month: "2026-09", stage,
    due: { gstr1: "2026-10-11", gstr3b: "2026-10-20", file_from: "2026-10-01" },
    record: { gstr1: ["gstr1", "filed"].includes(stage) ? filing("gstr1") : null,
      gstr3b: stage === "filed" ? filing("gstr3b") : null, gstr1a: null,
      legacy: false, unlocked: null, relocked: null, locked_by: null, locked_on: null },
    checks: { blockers: stage === "blocked" ? [{ kind: "duplicate", blocks: true,
      text: "Bill number KGH/2026-27/17 is used twice", detail: "", customer: null, suggested: 388,
      bills: [{ id: 388, invoice_number: "KGH/2026-27/17", invoice_date: "2026-09-09", customer_name: "Anita Mehta", total_amount: 4521000, status: "active" }], more_bills: 12 }] : [], notes: [], passes: [] },
    gstr3b: stage === "future" ? null : { output: heads(1037876), cash: heads(212000), carry_on: heads(0),
      credit: heads(0), carry_in: heads(0), used: heads(825876), amendments_in: [], late_bills: 0, to_confirm: 0,
      opening_missing: true, filed: stage === "filed" },
  };
}
