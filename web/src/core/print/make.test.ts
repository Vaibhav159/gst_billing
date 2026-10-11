// The maker's memory, the firm's signature and the bank choice a send carries, with react-pdf and the document stood in
// for (BillDocument.test.tsx makes real files). The signature comes through the app's api, answered by a fake server.
import type { ReactElement } from "react";
import { renderHook } from "@testing-library/react";
import { wireDetail } from "@/core/sales/fixtures";
import { toBillDetail } from "@/core/sales/wire";
import { serveWith } from "@/test/server";
import { billFile, makeBillPdf, sendBankChoice, sendFile, signatureData, useSendBankChoice, useSendFile, type PdfFile } from "./make";
import { copyPages, printBill, type PrintBill } from "./model";

const pdf = vi.hoisted(() => vi.fn());
vi.mock("@react-pdf/renderer", () => ({ pdf }));
vi.mock("./BillDocument", () => ({ BillDocument: () => null }));

type Made = { bills: PrintBill[]; copies: unknown; title: string; subject?: string };
/** react-pdf stood in for: each file made is a PDF of its own, or `fail` makes one fail. */
function maker(fail?: Error) {
  pdf.mockImplementation(() => ({ toBlob: async () => { if (fail) throw fail; return new Blob(["%PDF-1.3"], { type: "application/pdf" }); } }));
}
const made = () => pdf.mock.calls.map(([el]) => (el as ReactElement<Made>).props);
const bill = (over: Record<string, unknown> = {}) => toBillDetail(wireDetail(over));
const PNG = new Blob([Uint8Array.from([137, 80, 78, 71])], { type: "image/png" });
/** Another kind of image, which the maker redraws as PNG: here one the browser can't decode. */
const WEBP = new Blob([Uint8Array.from([82, 73, 70, 70])], { type: "image/webp" });

beforeEach(() => { pdf.mockReset(); maker(); });
afterEach(() => { vi.unstubAllGlobals(); });

test("a bill's PDF is made once for each answer from the server and each choice: the print page, Send and Share share it", async () => {
  const d = bill();
  const one = await billFile(d, { copies: "original", showBank: true });
  expect(one).toMatchObject({ name: "KGH_2026-27_31.pdf", sheets: 1 });
  expect(await billFile(d, { copies: "original", showBank: true })).toBe(one);
  expect(pdf).toHaveBeenCalledTimes(1);
  expect(made()[0]).toMatchObject({ title: "Tax Invoice KGH/2026-27/31", subject: "KGH/2026-27/31|08ABCPK1234F1Z5|2026-10-08|87083.21", copies: copyPages("original") });
  // another choice is another file: all three copies, one sheet each
  expect(await billFile(d, { copies: "all", showBank: true })).toMatchObject({ sheets: 3 });
  expect(await billFile(d, { copies: "original", showBank: false })).not.toBe(one);
  expect(made().slice(1).map((m) => [m.copies, m.bills[0].firm.bank])).toEqual([[copyPages("all"), expect.any(Array)], [copyPages("original"), null]]);
  // a new answer from the server (the bill was edited) is made afresh
  await billFile(bill(), { copies: "original", showBank: true });
  expect(pdf).toHaveBeenCalledTimes(4);
});

test("a PDF that couldn't be made isn't kept: the next ask makes it again", async () => {
  const d = bill();
  maker(new Error("the font didn't load"));
  await expect(billFile(d, { copies: "original", showBank: true })).rejects.toThrow("the font didn't load");
  maker();
  expect(await billFile(d, { copies: "original", showBank: true })).toMatchObject({ name: "KGH_2026-27_31.pdf" });
  expect(pdf).toHaveBeenCalledTimes(2);
});

test("a firm's signature reaches the PDF as a data URL fetched through the app's api, once per file however its link is signed; none prints without it", async () => {
  const calls = serveWith((c) => (c.url.startsWith("media/signatures/kgh.png?") ? { status: 200, data: PNG } : { status: 404 }));
  const { src } = await signatureData("/api/media/signatures/kgh.png?sig=a1");
  expect(src).toMatch(/^data:image\/png;base64,/);
  expect(await signatureData("/api/media/signatures/kgh.png?sig=b2")).toEqual({ src, again: false });
  expect(calls.map((c) => c.url)).toEqual(["media/signatures/kgh.png?sig=a1"]);
  expect(await signatureData(null)).toEqual({ src: null, again: false });

  const d = bill({ firm: { ...(wireDetail().firm as object), signature_url: "/api/media/signatures/kgh.png?sig=c3" } });
  await makeBillPdf([printBill(d, { showBank: true })], "original", { title: "t" });
  expect(made()[0].bills[0].firm.signature).toBe(src);
});

