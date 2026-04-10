import { useState, useEffect, useCallback } from "react";
import api from "@/utils/api";

export interface AuditLogEntry {
  id: string;
  action: "created" | "updated" | "deleted" | "imported" | "printed" | "exported" | "merged";
  entity: "invoice" | "customer" | "product" | "business";
  entityId: string;
  entityName: string;
  user: string;
  details?: string;
  changes?: Record<string, { old: string | null; new: string | null }>;
  timestamp: string;
  canUndo: boolean;
}

interface RawEntry {
  id: number;
  action: string;
  entity: string;
  entity_id: number;
  entity_name: string;
  user_name: string;
  details: string;
  changes: Record<string, { old: string | null; new: string | null }> | null;
  timestamp: string;
  can_undo: boolean;
}

function mapEntry(raw: RawEntry): AuditLogEntry {
  return {
    id: String(raw.id),
    action: raw.action as AuditLogEntry["action"],
    entity: raw.entity as AuditLogEntry["entity"],
    entityId: String(raw.entity_id),
    entityName: raw.entity_name,
    user: raw.user_name,
    details: raw.details || undefined,
    changes: raw.changes || undefined,
    timestamp: raw.timestamp,
    canUndo: raw.can_undo,
  };
}

interface Filters {
  search?: string;
  action?: string;
  entity?: string;
}

export function useAuditLog(filters?: Filters, enabled = true) {
  const [items, setItems] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  const filterKey = JSON.stringify(filters || {});

  const fetchLogs = useCallback(async () => {
    if (!enabled || !localStorage.getItem("gst_access_token")) return;
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      const f = filters || {};
      if (f.search) params.set("search", f.search);
      if (f.action && f.action !== "all") params.set("action", f.action);
      if (f.entity && f.entity !== "all") params.set("entity", f.entity);
      params.set("page_size", "30");

      const res = await api.get<any>(`audit-logs/?${params.toString()}`);
      const data = res.data;
      const results = Array.isArray(data) ? data : (data.results || []);
      setItems(results.map(mapEntry));
      setTotalCount(data.count ?? results.length);

      // Parse next page URL
      if (data.next) {
        try {
          const u = new URL(data.next);
          setNextPage(`audit-logs/${u.search}`);
        } catch {
          setNextPage(null);
        }
      } else {
        setNextPage(null);
      }
    } catch (e) {
      console.error("Failed to fetch audit logs", e);
    } finally {
      setIsLoading(false);
    }
  }, [filterKey, enabled]);

  const loadMore = useCallback(async () => {
    if (!nextPage || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const res = await api.get<any>(nextPage);
      const data = res.data;
      const results = (data.results || []).map(mapEntry);
      setItems(prev => [...prev, ...results]);
      if (data.next) {
        try {
          const u = new URL(data.next);
          setNextPage(`audit-logs/${u.search}`);
        } catch {
          setNextPage(null);
        }
      } else {
        setNextPage(null);
      }
    } catch (e) {
      console.error("Failed to load more audit logs", e);
    } finally {
      setIsLoadingMore(false);
    }
  }, [nextPage, isLoadingMore]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const undoEntry = useCallback(async (entryId: string) => {
    const res = await api.post<any>(`audit-logs/${entryId}/undo/`);
    await fetchLogs(); // refresh the list
    return res.data;
  }, [fetchLogs]);

  return {
    items,
    isLoading,
    isLoadingMore,
    hasMore: !!nextPage,
    totalCount,
    loadMore,
    refetch: fetchLogs,
    undoEntry,
  };
}
