// What a printed bill says, worked out once for both drawings of it: the PDF (BillDocument, react-pdf) and the paper
// on the print page (Paper, HTML). Every figure and word here comes from the server's bill (contract §2.2, the print
// data): the stored heads, the total exact to the paisa (no rupee rounding and no Rounded Off line: Ruling 1B-12, as v2
// prints today), the amounts in words. The layout is Tally's A4 tax invoice as v2 prints it (TallyInvoicePDF.tsx), with the prototype's boxes
// (PROTO sales/BillPrint.jsx:245-447). Long bills break into A4 pages here, so both drawings break in the same places.
// Selling's words and maths are 1B's (core/sales) and part 0's (core/format), reused here, never repeated (Ruling 1E-6).
import { date, inrParts, qty } from "@/core/format";
import { billPdfName } from "@/core/sales/files";
import { scaled } from "@/core/sales/maths";
import { stateNameOf } from "@/core/sales/pos";
import type { BillDetail, Copies, FirmOnBill } from "@/core/sales/types";
import { ewayNumberText, halfPercent, PAY, rateText, storedIgst, taxLines } from "@/core/sales/words";
import { qrPayload } from "./qr";

/* ── Copies (CGST Rule 48) ─────────────────────────────── */
export type CopyKind = "original" | "duplicate" | "triplicate";
export type CopyMark = { value: CopyKind; label: string; tag: string };
/** Each copy's mark at the top right of its pages (PROTO sales/lib.js:317-323). */
export const COPY_MARKS: readonly CopyMark[] = [
  { value: "original", label: "Original", tag: "ORIGINAL FOR RECIPIENT" },
  { value: "duplicate", label: "Duplicate", tag: "DUPLICATE FOR TRANSPORTER" },
  { value: "triplicate", label: "Triplicate", tag: "TRIPLICATE FOR SUPPLIER" },
];
/** The choice on the print page: one copy, or all three. */
export const COPY_OPTIONS: readonly { value: Copies; label: string }[] = [
  ...COPY_MARKS.map(({ value, label }) => ({ value, label })), { value: "all", label: "All three" },
];
export function copyPages(c: Copies): CopyMark[] {
  return c === "all" ? [...COPY_MARKS] : [COPY_MARKS.find((m) => m.value === c) ?? COPY_MARKS[0]];
}
/** "Original copy", "All three copies": for the audit log and the print page's words. */
export function copiesWords(c: Copies): string {
  return c === "all" ? "All three copies" : `${copyPages(c)[0].label} copy`;
}

/* ── Figures as the paper prints them ──────────────────── */
/**
 * "87,083.21": part 0's inrParts without the ₹ (the PDF's Times has no ₹; the Total row adds it in its own font). A
 * minus would be "-", which Times has, but a bill's figures are never below zero.
 */
export function amountText(paise: number): string {
  const p = inrParts(paise);
  return `${p.neg ? "-" : ""}${p.rupees}${p.paise}`;
}
/** A firm prints bank details only when it has an account number (PROTO sales/lib.js:520). */
export function hasBank(firm: Pick<FirmOnBill, "bank_account_number">): boolean {
  return Boolean(firm.bank_account_number.trim());
}

export const DECLARATION = "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.";
// ponytail: v2 prints Udaipur for every firm (TallyInvoicePDF.tsx:590) and no field holds a firm's own. Upgrade: part 4's firm form.
export const JURISDICTION = "Udaipur";

/* ── One bill, ready to draw ───────────────────────────── */
/**
 * Text as someone typed it (a name, an address, a note, a bank's or a transporter's name), alone or inside one of the
 * paper's lines. It can hold any character, a ₹ too, which the PDF's Times can't draw: every drawing of it goes through
 * the one ₹-aware text piece (Ruling 1E-5), and the model keeps it as typed. The rest is the model's own words and
 * figures (amountText, rateText without its ₹, bill numbers, HSN codes, GSTINs), which never hold a ₹.
 * Line breaks someone typed (v2's address boxes and 1D's note are textareas; react-pdf starts a new line at each) arrive
 * settled (Ruling 1E-9): an address as one entry of `lines` per printed line, one-line slots (the 14 boxes, `short`)
 * with each break read as a space, and the bill's `note` with its breaks kept.
 */
