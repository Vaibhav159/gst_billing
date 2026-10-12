import type { PhotoRow } from "./model";
import type { Read } from "../batch";
import type { Firm } from "@/core/scope";
export const firms: Firm[] = [{ id: 3, name: "Kiran Gold House", short: "Kiran", gstin: "08VRHFA2322D1ZI", state: "RAJASTHAN" }, { id: 2, name: "Mehta Ornaments", short: "Mehta", gstin: "08AAACM1234A1ZW", state: "RAJASTHAN" }];
export const read: Read = {
  source: "photo", irn: "", supplier: { name: "Udaipur Bullion Suppliers", gst_number: "08AACFU5521R1ZN", id: 21, state_code: "08", city: "" },
  buyer: { name: firms[0].name, gst_number: firms[0].gstin, business: 3 }, seller_business: null,
  invoice_number: "UBS/26-27/0866", invoice_date: "2026-10-07", payment_mode: "",
  lines: [{ product_name: "Gold bullion 995", hsn_code: "7108", gst_percent: "3", printed_rate: "3%", quantity: "42.180", unit: "gms", rate: "6878.000", taxable: "290114.04", amount_only: false }],
  printed_total: "298817.00", lines_total: "298817.46", confidence: { supplier: "high", gstin: "high", bill_no: "high", date: "medium", amounts: "high" }, notes: [],
};
export const row = (patch: Partial<PhotoRow> = {}): PhotoRow => ({ id: "photo-1", file: new File(["synthetic"], "UBS.jpg", { type: "image/jpeg" }), url: "blob:synthetic", phase: "read", kind: "purchase", firmId: 3, buyerFirmId: null, partyId: 21, read: structuredClone(read), include: true, buyerAck: false, itcEligible: true, itcMonth: null, problems: [], duplicate: null, ...patch });
