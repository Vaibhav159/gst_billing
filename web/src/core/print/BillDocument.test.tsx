// The PDF is checked two ways. Its element tree, expanded the way react-pdf itself expands components (each function
// component called with its props, down to DOCUMENT, PAGE, VIEW and TEXT): fast, exact, and independent of react-pdf's
// layout engine and fonts. And real files through makeBillPdf, read as bytes for what a PDF keeps in plain text: its
// page count (more pages than planned would mean a planned page overflowed), its fonts, and its Subject.
import type { ReactElement } from "react";
import { wireDetail, WIRE_LINES } from "@/core/sales/fixtures";
import type { Copies } from "@/core/sales/types";
import { toBillDetail } from "@/core/sales/wire";
import { BillDocument } from "./BillDocument";
import { makeBillPdf } from "./make";
import { copyPages, printBill } from "./model";
import {
  buyerWith, expand, firmWith, flat, IGST, LONG_BUYER, nodes, pdfText, raw, rows, rupeeTexts, sheetsIn, TRANSPORTED, TWO_LINE_ADDRESSES, WALKIN,
  words, type PdfNode,
} from "./testing";

const pagesOf = (el: ReactElement) => nodes(expand(el)[0], "PAGE");
const bill = (over: Record<string, unknown> = {}) => toBillDetail(wireDetail(over));
const long = rows(60);
/** A table's rows, each as its cells' words: rows of five texts or more (the goods' heading, the HSN summary's rows). */
const tableRows = (n: PdfNode) => nodes(n, "VIEW").filter((v) => v.children.length >= 5 && v.children.every((c) => typeof c !== "string" && c.type === "TEXT")).map((v) => v.children.map(words));

test("all three copies: three A4 pages in order, each marked for its holder", () => {
  const p = printBill(bill(), { showBank: true });
  const pages = pagesOf(<BillDocument bills={[p]} copies={copyPages("all")} title="Tax Invoice KGH/2026-27/31" subject={p.qr} />);
  expect(pages.map((pg) => pg.props.size)).toEqual(["A4", "A4", "A4"]);
  expect(pages.map((pg) => words(pg).match(/\((\w+) FOR (\w+)\)/)?.[0])).toEqual(["(ORIGINAL FOR RECIPIENT)", "(DUPLICATE FOR TRANSPORTER)", "(TRIPLICATE FOR SUPPLIER)"]);
});

test("the page carries the firm, the buyer, the rows, tax by slab, the ₹ total to the paisa in its own font, words, bank and signatory", () => {
  const p = printBill(bill(), { showBank: true });
  const [page] = pagesOf(<BillDocument bills={[p]} copies={copyPages("original")} title="t" />);
  const text = words(page);
  for (const w of [
    "Tax Invoice", "KIRAN GOLD HOUSE", "GSTIN/UIN: 08ABCPK1234F1Z5", "Buyer (Bill to)", "Anil Gupta", "Place of Supply : Rajasthan (08)",
    "Gold Ring 22K", "12.345 gms", "6,512.50", "80,396.81", "Peacock design", "CGST", "1.5%", "1,268.20",
    "₹ 87,083.21", "INR Eighty Seven Thousand Eighty Three Rupees and Twenty One Paise Only", "Tax Amount (in words) : INR Two Thousand Five Hundred Thirty Six Rupees and Forty Paise Only",
    "Company's PAN : ABCPK1234F", "Company's Bank Details", "Bank Name : Sandbox Bank", "A/c No. : 000000000003", "Branch & IFS Code : Jaipur & SBOX0000003",
    "for KIRAN GOLD HOUSE", "Authorised Signatory", "SUBJECT TO UDAIPUR JURISDICTION", "This is a Computer Generated Invoice",
  ]) expect(text).toContain(w);
  const rupee = nodes(page, "TEXT").find((t) => words(t) === "₹");
  expect(rupee?.props.style).toMatchObject({ fontFamily: "RupeeSign" });
  expect(text).not.toMatch(/Rounded Off|Less :/); // nothing is rounded (Ruling 1B-12)
  expect(nodes(page, "PATH")).toHaveLength(1); // the QR code, drawn as one path
});

