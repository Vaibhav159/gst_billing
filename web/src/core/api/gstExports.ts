import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import { problemOf } from "./errors";
import type { CaWorkbook } from "@/core/excel/caWorkbook";

export type WorkbookScope = { businessId: number | "all" | null; from: string; to: string; split: boolean };
export function workbookParams(scope: WorkbookScope) {
  return { ...(typeof scope.businessId === "number" ? { business_id: scope.businessId } : {}), from: scope.from, to: scope.to, ...(scope.split ? { split: "1" } : {}) };
}
export function useCaWorkbook(scope: WorkbookScope, open: boolean) {
  return useQuery<CaWorkbook>({
    queryKey: ["reports", "ca-workbook", scope], enabled: open && scope.businessId !== null,
    queryFn: async ({ signal }) => (await api.get("reports/ca-workbook/", { params: workbookParams(scope), signal })).data,
  });
}

export type BundleInput = { businessId: number; month: string; short: string; gstin: string; split: boolean; includeGstr1: boolean };
type NamedBlob = { name: string; blob: Blob };
// A file endpoint records a ReturnDownload. Call only after a person's download press, never as a prefetch.
async function returnFile(kind: "gstr1" | "gstr3b", input: BundleInput): Promise<NamedBlob> {
  try {
    const response = await api.get<string>(`gst/files/${kind}/`, {
      params: { business_id: input.businessId, month: input.month, via: "download" }, responseType: "text", transformResponse: [(raw) => raw],
    });
    const period = input.month.slice(5) + input.month.slice(0, 4);
    // The server's bytes stay intact: parsing and serializing would rewrite number formatting in a filed JSON.
    const disposition = String(response.headers["content-disposition"] || "");
    const name = /filename="([^"]+)"/i.exec(disposition)?.[1] || `${kind.toUpperCase()}_${input.gstin}_${period}.json`;
    return { name, blob: new Blob([response.data], { type: "application/json" }) };
  } catch (error) {
    const e = error as { response?: { data: unknown } };
    if (e.response && typeof e.response.data === "string") {
      try { e.response.data = JSON.parse(e.response.data); } catch { /* problemOf gives the ordinary server error. */ }
    }
    throw error;
  }
}

export async function prepareCaBundle(input: BundleInput) {
  const [year, month] = input.month.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const scope = { businessId: input.businessId, from: `${input.month}-01`, to: `${input.month}-${String(last).padStart(2, "0")}`, split: input.split };
  const data: CaWorkbook = (await api.get("reports/ca-workbook/", { params: workbookParams(scope) })).data;
  const { workbookBlob } = await import("@/core/excel/caWorkbook");
  const excel = { name: data.file, blob: await workbookBlob(data) };
  const gstr3b = await returnFile("gstr3b", input);
  let gstr1: NamedBlob | undefined;
  if (input.includeGstr1) {
    try { gstr1 = await returnFile("gstr1", input); }
    catch (error) { if (problemOf(error).code !== "checks_failing") throw error; }
  }
  const { caBundle } = await import("@/core/excel/bundle");
  return caBundle({ short: input.short, month: input.month, gstr1, gstr3b, excel });
}

export function logReport(audit: string, file: string) {
  return api.post("audit-logs/log/", { action: "exported", entity: "report", entity_id: 0, entity_name: audit.slice(0, 255), details: file });
}

export function recordCaBundle(input: BundleInput, parts: string[]) {
  return api.post("gst/files/bundle/", { business: input.businessId, month: input.month, via: "download", parts });
}