export type FreeText = string;
export type PrintLine = { sl: string; name: FreeText; note: FreeText; hsn: string; qty: string; rate: string; per: string; amount: string };
export type PrintTax = { key: string; head: string; rate: string; amount: string };
/** One row of the HSN summary. rate: the IGST rate, or the CGST (= SGST) rate on a local bill. */
export type PrintHsn = { key: string; hsn: string; taxable: string; rate: string; cgst: string; sgst: string; igst: string; tax: string };
/** A sheet of A4. lines: the indexes of the bill's lines on it. */
export type PrintPage = { index: number; count: number; first: boolean; last: boolean; lines: number[] };
/** lines: one printed line each (an address typed on two lines is two entries). */
export type Party = { label: string; name: FreeText; lines: FreeText[] };
export type PrintBill = {
  id: number; number: string; dated: string; file: string; cancelled: boolean;
  /** What the QR code carries (qrPayload). */
  qr: string;
  /** lines: one printed line each, as a party's; bank: [label, value] rows, the bank's name and branch as typed. */
  firm: { name: FreeText; gstin: string; lines: FreeText[]; pan: string; signature: string | null; bank: [string, FreeText][] | null };
  parties: [Party, Party];
  /** The 14 boxes beside the parties, as [label, value], one line each: a value can be typed text (the note, the transporter, the city). */
  meta: [string, FreeText][];
  /** The short header of a continued page, one line each: [firm · GSTIN, number · date, buyer, place of supply]. */
  short: [FreeText, string, FreeText, string];
  lines: PrintLine[]; taxes: PrintTax[];
  /**
   * The bill's note as typed, its line breaks kept: the PDF starts a new line at each, the paper on screen shows it with
   * white-space: pre-line (Task 4's Paper), and the page plan counts each typed line.
   */
  note: FreeText;
  /** qty: the total quantity when every line has one unit; amount: the bill's total, exact to the paisa. */
  total: { qty: string; amount: string };
  words: string; igst: boolean; hsn: PrintHsn[]; hsnTotal: PrintHsn; taxWords: string;
  declaration: string; jurisdiction: string;
  pages: PrintPage[];
};

const WALKIN_NAME = "Walk-in customer";

