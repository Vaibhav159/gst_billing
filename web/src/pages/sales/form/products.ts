// Products for the bill form: every page from the existing products/ reader, kept
// for 30 minutes and searched here as a person types, so a product picked by Enter straight after typing is never one
// the server hasn't answered for yet. Making charges are inside the rate (part 1 design §2), so a product brings its
// name, HSN code, GST rate and unit; the rate is typed as written on the paper bill.
import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/core/api/client";
import { invalidateCatalog, productTraits, type ProductTraits, type ProductKind } from "@/core/api/catalog";
import { pct, UNITS } from "@/core/format";

/** gst_percent: v2 keeps a fraction ("0.0300"); this is the percent the bill takes ("3", "0.25"). */
export type SaleProduct = ProductTraits & { id: number; name: string; hsn_code: string; gst_percent: string | null; unit: string; description: string; usage: number };

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
    ...productTraits(d),
    id: Number(d.id) || 0, name: String(d.name ?? ""), hsn_code: String(d.hsn_code ?? "").replace(/\D/g, ""), gst_percent: typeof d.gst_percent === "string" ? d.gst_percent : percentOf(d.gst_tax_rate as string),
    unit: String(d.unit ?? d.default_unit ?? "") || "gms", description: String(d.description ?? ""), usage: Number(d.usage_count) || 0,
  };
}

export const productKeys = { all: ["products"] as const, forSale: () => ["products", "for-sale"] as const };

/** Every page, kept for 30 minutes. Sales hide bought-only products; purchases keep them. */
export function useSaleProducts(enabled = true, { forSale = true }: { forSale?: boolean } = {}) {
  return useQuery({
    queryKey: forSale ? productKeys.forSale() : [...productKeys.all, "for-purchase"], staleTime: 30 * 60_000, enabled,
    queryFn: !enabled ? skipToken : async ({ signal }) => {
      const rows = new Map<number, SaleProduct>();
      // 100 pages of 1,000 is far past any shop; a server that keeps naming a next page fails here instead of looping
      for (let page = 1; page <= 100; page++) {
        // Only our own endpoint receives the JWT, never the host named by a next URL.
        const d = (await api.get("products/", { params: { page_size: 1000, ordering: "name", ...(page > 1 ? { page } : {}) }, signal })).data as { results?: Raw[]; next?: string | null } | Raw[] | null;
        for (const raw of Array.isArray(d) ? d : d?.results ?? []) {
          if (forSale && raw.purchase_only === true) continue;
          const p = toSaleProduct(raw); rows.set(p.id, p);
        }
        if (Array.isArray(d) || !d?.next) return [...rows.values()];
      }
      throw new Error("The product list didn't end after 100 pages.");
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

/** Owner only (product.edit): the same catalog validation as the full product form. A bill's typed rate stays on its line. */
export type NewProduct = { name: string; hsn_code: string; gst_percent: string; unit: string; description: string; kind: ProductKind | null; purity: string };
export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    // never retried, and offline it fails at once: the app's own defaults, said here for any cache it runs in
    retry: false, networkMode: "always",
    mutationFn: async (p: NewProduct) => toSaleProduct((await api.post("catalog/", {
      ...p, usual_rate: null, purchase_only: false,
    })).data),
    onSuccess: () => invalidateCatalog(qc),
  });
}