test("bank details off print no bank block; a cancelled bill is stamped CANCELLED", () => {
  const p = printBill(bill({ status: "cancelled" }), { showBank: false });
  const [page] = pagesOf(<BillDocument bills={[p]} copies={copyPages("original")} title="t" />);
  expect(words(page)).not.toContain("Company's Bank Details");
  expect(words(page)).toContain("CANCELLED");
});

test("a long bill: page n of N on each, the short header after the first, continued at the foot until the totals", () => {
  const p = printBill(bill({ lines: long }), { showBank: true });
  const pages = pagesOf(<BillDocument bills={[p]} copies={copyPages("original")} title="t" />);
  expect(pages).toHaveLength(3);
  expect(pages.map((pg) => words(pg).slice(0, 12))).toEqual(["Page 1 of 3 ", "Page 2 of 3 ", "Page 3 of 3 "]);
  expect(words(pages[0])).toContain("continued on page 2");
  expect(words(pages[1])).toContain("Tax Invoice (continued, page 2)");
  expect(words(pages[1])).toContain("Invoice No. KGH/2026-27/31 · Dated 08 Oct 2026");
  expect(words(pages[1])).not.toContain("Scan to check");
  expect(words(pages[2])).toContain("₹ 87,083.21");
  expect(words(pages[0])).not.toContain("₹ 87,083.21");
});

test("a batch keeps each bill's copies together, and the document says what it is", () => {
  const a = printBill(bill(), { showBank: true });
  const b = printBill(bill({ id: 413, invoice_number: "KGH/2026-27/32" }), { showBank: true });
  const doc = expand(<BillDocument bills={[a, b]} copies={copyPages("all")} title="Sales · 2 bills" />)[0] as PdfNode;
  expect(doc.props).toMatchObject({ title: "Sales · 2 bills", author: "GST Billing" });
  expect(nodes(doc, "PAGE").map((pg) => `${words(pg).match(/KGH\/2026-27\/3\d/)?.[0]} ${words(pg).match(/\((\w+) FOR/)?.[1]}`)).toEqual([
    "KGH/2026-27/31 ORIGINAL", "KGH/2026-27/31 DUPLICATE", "KGH/2026-27/31 TRIPLICATE", "KGH/2026-27/32 ORIGINAL", "KGH/2026-27/32 DUPLICATE", "KGH/2026-27/32 TRIPLICATE",
  ]);
});

test("every ₹ someone typed prints in the RupeeSign font, never in Times (Ruling 1E-5): the note and its box, an item and its note, both addresses, the bank", () => {
  const p = printBill(bill({
    notes: "₹5,000 paid in advance",
    firm: { ...(wireDetail().firm as object), address: "12 Sandbox Bazaar, ₹ Gali, Jaipur", bank_name: "₹ Bank" },
    customer: { ...(wireDetail().customer as object), address: "Shop 4, ₹ Market" },
    lines: [{ ...WIRE_LINES[0], product_name: "Ring ₹ motif 22K", note: "Stone worth ₹1,200 inside" }, WIRE_LINES[1]],
  }), { showBank: true });
  const [page] = pagesOf(<BillDocument bills={[p]} copies={copyPages("original")} title="t" />);
  const text = words(page);
  for (const w of [
    "Note: ₹5,000 paid in advance", "Other References ₹5,000 paid in advance", "Ring ₹ motif 22K", "Stone worth ₹1,200 inside",
    "12 Sandbox Bazaar, ₹ Gali, Jaipur", "Shop 4, ₹ Market, Udaipur", "Bank Name : ₹ Bank", "₹ 87,083.21",
  ]) expect(text).toContain(w);
  // a text that holds a ₹ holds only that ₹, in RupeeSign: one for each ₹ on the page (the buyer's address prints twice)
  expect(rupeeTexts(page).map((t) => [t.children, flat(t.props.style).fontFamily])).toEqual(Array.from({ length: 9 }, () => [["₹"], "RupeeSign"]));
});

