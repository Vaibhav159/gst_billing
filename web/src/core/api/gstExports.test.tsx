import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { testQueryClient } from "@/test/render";
import { serve } from "@/test/server";
import { prepareCaBundle, useCaWorkbook } from "./gstExports";
import { caBundle } from "@/core/excel/bundle";
import { workbookBlob } from "@/core/excel/caWorkbook";
import { bytesOf } from "@/core/files/zip";

vi.mock("@/core/excel/caWorkbook", () => ({ workbookBlob: vi.fn(async () => new Blob(["xlsx"])) }));
vi.mock("@/core/excel/bundle", () => ({ caBundle: vi.fn(async (v) => ({ name: "GST_Kiran_092026_for_CA.zip", blob: new Blob(["zip"]), parts: v.gstr1 ? ["gstr1", "gstr3b", "excel"] : ["gstr3b", "excel"] })) }));
const data = { scope: "Kiran", period: "Sep 2026", file: "GST_Report_Kiran_Sep_2026.xlsx", summary: [], firms: [] };
const input = { businessId: 3, month: "2026-09", short: "Kiran", gstin: "08VRHFA2322D1ZI", split: false, includeGstr1: true };
afterEach(() => { cleanup(); vi.clearAllMocks(); });

test("CA workbook waits for firm and open dialog; all firms omits business_id", async () => {
  const calls = serve({ "GET reports/ca-workbook/": data }); const q = testQueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={q}>{children}</QueryClientProvider>;
  const hook = renderHook(({ id, open }: { id: number | "all" | null; open: boolean }) => useCaWorkbook({ businessId: id, from: "2026-09-01", to: "2026-09-30", split: true }, open), { wrapper, initialProps: { id: null, open: true } as { id: number | "all" | null; open: boolean } });
  expect(calls).toHaveLength(0);
  hook.rerender({ id: "all", open: false }); expect(calls).toHaveLength(0);
  hook.rerender({ id: "all", open: true });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(calls[0].params).toEqual({ from: "2026-09-01", to: "2026-09-30", split: "1" });
});

test("bundle preserves portal JSON bytes and fetches the one firm's calendar month", async () => {
  const gstr1 = '{"val": 82808.71, "zero": 0.00}\n';
  const calls = serve({ "GET reports/ca-workbook/": data, "GET gst/files/gstr3b/": "{}", "GET gst/files/gstr1/": gstr1 });
  await prepareCaBundle(input);
  expect(calls.find((c) => c.url === "reports/ca-workbook/")?.params).toEqual({ business_id: 3, from: "2026-09-01", to: "2026-09-30" });
  const bundle = vi.mocked(caBundle).mock.calls[0][0];
  expect(new TextDecoder().decode(await bytesOf(bundle.gstr1!.blob))).toBe(gstr1);
  expect(bundle.gstr1!.name).toBe("GSTR1_08VRHFA2322D1ZI_092026.json");
  expect(calls.every((c) => c.method === "GET")).toBe(true);
  expect(calls.filter(c => c.url.startsWith("gst/files/")).every(c => c.params.record === "0")).toBe(true);
});

test("blocked bundle excludes only GSTR-1, never the workbook or 3B", async () => {
  const calls = serve({ "GET reports/ca-workbook/": data, "GET gst/files/gstr3b/": "{}" });
  const result = await prepareCaBundle({ ...input, includeGstr1: false });
  expect(result.parts).toEqual(["gstr3b", "excel"]);
  expect(calls.some((c) => c.url.includes("gstr1"))).toBe(false);
  expect(workbookBlob).toHaveBeenCalledWith(data);
});

test("a server blocker arising during bundle preparation safely drops GSTR-1", async () => {
  serve({ "GET reports/ca-workbook/": data, "GET gst/files/gstr3b/": "{}", "GET gst/files/gstr1/": () => ({ status: 409, data: JSON.stringify({ code: "checks_failing", detail: "1 check fails for September 2026, so the portal file isn't made. Fix it first." }) }) });
  expect((await prepareCaBundle(input)).parts).toEqual(["gstr3b", "excel"]);
});

test("a running month or missing file aborts instead of silently creating an incomplete bundle", async () => {
  serve({ "GET reports/ca-workbook/": data, "GET gst/files/gstr3b/": () => ({ status: 409, data: JSON.stringify({ code: "month_running", detail: "September 2026 is still running." }) }) });
  await expect(prepareCaBundle(input)).rejects.toMatchObject({ response: { data: { code: "month_running" } } });
  expect(caBundle).not.toHaveBeenCalled();
});

test("range uses leap-year month end; workbook failure makes no return-download calls", async () => {
  const calls = serve({ "GET reports/ca-workbook/": () => ({ status: 500 }) });
  await expect(prepareCaBundle({ ...input, month: "2028-02" })).rejects.toBeDefined();
  expect(calls).toHaveLength(1);
  expect(calls[0].params.to).toBe("2028-02-29");
});


test.each(["gstr1", "zip"])("a %s failure leaves every bundle file read unrecorded", async (failure) => {
  const calls = serve({ "GET reports/ca-workbook/": data, "GET gst/files/gstr3b/": "{}",
    "GET gst/files/gstr1/": failure === "gstr1" ? () => ({ status: 500 }) : "{}" });
  if (failure === "zip") vi.mocked(caBundle).mockRejectedValueOnce(new Error("Zip failed"));
  await expect(prepareCaBundle(input)).rejects.toBeDefined();
  const files = calls.filter(c => c.url.startsWith("gst/files/"));
  expect(files).toHaveLength(2);
  expect(files.every(c => c.method === "GET" && c.params.record === "0")).toBe(true);
  expect(calls.some(c => c.method === "POST")).toBe(false);
});
