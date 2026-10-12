// Contract examples shared by records tests. All requests still use the one fake server in test/server.ts.
import { serve, type Answer } from "./server";
export const PRODUCT = { id: 12, name: "Gold necklace 22K", hsn_code: "711319", hsn_text: "Gold jewellery", gst_percent: "3", slab_ok: true, unit: "gms", kind: "gold", kind_effective: "gold", purity: "22K", usual_rate: "6470.125", purchase_only: false, description: "Plain and Rajkot designs" };
export const SOLD = { bills: 14, quantity: "508.062", other_units: [{ unit: "pcs", quantity: "2.000" }], taxable: "3283912.40", tax: "98517.37", cancelled: 1 };
export const PRODUCT_DETAIL = { ...PRODUCT, sold: SOLD, bought: { bills: 0, quantity: "0.000", other_units: [], taxable: "0.00", tax: "0.00" }, by_firm: [], average_rate: "6463.125", lines: [], line_count: 0, hsn_on_bills: { lines: 0, groups: [], blocking: [] }, uses: { sales: 14, cancelled: 1, purchases: 2, bin: 0 }, earlier_names: ["Old necklace"], updated_at: "2026-10-08T12:00:00+05:30" };
export const CATALOG = { count: 1, next: null, previous: null, results: [{ ...PRODUCT, sold: SOLD }], total_products: 17, summary: { taxable: "3283912.40", bills: 14, cancelled: 1, no_items: [], no_items_count: 0 }, twins: [] };
export function recordsServer(answers: Record<string, Answer> = {}) {
  return serve({ "GET firms/": { results: [{ id: 3, name: "KIRAN GOLD HOUSE", gst_number: "08VRHFA2322D1ZI", state_name: "RAJASTHAN" }] }, "GET preferences/": { data: { defaultBusinessId: "3" } }, "GET catalog/": CATALOG, "GET catalog/12/": PRODUCT_DETAIL, ...answers });
}