test("a later page's short header bolds what the paper bolds: the firm's name, the number, the date and the buyer's name (Ruling 1E-10)", () => {
  const p = printBill(bill({ lines: long, customer: { ...(wireDetail().customer as object), gst_number: "08AAKFS4821M1ZQ" } }), { showBank: true });
  const [, second] = pagesOf(<BillDocument bills={[p]} copies={copyPages("original")} title="t" />);
  // each run of the header as [its words, bold], in order: the left half's two lines, then the right half's
  const runs = nodes(second, "TEXT").filter((t) => t.children.every((c) => typeof c === "string")).map((t) => [raw(t), flat(t.props.style).fontFamily === "Times-Bold"]);
  const from = runs.findIndex(([w]) => w === "KIRAN GOLD HOUSE");
  expect(runs.slice(from, from + 10)).toEqual([
    ["KIRAN GOLD HOUSE", true], [" · GSTIN 08ABCPK1234F1Z5", false], ["Buyer : ", false], ["Anil Gupta", true], [" · GSTIN 08AAKFS4821M1ZQ", false],
    ["Invoice No. ", false], ["KGH/2026-27/31", true], [" · Dated ", false], ["08 Oct 2026", true], ["Place of Supply : Rajasthan (08)", false],
  ]);
});

test("an empty box, and a one-page bill's page-number slot, hold PROTO's non-breaking space, so each keeps its line", () => {
  const [page] = pagesOf(<BillDocument bills={[printBill(bill(), { showBank: true })]} copies={copyPages("original")} title="t" />);
  const texts = nodes(page, "TEXT").map(raw);
  expect(texts.slice(0, 2)).toEqual(["\u00a0", "(ORIGINAL FOR RECIPIENT)"]);
  expect(texts[texts.indexOf("Reference No. & Date.") + 1]).toBe("\u00a0");
  expect(texts[texts.indexOf("Invoice No.") + 1]).toBe("KGH/2026-27/31");
});

test("lines typed apart print apart (Ruling 1E-9): an address's two lines as two texts, the note with its own breaks", () => {
  const p = printBill(bill({ ...TWO_LINE_ADDRESSES, notes: "Hallmarked\nBIS 916\nSize 14" }), { showBank: true });
  const pages = pagesOf(<BillDocument bills={[p]} copies={copyPages("original")} title="t" />);
  const first = nodes(pages[0], "TEXT").map(raw);
  expect(first).toEqual(expect.arrayContaining(["12 Sandbox Bazaar", "Jaipur, Rajasthan", "Shop 12, Ground Floor", "Bapu Bazaar, Udaipur"]));
  // the note's cell: a text for each line typed
  const note = nodes(pages[pages.length - 1], "VIEW").find((v) => v.children.length > 0 && v.children.every((c) => typeof c !== "string" && c.type === "TEXT") && raw(v.children[0]).startsWith("Note: "));
  expect(note?.children.map(raw)).toEqual(["Note: Hallmarked", "BIS 916", "Size 14"]);
  // no text holds a line break: Times has none, and react-pdf would set one in Helvetica
  expect(pages.flatMap((pg) => nodes(pg, "TEXT")).flatMap((t) => t.children).filter((c) => typeof c === "string" && /[\r\n]/.test(c))).toEqual([]);
});

test("a real PDF: A4, as many pages as planned (none overflowed), Times with the one-glyph Tinos ₹, and the QR's text as its Subject", async () => {
  const p = printBill(bill({ lines: long }), { showBank: true });
  const pdf = await pdfText(await makeBillPdf([p], "all", { title: "Tax Invoice KGH/2026-27/31", subject: p.qr }));
  expect(pdf.startsWith("%PDF-")).toBe(true);
  expect(pdf.match(/\/Type \/Pages\s*\/Count (\d+)/)?.[1]).toBe("9"); // 3 pages × all three copies
  expect(pdf).toMatch(/\/MediaBox \[0 0 595\.28\d* 841\.89\d*\]/);
  expect(pdf).toMatch(/\/BaseFont \/Times-Roman/);
  expect(pdf).toMatch(/\/BaseFont \/[A-Z]{6}\+Tinos-Bold/);
  expect(pdf).not.toMatch(/\/BaseFont \/Helvetica/); // every text is the paper's Times, or the ₹'s own font
  expect(pdf).toContain("(KGH/2026-27/31|08ABCPK1234F1Z5|2026-10-08|87083.21)");
}, 30_000);

