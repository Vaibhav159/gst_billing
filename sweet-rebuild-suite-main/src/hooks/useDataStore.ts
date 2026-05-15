import { useState, useEffect, useCallback } from "react";
import api from "@/utils/api";
import { logger } from "@/utils/logger";
import type { PaginatedResponse, DjangoInvoice, DjangoBusiness, DjangoCustomer, DjangoProduct, DashboardStatsResponse } from "@/types/api";

import { Invoice, Product } from "@/utils/mockData";

/**
 * Extracts relative URL from a DRF absolute `next` URL.
 * DRF returns e.g. "http://localhost:8000/api/invoices/?page=2"
 * We need just "invoices/?page=2" for our axios baseURL.
 */
function parseNextUrl(absoluteUrl: string | null): string | null {
  if (!absoluteUrl) return null;
  try {
    const u = new URL(absoluteUrl);
    return u.pathname.replace(/^\/api\//, '') + u.search;
  } catch {
    return null;
  }
}

/**
 * Fetches all pages from a DRF paginated endpoint (opt-in only).
 * Use sparingly — only for pages that truly need aggregated data (e.g. Dashboard).
 */
async function fetchAllPages<T = any>(endpoint: string): Promise<T[]> {
  const allResults: T[] = [];
  let url: string | null = endpoint;
  while (url) {
    const res = await api.get(url);
    const data = res.data;
    if (data && Array.isArray(data.results)) {
      allResults.push(...data.results);
      url = parseNextUrl(data.next);
    } else if (Array.isArray(data)) {
      allResults.push(...data);
      url = null;
    } else {
      url = null;
    }
  }
  return allResults;
}

export interface Business {
  id: string; // DRF returns int id normally, but we can treat as string or number
  name: string;
  address: string;
  gst_number: string;
  mobile_number: string;
  pan_number?: string | null;
  bank_name?: string | null;
  bank_account_number?: string | null;
  bank_ifsc_code?: string | null;
  bank_branch_name?: string | null;
  state_name?: string | null;
  primary_color_theme?: string;
  signature_image?: string | null;
  signature_image_base64?: string | null;
  email?: string | null;
  created_at?: string;
  updated_at?: string;
  total_revenue?: number;
  total_purchases?: number;
  customer_count?: number;
  invoice_count?: number;
}

export interface Customer {
  id: string; // From DRF
  name: string;
  address?: string | null;
  gst_number?: string | null;
  pan_number?: string | null;
  mobile_number?: string | null;
  email?: string | null;
  state_name?: string | null;
  created_at?: string;
  updated_at?: string;
  businesses?: string[]; // array of business IDs string or int
  tags?: string[];
  total_revenue?: number;
  invoice_count?: number;
}

export interface DashboardStats {
  totals: {
    inward: number;
    outward: number;
    net: number;
    count: number;
    tax: number;
    inward_tax: number;
  };
  monthly: any[];
  tax_distribution?: {
    cgst: number;
    sgst: number;
    igst: number;
  };
  top_customers: {
    id: string;
    name: string;
    total: number;
  }[];
  top_products: {
    name: string;
    total: number;
    qty: number;
    hsn?: string;
  }[];
  recent_invoices: any[];
}

const STORE_KEYS = {
  invoices: "gst_data_invoices",
  products: "gst_data_products",
  seeded: "gst_data_seeded",
};

function loadOrSeed<T>(key: string, seedData: T[]): T[] {
  const seeded = localStorage.getItem(STORE_KEYS.seeded);
  const stored = localStorage.getItem(key);
  if (stored) {
    try { return JSON.parse(stored); } catch { /* fall through */ }
  }
  if (!seeded) {
    localStorage.setItem(key, JSON.stringify(seedData));
    return [...seedData];
  }
  return [];
}

function persist<T>(key: string, data: T[]) {
  localStorage.setItem(key, JSON.stringify(data));
}

function markSeeded() {
  if (!localStorage.getItem(STORE_KEYS.seeded)) {
    localStorage.setItem(STORE_KEYS.seeded, "1");
  }
}

function useCRUD<T extends { id: string }>(key: string, seedData: T[]) {
  const [items, setItems] = useState<T[]>(() => loadOrSeed(key, seedData));
  useEffect(() => { markSeeded(); }, []);

  const save = useCallback((updated: T[]) => {
    setItems(updated);
    persist(key, updated);
    window.dispatchEvent(new CustomEvent("datastore-update", { detail: { key } }));
  }, [key]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.key === key) {
        const stored = localStorage.getItem(key);
        if (stored) {
          try { setItems(JSON.parse(stored)); } catch { /* ignore */ }
        }
      }
    };
    window.addEventListener("datastore-update", handler);
    return () => window.removeEventListener("datastore-update", handler);
  }, [key]);

  const create = useCallback((item: T) => {
    const updated = [...items, item];
    save(updated);
    return item;
  }, [items, save]);

  const update = useCallback((id: string, updates: Partial<T>) => {
    const updated = items.map(it => it.id === id ? { ...it, ...updates } : it);
    save(updated);
  }, [items, save]);

  const remove = useCallback((id: string) => {
    const updated = items.filter(it => it.id !== id);
    save(updated);
  }, [items, save]);

  const getById = useCallback((id: string) => {
    return items.find(it => it.id === id) || null;
  }, [items]);

  return { items, create, update, remove, getById, setAll: save };
}

