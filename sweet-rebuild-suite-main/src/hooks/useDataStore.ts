import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import api from "@/utils/api";
import { logger } from "@/utils/logger";
import { Invoice, Product } from "@/utils/mockData";

export interface Business {
  id: string;
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
  id: string;
  name: string;
  address?: string | null;
  gst_number?: string | null;
  pan_number?: string | null;
  mobile_number?: string | null;
  email?: string | null;
  state_name?: string | null;
  created_at?: string;
  updated_at?: string;
  businesses?: string[];
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

export interface InvoiceFilters {
  search?: string;
  businessId?: string;
  customerId?: string;
  typeFilter?: string;
  fyFilter?: string;
  monthFilter?: string;
  startDate?: string;
  endDate?: string;
}

function parseNextUrl(absoluteUrl: string | null): string | null {
  if (!absoluteUrl) return null;
  try {
    const u = new URL(absoluteUrl);
    return u.pathname.replace(/^\/api\//, '') + u.search;
  } catch {
    return null;
  }
}

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
  
  const itemBasedTax = totalCGST + totalSGST + totalIGST;
  const totalTax = itemBasedTax > 0 ? itemBasedTax : (parseFloat(inv.total_tax) || 0);
  
  if (itemBasedTax === 0 && totalTax > 0) {
    const isIGST = inv.is_igst_applicable || false;
    if (isIGST) {
      totalIGST = totalTax;
    } else {
      totalCGST = totalTax / 2;
      totalSGST = totalTax / 2;
    }
  }

  const apiTotal = parseFloat(inv.total_amount) || 0;
  const calculatedTotal = subtotal + totalTax;
  const rawTotal = apiTotal > 0 ? apiTotal : calculatedTotal;
  const roundedTotal = Math.round(rawTotal);
  const roundedOff = +(roundedTotal - rawTotal).toFixed(2);

  if (subtotal === 0 && apiTotal > 0) {
    subtotal = apiTotal - totalTax;
  }

  return {
    id: String(inv.id),
    invoiceNumber: inv.invoice_number || "",
    invoice_date: inv.invoice_date || "",
    customerId: String(typeof inv.customer === 'object' ? inv.customer?.id : (inv.customer || "")),
    customerName: inv.customer_name || (typeof inv.customer === 'object' ? inv.customer?.name : ""),
    businessId: String(typeof inv.business === 'object' ? inv.business?.id : (inv.business || "")),
    businessName: inv.business_name || (typeof inv.business === 'object' ? inv.business?.name : ""),
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

function buildDateRange(fyFilter?: string, monthFilter?: string): { start_date?: string; end_date?: string } {
  if (!fyFilter || fyFilter === "all") return {};

  const [startYearStr] = fyFilter.split("-");
  const startYear = parseInt(startYearStr);
  if (isNaN(startYear)) return {};

  const fyStart = new Date(startYear, 3, 1);
  const fyEnd = new Date(startYear + 1, 2, 31);

  if (monthFilter && monthFilter !== "all") {
    const m = parseInt(monthFilter);
    const year = m >= 4 ? startYear : startYear + 1;
    const monthStart = new Date(year, m - 1, 1);
    const monthEnd = new Date(year, m, 0);
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
  const queryClient = useQueryClient();
  const filterKey = JSON.stringify(filters || {});

  const {
    data,
    isLoading,
    isFetchingNextPage: isLoadingMore,
    hasNextPage: hasMore,
    fetchNextPage: loadMore,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['invoices', filterKey],
    queryFn: async ({ pageParam = null }) => {
      let url = `invoices/`;
      if (pageParam) {
        url = pageParam;
      } else {
        const params = new URLSearchParams();
        const f = filters || {};
        if (f.search) params.set("search", f.search);
        if (f.businessId && f.businessId !== "all") params.set("business_id", f.businessId);
        if (f.customerId && f.customerId !== "all") params.set("customer_id", f.customerId);
        if (f.typeFilter && f.typeFilter !== "all") params.set("type_of_invoice", f.typeFilter.toLowerCase());
        const dateRange = buildDateRange(f.fyFilter, f.monthFilter);
        if (dateRange.start_date) params.set("start_date", dateRange.start_date);
        if (dateRange.end_date) params.set("end_date", dateRange.end_date);
        params.set("page_size", "50");
        const qs = params.toString();
        url += qs ? `?${qs}` : "";
      }
      
      const res = await api.get(url);
      const resData = res.data;
      const results = Array.isArray(resData) ? resData : (resData.results || []);
      return {
        results: results.map(mapDjangoInvoice),
        next: parseNextUrl(resData.next || null),
        count: resData.count ?? results.length,
      };
    },
    getNextPageParam: (lastPage) => lastPage.next,
    initialPageParam: null as string | null,
    enabled: enabled && !!localStorage.getItem("gst_access_token"),
  });

  const items = data?.pages.flatMap((page) => page.results) || [];
  const totalCount = data?.pages[0]?.count || 0;

  const getById = useCallback((id: string | number) => {
    return items.find((it) => String(it.id) === String(id)) || null;
  }, [items]);

  const { mutateAsync: create } = useMutation({
    mutationFn: async (invoiceData: Partial<Invoice>) => {
      const apiPayload: Record<string, any> = {};
      if (invoiceData.customerId) apiPayload.customer = invoiceData.customerId;
      if (invoiceData.businessId) apiPayload.business = invoiceData.businessId;
      if (invoiceData.invoiceNumber) apiPayload.invoice_number = invoiceData.invoiceNumber;
      if (invoiceData.invoice_date) apiPayload.invoice_date = invoiceData.invoice_date;
      if (invoiceData.type) apiPayload.type_of_invoice = invoiceData.type.toLowerCase();
      if (invoiceData.total !== undefined) apiPayload.total_amount = invoiceData.total;

      const res = await api.post<any>("invoices/", apiPayload);
      const createdInvoice = res.data;

      if (invoiceData.items && invoiceData.items.length > 0) {
        try {
          await api.post(`invoices/${createdInvoice.id}/update_line_items/`, {
            line_items: invoiceData.items.map((it: any) => {
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
        } catch (e) {
          logger.warn("Line items creation endpoint not available, skipping", e);
        }
      }
      return createdInvoice;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardStats'] });
    },
  });

  const { mutateAsync: updateMut } = useMutation({
    mutationFn: async ({ id, updates }: { id: string | number; updates: Partial<Invoice> }) => {
      const apiPayload: Record<string, any> = {};
      if (updates.customerId) apiPayload.customer = updates.customerId;
      if (updates.businessId) apiPayload.business = updates.businessId;
      if (updates.invoiceNumber) apiPayload.invoice_number = updates.invoiceNumber;
      if (updates.invoice_date) apiPayload.invoice_date = updates.invoice_date;
      if (updates.type) apiPayload.type_of_invoice = updates.type.toLowerCase();
      if (updates.total !== undefined) apiPayload.total_amount = updates.total;

      const res = await api.patch<any>(`invoices/${id}/`, apiPayload);

      if (updates.items && updates.items.length > 0) {
        try {
          await api.post(`invoices/${id}/update_line_items/`, {
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
        } catch (e) {
          logger.warn("Line items update endpoint not available, skipping", e);
        }
      }
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardStats'] });
    },
  });

  const { mutateAsync: remove } = useMutation({
    mutationFn: async (id: string | number) => {
      await api.delete(`invoices/${id}/`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['dashboardStats'] });
    },
  });

  const update = async (id: string | number, updates: Partial<Invoice>) => updateMut({ id, updates });

  return { items, create, update, remove, getById, isLoading, isLoadingMore, hasMore: !!hasMore, totalCount, loadMore, refetch };
}

export function useCustomers(fy?: string, businessId?: string, enabled = true) {
  const queryClient = useQueryClient();
  const filterKey = JSON.stringify({ fy, businessId });

  const {
    data,
    isLoading,
    isFetchingNextPage: isLoadingMore,
    hasNextPage: hasMore,
    fetchNextPage: loadMore,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['customers', filterKey],
    queryFn: async ({ pageParam = null }) => {
      let url = `customers/`;
      if (pageParam) {
        url = pageParam;
      } else {
        const params = new URLSearchParams();
        if (fy && fy !== "all") {
          const { start_date, end_date } = buildDateRange(fy);
          if (start_date) params.set("start_date", start_date);
          if (end_date) params.set("end_date", end_date);
        }
        if (businessId && businessId !== "all") {
          params.set("business_id", businessId);
        }
        params.set("page_size", "1000");
        const qs = params.toString();
        url += qs ? `?${qs}` : "";
      }
      const res = await api.get(url);
      const resData = res.data;
      const results = Array.isArray(resData) ? resData : (resData.results || []);
      return {
        results,
        next: parseNextUrl(resData.next || null),
        count: resData.count ?? results.length,
      };
    },
    getNextPageParam: (lastPage) => lastPage.next,
    initialPageParam: null as string | null,
    enabled: enabled && !!localStorage.getItem("gst_access_token"),
  });

  const items = data?.pages.flatMap((page) => page.results) || [];
  const totalCount = data?.pages[0]?.count || 0;

  const getById = useCallback((id: string | number) => {
    return items.find((it) => String(it.id) === String(id)) || null;
  }, [items]);

  const { mutateAsync: create } = useMutation({
    mutationFn: async (data: Partial<Customer>) => {
      const res = await api.post<Customer>("customers/", data);
      return res.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['customers'] }),
  });

  const { mutateAsync: updateMut } = useMutation({
    mutationFn: async ({ id, updates }: { id: string | number; updates: Partial<Customer> }) => {
      const res = await api.patch<Customer>(`customers/${id}/`, updates);
      return res.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['customers'] }),
  });

  const { mutateAsync: remove } = useMutation({
    mutationFn: async (id: string | number) => {
      await api.delete(`customers/${id}/`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['customers'] }),
  });

  const update = async (id: string | number, updates: Partial<Customer>) => updateMut({ id, updates });

  return { items, create, update, remove, getById, isLoading, isLoadingMore, hasMore: !!hasMore, totalCount, loadMore, refetch };
}

export function useProducts(fy?: string, businessId?: string, enabled = true) {
  const queryClient = useQueryClient();
  const filterKey = JSON.stringify({ fy, businessId });

  const {
    data,
    isLoading,
    isFetchingNextPage: isLoadingMore,
    hasNextPage: hasMore,
    fetchNextPage: loadMore,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['products', filterKey],
    queryFn: async ({ pageParam = null }) => {
      let url = `products/`;
      if (pageParam) {
        url = pageParam;
      } else {
        const params = new URLSearchParams();
        if (fy && fy !== "all") {
          const { start_date, end_date } = buildDateRange(fy);
          if (start_date) params.set("start_date", start_date);
          if (end_date) params.set("end_date", end_date);
        }
        if (businessId && businessId !== "all") {
          params.set("business_id", businessId);
        }
        params.set("page_size", "1000");
        const qs = params.toString();
        url += qs ? `?${qs}` : "";
      }
      const res = await api.get(url);
      const resData = res.data;
      const results = Array.isArray(resData) ? resData : (resData.results || []);
      return {
        results: results.map(mapDjangoProduct),
        next: parseNextUrl(resData.next || null),
        count: resData.count ?? results.length,
      };
    },
    getNextPageParam: (lastPage) => lastPage.next,
    initialPageParam: null as string | null,
    enabled: enabled && !!localStorage.getItem("gst_access_token"),
  });

  const items = data?.pages.flatMap((page) => page.results) || [];
  const totalCount = data?.pages[0]?.count || 0;

  const getById = useCallback((id: string | number) => {
    return items.find((it) => String(it.id) === String(id)) || null;
  }, [items]);

  const { mutateAsync: create } = useMutation({
    mutationFn: async (data: Partial<Product>) => {
      const payload = { ...data, hsn_code: data.hsn, gst_tax_rate: (data.gstRate || 0) / 100 };
      const res = await api.post<any>("products/", payload);
      return res.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
  });

  const { mutateAsync: updateMut } = useMutation({
    mutationFn: async ({ id, updates }: { id: string | number; updates: Partial<Product> }) => {
      const payload = { ...updates };
      if (payload.hsn !== undefined) { (payload as any).hsn_code = payload.hsn; delete payload.hsn; }
      if (payload.gstRate !== undefined) { (payload as any).gst_tax_rate = payload.gstRate / 100; delete payload.gstRate; }
      const res = await api.patch<any>(`products/${id}/`, payload);
      return res.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
  });

  const { mutateAsync: remove } = useMutation({
    mutationFn: async (id: string | number) => {
      await api.delete(`products/${id}/`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
  });

  const update = async (id: string | number, updates: Partial<Product>) => updateMut({ id, updates });

  return { items, create, update, remove, getById, isLoading, isLoadingMore, hasMore: !!hasMore, totalCount, loadMore, refetch };
}

export function useProduct(id: string | undefined) {
  const { data: item, isLoading, refetch } = useQuery({
    queryKey: ['product', id],
    queryFn: async () => {
      const res = await api.get(`products/${id}/`);
      return mapDjangoProduct(res.data);
    },
    enabled: !!id && !!localStorage.getItem("gst_access_token"),
  });
  return { item, isLoading, refetch };
}

export function useCustomer(id: string | undefined) {
  const { data: item, isLoading, refetch } = useQuery({
    queryKey: ['customer', id],
    queryFn: async () => {
      const res = await api.get(`customers/${id}/`);
      return res.data;
    },
    enabled: !!id && !!localStorage.getItem("gst_access_token"),
  });
  return { item, isLoading, refetch };
}

export function useInvoice(id: string | undefined) {
  const { data: item, isLoading, refetch } = useQuery({
    queryKey: ['invoice', id],
    queryFn: async () => {
      const res = await api.get(`invoices/${id}/`);
      return mapDjangoInvoice(res.data);
    },
    enabled: !!id && !!localStorage.getItem("gst_access_token"),
  });
  return { item, isLoading, refetch };
}

export function useDashboardStats(filters?: InvoiceFilters, enabled = true) {
  const filterKey = JSON.stringify(filters || {});
  
  const { data, isLoading, refetch } = useQuery<DashboardStats>({
    queryKey: ['dashboardStats', filterKey],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.startDate && filters?.endDate) {
        params.set("start_date", filters.startDate);
        params.set("end_date", filters.endDate);
      } else if (filters?.fyFilter && filters.fyFilter !== "all") {
        const { start_date, end_date } = buildDateRange(filters.fyFilter);
        if (start_date) params.set("start_date", start_date);
        if (end_date) params.set("end_date", end_date);
      }
      if (filters?.businessId && filters.businessId !== "all") params.set("business_id", filters.businessId);
      if (filters?.customerId && filters.customerId !== "all") params.set("customer_id", filters.customerId);
      if (filters?.typeFilter && filters.typeFilter !== "all") params.set("type_of_invoice", filters.typeFilter.toLowerCase());
      if (filters?.monthFilter && filters.monthFilter !== "all") params.set("month", filters.monthFilter);
      if (filters?.search) params.set("search", filters.search);

      const qs = params.toString();
      const res = await api.get<DashboardStats>(`invoices/stats/${qs ? `?${qs}` : ""}`);
      return res.data;
    },
    enabled: enabled && !!localStorage.getItem("gst_access_token"),
  });
  return { data, isLoading, refetch };
}

export function useBusiness(id: string | undefined) {
  const { data: item, isLoading, refetch } = useQuery({
    queryKey: ['business', id],
    queryFn: async () => {
      const res = await api.get(`businesses/${id}/`);
      return res.data;
    },
    enabled: !!id && !!localStorage.getItem("gst_access_token"),
  });
  return { item, isLoading, refetch };
}

export function useBusinesses(fy?: string, enabled = true) {
  const queryClient = useQueryClient();
  const filterKey = JSON.stringify({ fy });

  const {
    data,
    isLoading,
    isFetchingNextPage: isLoadingMore,
    hasNextPage: hasMore,
    fetchNextPage: loadMore,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['businesses', filterKey],
    queryFn: async ({ pageParam = null }) => {
      let url = `businesses/`;
      if (pageParam) {
        url = pageParam;
      } else {
        const params = new URLSearchParams();
        if (fy && fy !== "all") {
          const { start_date, end_date } = buildDateRange(fy);
          if (start_date) params.set("start_date", start_date);
          if (end_date) params.set("end_date", end_date);
        }
        const qs = params.toString();
        url += qs ? `?${qs}` : "";
      }
      const res = await api.get(url);
      const resData = res.data;
      const results = Array.isArray(resData) ? resData : (resData.results || []);
      return {
        results,
        next: parseNextUrl(resData.next || null),
        count: resData.count ?? results.length,
      };
    },
    getNextPageParam: (lastPage) => lastPage.next,
    initialPageParam: null as string | null,
    enabled: enabled && !!localStorage.getItem("gst_access_token"),
  });

  const items = data?.pages.flatMap((page) => page.results) || [];
  const totalCount = data?.pages[0]?.count || 0;

  const getById = useCallback((id: string | number) => {
    return items.find((it) => String(it.id) === String(id)) || null;
  }, [items]);

  const { mutateAsync: create } = useMutation({
    mutationFn: async (data: Partial<Business> | FormData) => {
      const res = await api.post<Business>("businesses/", data);
      return res.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['businesses'] }),
  });

  const { mutateAsync: updateMut } = useMutation({
    mutationFn: async ({ id, updates }: { id: string | number; updates: Partial<Business> | FormData }) => {
      const res = await api.patch<Business>(`businesses/${id}/`, updates);
      return res.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['businesses'] }),
  });

  const { mutateAsync: remove } = useMutation({
    mutationFn: async (id: string | number) => {
      await api.delete(`businesses/${id}/`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['businesses'] }),
  });

  const update = async (id: string | number, updates: Partial<Business> | FormData) => updateMut({ id, updates });

  return { items, create, update, remove, getById, isLoading, isLoadingMore, hasMore: !!hasMore, totalCount, loadMore, refetch };
}

export function generateId(prefix: string = "") {
  return prefix + crypto.randomUUID().slice(0, 8);
}