test("a signature that can't be read prints none, and the next file asks for it again; only one that got no answer, the proxy's for an app server that didn't (502, 503, 504) or the app's own error (500) may come by then", async () => {
  const calls = serveWith((c) => ({ status: Number(/[?&]status=(\d+)/.exec(c.url)?.[1] ?? 404) }));
  expect(await signatureData("/api/media/signatures/gone.png?sig=a1")).toEqual({ src: null, again: false });
  expect(await signatureData("/api/media/signatures/gone.png?sig=b2")).toEqual({ src: null, again: false });
  for (const status of [0, 500, 502, 503, 504]) expect(await signatureData(`/api/media/signatures/later${status}.png?status=${status}`)).toEqual({ src: null, again: true });
  expect(await signatureData("/api/media/signatures/barred.png?status=403")).toEqual({ src: null, again: false });
  expect(calls).toHaveLength(8);
});

test("a PDF made without a signature that can never be read, a file that's gone (404) or an image that won't decode, is kept: the next Download, Print or Share hands out the same file, with nothing fetched again", async () => {
  const calls = serveWith((c) => (c.url.startsWith("media/signatures/odd.webp?") ? { status: 200, data: WEBP } : { status: 404 }));
  vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new DOMException("The source image could not be decoded.", "InvalidStateError"); }));
  for (const signature_url of ["/api/media/signatures/gone.png?sig=a1", "/api/media/signatures/odd.webp?sig=a1"]) {
    const d = bill({ firm: { ...(wireDetail().firm as object), signature_url } });
    const first = await billFile(d, { copies: "original", showBank: true });
    expect(await billFile(d, { copies: "original", showBank: true })).toBe(first);
  }
  expect(made().map((m) => m.bills[0].firm.signature)).toEqual([null, null]);
  expect(calls.map((c) => c.url)).toEqual(["media/signatures/gone.png?sig=a1", "media/signatures/odd.webp?sig=a1"]);
});

test.each([["no answer (offline, unreachable)", 0], ["the proxy's 502 for an app server that didn't answer", 502]])("a PDF made while the firm's signature got %s is handed out but not kept: the next ask makes it again, with the signature", async (_, status) => {
  let up = false;
  const path = `media/signatures/later${status}.png`; // its own: a signature read once is kept by its path
  serveWith((c) => (c.url.startsWith(`${path}?`) ? (up ? { status: 200, data: PNG } : { status }) : { status: 404 }));
  const d = bill({ firm: { ...(wireDetail().firm as object), signature_url: `/api/${path}?sig=a1` } });
  const without = await billFile(d, { copies: "original", showBank: true });
  expect(made()[0].bills[0].firm.signature).toBeNull();
  // the file says so, so a page holding it can ask again (Task 5's review, Minor 1)
  expect(without.again).toBe(true);
  up = true;
  const signed = await billFile(d, { copies: "original", showBank: true });
  expect(signed).not.toBe(without);
  expect(signed.again).toBe(false);
  expect(made()[1].bills[0].firm.signature).toMatch(/^data:image\/png;base64,/);
  // once it carries the signature, it's kept
  expect(await billFile(d, { copies: "original", showBank: true })).toBe(signed);
  expect(pdf).toHaveBeenCalledTimes(2);
  // a firm with no signature has none to wait for: its file is kept at once
  const plain = bill();
  const kept = await billFile(plain, { copies: "original", showBank: true });
  expect(await billFile(plain, { copies: "original", showBank: true })).toBe(kept);
  expect(kept.again).toBe(false);
});

test("while the print page shows a bill, a send from it carries the page's bank choice; elsewhere there's none", () => {
  const { rerender, unmount } = renderHook(({ show }) => useSendBankChoice(412, show), { initialProps: { show: false } });
  expect([sendBankChoice(412), sendBankChoice(413)]).toEqual([false, undefined]);
  rerender({ show: true });
  expect(sendBankChoice(412)).toBe(true);
  unmount();
  expect(sendBankChoice(412)).toBeUndefined();
});

test("while the print page shows a bill, a send from it hands out the Original the page made; one without the firm's signature isn't, so a send tries again for it", () => {
  const blob = new Blob(["%PDF-1.3"], { type: "application/pdf" });
  const signed = { blob, name: "KGH_2026-27_31.pdf", sheets: 1, again: false };
  const unsigned = { ...signed, again: true };
  const { rerender, unmount } = renderHook(({ file }: { file: PdfFile | null }) => useSendFile(412, file), { initialProps: { file: null as PdfFile | null } });
  expect(sendFile(412)).toBeUndefined();
  rerender({ file: signed });
  expect([sendFile(412), sendFile(413)]).toEqual([signed, undefined]);
  rerender({ file: unsigned });
  expect(sendFile(412)).toBeUndefined();
  rerender({ file: signed });
  unmount();
  expect(sendFile(412)).toBeUndefined();
});

test("the document maker is handed every bill, each with its copies, in one file", async () => {
  const a = printBill(bill(), { showBank: true });
  const b = printBill(bill({ id: 413, invoice_number: "KGH/2026-27/32" }), { showBank: true });
  expect(await makeBillPdf([a, b], "all", { title: "Sales · 2 bills" })).toBeInstanceOf(Blob);
  expect(made()[0]).toMatchObject({ bills: [{ number: "KGH/2026-27/31" }, { number: "KGH/2026-27/32" }], copies: copyPages("all"), title: "Sales · 2 bills" });
});
