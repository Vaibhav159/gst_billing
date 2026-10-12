import { SLABS } from "@/core/sales/slabs";

/** The GST rates, the jeweller's two first (PROTO sales/parts.jsx:1039-1040): one list, kept in core/sales/slabs. */
export { SLABS };
/**
 * A GST rate as its slab, compared as numbers ("3.00" is "3", "0.250" is "0.25"), or "" when it isn't one: none picked,
 * a blank (which isn't 0%), or a v2 product's rate outside the slabs (0.07 reads "7").
 */
export function slabOf(gst: string | null): string {
  return gst != null && gst.trim() !== "" ? SLABS.find((s) => Number(s) === Number(gst)) ?? "" : "";
}
