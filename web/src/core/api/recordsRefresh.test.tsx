import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { useSaveFirm, useSignature, firmKeys, toFirmDetail } from "./firms";
import { FIRM_DETAIL } from "@/test/firmRecords";
import { firmBody } from "@/pages/firms/form";
import { serve } from "@/test/server";
import { useSetup } from "./setup";
import { useSaveCustomer } from "./customers";
import { useCreateBill, useCancelBill } from "./sales";
import { testQueryClient } from "@/test/render";
import { salesServer, wireDetail } from "@/core/sales/fixtures";
import type { BillInput } from "@/core/sales/types";

test("customer and bill writes refresh setup and bill figures only after the write succeeds", async () => {
  let customers = 0, bills = 0, cancelled = 0;
  const { calls } = salesServer([
    ["GET", "setup/", () => ({ firms: { count: 1, names: ["Kiran"] }, customers: { count: customers, names: [] }, products: { count: 0, names: [] }, bills: { count: bills, cancelled }, people: 1, last_backup_at: null })],
    ["POST", "customers/", () => { customers++; return { id: 7, name: "Anil", businesses: [] }; }],
    ["POST", "sales/", () => { bills++; return wireDetail(); }],
    ["POST", "sales/31/cancel/", () => { bills--; cancelled++; return { id: 31, status: "cancelled" }; }],
  ]);
  const qc = testQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hooks = renderHook(() => ({ setup: useSetup(), customer: useSaveCustomer(), bill: useCreateBill(), cancel: useCancelBill() }), { wrapper });
  await waitFor(() => expect(hooks.result.current.setup.data?.customers.count).toBe(0));
  for (const key of ["catalog", "firms"]) qc.setQueryData([key, "figures"], {});
  await act(async () => { await hooks.result.current.customer.mutateAsync({ body: { name: "Anil" } }); });
  await waitFor(() => expect(hooks.result.current.setup.data?.customers.count).toBe(1));
  const body: BillInput = { business: 3, customer: 7, invoice_number: "31", invoice_date: "2026-10-08", payment_mode: "cash", place_of_supply: null, notes: "", paper: false, lines: [{ product_name: "Gold", hsn_code: "7113", gst_percent: "3", quantity: "1", unit: "g", rate: "5000.000", note: "" }] };
  await act(async () => { await hooks.result.current.bill.mutateAsync(body); });
  await waitFor(() => expect(hooks.result.current.setup.data?.bills.count).toBe(1));
  for (const key of ["catalog", "firms"]) expect(qc.getQueryState([key, "figures"])?.isInvalidated).toBe(true);
  await act(async () => { await hooks.result.current.cancel.mutateAsync({ id: 31, reason: "Duplicate paper entry" }); });
  await waitFor(() => expect(hooks.result.current.setup.data?.bills).toEqual({ count: 0, cancelled: 1 }));
  expect(calls.filter((call) => call.url === "setup/")).toHaveLength(4);
  hooks.unmount(); qc.clear();
});

test("firm saves and signature changes accept persisted fields without annual detail figures", async () => {
  const { numbers: _numbers, figures: _figures, months: _months, uses: _uses, recent: _recent, plain_after_full_date: _plain, ...saved } = FIRM_DETAIL;
  const calls = serve({ "POST firms/": saved, "PUT firms/3/": { ...saved, changes: [], frozen_bills: 2 }, "PUT firms/3/signature/": saved, "DELETE firms/3/signature/": saved });
  const qc = testQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hooks = renderHook(() => ({ save: useSaveFirm(), signature: useSignature() }), { wrapper });
  const body = firmBody(toFirmDetail(FIRM_DETAIL));
  qc.setQueryData(firmKeys.one(3, "2026-27"), toFirmDetail(FIRM_DETAIL));
  await act(async () => {
    expect(await hooks.result.current.save.mutateAsync({ body })).toEqual(saved);
    expect(await hooks.result.current.save.mutateAsync({ id: 3, body })).toMatchObject({ id: 3, frozen_bills: 2 });
    expect(await hooks.result.current.signature.mutateAsync({ id: 3, image: new File(["image"], "signature.png", { type: "image/png" }) })).toEqual(saved);
    expect(await hooks.result.current.signature.mutateAsync({ id: 3, image: null })).toEqual(saved);
  });
  expect(qc.getQueryState(firmKeys.one(3, "2026-27"))?.isInvalidated).toBe(true);
  expect(calls.map(c => c.method)).toEqual(["POST", "PUT", "PUT", "DELETE"]);
  hooks.unmount(); qc.clear();
});
