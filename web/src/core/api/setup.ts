import { skipToken, useQuery } from "@tanstack/react-query";
import { api } from "./client";

export type Setup = { firms: { count: number; names: string[] }; customers: { count: number; names: string[] }; products: { count: number; names: string[] }; bills: { count: number; cancelled: number }; people: number | null; last_backup_at: string | null };
export type SetupSummary = Setup;
export function useSetup(enabled = true) {
  return useQuery({ queryKey: ["setup"], queryFn: enabled ? async ({ signal }) => (await api.get<Setup>("setup/", { signal })).data : skipToken });
}
