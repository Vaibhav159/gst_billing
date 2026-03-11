import { useState, useEffect, useCallback } from "react";
import api from "@/lib/api";

import { Invoice, Product } from "@/lib/mockData";

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
  email?: string | null;
  created_at?: string;
  updated_at?: string;
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

function mapDjangoInvoice(inv: any): Invoice {
  const items = (inv.line_items || []).map((item: any) => ({
    productId: String(item.product || item.id || ""),
    productName: item.product_name || item.item_name || "",
    hsn: item.hsn_code || "",
    gstRate: Math.round(parseFloat(item.gst_tax_rate) * 100) || 0,
    qty: parseFloat(item.quantity) || 0,
    rate: parseFloat(item.rate) || 0,
    amount: parseFloat(item.amount) || 0,
    cgst: parseFloat(item.cgst) || 0,
    sgst: parseFloat(item.sgst) || 0,
    igst: parseFloat(item.igst) || 0,
  }));

  const subtotal = items.reduce((sum: number, it: any) => sum + (it.qty * it.rate), 0);
  const totalCGST = items.reduce((sum: number, it: any) => sum + it.cgst, 0);
  const totalSGST = items.reduce((sum: number, it: any) => sum + it.sgst, 0);
  const totalIGST = items.reduce((sum: number, it: any) => sum + it.igst, 0);
  const totalTax = totalCGST + totalSGST + totalIGST;

  return {
    id: String(inv.id),
    invoiceNumber: inv.invoice_number || "",
    invoice_date: inv.invoice_date || "",
    customerId: String(inv.customer || ""),
    customerName: inv.customer_name || "",
    businessId: String(inv.business || ""),
    businessName: inv.business_name || "",
    type: inv.type_of_invoice || "OUTWARD",
    isIGST: inv.is_igst_applicable || false,
    items,
    subtotal,
    totalCGST,
    totalSGST,
    totalIGST,
    totalTax,
    total: parseFloat(inv.total_amount) || 0,
    financialYear: getFinancialYear(inv.invoice_date),
    createdAt: inv.created_at || "",
    updatedAt: inv.updated_at || "",
  };
}

function mapDjangoProduct(prod: any): Product {
  return {
    id: String(prod.id),
    name: prod.name || "",
    hsn: prod.hsn_code || "",
    gstRate: Math.round(parseFloat(prod.gst_tax_rate) * 100) || 0,
    description: prod.description || "",
    createdAt: prod.created_at || "",
  };
}

export function useInvoices() {
  const [items, setItems] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchInvoices = useCallback(async () => {
    if (!localStorage.getItem("gst_access_token")) return;
    setIsLoading(true);
    try {
      const res = await api.get<any>("invoices/");
      const data = res.data as any;
      const results = data.results || data;
      setItems(results.map(mapDjangoInvoice));
    } catch (e) {
      console.error("Failed to fetch invoices", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const getById = useCallback((id: string | number) => {
    return items.find((it) => String(it.id) === String(id)) || null;
  }, [items]);

  const create = async (data: Partial<Invoice>) => {
    const res = await api.post<any>("invoices/", data);
    setItems((prev) => [...prev, mapDjangoInvoice(res.data)]);
    return res.data;
  };

  const update = async (id: string | number, updates: Partial<Invoice>) => {
    const res = await api.patch<any>(`invoices/${id}/`, updates);
    setItems((prev) => prev.map((it) => (String(it.id) === String(id) ? mapDjangoInvoice(res.data) : it)));
  };

  const remove = async (id: string | number) => {
    await api.delete(`invoices/${id}/`);
    setItems((prev) => prev.filter((it) => String(it.id) !== String(id)));
  };

  return { items, create, update, remove, getById, isLoading, refetch: fetchInvoices };
}

// Custom Hook for API-driven Customers
export function useCustomers() {
  const [items, setItems] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchCustomers = useCallback(async () => {
    if (!localStorage.getItem("gst_access_token")) return;
    setIsLoading(true);
    try {
      const res = await api.get<Customer[]>("customers/");
      const data = res.data as any;
      setItems(data.results || data);
    } catch (e) {
      console.error("Failed to fetch", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

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

  return { items, create, update, remove, getById, isLoading, refetch: fetchCustomers };
}

export function useProducts() {
  const [items, setItems] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProducts = useCallback(async () => {
    if (!localStorage.getItem("gst_access_token")) return;
    setIsLoading(true);
    try {
      const res = await api.get<any>("products/");
      const data = res.data as any;
      const results = data.results || data;
      setItems(results.map(mapDjangoProduct));
    } catch (e) {
      console.error("Failed to fetch products", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const getById = useCallback((id: string | number) => {
    return items.find((it) => String(it.id) === String(id)) || null;
  }, [items]);

  const create = async (data: Partial<Product>) => {
    // When saving back to DRF, we'd need to reverse-map, but we can just let DRF defaults figure it out or map if needed
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

  return { items, create, update, remove, getById, isLoading, refetch: fetchProducts };
}

export function useProduct(id: string | undefined) {
  const [item, setItem] = useState<Product | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProduct = useCallback(async () => {
    if (!id || !localStorage.getItem("gst_access_token")) return;
    setIsLoading(true);
    try {
      const res = await api.get<any>(`products/${id}/`);
      setItem(mapDjangoProduct(res.data));
    } catch (e) {
      console.error("Failed to fetch product", e);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchProduct();
  }, [fetchProduct]);

  return { item, isLoading, refetch: fetchProduct };
}

// Custom Hook for API-driven Businesses
export function useBusinesses() {
  const [items, setItems] = useState<Business[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchBusinesses = useCallback(async () => {
    if (!localStorage.getItem("gst_access_token")) return;
    setIsLoading(true);
    try {
      const res = await api.get<Business[]>("businesses/");
      const data = res.data as any;
      setItems(data.results || data);
    } catch (e) {
      console.error("Failed to fetch", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBusinesses();
  }, [fetchBusinesses]);

  const getById = useCallback((id: string | number) => {
    return items.find((it) => String(it.id) === String(id)) || null;
  }, [items]);

  const create = async (data: Partial<Business>) => {
    const res = await api.post<Business>("businesses/", data);
    setItems((prev) => [...prev, res.data]);
    return res.data;
  };

  const update = async (id: string | number, updates: Partial<Business>) => {
    const res = await api.patch<Business>(`businesses/${id}/`, updates);
    setItems((prev) => prev.map((it) => (String(it.id) === String(id) ? res.data : it)));
  };

  const remove = async (id: string | number) => {
    await api.delete(`businesses/${id}/`);
    setItems((prev) => prev.filter((it) => String(it.id) !== String(id)));
  };

  return { items, create, update, remove, getById, isLoading, refetch: fetchBusinesses };
}

export function generateId(prefix: string = "") {
  return prefix + crypto.randomUUID().slice(0, 8);
}
