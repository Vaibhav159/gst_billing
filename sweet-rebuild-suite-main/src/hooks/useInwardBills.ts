import { useState, useEffect, useCallback } from "react";
import api from "@/utils/api";

export interface InwardSupplier {
  id: number;
  name: string;
  gst_number: string | null;
}

export interface InwardBillRow {
  id: number;
  invoice_number: string;
  invoice_date: string;
  total_amount: string;
  business: number;
  business_name: string;
  business_gstin: string;
  customer: number | null;
  supplier: InwardSupplier | null;
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  is_igst_applicable: boolean;
  has_file: boolean;
  source_preview_url: string | null;
  created_at: string;
}

export interface InwardBillLine {
  id: number;
  product_name: string;
  hsn_code: string;
  quantity: string;
  rate: string;
  cgst: string;
  sgst: string;
  igst: string;
  amount: string;
  unit: string;
  gst_tax_rate: string;
}

export interface InwardBillDetail extends InwardBillRow {
  line_items: InwardBillLine[];
  source_file_url: string | null;
}

export interface ExtractLine {
  product_name: string;
  quantity: number;
  rate: number;
  hsn_code: string;
  gst_tax_rate: number;
  amount: number;
}

export interface ExtractResult {
  supplier: { name: string; gstin: string; address: string; pan: string; mobile: string };
  invoice_number: string;
  invoice_date: string;
  line_items: ExtractLine[];
  tax_type: "igst" | "cgst_sgst";
  warnings: { gstin_mismatch: boolean; duplicate: boolean; extraction_failed: boolean };
}

export interface InwardFilters {
  business?: string;
  date_from?: string;
  date_to?: string;
  q?: string;
  page?: number;
}

export function useInwardBills(filters: InwardFilters = {}) {
  const [items, setItems] = useState<InwardBillRow[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(filters);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = {};
      if (filters.business && filters.business !== "all") params.business = filters.business;
      if (filters.date_from) params.date_from = filters.date_from;
      if (filters.date_to) params.date_to = filters.date_to;
      if (filters.q) params.q = filters.q;
      if (filters.page) params.page = filters.page;
      const res = await api.get("inward-bills/", { params });
      setItems(res.data.results ?? []);
      setCount(res.data.count ?? 0);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to load inward bills.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { items, count, loading, error, refetch };
}

export function useInwardBill(id?: string) {
  const [bill, setBill] = useState<InwardBillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    setError(null);
    api
      .get(`inward-bills/${id}/`)
      .then((r) => alive && setBill(r.data))
      .catch((e) => alive && setError(e?.response?.data?.error || "Inward bill not found."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  return { bill, loading, error };
}

export async function extractInwardBill(file: File, businessId: string): Promise<ExtractResult> {
  const fd = new FormData();
  fd.append("file", file, file.name);
  if (businessId) fd.append("business_id", businessId);
  const res = await api.post("inward-bills/extract/", fd);
  return res.data as ExtractResult;
}

export async function createInwardBill(payload: FormData): Promise<InwardBillDetail> {
  const res = await api.post("inward-bills/", payload);
  return res.data as InwardBillDetail;
}
