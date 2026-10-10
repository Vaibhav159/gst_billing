import { wireDetail } from "@/core/sales/fixtures";
import { toBillDetail } from "@/core/sales/wire";
import { parseQr, qrPath, qrPayload } from "./qr";

test("a bill's QR carries its number, the firm's GSTIN, its date and the total printed, to the paisa", () => {
  expect(qrPayload(toBillDetail(wireDetail()))).toBe("KGH/2026-27/31|08ABCPK1234F1Z5|2026-10-08|87083.21");
});

test("a scanned code reads back: this app's, and the JSON v2's bulk PDFs printed; anything else is unreadable", () => {
  expect(parseQr(" KGH/2026-27/31|08abcpk1234f1z5|2026-10-08|87083.21 ")).toEqual({ number: "KGH/2026-27/31", gstin: "08ABCPK1234F1Z5", firm: "", date: "2026-10-08", total: 8708321 });
  // v2 printed the total as a plain number, rounded to the rupee until 2 Sep 2026
  expect(parseQr("KGH/2026-27/31|08ABCPK1234F1Z5|2026-10-08|87083")).toMatchObject({ total: 8708300 });
  expect(parseQr("31|08ABCPK1234F1Z5|2026-10-08|566.05")).toMatchObject({ number: "31", total: 56605 });
  expect(parseQr('{"inv":"KGH/2026-27/9","biz":"KIRAN GOLD HOUSE","total":566.05}')).toEqual({ number: "KGH/2026-27/9", gstin: "", firm: "KIRAN GOLD HOUSE", date: "", total: 56605 });
  expect(parseQr("KGH/2026-27/31|08ABCPK1234F1Z5|8 Oct|87083")).toBeNull();
  expect(parseQr("https://example.com")).toBeNull();
  expect(parseQr('{"total":5}')).toBeNull();
});

test("a bill from a firm without a GSTIN reads back too: its GSTIN is empty, not unreadable", () => {
  const b = toBillDetail(wireDetail({ firm: { ...(wireDetail().firm as object), gst_number: "" } }));
  expect(qrPayload(b)).toBe("KGH/2026-27/31||2026-10-08|87083.21");
  expect(parseQr(qrPayload(b))).toEqual({ number: "KGH/2026-27/31", gstin: "", firm: "", date: "2026-10-08", total: 8708321 });
});

test("the code is a real QR: a 2-module quiet zone, then the 7-module finder square in the top left", () => {
  const q = qrPath("KGH/2026-27/31|08ABCPK1234F1Z5|2026-10-08|87083.21")!;
  expect(q.size).toBe(37); // version 4 (33 modules) at level M, and the quiet zone
  expect(q.d.startsWith("M2 2H9V3H2Z")).toBe(true); // the finder's top edge: 7 dark modules in one run
  expect(qrPath("")).toBeNull(); // nothing to encode
});
