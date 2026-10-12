import type { Product, ProductFigures, ProductKind } from "@/core/api/catalog";
import { qty, UNITS } from "@/core/format";
import { halfPercent, rateText } from "@/core/sales/words";

export { inferredKind } from "@/core/api/catalog";
export const KIND_LABEL: Record<ProductKind, string> = { gold: "Gold", silver: "Silver", diamond: "Diamond", bullion: "Bullion", service: "Service", packing: "Packing", other: "Other" };
export const perUnit = (unit: string) => ["pcs", "nos", "unit"].includes(unit) ? "per piece" : `per ${unit === "gms" ? "g" : unit}`;
export const unitName = (unit: string) => UNITS.find((u) => u.value === unit)?.label ?? unit;
export const usualRate = (p: Pick<Product, "usual_rate" | "unit">) => p.usual_rate ? `${rateText(p.usual_rate)} ${perUnit(p.unit)}` : "Set on each bill";
export const slabSplit = (percent: string) => `CGST ${halfPercent(percent)} + SGST ${halfPercent(percent)}, or IGST ${percent}%`;
export const soldQuantity = (s: ProductFigures, unit: string) => `${qty(Number(s.quantity), unit)}${s.other_units.length ? ` · also ${s.other_units.map((u) => qty(Number(u.quantity), u.unit)).join(", ")}` : ""}`;
// The prototype's twelve suggestions. The API's kind is diamond (the prototype called it stone).
export const HSN_SUGGESTIONS: { hsn: string; name: string; gst: string; kind?: ProductKind }[] = [
  { hsn: "7113", name: "Jewellery of gold, silver or platinum", gst: "3" },
  { hsn: "71131910", name: "Gold jewellery", gst: "3", kind: "gold" },
  { hsn: "71131920", name: "Silver jewellery", gst: "3", kind: "silver" },
  { hsn: "7114", name: "Articles of gold or silver (utensils)", gst: "3" },
  { hsn: "7118", name: "Coins", gst: "3" },
  { hsn: "7108", name: "Gold, unwrought (bullion)", gst: "3", kind: "bullion" },
  { hsn: "7106", name: "Silver, unwrought (bars)", gst: "3", kind: "bullion" },
  { hsn: "7102", name: "Diamonds, cut and polished", gst: "0.25", kind: "diamond" },
  { hsn: "71023100", name: "Diamonds, rough (non-industrial)", gst: "0.25", kind: "diamond" },
  { hsn: "9988", name: "Job work on jewellery", gst: "5", kind: "service" },
  { hsn: "9983", name: "Hallmarking and other professional services", gst: "18", kind: "service" },
  { hsn: "4819", name: "Cartons and jewellery boxes", gst: "18", kind: "packing" },
];
export const PURITY_CHIPS: Record<ProductKind, string[]> = { gold: ["24K", "22K", "18K"], silver: ["999", "925"], bullion: ["999", "995", "925"], diamond: ["VVS", "VS", "SI"], service: [], packing: [], other: [] };
export function slabWarning(hsn: string, gst: string): string {
  if (!hsn || gst === "") return "";
  if (hsn.startsWith("7102") && Number(gst) !== 0.25) return "Cut and polished diamonds (HSN 7102) are taxed at 0.25%. Check the rate.";
  if (Number(gst) === 0.25 && !hsn.startsWith("7102")) return "0.25% is only for diamonds (HSN 7102). Check the HSN or the rate.";
  if (hsn.startsWith("71") && !hsn.startsWith("7102") && Number(gst) !== 3) return "Gold, silver, jewellery and coins (HSN 71) are taxed at 3%. Check the rate.";
  return "";
}
