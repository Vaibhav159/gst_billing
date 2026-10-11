import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { api } from "./client";
import type { Person } from "@/core/sales/types";

export type BackupSummary = {
  counts: Record<"firms" | "customers" | "suppliers" | "products" | "sales" | "cancelled" | "purchases" | "people" | "audit" | "bin", number>;
  years: { fy: string; sales: number; cancelled: number; purchases: number }[];
  recent: { audit_id: number; at: string; by: Person; file: string; size: string }[];
  last_backup_at: string | null; estimated_size: string;
};
export type ExportKind = "sales" | "purchases" | "customers" | "products" | "firms";
export function useBackupSummary() {
  return useQuery({ queryKey: ["backup", "summary"], queryFn: async ({ signal }) => (await api.get<BackupSummary>("backup/summary/", { signal })).data });
}

/** The server makes the file. Only its download has a ten-minute timeout. */
export async function downloadBackupFile(url: string, params: Record<string, string | number>, fallback: string, progress?: (loaded: number) => void): Promise<{ blob: Blob; name: string }> {
  try {
    const reply = await api.get<Blob>(url, { params, responseType: "blob", timeout: 600_000, onDownloadProgress: (event) => progress?.(event.loaded) });
    const disposition = String(reply.headers["content-disposition"] ?? "");
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    let name = /filename="([^"]+)"/i.exec(disposition)?.[1] ?? fallback;
    if (encoded) { try { name = decodeURIComponent(encoded); } catch { name = fallback; } }
    name = name.split(/[\\/]/).pop()?.replace(/[\x00-\x1f\x7f]/g, "") || fallback;
    return { blob: reply.data, name };
  } catch (error) {
    // Axios keeps a JSON refusal as a Blob for a blob request; restore its object for problemOf.
    if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
      try { error.response.data = JSON.parse(await error.response.data.text()); } catch { /* the shared formatter handles non-JSON failures */ }
    }
    throw error;
  }
}
