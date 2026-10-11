import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
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