// ── Typed hooks ──

function getFinancialYear(date: string) {
  if (!date) return "";
  const d = new Date(date);
  const m = d.getMonth();
  const y = d.getFullYear();
  if (m < 3) return `${y - 1}-${y.toString().slice(-2)}`;
  return `${y}-${(y + 1).toString().slice(-2)}`;
}

export function mapDjangoInvoice(inv: any): Invoice {
  const hasItems = Array.isArray(inv.line_items) && inv.line_items.length > 0;
  
  const items = (inv.line_items || []).map((item: any) => ({
    productId: String(item.product || item.id || ""),
    productName: item.product_name || item.item_name || "",
    hsn: item.hsn_code || "",
    gstRate: (() => { const r = parseFloat(item.gst_tax_rate) || 0; return Math.round(r > 1 ? r : r * 100); })(),
    qty: parseFloat(item.quantity) || 0,
    rate: parseFloat(item.rate) || 0,
    unit: item.unit || "gms",
    amount: parseFloat(item.amount) || 0,
    cgst: parseFloat(item.cgst) || 0,
    sgst: parseFloat(item.sgst) || 0,
    igst: parseFloat(item.igst) || 0,
  }));

  let subtotal = hasItems ? items.reduce((sum: number, it: any) => sum + (it.qty * it.rate), 0) : 0;
  let totalCGST = items.reduce((sum: number, it: any) => sum + it.cgst, 0);
  let totalSGST = items.reduce((sum: number, it: any) => sum + it.sgst, 0);
  let totalIGST = items.reduce((sum: number, it: any) => sum + it.igst, 0);
  
  // Use annotated total_tax if line_items is empty/missing
  const itemBasedTax = totalCGST + totalSGST + totalIGST;
  const totalTax = itemBasedTax > 0 ? itemBasedTax : (parseFloat(inv.total_tax) || 0);
  
  // If line items didn't have cgst/sgst/igst breakdown, infer from totalTax + isIGST flag
  if (itemBasedTax === 0 && totalTax > 0) {
    const isIGST = inv.is_igst_applicable || false;
    if (isIGST) {
      totalIGST = totalTax;
    } else {
      totalCGST = totalTax / 2;
      totalSGST = totalTax / 2;
    }
  }

  // Prefer the API-provided total_amount (always accurate), fall back to calculated
  const apiTotal = parseFloat(inv.total_amount) || 0;
  const calculatedTotal = subtotal + totalTax;
  const rawTotal = apiTotal > 0 ? apiTotal : calculatedTotal;
  const roundedTotal = Math.round(rawTotal);
  const roundedOff = +(roundedTotal - rawTotal).toFixed(2);

  // Also fix subtotal: if line items are missing, derive from total - tax
  if (subtotal === 0 && apiTotal > 0) {
    subtotal = apiTotal - totalTax;
  }

  return {
    id: String(inv.id),
    invoiceNumber: inv.invoice_number || "",
    invoice_date: inv.invoice_date || "",
    customerId: String(typeof inv.customer === 'object' ? inv.customer.id : (inv.customer || "")),
    customerName: inv.customer_name || (typeof inv.customer === 'object' ? inv.customer.name : ""),
    businessId: String(typeof inv.business === 'object' ? inv.business.id : (inv.business || "")),
    businessName: inv.business_name || (typeof inv.business === 'object' ? inv.business.name : ""),
    type: (inv.type_of_invoice || "OUTWARD").toUpperCase(),
    isIGST: inv.is_igst_applicable || false,
    items,
    subtotal,
    totalCGST,
    totalSGST,
    totalIGST,
    totalTax,
    total: roundedTotal,
    roundedOff: roundedOff !== 0 ? roundedOff : undefined,
    financialYear: getFinancialYear(inv.invoice_date),
    createdAt: inv.created_at || "",
    updatedAt: inv.updated_at || "",
    lineItemCount: hasItems ? items.length : (inv.line_item_count || 0),
  };
}

