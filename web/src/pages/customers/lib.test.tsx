import { testQueryClient } from "@/test/render";
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { customerLine } from "./forBills";
import { homeState, safeReturn, scopeName, SETTLED, tableState, useOnFile } from "./lib";
import { ANIL, handClock, pass, serve } from "./testing";

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

test("the firm scope reads as the firm's name, or All firms; one whose name isn't known yet is never called All firms", () => {
  const firms = [{ id: 3, name: "KIRAN GOLD HOUSE", short: "Kiran", gstin: "", state: "RAJASTHAN" }];
  expect(scopeName(firms, "all")).toBe("All firms");
  expect(scopeName(firms, 3)).toBe("KIRAN GOLD HOUSE");
  expect(scopeName(firms, 3, true)).toBe("Kiran");
  // the list of firms hasn't come (or didn't), or the firm isn't in it, or the scope isn't known yet
  expect([scopeName([], 3), scopeName(firms, 99, true), scopeName(firms, null)]).toEqual(["the firm picked", "the firm picked", "the firm picked"]);
});

test("how a statement bill was settled, in one set of words that the statement page and its PDF both show", () => {
  expect(SETTLED).toEqual({
    billing: "Paid at billing", udhaar: "On udhaar · payment not recorded in the app", not_recorded: "Payment mode not recorded (from Tally)", cancelled: "Cancelled · not counted",
  });
});

test("customers on file with a phone or GSTIN: asked for once typing pauses, only for a whole number or GSTIN, never the one being edited", async () => {
  const KULKARNI = { ...ANIL, id: 9, name: "Kulkarni Jewellers", gst_number: "27XTZPS7585P1ZB", mobile_number: "9822012345" };
  const calls = serve({ "GET customers/": { count: 1, next: null, results: [KULKARNI] } });
  const qc = testQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  type Typed = { phone: string; gstin: string };
  // each box a key short of whole: 9 digits, 14 characters
  const partly: Typed = { phone: "98220 1234", gstin: "27XTZPS7585P1Z" };
  handClock();
  const onFile = (except?: number) => renderHook((t: Typed) => useOnFile(t.phone, t.gstin, except), { wrapper, initialProps: partly });
  const other = onFile();
  const self = onFile(9);
  const part = onFile();
  // the last key: a whole number and a whole GSTIN, and nothing is asked until typing has paused for 250 ms
  for (const h of [other, self]) h.rerender({ phone: "98220 12345", gstin: "27XTZPS7585P1ZB" });
  await pass(0);
  expect(calls).toEqual([]);
  await pass(249);
  expect(calls).toEqual([]);
  await pass(1);
  expect(other.result.current.samePhone?.name).toBe("Kulkarni Jewellers");
  expect(other.result.current.sameGstin?.name).toBe("Kulkarni Jewellers");
  // the one being edited has the same answers (one search each), and isn't named
  expect(self.result.current).toEqual({ samePhone: null, sameGstin: null });
  expect(part.result.current).toEqual({ samePhone: null, sameGstin: null });
  expect(calls.every((c) => c.params.figures === undefined)).toBe(true);
  expect(calls.map((c) => c.params.search).sort()).toEqual(["27XTZPS7585P1ZB", "9822012345"]);
});


test("a placeholder GSTIN reads as No GSTIN in a customer line", () => {
  expect(customerLine({ ...ANIL, type: "person", gst_number: "URP" })).toBe("98290 41122 · No GSTIN · Udaipur, Rajasthan");
});
