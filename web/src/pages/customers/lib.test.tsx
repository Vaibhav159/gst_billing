import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { customerLine } from "./forBills";
import { homeState, safeReturn, tableState, useOnFile } from "./lib";
import { ANIL, serve } from "./testing";

afterEach(() => { vi.useRealTimers(); });

test("a customer's line, for pickers and bills: phone, GSTIN and place, or the walk-in's", () => {
  expect(customerLine({ type: "person", mobile_number: "9829041122", gst_number: "", city: "Udaipur", state_name: "RAJASTHAN" })).toBe("98290 41122 · No GSTIN · Udaipur, Rajasthan");
  expect(customerLine({ type: "business", mobile_number: "", gst_number: "01ABCPK1234F1ZJ", city: "", state_name: "JAMMU & KASHMIR" })).toBe("No phone · GSTIN 01ABCPK1234F1ZJ · City not set, Jammu and Kashmir");
  expect(customerLine({ type: "walkin", mobile_number: "", gst_number: "", city: "", state_name: "RAJASTHAN" })).toBe("Counter sale · no name or GSTIN on the bill");
});

test("?return= goes back only to a page of this app", () => {
  expect(safeReturn("/sales/new?paper=1")).toBe("/sales/new?paper=1");
  // another site, however it's written (a browser reads \ as / and drops tabs and line breaks)
  expect(["//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "https://evil.example", "sales/new", "", null].map(safeReturn))
    .toEqual([null, null, null, null, null, null, null, null]);
});

test("a state reads in the GST table's spelling, so a stored JAMMU & KASHMIR is the picker's and the GSTIN's Jammu and Kashmir", () => {
  expect(["JAMMU & KASHMIR", " rajasthan ", "Gondwana", ""].map(tableState)).toEqual(["JAMMU AND KASHMIR", "RAJASTHAN", "GONDWANA", ""]);
  const firm = (id: number, state: string) => ({ id, name: "F", short: "F", gstin: "", state });
  // the firm picked, else the first
  expect(homeState([firm(3, "Rajasthan"), firm(4, "Jammu & Kashmir")], 4)).toBe("JAMMU AND KASHMIR");
  expect(homeState([firm(3, "Rajasthan"), firm(4, "Jammu & Kashmir")], "all")).toBe("RAJASTHAN");
});

test("customers on file with a phone or GSTIN: asked for once typing pauses, only for a whole number or GSTIN, never the one being edited", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const KULKARNI = { ...ANIL, id: 9, name: "Kulkarni Jewellers", gst_number: "27XTZPS7585P1ZB", mobile_number: "9822012345" };
  const calls = serve({ "GET customers/": { count: 1, next: null, results: [KULKARNI] } });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const other = renderHook(() => useOnFile("98220 12345", "27XTZPS7585P1ZB"), { wrapper });
  const self = renderHook(() => useOnFile("98220 12345", "27XTZPS7585P1ZB", 9), { wrapper });
  const part = renderHook(() => useOnFile("98220 1234", "27XTZPS7585P1Z"), { wrapper });
  expect(calls).toEqual([]);
  act(() => { vi.advanceTimersByTime(250); });
  await waitFor(() => expect(other.result.current.samePhone?.name).toBe("Kulkarni Jewellers"));
  await waitFor(() => expect(other.result.current.sameGstin?.name).toBe("Kulkarni Jewellers"));
  // the one being edited has the same answers (one search each), and isn't named
  expect(self.result.current).toEqual({ samePhone: null, sameGstin: null });
  expect(part.result.current).toEqual({ samePhone: null, sameGstin: null });
  expect(calls.map((c) => c.params.search).sort()).toEqual(["27XTZPS7585P1ZB", "9822012345"]);
});
