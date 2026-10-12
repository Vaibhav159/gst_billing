import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { shopSettingsQuery, useSaveShopSettings } from "./sales";
import { testQueryClient } from "@/test/render";
import { serve, type Call } from "@/test/server";

test("a slow save on one settings row cannot undo another row's newer successful save", async () => {
  const settings = { copies: "original" as const, show_bank: true, share_message: "{number}", updated_at: null, updated_by: null, default_business: 3, default_business_name: "Kiran", warnings: [] };
  let release: ((reply: { status: number; data: unknown }) => void) | undefined;
  serve({ "PUT shop-settings/": ({ data }: Call) => "copies" in (data as object) ? new Promise((resolve) => { release = resolve; }) : { status: 200, data: { ...settings, copies: "all", show_bank: false } } });
  const qc = testQueryClient(); qc.setQueryData(shopSettingsQuery.queryKey, settings);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hooks = renderHook(() => ({ copies: useSaveShopSettings(), bank: useSaveShopSettings() }), { wrapper });
  let first!: Promise<unknown>;
  act(() => { first = hooks.result.current.copies.mutateAsync({ copies: "all" }); });
  await waitFor(() => expect(release).toBeDefined());
  await act(async () => { await hooks.result.current.bank.mutateAsync({ show_bank: false }); });
  await act(async () => { release?.({ status: 200, data: { ...settings, copies: "all" } }); await first; });
  expect(qc.getQueryData(shopSettingsQuery.queryKey)).toMatchObject({ copies: "all", show_bank: false });
  hooks.unmount(); qc.clear();
});


test("a late settings read cannot roll a successful row save back", async () => {
  let release: ((reply: { status: number; data: unknown }) => void) | undefined;
  serve({ "GET shop-settings/": () => new Promise((resolve) => { release = resolve; }), "PUT shop-settings/": { copies: "all", show_bank: true, share_message: "{number}" } });
  const qc = testQueryClient();
  qc.setQueryData(shopSettingsQuery.queryKey, { copies: "original", show_bank: true, share_message: "{number}", updated_at: null, updated_by: null });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hooks = renderHook(() => useSaveShopSettings(), { wrapper });
  const read = qc.fetchQuery({ ...shopSettingsQuery, staleTime: 0 }).catch(() => undefined);
  await waitFor(() => expect(release).toBeDefined());
  await act(async () => { await hooks.result.current.mutateAsync({ copies: "all" }); });
  await act(async () => { release?.({ status: 200, data: { copies: "original", show_bank: true, share_message: "{number}" } }); await read; });
  expect(qc.getQueryData(shopSettingsQuery.queryKey)).toMatchObject({ copies: "all" });
  hooks.unmount(); qc.clear();
});
