// Records contract §1. Totals are integer paise; quantities and rates retain the server's decimal strings.
import { skipToken, useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { toPaise } from "@/core/format";
import type { FirmId } from "@/core/scope";
import type { BillRef } from "@/core/sales/types";

export type ProductKind = "gold" | "silver" | "diamond" | "bullion" | "service" | "packing" | "other";
export type RecordRef = { id: number; name: string };
export type FirmRef = RecordRef & { short: string };
export type Change = { key: string; field: string; from: string; to: string };
export type ProductFigures = { bills: number; quantity: string; other_units: { unit: string; quantity: string }[]; taxable: number; tax: number; cancelled?: number };
export type Product = {
  id: number; name: string; hsn_code: string; hsn_text: string; gst_percent: string; slab_ok: boolean;
  unit: string; kind: ProductKind; kind_set: boolean; purity: string; usual_rate: string | null; purchase_only: boolean;
  description: string; sold?: ProductFigures;
};
export type ProductDetail = Product & {
  sold: ProductFigures; bought: ProductFigures; average_rate: string | null; line_count: number; earlier_names: string[]; updated_at: string;
  by_firm: { business: FirmRef; sold: ProductFigures; bought: ProductFigures }[];
  lines: { bill: BillRef; business: FirmRef; quantity: string; unit: string; rate: string; taxable: number }[];
  hsn_on_bills: { lines: number; groups: { hsn_code: string; matches: boolean; lines: number; sales: BillRef[]; purchases: { id: number; bill_no: string }[] }[]; blocking: { bill: BillRef; business: FirmRef; month: string }[] };
  uses: { sales: number; cancelled: number; purchases: number; bin: number }; changes?: Change[];
};
export type ProductBody = { name: string; hsn_code: string; gst_percent: string; unit: string; kind: ProductKind | ""; purity: string; usual_rate: string | null; purchase_only: boolean; description: string };
export type CatalogPage = { count: number; next: string | null; previous: string | null; results: Product[]; total_products: number; twins: RecordRef[][]; summary?: { taxable: number; bills: number; cancelled: number; no_items: BillRef[]; no_items_count: number } };
type WireFigures = Omit<ProductFigures, "taxable" | "tax"> & { taxable: string; tax: string };
type WireProduct = Omit<Product, "sold"> & { sold?: WireFigures };
type WireDetail = Omit<ProductDetail, "sold" | "bought" | "by_firm" | "lines"> & {
  sold: WireFigures; bought: WireFigures; by_firm: { business: FirmRef; sold: WireFigures; bought: WireFigures }[];
  lines: (Omit<ProductDetail["lines"][number], "taxable"> & { taxable: string })[];
};
const money = (s: string) => toPaise(s) ?? 0;
const figures = (v: WireFigures): ProductFigures => ({ ...v, other_units: v.other_units ?? [], taxable: money(v.taxable), tax: money(v.tax) });
export function toProduct(raw: unknown): Product {
  const d = raw as WireProduct;
  return { ...d, sold: d.sold ? figures(d.sold) : undefined };
}
export function toProductDetail(raw: unknown): ProductDetail {
  const d = raw as WireDetail;
  return { ...d, sold: figures(d.sold), bought: figures(d.bought), by_firm: d.by_firm.map((r) => ({ ...r, sold: figures(r.sold), bought: figures(r.bought) })), lines: d.lines.map((l) => ({ ...l, taxable: money(l.taxable) })) };
}
export function toCatalogPage(raw: unknown): CatalogPage {
  const d = raw as Omit<CatalogPage, "results" | "summary"> & { results: WireProduct[]; summary?: Omit<NonNullable<CatalogPage["summary"]>, "taxable"> & { taxable: string } };
  return { ...d, results: d.results.map(toProduct), summary: d.summary ? { ...d.summary, taxable: money(d.summary.taxable) } : undefined };
}
export type ProductScope = { firmId: FirmId | null; fy: string };
export type CatalogFilters = ProductScope & { q: string; show: "all" | "sold" | "bought"; gst_rate: string; ordering: "name" | "-sold" | "hsn"; kind?: ProductKind | "" };
export const catalogKeys = { all: ["catalog"] as const, list: (p: object | null) => ["catalog", "list", p] as const, one: (id: number | null, p: object | null) => ["catalog", "one", id, p] as const };
const scopeParams = (s: ProductScope) => ({ fy: s.fy, ...(typeof s.firmId === "number" ? { business_id: s.firmId } : {}) });
export function useCatalog(f: CatalogFilters) {
  const params = f.firmId === null ? null : { ...scopeParams(f), figures: 1, q: f.q.trim().slice(0, 100), show: f.show, ...(f.gst_rate ? { gst_rate: f.gst_rate } : {}), ...(f.kind ? { kind: f.kind } : {}), ordering: f.ordering, page_size: 20 };
  return useInfiniteQuery({ queryKey: catalogKeys.list(params), initialPageParam: 1,
    queryFn: params ? async ({ pageParam, signal }) => toCatalogPage((await api.get("catalog/", { params: { ...params, page: pageParam }, signal })).data) : skipToken,
    getNextPageParam: (last, _pages, page) => last.next ? page + 1 : undefined,
    placeholderData: (prev, query) => {
      const was = query?.queryKey[2] as { fy?: string; business_id?: number } | null;
      return was && params && was.fy === params.fy && was.business_id === params.business_id ? prev : undefined;
    },
  });
}
export function useProduct(id: number | null, scope: ProductScope, all = false) {
  const params = scope.firmId === null ? null : { ...scopeParams(scope), ...(all ? { lines: "all" } : {}) };
  return useQuery({ queryKey: catalogKeys.one(id, params), queryFn: id === null || params === null ? skipToken : async ({ signal }) => toProductDetail((await api.get(`catalog/${id}/`, { params, signal })).data) });
}
export function useCatalogSearch(typed: string, enabled = true) {
  const q = typed.trim().slice(0, 100);
  return useQuery({ queryKey: ["catalog", "search", q], queryFn: !enabled || !q ? skipToken : async ({ signal }) => toCatalogPage((await api.get("catalog/", { params: { q, page_size: 5 }, signal })).data).results });
}
export function invalidateCatalog(qc: QueryClient) {
  for (const key of ["catalog", "products", "setup", "search", "audit"]) void qc.invalidateQueries({ queryKey: [key] });
}
export function useSaveProduct() {
  const qc = useQueryClient();
  return useMutation({ retry: false, networkMode: "always", mutationFn: async ({ id, body }: { id?: number; body: ProductBody }) => toProduct((await (id ? api.put(`catalog/${id}/`, body) : api.post("catalog/", body))).data), onSuccess: () => invalidateCatalog(qc) });
}
export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({ retry: false, networkMode: "always", mutationFn: async (id: number) => (await api.delete<{ audit_id: number }>(`catalog/${id}/`)).data, onSuccess: () => invalidateCatalog(qc) });
}
/** Product-delete Undo can work before the Audit page lands (contract §8.4). */
export function useRestoreProduct() {
  const qc = useQueryClient();
  return useMutation({ retry: false, networkMode: "always", mutationFn: async (auditId: number) => (await api.post<{ link: string }>(`audit/${auditId}/restore/`)).data, onSuccess: () => invalidateCatalog(qc) });
}