/** "State Name : Rajasthan, Code : 08", or "" without a code. */
function stateLine(code: string): string {
  return code ? `State Name : ${stateNameOf(code)}, Code : ${code}` : "";
}
/** Typed text on its printed lines: each line break someone typed starts a new one, and blank lines go (Ruling 1E-9). */
const linesOf = (text: string): string[] => text.split(/\s*\n\s*/).map((s) => s.trim()).filter(Boolean);
/** Typed text for a one-line slot: a line break or a run of spaces reads as one space. */
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The bill as the paper prints it. showBank: the switch on the print page (a firm without an account prints none). */
export function printBill(d: BillDetail, { showBank }: { showBank: boolean }): PrintBill {
  const f = d.firm;
  const c = d.customer;
  const walkin = c.type === "walkin";
  const name = walkin ? WALKIN_NAME : c.name;
  // the address's printed lines, then the city after the last, unless a part of the address (between commas) is the city
  const address = linesOf(c.address);
  const city = c.city.trim();
  const named = address.some((l) => l.split(",").some((part) => part.trim().toLowerCase() === city.toLowerCase()));
  const where = !city || named ? address : address.length ? [...address.slice(0, -1), `${address[address.length - 1]}, ${city}`] : [city];
  const gstin = c.gst_number || "Unregistered";
  const pos = d.place_of_supply ? `${stateNameOf(d.place_of_supply)} (${d.place_of_supply})` : "";
  const e = d.eway;
  const units = [...new Set(d.lines.map((l) => l.unit))];
  const thousandths = d.lines.reduce((a, l) => a + (scaled(l.quantity, 3) ?? 0n), 0n);
  const igst = storedIgst(d);
  const bank = showBank && hasBank(f)
    ? [["Bank Name", f.bank_name], ["A/c No.", f.bank_account_number], ["Branch & IFS Code", [f.bank_branch_name, f.bank_ifsc_code].filter(Boolean).join(" & ")]] as [string, string][]
    : null;
  const lines: PrintLine[] = d.lines.map((l, i) => ({
    sl: String(i + 1), name: l.product_name, note: l.note, hsn: l.hsn_code, qty: qty(Number(l.quantity), l.unit),
    rate: rateText(l.rate).replace("₹", ""), per: l.unit, amount: amountText(l.taxable),
  }));
  const taxes = taxLines(d).map((t) => ({ key: t.key, head: t.head, rate: t.rate, amount: amountText(t.value) }));
  const hsn = d.hsn_summary.map((h, i) => ({
    key: `${h.hsn_code}|${h.gst_percent}|${h.unit}|${i}`, hsn: h.hsn_code || "—", taxable: amountText(h.taxable),
    rate: igst ? `${h.gst_percent}%` : halfPercent(h.gst_percent), cgst: amountText(h.cgst), sgst: amountText(h.sgst), igst: amountText(h.igst), tax: amountText(h.tax),
  }));
  const terms = e.eway_bill_number || e.vehicle_number || e.transporter_name || e.distance_km
    ? `By ${e.transport_mode.toLowerCase()}${e.distance_km ? `, ${e.distance_km} km` : ""}` : "";
  const bill: Omit<PrintBill, "pages"> = {
    id: d.id, number: d.invoice_number, dated: date(d.invoice_date), file: billPdfName(d), cancelled: d.status === "cancelled",
    qr: qrPayload(d),
    firm: {
      name: f.name, gstin: f.gst_number,
      lines: [...linesOf(f.address), f.gst_number ? `GSTIN/UIN: ${f.gst_number}` : "", stateLine(f.state_code), f.email ? `E-Mail : ${f.email}` : ""].filter(Boolean),
      pan: f.pan_number, signature: f.signature_url, bank,
    },
    parties: [
      { label: "Consignee (Ship to)", name, lines: [...where, `GSTIN/UIN : ${gstin}`, stateLine(c.state_code)].filter(Boolean) },
      {
        label: "Buyer (Bill to)", name,
        lines: [
          ...where, c.mobile_number ? `Phone : ${c.mobile_number}` : "", `GSTIN/UIN : ${gstin}${!c.gst_number && c.pan ? ` · PAN : ${c.pan}` : ""}`,
          stateLine(c.state_code), pos ? `Place of Supply : ${pos}` : "", "Reverse Charge : No",
        ].filter(Boolean),
      },
    ],
    meta: ([
      ["Invoice No.", d.invoice_number], ["Dated", date(d.invoice_date)],
      ["e-Way Bill No.", ewayNumberText(e.eway_bill_number)], ["Mode/Terms of Payment", d.payment_mode ? PAY[d.payment_mode] : ""],
      ["Reference No. & Date.", ""], ["Other References", oneLine(d.notes).length < 28 ? d.notes : ""],
      ["Buyer's Order No.", ""], ["Dated", ""],
      ["Dispatch Doc No.", ""], ["Delivery Note Date", ""],
      ["Dispatched through", e.transporter_name ? `${e.transporter_name}${e.transporter_gstin ? ` (${e.transporter_gstin})` : ""}` : ""], ["Destination", c.city],
      ["Motor Vehicle No.", e.vehicle_number], ["Terms of Delivery", terms],
    ] as [string, string][]).map(([k, v]): [string, string] => [k, oneLine(v)]),
    short: [
      `${f.name}${f.gst_number ? ` · GSTIN ${f.gst_number}` : ""}`, `Invoice No. ${d.invoice_number} · Dated ${date(d.invoice_date)}`,
      `Buyer : ${name}${c.gst_number ? ` · GSTIN ${c.gst_number}` : ""}`, pos ? `Place of Supply : ${pos}` : "",
    ].map(oneLine) as PrintBill["short"],
    lines, taxes, note: d.notes,
    total: { qty: units.length === 1 ? qty(Number(thousandths) / 1000, units[0]) : "", amount: amountText(d.total_amount) },
    words: `INR ${d.total_in_words}`, igst, hsn,
    hsnTotal: { key: "total", hsn: "Total", taxable: amountText(d.taxable), rate: "", cgst: amountText(d.cgst), sgst: amountText(d.sgst), igst: amountText(d.igst), tax: amountText(d.tax) },
    taxWords: `INR ${d.tax_in_words}`,
    declaration: DECLARATION, jurisdiction: JURISDICTION,
  };
  return { ...bill, pages: pagesOf(bill) };
}

/* ── A4 pages ──────────────────────────────────────────── */
/**
 * Heights in points, measured on BillDocument's own layout (A4, Times 9 pt): the room inside the outer border, the
 * header parts, a line's row, the last page's closing part. The character counts are how many fit on one line of a
 * column, on the short side (capitals are wide), so a page is planned a little emptier rather than overfull.
 */