test("an ordinary bill prints on the sheets it needs: the 8-line bill's three copies on three sheets, 9 lines on one, and a 10th line on two", async () => {
  const made = async (n: number, copies: Copies) => {
    const p = printBill(bill({ lines: rows(n) }), { showBank: true });
    return [p.pages.length, sheetsIn(await pdfText(await makeBillPdf([p], copies, { title: "t" })))];
  };
  expect(await made(8, "all")).toEqual([1, 3]);
  expect(await made(9, "original")).toEqual([1, 1]);
  expect(await made(10, "original")).toEqual([2, 2]);
}, 60_000);

test("an inter-state bill sets out IGST: the HSN summary's five columns and one tax row by slab", () => {
  const p = printBill(bill(IGST), { showBank: true });
  const [page] = pagesOf(<BillDocument bills={[p]} copies={copyPages("original")} title="t" />);
  const table = tableRows(page);
  expect(table.slice(table.findIndex((r) => r[0] === "HSN/SAC"))).toEqual([
    ["HSN/SAC", "Taxable Value", "IGST Rate", "IGST Amount", "Total Tax Amount"],
    ["711319", "80,396.81", "3%", "2,411.90", "2,411.90"],
    ["711319", "4,150.00", "3%", "124.50", "124.50"],
    ["Total", "84,546.81", "", "2,536.40", "2,536.40"],
  ]);
  expect(words(page)).toContain("IGST 3% 2,536.40"); // the tax row: its head, rate and amount in their columns
  expect(words(page)).not.toMatch(/CGST|SGST/);
});

test("a bank's name or branch too long for its column wraps inside it, as on the paper on screen: each value takes the room beside its label, which keeps its width", () => {
  const p = printBill(bill({ firm: firmWith({ bank_name: "The Udaipur Mahila Urban Co-operative Bank Limited", bank_branch_name: "Hiran Magri Sector 4, Udaipur" }) }), { showBank: true });
  const [page] = pagesOf(<BillDocument bills={[p]} copies={copyPages("original")} title="t" />);
  const bank = nodes(page, "VIEW").filter((v) => v.children.length === 2 && ["Bank Name", "A/c No.", "Branch & IFS Code"].includes(raw(v.children[0])));
  expect(bank.map((v) => [words(v.children[0]), flat((v.children[0] as PdfNode).props.style).width, words(v.children[1])])).toEqual([
    ["Bank Name", 82, ": The Udaipur Mahila Urban Co-operative Bank Limited"], ["A/c No.", 82, ": 000000000003"], ["Branch & IFS Code", 82, ": Hiran Magri Sector 4, Udaipur & SBOX0000003"],
  ]);
  for (const v of bank) expect(flat((v.children[1] as PdfNode).props.style)).toMatchObject({ flexGrow: 1, flexBasis: 0 });
});

test("the firm's signature, handed in as data (make.ts fetches it), sits between the firm's name and Authorised Signatory", () => {
  const p = printBill(bill({ firm: firmWith({ signature_url: "/api/media/signatures/3.png?s=abc" }) }), { showBank: false });
  const drawn = { ...p, firm: { ...p.firm, signature: "data:image/png;base64,iVBORw0KGgo=" } };
  const [page] = pagesOf(<BillDocument bills={[drawn]} copies={copyPages("original")} title="t" />);
  const sign = nodes(page, "VIEW").find((v) => v.children.some((c) => typeof c !== "string" && c.type === "IMAGE"));
  expect(sign?.children.map((c) => (typeof c !== "string" && c.type === "IMAGE" ? `image ${String(c.props.src)}` : words(c)))).toEqual([
    "for KIRAN GOLD HOUSE", "image data:image/png;base64,iVBORw0KGgo=", "Authorised Signatory",
  ]);
  expect(words(page)).not.toContain("Company's Bank Details");
});

