import type { Product, ProductFigures, ProductKind } from "@/core/api/catalog";
import { qty, UNITS } from "@/core/format";
import { rateText } from "@/core/sales/words";

export const KIND_LABEL: Record<ProductKind, string> = { gold: "Gold", silver: "Silver", diamond: "Diamond", bullion: "Bullion", service: "Service", packing: "Packing", other: "Other" };
export const perUnit = (unit: string) => ["pcs", "nos", "unit"].includes(unit) ? "per piece" : `per ${unit === "gms" ? "g" : unit}`;
export const unitName = (unit: string) => UNITS.find((u) => u.value === unit)?.label ?? unit;
export const usualRate = (p: Pick<Product, "usual_rate" | "unit">) => p.usual_rate ? `${rateText(p.usual_rate)} ${perUnit(p.unit)}` : "Set on each bill";
export const slabSplit = (percent: string) => `CGST ${Number(percent) / 2}% + SGST ${Number(percent) / 2}%, or IGST ${percent}%`;
export const soldQuantity = (s: ProductFigures, unit: string) => `${qty(Number(s.quantity), unit)}${s.other_units.length ? ` · also ${s.other_units.map((u) => qty(Number(u.quantity), u.unit)).join(", ")}` : ""}`;
