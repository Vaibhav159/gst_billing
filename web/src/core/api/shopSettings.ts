// Kept separate from bill queries so shell defaults do not eagerly download the sales screens.
import { queryOptions, useQuery } from "@tanstack/react-query";
import { api } from "./client";
import type { ShopSettings } from "@/core/sales/types";
const text = (value: unknown): string => value == null ? "" : String(value);
const whole = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- wire JSON, read field by field
const toPerson = (value: any) => value && value.id != null ? { id: whole(value.id), name: text(value.name) } : null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- wire JSON, read field by field
export function toShopSettings(w: any): ShopSettings {
  const copies = w?.copies === "duplicate" || w?.copies === "triplicate" || w?.copies === "all" ? w.copies : "original";
  return { default_business: w?.default_business ? whole(w.default_business) : null, default_business_name: text(w?.default_business_name), warnings: Array.isArray(w?.warnings) ? w.warnings.map(text) : [], copies, show_bank: w?.show_bank !== false, share_message: text(w?.share_message), updated_at: w?.updated_at ? text(w.updated_at) : null, updated_by: toPerson(w?.updated_by) };
}
/** useShopSettings' query, for queryClient.ensureQueryData outside React (plan 1E: a send's PDF reads show_bank). Kept 5 minutes. */
export const shopSettingsQuery = queryOptions({
  queryKey: ["shop-settings"], staleTime: 5 * 60_000, queryFn: async ({ signal }) => toShopSettings((await api.get("shop-settings/", { signal })).data),
});
/** The shop's settings: default copies, bank details on the bill, the share message (contract §5). */
export function useShopSettings(enabled = true) {
  return useQuery({ ...shopSettingsQuery, enabled });
}

