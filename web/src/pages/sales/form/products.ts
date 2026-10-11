// Products for the bill form (v2's products/ endpoint, read as it is until part 4's Products screens): every product, kept
// for 30 minutes and searched here as a person types, so a product picked by Enter straight after typing is never one
// the server hasn't answered for yet. Making charges are inside the rate (part 1 design §2), so a product brings its
// name, HSN code, GST rate and unit; the rate is typed as written on the paper bill.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/core/api/client";
import { pct, UNITS } from "@/core/format";

/** gst_percent: v2 keeps a fraction ("0.0300"); this is the percent the bill takes ("3", "0.25"). */
export type SaleProduct = { id: number; name: string; hsn_code: string; gst_percent: string | null; unit: string; description: string; usage: number };

export const UNIT_OPTIONS = UNITS.map((u) => ({ value: u.value, label: u.value }));

/** The picker subtitle; the phone uses its unit as the final detail, the desktop its description. */
export const productSubtitle = (p: SaleProduct, detail = p.description) => `HSN ${p.hsn_code || "missing"} · GST ${p.gst_percent != null ? `${p.gst_percent}%` : "rate not set"}${detail ? ` · ${detail}` : ""}`;

/** A fraction as v2 stores it ("0.0300", 0.0025) as the percent a bill line takes ("3", "0.25"): part 0's pct without its "%". Null when it isn't a number. */
export function percentOf(fraction: string | number | null | undefined): string | null {
  const n = typeof fraction === "number" || (typeof fraction === "string" && fraction.trim()) ? Number(fraction) : NaN;
  return Number.isFinite(n) ? pct(n).slice(0, -1) : null;
}

type Raw = Record<string, unknown>;
export function toSaleProduct(raw: unknown): SaleProduct {
  const d = (raw && typeof raw === "object" ? raw : {}) as Raw;
  return {
    id: Number(d.id) || 0, name: String(d.name ?? ""), hsn_code: String(d.hsn_code ?? "").replace(/\D/g, ""), gst_percent: percentOf(d.gst_tax_rate as string),
    unit: String(d.default_unit ?? "") || "gms", description: String(d.description ?? ""), usage: Number(d.usage_count) || 0,
  };
}

export const productKeys = { all: ["products"] as const, forSale: () => ["products", "for-sale"] as const };

/** Every product, kept for 30 minutes: one page of 1000, by name. */
export function useSaleProducts() {
  return useQuery({
    queryKey: productKeys.forSale(), staleTime: 30 * 60_000,
    queryFn: async ({ signal }) => {
      const d = (await api.get("products/", { params: { page_size: 1000, ordering: "name" }, signal })).data as { results?: unknown[] } | unknown[] | null;
      return (Array.isArray(d) ? d : d?.results ?? []).map(toSaleProduct);
    },
  });
}

/** Products whose name or HSN has every word typed, best first: a name starting with the words, then the rest. */
export function matchProducts(list: SaleProduct[], typed: string): SaleProduct[] {
  const words = typed.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  const hits = list.filter((p) => words.every((w) => p.name.toLowerCase().includes(w) || p.hsn_code.startsWith(w)));
  const first = words[0];
  return [...hits.filter((p) => p.name.toLowerCase().startsWith(first)), ...hits.filter((p) => !p.name.toLowerCase().startsWith(first))];
}

/** The products most billed, for the phone's quick chips (at most n). */
export function quickProducts(list: SaleProduct[], n = 8): SaleProduct[] {
  return [...list].sort((a, b) => b.usage - a.usage || a.name.localeCompare(b.name)).slice(0, n);
}

/** Owner only (product.edit): an item that isn't in Products, kept there for the next bill (v2's POST products/). */
export type NewProduct = { name: string; hsn_code: string; gst_percent: string; unit: string; description: string };
export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    // never retried, and offline it fails at once: the app's own defaults, said here for any cache it runs in
    retry: false, networkMode: "always",
    mutationFn: async (p: NewProduct) => toSaleProduct((await api.post("products/", {
      name: p.name, hsn_code: p.hsn_code, gst_tax_rate: String(Number(p.gst_percent) / 100), default_unit: p.unit, description: p.description,
    })).data),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: productKeys.all }); },
  });
}