const NOTE_500 = Array.from({ length: 12 }, (_, i) => `Item ${i + 1} weighed at the counter and hallmarked.`).join(" ").slice(0, 500);
const ADDRESS = "Shop 12, Ground Floor, Sardarpura Main Road, near Jagdish Chowk\nOpposite the old clock tower, Bapu Bazaar";
const HSN = Array.from({ length: 26 }, (_, i) => String(711301 + i));
/** A line of silver sold by the gram, 10 kg and more: its quantity wraps in its column. */
const HEAVY = { quantity: "12345.678" };

/**
 * Shapes at the edges of PAGE_FIT's estimates (pre-flight F17a), each with a page planned full: the plan's character
 * counts against react-pdf's own layout. A planned page that overflowed would add a sheet, with no copy mark and a
 * wrong "Page n of N".
 */
const SHAPES: [string, Record<string, unknown>][] = [
  ["both addresses typed on two lines, and a note on three (Ruling 1E-9)", { ...TWO_LINE_ADDRESSES, notes: "Hallmarked\nBIS 916\nSize 14" }],
  ["45 long item names and notes, each wrapping", { lines: rows(45, () => ({ product_name: "Gold Necklace 22K, Kundan and Meenakari work with matching earrings", note: "Hallmarked BIS 916, weighed with the buyer at the counter, stones counted and listed" })) }],
  ["the longest note beside addresses typed long and on two lines", { notes: NOTE_500, firm: firmWith({ address: ADDRESS }), customer: buyerWith({ address: ADDRESS }), lines: rows(40) }],
  ["26 HSN groups, with the bank: the last page's part nearly a sheet", { lines: rows(26, (i) => ({ hsn_code: HSN[i] })), hsn_summary: HSN.map((hsn_code) => ({ ...(wireDetail().hsn_summary as object[])[0], hsn_code })) }],
  ["a long firm name and a business buyer's long name: a later page's header wraps", { firm: firmWith({ name: "SHREE MAHALAXMI GOLD AND SILVER JEWELLERS" }), customer: { ...LONG_BUYER, name: "SHREE GANESH GEMS AND JEWELLERS PRIVATE LIMITED" }, lines: rows(64) }],
  ["a walk-in's goods sent by a transporter: the boxes wrap past the parties", { customer: WALKIN, eway: TRANSPORTED, notes: "Hallmarked by BIS, size 14.", lines: rows(28) }],
  ["a business buyer's name in capitals that wraps in both party blocks", { customer: LONG_BUYER, lines: rows(26) }],
  ["26 lines, 3 of them 12,345.678 gms: a quantity of 10 kg wraps in its column", { lines: rows(26, (i) => (i < 3 ? HEAVY : {})) }],
  ["64 lines, 3 of 10 kg and more on a later page, and the total's quantity wrapping too", { lines: rows(64, (i) => (i >= 30 && i < 33 ? HEAVY : {})) }],
  ["a bank's long name and branch in capitals, each wrapping to three lines in the bank block", { firm: firmWith({ bank_name: "THE UDAIPUR MAHILA URBAN CO-OPERATIVE BANK LIMITED, HEAD OFFICE", bank_branch_name: "HIRAN MAGRI SECTOR 4, NEAR CHETAK CIRCLE, UDAIPUR" }), lines: rows(47) }],
];

test.each(SHAPES)("a real PDF has exactly the pages planned: %s", async (_, over) => {
  const p = printBill(bill(over), { showBank: true });
  expect(p.pages.length).toBeGreaterThan(1);
  const pdf = await pdfText(await makeBillPdf([p], "original", { title: "t" }));
  expect(sheetsIn(pdf)).toBe(p.pages.length);
  expect(pdf).not.toMatch(/\/BaseFont \/Helvetica/);
}, 30_000);
