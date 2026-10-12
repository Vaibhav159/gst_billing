// @vitest-environment node
import { Font } from "@react-pdf/renderer";
import { wireDetail } from "@/core/sales/fixtures";
import { toBillDetail } from "@/core/sales/wire";
import { makeBillPdf } from "./make";
import { printBill } from "./model";
import { buyerWith, firmWith, pdfWords, rows, TRANSPORTED } from "./testing";
import "./pdfRupee";

test("a two-page business bill keeps every GSTIN whole, including the transporter and continued header (Ruling 1E-23)", async () => {
  const gstin = "08AAKFS4821M1ZQ";
  const p = printBill(toBillDetail(wireDetail({
    customer: buyerWith({ type: "business", name: "JEWELLERS ORNAMENTS TRADERS AND", gst_number: gstin }),
    firm: firmWith({ name: "JEWELLERS ORNAMENTS TRADERS AND GOLD" }),
    eway: { ...TRANSPORTED, transporter_name: "AND SONS" },
    lines: rows(30),
  })), { showBank: true });
  expect(p.pages).toHaveLength(2);
  const pages = await pdfWords(await makeBillPdf([p], "original", { title: "Tax Invoice" }));
  expect(pages).toHaveLength(2);
  // The first page has the consignee, buyer and transporter; the second repeats the buyer's identifier.
  expect(pages.map((page) => page.split(gstin).length - 1)).toEqual([3, 1]);
  for (const page of pages) {
    expect(page).toContain("08ABCPK1234F1Z5");
    expect(page).not.toContain("08AAK-");
  }
}, 30_000);


test("only words with digits bypass the English hyphenator; ordinary words still wrap", () => {
  const callback = Font.getHyphenationCallback();
  expect(callback).not.toBeNull();
  const hyphenate = vi.fn((word: string) => [word.slice(0, 20), word.slice(20)]);
  const word = "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW";
  expect(Reflect.apply(callback!, undefined, [word, hyphenate])).toEqual([word.slice(0, 20), word.slice(20)]);
  for (const identifier of ["08AAKFS4821M1ZQ", "SBIN0001234", "KGH/2026-27/31", "123456789012"]) {
    expect(Reflect.apply(callback!, undefined, [identifier, hyphenate])).toEqual([identifier]);
  }
  expect(hyphenate).toHaveBeenCalledTimes(1);
  expect(Reflect.apply(callback!, undefined, ["manufacturers"])).toEqual(["manufacturers"]);
});