export function mapDjangoProduct(prod: any): Product {
  return {
    id: String(prod.id),
    name: prod.name || "",
    hsn: prod.hsn_code || "",
    gstRate: (() => { const r = parseFloat(prod.gst_tax_rate) || 0; return Math.round(r > 1 ? r : r * 100); })(),
    description: prod.description || "",
    createdAt: prod.created_at || "",
    total_revenue: Number(prod.total_revenue) || 0,
    qty_sold: Number(prod.qty_sold) || 0,
    usage_count: Number(prod.usage_count) || 0,
  };
}

export interface InvoiceFilters {
  search?: string;
  businessId?: string;
  customerId?: string;
  typeFilter?: string;  // "all" | "OUTWARD" | "INWARD"
  fyFilter?: string;    // "all" | "2024-25" etc.
  monthFilter?: string; // "all" | "1"-"12"
  startDate?: string;   // "YYYY-MM-DD" explicit date range override
  endDate?: string;     // "YYYY-MM-DD" explicit date range override
  // Data-quality drill-downs from DataQualityBanner:
  dups?: boolean;       // only invoices with collision in (biz, no, FY, type)
  empty?: boolean;      // only invoices with zero line items
  noHsn?: boolean;      // only invoices with at least one HSN-less line item
}

/**
 * Compute start_date and end_date from FY + optional month filter.
 * FY "2024-25" → April 2024 to March 2025.
 */
function buildDateRange(fyFilter?: string, monthFilter?: string): { start_date?: string; end_date?: string } {
  if (!fyFilter || fyFilter === "all") return {};

  const [startYearStr] = fyFilter.split("-");
  const startYear = parseInt(startYearStr);
  if (isNaN(startYear)) return {};

  // FY 2024-25 → Apr 2024 to Mar 2025
  const fyStart = new Date(startYear, 3, 1); // April 1
  const fyEnd = new Date(startYear + 1, 2, 31); // March 31

  if (monthFilter && monthFilter !== "all") {
    const m = parseInt(monthFilter); // 1-12
    // If month is Jan-Mar (1-3), it falls in the next calendar year of the FY
    const year = m >= 4 ? startYear : startYear + 1;
    const monthStart = new Date(year, m - 1, 1);
    const monthEnd = new Date(year, m, 0); // last day of month
    return {
      start_date: monthStart.toISOString().split("T")[0],
      end_date: monthEnd.toISOString().split("T")[0],
    };
  }

  return {
    start_date: fyStart.toISOString().split("T")[0],
    end_date: fyEnd.toISOString().split("T")[0],
  };
}

