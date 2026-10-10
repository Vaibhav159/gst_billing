// The PDF is checked two ways. Its element tree, expanded the way react-pdf itself expands components (each function
// component called with its props, down to DOCUMENT, PAGE, VIEW and TEXT): fast, exact, and independent of react-pdf's
// layout engine and fonts. And real files through makeBillPdf, read as bytes for what a PDF keeps in plain text: its
// page count (more pages than planned would mean a planned page overflowed), its fonts, and its Subject.
import { Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { wireDetail, WIRE_LINES } from "@/core/sales/fixtures";
import { toBillDetail } from "@/core/sales/wire";
import { BillDocument } from "./BillDocument";
import { makeBillPdf } from "./make";
import { copyPages, printBill } from "./model";

type PdfNode = { type: string; props: Record<string, unknown>; children: (PdfNode | string)[] };
/** The tree react-pdf would lay out: function components called, primitives ("PAGE", "TEXT"…) kept with their props. */
function expand(node: ReactNode): (PdfNode | string)[] {
  if (node == null || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(expand);
  if (!isValidElement(node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  if (el.type === Fragment) return expand(el.props.children as ReactNode);
  if (typeof el.type === "function") return expand((el.type as (p: unknown) => ReactNode)(el.props));
  const { children, ...props } = el.props;
  return [{ type: String(el.type), props, children: expand(children as ReactNode) }];
}
const nodes = (n: PdfNode | string, type: string): PdfNode[] => (typeof n === "string" ? [] : [...(n.type === type ? [n] : []), ...n.children.flatMap((c) => nodes(c, type))]);
/** A node's words: each TEXT's strings run together as react-pdf draws them, one space between separate texts. */
function raw(n: PdfNode | string): string {
  return typeof n === "string" ? n : n.children.map(raw).join(n.type === "TEXT" ? "" : " ");
}
const words = (n: PdfNode | string) => raw(n).replace(/\s+/g, " ").trim();
const pagesOf = (el: ReactElement) => nodes(expand(el)[0], "PAGE");
/** A style as react-pdf reads it: a list of styles merged, the later winning. */
const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
const bill = (over: Record<string, unknown> = {}) => toBillDetail(wireDetail(over));
const long = Array.from({ length: 60 }, (_, i) => ({ ...WIRE_LINES[0], id: i + 1, product_name: `Gold Ring 22K ${i + 1}` }));

/** A PDF's bytes as text (jsdom's Blob reads through a FileReader; compressed streams don't survive, plain objects do). */
async function bytes(blob: Blob): Promise<string> {
  const buf = await new Promise<ArrayBuffer>((done) => { const r = new FileReader(); r.onload = () => done(r.result as ArrayBuffer); r.readAsArrayBuffer(blob); });
  return new TextDecoder("latin1").decode(buf);
}
/** The sheets react-pdf made: its page tree's count. */
const sheetsIn = (pdf: string) => Number(pdf.match(/\/Type \/Pages\s*\/Count (\d+)/)?.[1]);

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
  const signs = nodes(page, "TEXT").filter((t) => t.children.some((c) => typeof c === "string" && c.includes("₹")));
  expect(signs.map((t) => [t.children, flat(t.props.style).fontFamily])).toEqual(Array.from({ length: 9 }, () => [["₹"], "RupeeSign"]));
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
  const pdf = await bytes(await makeBillPdf([p], "all", { title: "Tax Invoice KGH/2026-27/31", subject: p.qr }));
  expect(pdf.startsWith("%PDF-")).toBe(true);
  expect(pdf.match(/\/Type \/Pages\s*\/Count (\d+)/)?.[1]).toBe("9"); // 3 pages × all three copies
  expect(pdf).toMatch(/\/MediaBox \[0 0 595\.28\d* 841\.89\d*\]/);
  expect(pdf).toMatch(/\/BaseFont \/Times-Roman/);
  expect(pdf).toMatch(/\/BaseFont \/[A-Z]{6}\+Tinos-Bold/);
  expect(pdf).not.toMatch(/\/BaseFont \/Helvetica/); // every text is the paper's Times, or the ₹'s own font
  expect(pdf).toContain("(KGH/2026-27/31|08ABCPK1234F1Z5|2026-10-08|87083.21)");
}, 30_000);

/**
 * Ruling 1E-9's bill, as model.test.ts plans it (copied: a test never imports another test): the firm's and the buyer's
 * addresses typed on two lines each, and 30 one-line rows (23 and 7).
 */
const TWO_LINE_ADDRESSES = {
  firm: { ...(wireDetail().firm as object), address: "12 Sandbox Bazaar\nJaipur, Rajasthan" },
  customer: { ...(wireDetail().customer as object), address: "Shop 12, Ground Floor\nBapu Bazaar" },
  lines: Array.from({ length: 30 }, (_, i) => ({ ...WIRE_LINES[0], id: i + 1, product_name: `Gold Ring 22K ${i + 1}` })),
};
const rows = (n: number, over: Record<string, unknown> = {}) => Array.from({ length: n }, (_, i) => ({ ...WIRE_LINES[0], id: i + 1, product_name: `Gold Ring 22K ${i + 1}`, ...over }));
const firm = (over: Record<string, unknown>) => ({ ...(wireDetail().firm as object), ...over });
const buyer = (over: Record<string, unknown>) => ({ ...(wireDetail().customer as object), ...over });
const WALKIN = { id: 9, name: "Walk-in Customer", type: "walkin", address: "", city: "", state_name: "RAJASTHAN", state_code: "08", gst_number: "", gstin_valid: null, pan_number: "", pan: "", mobile_number: "", email: "" };
const NOTE_500 = Array.from({ length: 12 }, (_, i) => `Item ${i + 1} weighed at the counter and hallmarked.`).join(" ").slice(0, 500);
const ADDRESS = "Shop 12, Ground Floor, Sardarpura Main Road, near Jagdish Chowk\nOpposite the old clock tower, Bapu Bazaar";
const HSN = Array.from({ length: 26 }, (_, i) => String(711301 + i));

/**
 * Shapes at the edges of PAGE_FIT's estimates (pre-flight F17a), each with a page planned full: the plan's character
 * counts against react-pdf's own layout. A planned page that overflowed would add a sheet, with no copy mark and a
 * wrong "Page n of N".
 */
const SHAPES: [string, Record<string, unknown>][] = [
  ["both addresses typed on two lines, and a note on three (Ruling 1E-9)", { ...TWO_LINE_ADDRESSES, notes: "Hallmarked\nBIS 916\nSize 14" }],
  ["45 long item names and notes, each wrapping", { lines: rows(45, { product_name: "Gold Necklace 22K, Kundan and Meenakari work with matching earrings", note: "Hallmarked BIS 916, weighed with the buyer at the counter, stones counted and listed" }) }],
  ["the longest note beside addresses typed long and on two lines", { notes: NOTE_500, firm: firm({ address: ADDRESS }), customer: buyer({ address: ADDRESS }), lines: rows(40) }],
  ["26 HSN groups, with the bank: the last page's part nearly a sheet", { lines: HSN.map((hsn_code, i) => ({ ...WIRE_LINES[0], id: i + 1, hsn_code })), hsn_summary: HSN.map((hsn_code) => ({ ...(wireDetail().hsn_summary as object[])[0], hsn_code })) }],
  ["a long firm name and a business buyer's long name: a later page's header wraps", { firm: firm({ name: "SHREE MAHALAXMI GOLD AND SILVER JEWELLERS" }), customer: buyer({ type: "business", name: "SHREE GANESH GEMS AND JEWELLERS PRIVATE LIMITED", gst_number: "08AAKFS4821M1ZQ" }), lines: rows(64) }],
  ["a walk-in's goods sent by a transporter: the boxes wrap past the parties", { customer: WALKIN, notes: "Hallmarked by BIS, size 14.", lines: rows(28), eway: { eway_bill_number: "123456789012", transporter_name: "SHREE GANESH ROADWAYS AND LOGISTICS COMPANY", transporter_gstin: "08AAKFS4821M1ZQ", vehicle_number: "RJ14AB1234", vehicle_type: "Regular", transport_mode: "Road", distance_km: 1200, may_be_needed: false } }],
  ["a business buyer's name in capitals that wraps in both party blocks", { customer: buyer({ type: "business", name: "M/S SHREE MAHAVEER JEWELLERS AND ORNAMENT MANUFACTURERS", gst_number: "08AAKFS4821M1ZQ" }), lines: rows(26) }],
];

test.each(SHAPES)("a real PDF has exactly the pages planned: %s", async (_, over) => {
  const p = printBill(bill(over), { showBank: true });
  expect(p.pages.length).toBeGreaterThan(1);
  const pdf = await bytes(await makeBillPdf([p], "original", { title: "t" }));
  expect(sheetsIn(pdf)).toBe(p.pages.length);
  expect(pdf).not.toMatch(/\/BaseFont \/Helvetica/);
}, 30_000);