export const PAGE_FIT = {
  page: 800.5, title: 72.3, titleNext: 24.4, shortHead: 30, head: 27.2, closing: 20,
  row: 18, rowPad: 6, nameLine: 10.2, noteLine: 8.6, nameChars: 40, noteChars: 55,
  meta: 173.3, blockPad: 10, firmName: 12.3, label: 7.8, infoLine: 10.1, infoChars: 58,
  taxRow: 18, footer: 216.3, hsnRow: 14.5, bank: 38, wordsChars: 100,
  /** Kept free on every page, for what the estimates above can't see (a word that wraps early). */
  safety: 12,
};
/** The printed lines a text takes in a column `per` characters wide: each line typed wraps on its own (Ruling 1E-9). */
const wraps = (text: string, per: number) => text.split("\n").reduce((a, s) => a + Math.max(1, Math.ceil(s.length / per)), 0);

function lineHeight(l: PrintLine): number {
  const F = PAGE_FIT;
  return Math.max(F.row, F.rowPad + F.nameLine * wraps(l.name, F.nameChars) + (l.note ? F.noteLine * wraps(l.note, F.noteChars) : 0));
}

/** The first page's firm, consignee and buyer blocks beside the 14 boxes. */
function infoHeight(b: Omit<PrintBill, "pages">): number {
  const F = PAGE_FIT;
  const lines = (ls: string[]) => ls.reduce((a, l) => a + wraps(l, F.infoChars), 0) * F.infoLine;
  const firm = F.blockPad + F.firmName + lines(b.firm.lines) + 1;
  const parties = b.parties.reduce((a, p) => a + F.blockPad + F.label + lines([p.name, ...p.lines]), 0) + 1;
  return Math.max(F.meta, firm + parties) + 1;
}

// ponytail: the last page's part after its lines has to fit on one sheet, and past about 28 HSN groups with the bank block
// (30 without), or about 18 beside a 500-character note, it doesn't: the totals then stand alone on a last page that is still
// too tall, and react-pdf spills it onto one more sheet, with no copy mark and a wrong "Page n of N". Upgrade: carry the HSN
// summary on to a next page.
/** The last page's part after its lines: tax rows, the note, the words, HSN summary and footer. */
function lastExtra(b: Omit<PrintBill, "pages">): number {
  const F = PAGE_FIT;
  return F.taxRow * b.taxes.length + (b.note ? F.rowPad + F.nameLine * wraps(b.note, F.nameChars) : 0)
    + F.footer + F.hsnRow * b.hsn.length + (b.firm.bank ? F.bank : 0) + F.infoLine * (wraps(b.words, F.wordsChars) - 1);
}

/**
 * Lines onto pages (PROTO sales/lib.js:524-549): the first page under the full header, later ones under a short one;
 * the last page also carries the tax rows, the totals and the footer. A page that isn't the last ends in "continued
 * on page n", and the last page keeps at least one line when it can, so the totals never stand alone.
 */
export function planPages(heights: number[], room: { first: number; next: number; extra: number }): PrintPage[] {
  const pages: Omit<PrintPage, "index" | "count">[] = [];
  const all = heights.map((_, k) => k);
  let i = 0;
  for (;;) {
    const first = pages.length === 0;
    const space = first ? room.first : room.next;
    // everything left fits with the totals, or only the totals are left
    if (i >= heights.length || heights.slice(i).reduce((a, h) => a + h, 0) + room.extra <= space) {
      pages.push({ first, last: true, lines: all.slice(i) });
      break;
    }
    const lines: number[] = [];
    let used = 0;
    while (i < heights.length && used + heights[i] <= space) { used += heights[i]; lines.push(i); i += 1; }
    if (!lines.length) { lines.push(i); i += 1; } // a line taller than a page still goes somewhere
    if (i >= heights.length && lines.length > 1) { i -= 1; lines.pop(); } // the totals keep a line beside them
    pages.push({ first, last: false, lines });
  }
  return pages.map((p, index) => ({ ...p, index, count: pages.length }));
}

function pagesOf(b: Omit<PrintBill, "pages">): PrintPage[] {
  const F = PAGE_FIT;
  return planPages(b.lines.map(lineHeight), {
    first: F.page - F.title - infoHeight(b) - F.head - F.closing - F.safety,
    next: F.page - F.titleNext - F.shortHead - F.head - F.closing - F.safety,
    extra: lastExtra(b),
  });
}