export function useInvoices(filters?: InvoiceFilters, enabled = true) {
  const [items, setItems] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  // Serialize filters to a stable string for useCallback dep
  const filterKey = JSON.stringify(filters || {});

  const fetchInvoices = useCallback(async () => {
    if (!enabled || !localStorage.getItem("gst_access_token")) return;
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      const f = filters || {};

      if (f.search) params.set("search", f.search);
      if (f.businessId && f.businessId !== "all") params.set("business_id", f.businessId);
      if (f.customerId && f.customerId !== "all") params.set("customer_id", f.customerId);
      if (f.typeFilter && f.typeFilter !== "all") {
        params.set("type_of_invoice", f.typeFilter.toLowerCase());
      }

      const dateRange = buildDateRange(f.fyFilter, f.monthFilter);
      if (dateRange.start_date) params.set("start_date", dateRange.start_date);
      if (dateRange.end_date) params.set("end_date", dateRange.end_date);

      // Data-hygiene drill-downs (DataQualityBanner)
      if (f.dups) params.set("dups", "1");
      if (f.empty) params.set("empty", "1");
      if (f.noHsn) params.set("no_hsn", "1");

      // Increase page size to get more results
      params.set("page_size", "50");

      const qs = params.toString();
      const url = `invoices/${qs ? `?${qs}` : ""}`;
      const res = await api.get(url);
      const data = res.data;
      const results = Array.isArray(data) ? data : (data.results || []);
      setItems(results.map(mapDjangoInvoice));
      setNextUrl(parseNextUrl(data.next || null));
      setTotalCount(data.count ?? results.length);
    } catch (e) {
      logger.error("Failed to fetch invoices", e);
    } finally {
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, enabled]);

  const loadMore = useCallback(async () => {
    if (!nextUrl || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const res = await api.get(nextUrl);
      const data = res.data;
      const results = (data.results || []).map(mapDjangoInvoice);
      setItems((prev) => [...prev, ...results]);
      setNextUrl(parseNextUrl(data.next || null));
    } catch (e) {
      logger.error("Failed to load more invoices", e);
    } finally {
      setIsLoadingMore(false);
    }
  }, [nextUrl, isLoadingMore]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const getById = useCallback((id: string | number) => {
    return items.find((it) => String(it.id) === String(id)) || null;
  }, [items]);

  const create = async (data: Partial<Invoice>) => {
    // Single-round-trip create: invoice fields + line items in one POST.
    // Backend (InvoiceViewSet.create) bulk-creates the items + sets the
    // total in the same transaction.
    const apiPayload: Record<string, any> = {};

    if (data.customerId) apiPayload.customer = data.customerId;
    if (data.businessId) apiPayload.business = data.businessId;
    if (data.invoiceNumber) apiPayload.invoice_number = data.invoiceNumber;
    if (data.invoice_date) apiPayload.invoice_date = data.invoice_date;
    if (data.type) apiPayload.type_of_invoice = data.type.toLowerCase();
    if (data.total !== undefined) apiPayload.total_amount = data.total;

    if (data.items && data.items.length > 0) {
      apiPayload.line_items = data.items.map((it: any) => {
        // gstRate is percentage (3), gst_tax_rate is decimal (0.03) — normalize to decimal
        const rawRate = it.gstRate || it.gst_tax_rate || 0;
        const gstDecimal = rawRate > 1 ? rawRate / 100 : rawRate;
        return {
          product_name: it.productName || it.product_name || "",
          hsn_code: it.hsn || it.hsn_code || "",
          gst_tax_rate: gstDecimal,
          quantity: it.qty || it.quantity || 1,
          rate: it.rate || 0,
          unit: it.unit || "pcs",
          cgst: it.cgst || 0,
          sgst: it.sgst || 0,
          igst: it.igst || 0,
          amount: it.amount || 0,
        };
      });
    }

    const res = await api.post<any>("invoices/", apiPayload);
    const createdInvoice = res.data;

    setItems((prev) => [...prev, mapDjangoInvoice(createdInvoice)]);
    return createdInvoice;
  };

  const update = async (id: string | number, updates: Partial<Invoice>) => {
    // Map frontend field names to Django API field names
    const invoiceFields: Record<string, any> = {};
    if (updates.customerId) invoiceFields.customer = updates.customerId;
    if (updates.businessId) invoiceFields.business = updates.businessId;
    if (updates.invoiceNumber) invoiceFields.invoice_number = updates.invoiceNumber;
    if (updates.invoice_date) invoiceFields.invoice_date = updates.invoice_date;
    if (updates.type) invoiceFields.type_of_invoice = updates.type.toLowerCase();

    // Single round-trip: invoice fields + line items in one call.
    // The combined endpoint replaces the old PATCH + update_line_items pair
    // (was 3+s on Neon Singapore, now ~500ms).
    if (updates.items && updates.items.length > 0) {
      const res = await api.post<any>(`invoices/${id}/update_line_items/`, {
        invoice: invoiceFields,
        line_items: updates.items.map((it: any) => {
          const rawRate = it.gstRate || it.gst_tax_rate || 0;
          const gstDecimal = rawRate > 1 ? rawRate / 100 : rawRate;
          return {
            product_name: it.productName || it.product_name || "",
            hsn_code: it.hsn || it.hsn_code || "",
            gst_tax_rate: gstDecimal,
            quantity: it.qty || it.quantity || 1,
            rate: it.rate || 0,
            unit: it.unit || "pcs",
            cgst: it.cgst || 0,
            sgst: it.sgst || 0,
            igst: it.igst || 0,
            amount: it.amount || 0,
          };
        }),
      });
      setItems((prev) => prev.map((it) => (String(it.id) === String(id) ? mapDjangoInvoice(res.data) : it)));
      return;
    }

    // No line items being updated — fall back to plain PATCH on the invoice.
    const res = await api.patch<any>(`invoices/${id}/`, invoiceFields);
    setItems((prev) => prev.map((it) => (String(it.id) === String(id) ? mapDjangoInvoice(res.data) : it)));
  };

  const remove = async (id: string | number) => {
    await api.delete(`invoices/${id}/`);
    setItems((prev) => prev.filter((it) => String(it.id) !== String(id)));
  };

  return { items, create, update, remove, getById, isLoading, isLoadingMore, hasMore: !!nextUrl, totalCount, loadMore, refetch: fetchInvoices };
}

export function useCustomers(fy?: string, businessId?: string, enabled = true) {
  const [items, setItems] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  const fetchCustomers = useCallback(async () => {
    if (!enabled || !localStorage.getItem("gst_access_token")) return;
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (fy && fy !== "all") {
        const { start_date, end_date } = buildDateRange(fy);
        if (start_date) params.set("start_date", start_date);
        if (end_date) params.set("end_date", end_date);
      }
      if (businessId && businessId !== "all") {
        params.set("business_id", businessId);
      }
      const qs = params.toString();
      const res = await api.get(`customers/${qs ? `?${qs}&` : "?"}page_size=1000`);
      const data = res.data;
      const results = Array.isArray(data) ? data : (data.results || []);
      setItems(results);
      setNextUrl(parseNextUrl(data.next || null));
      setTotalCount(data.count ?? results.length);
    } catch (e) {
      logger.error("Failed to fetch", e);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, fy, businessId]);

  const loadMore = useCallback(async () => {
    if (!nextUrl || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const res = await api.get(nextUrl);
      const data = res.data;
      setItems((prev) => [...prev, ...(data.results || [])]);
      setNextUrl(parseNextUrl(data.next || null));
    } catch (e) {
      logger.error("Failed to load more customers", e);
    } finally {
      setIsLoadingMore(false);
    }
  }, [nextUrl, isLoadingMore]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const getById = useCallback((id: string | number) => {
    return items.find((it) => String(it.id) === String(id)) || null;
  }, [items]);

  const create = async (data: Partial<Customer>) => {
    const res = await api.post<Customer>("customers/", data);
    setItems((prev) => [...prev, res.data]);
    return res.data;
  };

  const update = async (id: string | number, updates: Partial<Customer>) => {
    const res = await api.patch<Customer>(`customers/${id}/`, updates);
    setItems((prev) => prev.map((it) => (String(it.id) === String(id) ? res.data : it)));
  };

  const remove = async (id: string | number) => {
    await api.delete(`customers/${id}/`);
    setItems((prev) => prev.filter((it) => String(it.id) !== String(id)));
  };

  return { items, create, update, remove, getById, isLoading, isLoadingMore, hasMore: !!nextUrl, totalCount, loadMore, refetch: fetchCustomers };
}

export function useProducts(fy?: string, businessId?: string, enabled = true) {
  const [items, setItems] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  const fetchProducts = useCallback(async () => {
    if (!enabled || !localStorage.getItem("gst_access_token")) return;
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (fy && fy !== "all") {
        const { start_date, end_date } = buildDateRange(fy);
        if (start_date) params.set("start_date", start_date);
        if (end_date) params.set("end_date", end_date);
      }
      if (businessId && businessId !== "all") {
        params.set("business_id", businessId);
      }
      const qs = params.toString();
      const res = await api.get(`products/${qs ? `?${qs}&` : "?"}page_size=1000`);
      const data = res.data;
      const results = Array.isArray(data) ? data : (data.results || []);
      setItems(results.map(mapDjangoProduct));
      setNextUrl(parseNextUrl(data.next || null));
      setTotalCount(data.count ?? results.length);
    } catch (e) {
      logger.error("Failed to fetch products", e);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, fy, businessId]);

  const loadMore = useCallback(async () => {
    if (!nextUrl || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const res = await api.get(nextUrl);
      const data = res.data;
      const results = (data.results || []).map(mapDjangoProduct);
      setItems((prev) => [...prev, ...results]);
      setNextUrl(parseNextUrl(data.next || null));
    } catch (e) {
      logger.error("Failed to load more products", e);
    } finally {
      setIsLoadingMore(false);
    }
  }, [nextUrl, isLoadingMore]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const getById = useCallback((id: string | number) => {
    return items.find((it) => String(it.id) === String(id)) || null;
  }, [items]);

  const create = async (data: Partial<Product>) => {
    const payload = { ...data, hsn_code: data.hsn, gst_tax_rate: (data.gstRate || 0) / 100 };
    const res = await api.post<any>("products/", payload);
    setItems((prev) => [...prev, mapDjangoProduct(res.data)]);
    return res.data;
  };

  const update = async (id: string | number, updates: Partial<Product>) => {
    const payload = { ...updates };
    if (payload.hsn !== undefined) { (payload as any).hsn_code = payload.hsn; delete payload.hsn; }
    if (payload.gstRate !== undefined) { (payload as any).gst_tax_rate = payload.gstRate / 100; delete payload.gstRate; }
    
    const res = await api.patch<any>(`products/${id}/`, payload);
    setItems((prev) => prev.map((it) => (String(it.id) === String(id) ? mapDjangoProduct(res.data) : it)));
  };

  const remove = async (id: string | number) => {
    await api.delete(`products/${id}/`);
    setItems((prev) => prev.filter((it) => String(it.id) !== String(id)));
  };

  return { items, create, update, remove, getById, isLoading, isLoadingMore, hasMore: !!nextUrl, totalCount, loadMore, refetch: fetchProducts };
}

export function useProduct(id: string | undefined) {
  const [item, setItem] = useState<Product | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProduct = useCallback(async () => {
    if (!id || !localStorage.getItem("gst_access_token")) return;
    setIsLoading(true);
    try {
      const res = await api.get(`products/${id}/`);
      setItem(mapDjangoProduct(res.data));
    } catch (e) {
      logger.error("Failed to fetch product", e);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchProduct();
  }, [fetchProduct]);

  return { item, isLoading, refetch: fetchProduct };
}

export function useCustomer(id: string | undefined) {
  const [item, setItem] = useState<Customer | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchCustomer = useCallback(async () => {
    if (!id || !localStorage.getItem("gst_access_token")) return;
    setIsLoading(true);
    try {
      const res = await api.get(`customers/${id}/`);
      setItem(res.data);
    } catch (e) {
      logger.error("Failed to fetch customer", e);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchCustomer();
  }, [fetchCustomer]);

  return { item, isLoading, refetch: fetchCustomer };
}

/**
 * Fetch a single invoice by either internal id OR invoice_number.
 *
 * - Numeric slugs (`/billing/invoice/764`) hit the `retrieve` endpoint directly.
 * - Non-numeric slugs (`/billing/invoice/040`, or URL-decoded
 *   `SGJ/2024-25/108`) fall back to a list-endpoint lookup by
 *   `invoice_number`. If multiple invoices share a number across businesses
 *   we pick the first match (the URL is ambiguous; for a strict canonical
 *   resolution callers should keep the id-based URL).
 *
 * Lets us swap the internal id for a human-readable number in the URL bar
 * without breaking refresh / share / bookmark.
 */
export function useInvoice(slug: string | undefined) {
  const [item, setItem] = useState<Invoice | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchInvoice = useCallback(async () => {
    if (!slug || !localStorage.getItem("gst_access_token")) return;
    setIsLoading(true);
    try {
      if (/^\d+$/.test(slug)) {
        // All-digit slug → internal pk path. Keeps the old behaviour intact.
        const res = await api.get(`invoices/${slug}/`);
        setItem(mapDjangoInvoice(res.data));
      } else {
        // Anything else → treat as invoice_number and look up via list.
        // Backend uses `__icontains` so "040" would also surface "0401" —
        // filter to exact match client-side before picking.
        const target = decodeURIComponent(slug);
        const params = new URLSearchParams();
        params.set("invoice_number", target);
        params.set("page_size", "10");
        const list = await api.get<any>(`invoices/?${params.toString()}`);
        const results = (list.data?.results || (Array.isArray(list.data) ? list.data : []))
          .filter((r: any) => r.invoice_number === target);
        if (results.length === 0) {
          setItem(null);
        } else {
          // Hydrate the full record via /invoices/{pk}/ since list responses
          // often elide line items. If multiple invoices share the number
          // across businesses (common — "1" is everyone's first invoice),
          // we pick the first; for unambiguous deep-links callers should
          // use the id-based URL.
          const full = await api.get(`invoices/${results[0].id}/`);
          setItem(mapDjangoInvoice(full.data));
        }
      }
    } catch (e) {
      logger.error("Failed to fetch invoice", e);
    } finally {
      setIsLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    fetchInvoice();
  }, [fetchInvoice]);

  return { item, isLoading, refetch: fetchInvoice };
}

export function useDashboardStats(filters?: InvoiceFilters, enabled = true) {
  const [data, setData] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    if (!enabled || !localStorage.getItem("gst_access_token")) return;
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      // Explicit date range takes priority over FY filter
      if (filters?.startDate && filters?.endDate) {
        params.set("start_date", filters.startDate);
        params.set("end_date", filters.endDate);
      } else if (filters?.fyFilter && filters.fyFilter !== "all") {
        const { start_date, end_date } = buildDateRange(filters.fyFilter);
        if (start_date) params.set("start_date", start_date);
        if (end_date) params.set("end_date", end_date);
      }
      if (filters?.businessId && filters.businessId !== "all") {
        params.set("business_id", filters.businessId);
      }
      if (filters?.customerId && filters.customerId !== "all") {
        params.set("customer_id", filters.customerId);
      }
      if (filters?.typeFilter && filters.typeFilter !== "all") {
        params.set("type_of_invoice", filters.typeFilter.toLowerCase());
      }
      if (filters?.monthFilter && filters.monthFilter !== "all") {
        params.set("month", filters.monthFilter);
      }
      if (filters?.search) {
        params.set("search", filters.search);
      }

      const qs = params.toString();
      const res = await api.get<DashboardStats>(`invoices/stats/${qs ? `?${qs}` : ""}`);
      setData(res.data);
    } catch (e) {
      logger.error("Failed to fetch dashboard stats", e);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, JSON.stringify(filters)]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return { data, isLoading, refetch: fetchStats };
}

export function useBusiness(id: string | undefined) {
  const [item, setItem] = useState<Business | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchBusiness = useCallback(async () => {
    if (!id || !localStorage.getItem("gst_access_token")) return;
    setIsLoading(true);
    try {
      const res = await api.get(`businesses/${id}/`);
      setItem(res.data);
    } catch (e) {
      logger.error("Failed to fetch business", e);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchBusiness();
  }, [fetchBusiness]);

  return { item, isLoading, refetch: fetchBusiness };
}

export function useBusinesses(fy?: string, enabled = true) {
  const [items, setItems] = useState<Business[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  const fetchBusinesses = useCallback(async () => {
    if (!enabled || !localStorage.getItem("gst_access_token")) return;
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (fy && fy !== "all") {
        const { start_date, end_date } = buildDateRange(fy);
        if (start_date) params.set("start_date", start_date);
        if (end_date) params.set("end_date", end_date);
      }
      const qs = params.toString();
      const res = await api.get(`businesses/${qs ? `?${qs}` : ""}`);
      const data = res.data;
      const results = Array.isArray(data) ? data : (data.results || []);
      setItems(results);
      setNextUrl(parseNextUrl(data.next || null));
      setTotalCount(data.count ?? results.length);
    } catch (e) {
      logger.error("Failed to fetch", e);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, fy]);

  const loadMore = useCallback(async () => {
    if (!nextUrl || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const res = await api.get(nextUrl);
      const data = res.data;
      setItems((prev) => [...prev, ...(data.results || [])]);
      setNextUrl(parseNextUrl(data.next || null));
    } catch (e) {
      logger.error("Failed to load more businesses", e);
    } finally {
      setIsLoadingMore(false);
    }
  }, [nextUrl, isLoadingMore]);

  useEffect(() => {
    fetchBusinesses();
  }, [fetchBusinesses]);

  const getById = useCallback((id: string | number) => {
    return items.find((it) => String(it.id) === String(id)) || null;
  }, [items]);

  const create = async (data: Partial<Business> | FormData) => {
    const res = await api.post<Business>("businesses/", data);
    setItems((prev) => [...prev, res.data]);
    return res.data;
  };

  const update = async (id: string | number, updates: Partial<Business> | FormData) => {
    const res = await api.patch<Business>(`businesses/${id}/`, updates);
    setItems((prev) => prev.map((it) => (String(it.id) === String(id) ? res.data : it)));
  };

  const remove = async (id: string | number) => {
    await api.delete(`businesses/${id}/`);
    setItems((prev) => prev.filter((it) => String(it.id) !== String(id)));
  };

  return { items, create, update, remove, getById, isLoading, isLoadingMore, hasMore: !!nextUrl, totalCount, loadMore, refetch: fetchBusinesses };
}

export function generateId(prefix: string = "") {
  return prefix + crypto.randomUUID().slice(0, 8);
}
