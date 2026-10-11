import { wireDetail, WIRE_LINES } from "@/core/sales/fixtures";
import { toBillDetail } from "@/core/sales/wire";
import { amountText, COPY_OPTIONS, copiesWords, copyPages, planPages, printBill } from "./model";
import { buyerWith, firmWith, IGST, LONG_BUYER, rows, TRANSPORTED, TWO_LINE_ADDRESSES, WALKIN } from "./testing";

const bill = (over: Record<string, unknown> = {}) => toBillDetail(wireDetail(over));

test("copies are chosen at print: one, or all three, each with its CGST Rule 48 mark", () => {
  expect(COPY_OPTIONS.map((o) => o.label)).toEqual(["Original", "Duplicate", "Triplicate", "All three"]);
  expect(copyPages("all").map((c) => c.tag)).toEqual(["ORIGINAL FOR RECIPIENT", "DUPLICATE FOR TRANSPORTER", "TRIPLICATE FOR SUPPLIER"]);
  expect(copyPages("duplicate").map((c) => c.tag)).toEqual(["DUPLICATE FOR TRANSPORTER"]);
  expect([copiesWords("original"), copiesWords("all")]).toEqual(["Original copy", "All three copies"]);
});

test("figures print as Tally does: Indian grouping and two decimals", () => {
  expect(amountText(8708321)).toBe("87,083.21");
  expect(amountText(12345678)).toBe("1,23,456.78");
  expect(amountText(56605)).toBe("566.05");
  expect(amountText(0)).toBe("0.00");
});

test("the contract's bill on paper: rows as written, tax by slab, the total to the paisa and its words", () => {
  const p = printBill(bill(), { showBank: true });
  expect(p.lines).toEqual([
    { sl: "1", name: "Gold Ring 22K", note: "", hsn: "711319", qty: "12.345 gms", rate: "6,512.50", per: "gms", amount: "80,396.81" },
    { sl: "2", name: "Gold Pendant 22K", note: "Peacock design", hsn: "711319", qty: "1 pcs", rate: "4,150.00", per: "pcs", amount: "4,150.00" },
  ]);
  expect(p.taxes).toEqual([{ key: "c3", head: "CGST", rate: "1.5%", amount: "1,268.20" }, { key: "s3", head: "SGST", rate: "1.5%", amount: "1,268.20" }]);
  expect(p.total).toEqual({ qty: "", amount: "87,083.21" }); // two units, so no total quantity
  expect(p.words).toBe("INR Eighty Seven Thousand Eighty Three Rupees and Twenty One Paise Only");
  expect(p.taxWords).toBe("INR Two Thousand Five Hundred Thirty Six Rupees and Forty Paise Only");
  expect(p.qr).toBe("KGH/2026-27/31|08ABCPK1234F1Z5|2026-10-08|87083.21");
  expect(p.file).toBe("KGH_2026-27_31.pdf");
  expect(p.igst).toBe(false);
  expect(p.hsn.map((h) => [h.hsn, h.taxable, h.rate, h.cgst, h.sgst, h.tax])).toEqual([
    ["711319", "80,396.81", "1.5%", "1,205.95", "1,205.95", "2,411.90"], ["711319", "4,150.00", "1.5%", "62.25", "62.25", "124.50"],
  ]);
  expect(p.hsnTotal).toMatchObject({ taxable: "84,546.81", cgst: "1,268.20", sgst: "1,268.20", tax: "2,536.40" });
  expect(p.pages).toEqual([{ index: 0, count: 1, first: true, last: true, lines: [0, 1] }]);
});

test("the firm, the consignee and the buyer as the bill names them; the 14 boxes; the bank only when it's on and saved", () => {
  const p = printBill(bill({ notes: "Hallmarked" }), { showBank: true });
  expect(p.firm).toMatchObject({
    name: "KIRAN GOLD HOUSE", pan: "ABCPK1234F", signature: null,
    lines: ["12 Sandbox Bazaar, Jaipur, Rajasthan", "GSTIN/UIN: 08ABCPK1234F1Z5", "State Name : Rajasthan, Code : 08", "E-Mail : firm3@example.com"],
    bank: [["Bank Name", "Sandbox Bank"], ["A/c No.", "000000000003"], ["Branch & IFS Code", "Jaipur & SBOX0000003"]],
  });
  expect(p.parties[1]).toEqual({
    label: "Buyer (Bill to)", name: "Anil Gupta",
    lines: ["15 Demo Road, Rajasthan, Udaipur", "Phone : 9829041122", "GSTIN/UIN : Unregistered", "State Name : Rajasthan, Code : 08", "Place of Supply : Rajasthan (08)", "Reverse Charge : No"],
  });
  expect(p.meta.slice(0, 6)).toEqual([["Invoice No.", "KGH/2026-27/31"], ["Dated", "08 Oct 2026"], ["e-Way Bill No.", ""], ["Mode/Terms of Payment", "Cash"], ["Reference No. & Date.", ""], ["Other References", "Hallmarked"]]);
  expect(p.note).toBe("Hallmarked");
  expect(printBill(bill(), { showBank: false }).firm.bank).toBeNull();
  expect(printBill(bill({ firm: { ...(wireDetail().firm as object), bank_account_number: "" } }), { showBank: true }).firm.bank).toBeNull();
});

test("inter-state: IGST by slab; a walk-in prints as one; the e-way details fill their boxes; a cancelled bill is marked", () => {
  const p = printBill(bill({
    ...IGST, status: "cancelled",
    customer: { id: 9, name: "Walk-in Customer", type: "walkin", address: "", city: "", state_name: "GUJARAT", state_code: "24", gst_number: "", gstin_valid: null, pan_number: "", pan: "AAKFS4821M", mobile_number: "", email: "" },
    eway: { eway_bill_number: "123456789012", transporter_name: "Shree Transport", transporter_gstin: "", vehicle_number: "RJ14AB1234", vehicle_type: "Regular", transport_mode: "Road", distance_km: 120, may_be_needed: false },
  }), { showBank: true });
  expect(p.igst).toBe(true);
  expect(p.taxes).toEqual([{ key: "i3", head: "IGST", rate: "3%", amount: "2,536.40" }]);
  expect(p.hsn[0]).toMatchObject({ rate: "3%", igst: "2,411.90" });
  expect(p.parties[1].name).toBe("Walk-in customer");
  expect(p.parties[1].lines).toEqual(["GSTIN/UIN : Unregistered · PAN : AAKFS4821M", "State Name : Gujarat, Code : 24", "Place of Supply : Gujarat (24)", "Reverse Charge : No"]);
  expect(Object.fromEntries(p.meta.filter(([, v]) => v))).toMatchObject({ "e-Way Bill No.": "1234 5678 9012", "Dispatched through": "Shree Transport", "Motor Vehicle No.": "RJ14AB1234", "Terms of Delivery": "By road, 120 km" });
  expect(p.cancelled).toBe(true);
});

test("one unit throughout: the Total row also sums the quantity, to the thousandth, grouped as Tally does", () => {
  expect(printBill(bill({ lines: [WIRE_LINES[0], { ...WIRE_LINES[1], unit: "gms", quantity: "1002.655" }] }), { showBank: true }).total.qty).toBe("1,015.000 gms");
});

test("566.05 prints as 566.05: the total is never rounded to the rupee, and no round-off is made up (Ruling 1B-12)", () => {
  const p = printBill(bill({ total_amount: "566.05", total_in_words: "Five Hundred Sixty Six Rupees and Five Paise Only" }), { showBank: true });
  expect(p.total.amount).toBe("566.05");
  expect(p.words).toBe("INR Five Hundred Sixty Six Rupees and Five Paise Only");
  expect(p.qr.endsWith("|566.05")).toBe(true);
  expect(Object.keys(p)).not.toContain("roundOff");
});

test("pages: lines fill the first page, then the next ones; the last page keeps a line beside the totals", () => {
  const rows = Array.from({ length: 10 }, () => 18);
  expect(planPages(rows, { first: 1000, next: 1000, extra: 100 })).toEqual([{ index: 0, count: 1, first: true, last: true, lines: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }]);
  expect(planPages(rows, { first: 100, next: 200, extra: 150 }).map((p) => [p.first, p.last, p.lines.length])).toEqual([[true, false, 5], [false, false, 4], [false, true, 1]]);
  // a line taller than a page still goes somewhere; a bill without lines is one page
  expect(planPages([500, 18], { first: 100, next: 100, extra: 50 }).map((p) => p.lines)).toEqual([[0], [1]]);
  expect(planPages([], { first: 100, next: 100, extra: 500 })).toEqual([{ index: 0, count: 1, first: true, last: true, lines: [] }]);
});

test("a long bill breaks where its rows run out of room: 60 lines take three pages, every line on one of them", () => {
  const lines = Array.from({ length: 60 }, (_, i) => ({ ...WIRE_LINES[0], id: i + 1, product_name: `Gold Ring 22K ${i + 1}` }));
  const p = printBill(bill({ lines }), { showBank: true });
  expect(p.pages.map((x) => [x.first, x.last])).toEqual([[true, false], [false, false], [false, true]]);
  expect(p.pages.flatMap((x) => x.lines)).toEqual(lines.map((_, i) => i));
  expect(p.pages.map((x) => x.lines.length)).toEqual([25, 34, 1]);
});

test("rows that wrap take more room: 30 lines with two-line names and notes break as 10, 15 and 5, where one-line rows take 25 and 5", () => {
  const lines = Array.from({ length: 30 }, (_, i) => ({ ...WIRE_LINES[0], id: i + 1, product_name: `Gold Necklace 22K, Kundan and Meenakari work ${i + 1}`, note: "Hallmarked BIS 916, weighed with the buyer at the counter" }));
  expect(printBill(bill({ lines: lines.map((l) => ({ ...l, product_name: "Gold Ring 22K", note: "" })) }), { showBank: true }).pages.map((x) => x.lines.length)).toEqual([25, 5]);
  expect(printBill(bill({ lines }), { showBank: true }).pages.map((x) => x.lines.length)).toEqual([10, 15, 5]);
});

test("a two-line address takes room from the first page, and a long note and the bank from the last: 42 lines break as 24 and 18", () => {
  const p = printBill(bill({
    lines: Array.from({ length: 42 }, (_, i) => ({ ...WIRE_LINES[0], id: i + 1 })),
    customer: { ...(wireDetail().customer as object), address: "Shop 12, Ground Floor, Bapu Bazaar, near Jagdish Chowk" },
    notes: "Delivered at the counter to the buyer's son, Rohit Gupta, who showed the order slip. Hallmarked by BIS. Ring size 14; the pendant chain was resized free of charge on request.",
  }), { showBank: true });
  expect(p.pages.map((x) => x.lines.length)).toEqual([24, 18]);
});

test("an ordinary bill prints on the sheets it needs, the bank block counted once: 8 lines fit one page, and so do 9; a 10th line takes a second, 9 and 1", () => {
  const split = (n: number) => printBill(bill({ lines: rows(n) }), { showBank: true }).pages.map((x) => x.lines.length);
  expect([split(8), split(9), split(10)]).toEqual([[8], [9], [9, 1]]);
});

test("text someone typed reaches the drawing as typed, a ₹ too, for the one ₹-aware text piece to draw (Ruling 1E-5); the figures carry none", () => {
  const p = printBill(bill({
    notes: "₹5,000 paid in advance",
    firm: { ...(wireDetail().firm as object), address: "12 Sandbox Bazaar, ₹ Gali, Jaipur" },
    customer: { ...(wireDetail().customer as object), address: "Shop 4, ₹ Market" },
    lines: [{ ...WIRE_LINES[0], product_name: "Ring ₹ motif 22K", note: "Stone worth ₹1,200 inside" }],
  }), { showBank: true });
  expect([p.note, p.meta[5]]).toEqual(["₹5,000 paid in advance", ["Other References", "₹5,000 paid in advance"]]);
  expect(p.lines[0]).toMatchObject({ name: "Ring ₹ motif 22K", note: "Stone worth ₹1,200 inside", rate: "6,512.50", amount: "80,396.81" });
  expect([p.firm.lines[0], ...p.parties.map((x) => x.lines[0])]).toEqual(["12 Sandbox Bazaar, ₹ Gali, Jaipur", "Shop 4, ₹ Market, Udaipur", "Shop 4, ₹ Market, Udaipur"]);
});

test("the HSN summary follows the heads the bill stored, as its tax rows do: CGST + SGST on an inter-state bill print as stored; with no tax, the direction decides", () => {
  // v2's imports can store CGST + SGST on an inter-state bill (check heads_mismatch): the paper shows what was filed
  const mixed = printBill(bill({ interstate: true, place_of_supply: "24" }), { showBank: true });
  expect([mixed.igst, mixed.taxes.map((t) => t.head), mixed.hsn[0].rate]).toEqual([false, ["CGST", "SGST"], "1.5%"]);
  const zero = { gst_percent: "0", cgst: "0.00", sgst: "0.00", igst: "0.00", tax: "0.00" };
  const exempt = printBill(bill({
    interstate: true, place_of_supply: "24", cgst: "0.00", sgst: "0.00", tax: "0.00", total_amount: "84546.81", gst_percents: ["0"],
    lines: WIRE_LINES.map((l) => ({ ...l, ...zero, amount: l.taxable })),
    slabs: [{ ...zero, taxable: "84546.81" }],
    hsn_summary: [{ hsn_code: "711319", unit: "gms", quantity: "12.345", ...zero, taxable: "80396.81" }, { hsn_code: "711319", unit: "pcs", quantity: "1.000", ...zero, taxable: "4150.00" }],
    total_in_words: "Eighty Four Thousand Five Hundred Forty Six Rupees and Eighty One Paise Only", tax_in_words: "Zero Rupees Only",
  }), { showBank: true });
  expect([exempt.igst, exempt.taxes, exempt.hsn.map((h) => h.rate)]).toEqual([true, [{ key: "i0", head: "IGST", rate: "0%", amount: "0.00" }], ["0%", "0%"]]);
});

test("an address typed on two lines prints as two lines, in the firm's block and both parties', and the first page makes room: 30 lines break as 23 and 7", () => {
  const p = printBill(bill(TWO_LINE_ADDRESSES), { showBank: true });
  expect(p.firm.lines.slice(0, 3)).toEqual(["12 Sandbox Bazaar", "Jaipur, Rajasthan", "GSTIN/UIN: 08ABCPK1234F1Z5"]);
  expect(p.parties.map((x) => x.lines.slice(0, 2))).toEqual([["Shop 12, Ground Floor", "Bapu Bazaar, Udaipur"], ["Shop 12, Ground Floor", "Bapu Bazaar, Udaipur"]]);
  expect(p.pages.map((x) => x.lines.length)).toEqual([23, 7]);
});

test("the first page's header is counted as the PDF draws it, the point under the firm's name too: with every address typed on three lines, 26 lines break as 21 and 5", () => {
  const p = printBill(bill({
    firm: firmWith({ address: "12 Sandbox Bazaar\nJohari Bazaar\nJaipur, Rajasthan" }), customer: buyerWith({ address: "Shop 12, Ground Floor\nBapu Bazaar\nnear Jagdish Chowk" }), lines: rows(26),
  }), { showBank: true });
  expect(p.parties.map((x) => x.lines.slice(0, 3))).toEqual(Array.from({ length: 2 }, () => ["Shop 12, Ground Floor", "Bapu Bazaar", "near Jagdish Chowk, Udaipur"]));
  expect(p.pages.map((x) => x.lines.length)).toEqual([21, 5]);
});

test("a note typed on three lines keeps its breaks for the paper, and the plan counts three lines: 8 lines break as 7 and 1, where the same note on one line leaves them on one page", () => {
  const lines = Array.from({ length: 8 }, (_, i) => ({ ...WIRE_LINES[0], id: i + 1 }));
  const p = printBill(bill({ notes: "Hallmarked\nBIS 916\nSize 14", lines }), { showBank: true });
  expect(p.note).toBe("Hallmarked\nBIS 916\nSize 14");
  expect(p.pages.map((x) => x.lines.length)).toEqual([7, 1]);
  expect(printBill(bill({ notes: "Hallmarked BIS 916 Size 14", lines }), { showBank: true }).pages.map((x) => x.lines.length)).toEqual([8]);
});

/** k rows of the HSN summary, each its own code: each row takes 14.46 pt of the last page, a fine step for finding its edge. */
const groups = (k: number) => Array.from({ length: k }, (_, i) => ({ ...(wireDetail().hsn_summary as object[])[0], hsn_code: String(711301 + i) }));

test("a one-line note takes a full row, as the PDF draws it (18 pt, more than its one line): 8 lines over 3 HSN groups beside a one-line note break as 7 and 1, where without it they fit one page", () => {
  const split = (over: Record<string, unknown>) => printBill(bill({ lines: rows(8), hsn_summary: groups(3), ...over }), { showBank: true }).pages.map((x) => x.lines.length);
  expect([split({ notes: "Hallmarked by BIS, size 14" }), split({})]).toEqual([[7, 1], [8]]);
});

test("the tax in words, too long for its line, takes a second, and the plan counts it: 8 lines over 4 HSN groups beside the longest tax in words break as 7 and 1, where a short one leaves them on one page", () => {
  const taxWords = "Seventy Seven Crore Seventy Seven Lakh Seventy Seven Thousand Seven Hundred Seventy Seven Rupees and Seventy Seven Paise Only";
  const split = (over: Record<string, unknown>) => printBill(bill({ lines: rows(8), hsn_summary: groups(4), ...over }), { showBank: true }).pages.map((x) => x.lines.length);
  expect([split({ tax_in_words: taxWords }), split({})]).toEqual([[7, 1], [8]]);
});

test("a firm's signature beside a name that wraps under it (\"for SHREE MAHALAXMI …\" on two lines) makes the signatory's box taller: 9 lines break as 8 and 1, where without the signature they fit one page", () => {
  const name = "SHREE MAHALAXMI GOLD AND SILVER JEWELLERS PVT LTD";
  const split = (firm: Record<string, unknown>) => printBill(bill({ firm: firmWith({ name, ...firm }), lines: rows(9) }), { showBank: true }).pages.map((x) => x.lines.length);
  expect([split({ signature_url: "/api/media/signatures/3.png?s=abc" }), split({})]).toEqual([[8, 1], [9]]);
});

test("a bank's name or branch too long for its column wraps there, and the plan counts each line: a co-operative bank's long name and branch break 9 lines as 8 and 1, where a short name and branch leave them on one page", () => {
  const split = (firm: Record<string, unknown>) => printBill(bill({ firm: firmWith(firm), lines: rows(9) }), { showBank: true }).pages.map((x) => x.lines.length);
  expect([split({ bank_name: "The Udaipur Mahila Urban Co-operative Bank Limited", bank_branch_name: "Hiran Magri Sector 4, Udaipur" }), split({})]).toEqual([[8, 1], [9]]);
});

test("an IGST bill's HSN summary heads its columns on one line, where a local bill's take two (CGST Rate, SGST/UTGST): 11 lines of an IGST bill fit one page, and a local bill's break as 10 and 1", () => {
  const igst = printBill(bill({ ...IGST, lines: rows(11, () => ({ cgst: "0.00", sgst: "0.00", igst: "1205.95" })) }), { showBank: true });
  expect(igst.pages.map((x) => x.lines.length)).toEqual([11]);
  expect(printBill(bill({ lines: rows(11) }), { showBank: true }).pages.map((x) => x.lines.length)).toEqual([10, 1]);
});

test("a line that holds a ₹ stands taller in the ₹'s own font (Tinos, 1.15 em against Times's 1.12), and the plan counts each line of a name with one so: 6 names of two lines in the PDF, with a ₹, over 3 HSN groups break as 5 and 1, where without it they fit one page", () => {
  const split = (name: string) => printBill(bill({ lines: rows(6, (i) => ({ product_name: `${name} ${i + 1}` })), hsn_summary: groups(3) }), { showBank: true }).pages.map((x) => x.lines.length);
  expect([split("Gold Necklace ₹ motif 22K, Kundan and Meenakari work with matching earrings"), split("Gold Necklace 22K motif, Kundan and Meenakari work with matching earrings")]).toEqual([[5, 1], [6]]);
});

test("the 14 boxes and a continued page's header hold one line each: a line break typed there reads as a space", () => {
  // v2's bulk import stores a spreadsheet's bill number and GSTINs as they are, line breaks too
  const p = printBill(bill({
    notes: "Hallmarked\nBIS 916\nSize 14", invoice_number: "KGH/2026-27/\n31",
    firm: { ...(wireDetail().firm as object), gst_number: "08ABCPK1234F1Z5\n" },
    customer: { ...(wireDetail().customer as object), name: "Anil\nGupta", gst_number: "08AAKFS4821M1ZQ\r\n" },
  }), { showBank: true });
  expect(p.meta[5]).toEqual(["Other References", "Hallmarked BIS 916 Size 14"]);
  // the Invoice No. box, a later page's header and the QR code read the number alike: a break in the code would be a
  // USB scanner's Enter halfway through it (1E Task 9)
  expect(p.meta[0]).toEqual(["Invoice No.", "KGH/2026-27/ 31"]);
  expect(p.qr).toBe("KGH/2026-27/ 31|08ABCPK1234F1Z5|2026-10-08|87083.21");
  expect(p.short.slice(0, 3)).toEqual([
    [{ text: "KIRAN GOLD HOUSE", bold: true }, { text: " · GSTIN 08ABCPK1234F1Z5" }],
    [{ text: "Invoice No. " }, { text: "KGH/2026-27/ 31", bold: true }, { text: " · Dated " }, { text: "08 Oct 2026", bold: true }],
    [{ text: "Buyer : " }, { text: "Anil Gupta", bold: true }, { text: " · GSTIN 08AAKFS4821M1ZQ" }],
  ]);
});

test("a line break inside a name, a line's note or the bank's details reads as a space, so each prints on one line, and the plan counts one: 30 lines break as 18 and 12", () => {
  // these reach v3 with breaks only from v2's imports; the firm's name and the bank's details sit in slots of fixed height that the plan never counts
  const p = printBill(bill({
    firm: { ...(wireDetail().firm as object), name: "KIRAN GOLD\nHOUSE", bank_name: "Sandbox\nBank", bank_branch_name: "Jaipur\nMain Branch" },
    customer: { ...(wireDetail().customer as object), name: "Anil\r\nGupta" },
    lines: Array.from({ length: 30 }, (_, i) => ({ ...WIRE_LINES[1], id: i + 1, product_name: "Gold Pendant\n22K", note: "Peacock\ndesign" })),
  }), { showBank: true });
  expect(p.firm.name).toBe("KIRAN GOLD HOUSE");
  expect(p.parties.map((x) => x.name)).toEqual(["Anil Gupta", "Anil Gupta"]);
  expect(p.lines[0]).toMatchObject({ name: "Gold Pendant 22K", note: "Peacock design" });
  expect(p.firm.bank).toEqual([["Bank Name", "Sandbox Bank"], ["A/c No.", "000000000003"], ["Branch & IFS Code", "Jaipur Main Branch & SBOX0000003"]]);
  expect(p.pages.map((x) => x.lines.length)).toEqual([18, 12]);
});

test("the last page's fixed part fits a sheet only up to a limit (the ponytail at lastExtra): with 29 HSN groups beside the bank block the totals stand alone on a fourth page, where 28 keep a line beside them", () => {
  const split = (k: number) => printBill(bill({
    lines: groups(k).map(({ hsn_code }, i) => ({ ...WIRE_LINES[0], id: i + 1, hsn_code })), hsn_summary: groups(k),
  }), { showBank: true }).pages.map((x) => x.lines.length);
  expect([split(28), split(29)]).toEqual([[25, 2, 1], [25, 3, 1, 0]]);
});

test("names in capitals too long for a line wrap where they print, and the first page makes room: the firm's (in its header) and a business buyer's (in both party blocks): 26 lines break as 23 and 3", () => {
  const p = printBill(bill({ firm: firmWith({ name: "SHREE MAHALAXMI GOLD AND SILVER JEWELLERS PVT LTD" }), customer: LONG_BUYER, lines: rows(26) }), { showBank: true });
  expect(p.pages.map((x) => x.lines.length)).toEqual([23, 3]);
  // short names leave the first page its 25
  expect(printBill(bill({ lines: rows(26) }), { showBank: true }).pages.map((x) => x.lines.length)).toEqual([25, 1]);
});

test("a box beside the parties that wraps (a transporter with its GSTIN) can stand taller than them, and a walk-in's first page makes room: 28 lines break as 25 and 3", () => {
  const p = printBill(bill({ customer: WALKIN, eway: TRANSPORTED, notes: "Hallmarked by BIS, size 14.", lines: rows(28) }), { showBank: true });
  expect(p.meta[10]).toEqual(["Dispatched through", "SHREE GANESH ROADWAYS AND LOGISTICS COMPANY (08AAKFS4821M1ZQ)"]);
  expect(p.pages.map((x) => x.lines.length)).toEqual([25, 3]);
});

test("a later page's header that wraps (a long firm name, a business buyer's long name) takes room from that page: 64 lines break as 25, 37 and 2, where short names give 25, 38 and 1", () => {
  const p = printBill(bill({ firm: firmWith({ name: "SHREE MAHALAXMI GOLD AND SILVER JEWELLERS" }), customer: { ...LONG_BUYER, name: "SHREE GANESH GEMS AND JEWELLERS PRIVATE LIMITED" }, lines: rows(64) }), { showBank: true });
  expect(p.pages.map((x) => x.lines.length)).toEqual([25, 37, 2]);
  expect(printBill(bill({ lines: rows(64) }), { showBank: true }).pages.map((x) => x.lines.length)).toEqual([25, 38, 1]);
});

/** A line of silver sold by the gram, 10 kg and more: "12,345.678 gms" is too wide for the Quantity column's one line. */
const HEAVY = { quantity: "12345.678" };

test("a quantity of 10 kg and more wraps in its column, and its row takes two lines: 26 lines, 3 of them 12,345.678 gms, break as 23 and 3, and 64 with 3 such on page 2 as 25, 36 and 3", () => {
  const p = printBill(bill({ lines: rows(26, (i) => (i < 3 ? HEAVY : {})) }), { showBank: true });
  expect(p.lines[0].qty).toBe("12,345.678 gms");
  expect(p.pages.map((x) => x.lines.length)).toEqual([23, 3]);
  expect(printBill(bill({ lines: rows(64, (i) => (i >= 30 && i < 33 ? HEAVY : {})) }), { showBank: true }).pages.map((x) => x.lines.length)).toEqual([25, 36, 3]);
  // 1,234.567 gms still fits on a line
  expect(printBill(bill({ lines: rows(26, () => ({ quantity: "1234.567" })) }), { showBank: true }).pages.map((x) => x.lines.length)).toEqual([25, 1]);
});

test("a total of 10 kg and more wraps in the Total row, and the last page makes room for its second line: without the bank block, 12 lines of 1 kg break as 11 and 1, where 12 of 200 g fit one page; 10 of 1.5 kg over one HSN group still fit; 45 of 1 kg break as 25 and 20", () => {
  const kg = printBill(bill({ lines: rows(12, () => ({ quantity: "1000.000" })) }), { showBank: false });
  expect(kg.total.qty).toBe("12,000.000 gms");
  expect(kg.pages.map((x) => x.lines.length)).toEqual([11, 1]);
  const light = printBill(bill({ lines: rows(12, () => ({ quantity: "200.000" })) }), { showBank: false });
  expect(light.total.qty).toBe("2,400.000 gms");
  expect(light.pages.map((x) => x.lines.length)).toEqual([12]);
  // the Total row grows by its second line only (27.16 pt in all), not by a line's whole row
  const bars = printBill(bill({ lines: rows(10, () => ({ quantity: "1500.000" })), hsn_summary: groups(1) }), { showBank: true });
  expect(bars.total.qty).toBe("15,000.000 gms");
  expect(bars.pages.map((x) => x.lines.length)).toEqual([10]);
  expect(printBill(bill({ lines: rows(45, () => ({ quantity: "1000.000" })) }), { showBank: true }).pages.map((x) => x.lines.length)).toEqual([25, 20]);
});

test("a firm without a GSTIN prints no bare GSTIN, in its block or a continued page's header, and its QR code leaves the field empty", () => {
  const p = printBill(bill({ firm: { ...(wireDetail().firm as object), gst_number: "" } }), { showBank: true });
  expect(p.firm.lines).toEqual(["12 Sandbox Bazaar, Jaipur, Rajasthan", "State Name : Rajasthan, Code : 08", "E-Mail : firm3@example.com"]);
  expect(p.short[0]).toEqual([{ text: "KIRAN GOLD HOUSE", bold: true }]);
  expect(p.qr).toBe("KGH/2026-27/31||2026-10-08|87083.21");
});

test("a GSTIN that ends in a line break prints as one line wherever it prints: the firm's block and its QR code, both parties, a later page's header; one that's only a break or spaces is no GSTIN", () => {
  // v2's bulk import stores a spreadsheet's GSTIN as it is
  const p = printBill(bill({
    firm: { ...(wireDetail().firm as object), gst_number: "08ABCPK1234F1Z5\n" },
    customer: { ...(wireDetail().customer as object), gst_number: "08AAKFS4821M1ZQ\n" },
  }), { showBank: true });
  expect(p.firm.gstin).toBe("08ABCPK1234F1Z5");
  expect(p.firm.lines).toContain("GSTIN/UIN: 08ABCPK1234F1Z5");
  expect(p.qr).toBe("KGH/2026-27/31|08ABCPK1234F1Z5|2026-10-08|87083.21");
  expect(p.parties.map((x) => x.lines.filter((l) => l.startsWith("GSTIN")))).toEqual([["GSTIN/UIN : 08AAKFS4821M1ZQ"], ["GSTIN/UIN : 08AAKFS4821M1ZQ"]]);
  expect([p.short[0][1], p.short[2][2]]).toEqual([{ text: " · GSTIN 08ABCPK1234F1Z5" }, { text: " · GSTIN 08AAKFS4821M1ZQ" }]);
  const none = printBill(bill({
    firm: { ...(wireDetail().firm as object), gst_number: "\n" },
    customer: { ...(wireDetail().customer as object), gst_number: " " },
  }), { showBank: true });
  expect(none.firm.gstin).toBe("");
  expect(none.firm.lines.filter((l) => l.includes("GSTIN"))).toEqual([]);
  expect(none.qr).toBe("KGH/2026-27/31||2026-10-08|87083.21");
  expect(none.parties.map((x) => x.lines.filter((l) => l.startsWith("GSTIN")))).toEqual([["GSTIN/UIN : Unregistered"], ["GSTIN/UIN : Unregistered"]]);
  expect([none.short[0], none.short[2]]).toEqual([[{ text: "KIRAN GOLD HOUSE", bold: true }], [{ text: "Buyer : " }, { text: "Anil Gupta", bold: true }]]);
});

test("the city follows the address unless a part of the address, between commas, is the city: Ajmer isn't Ajmeri Gate", () => {
  const where = (address: string, city: string) => printBill(bill({ customer: { ...(wireDetail().customer as object), address, city } }), { showBank: true }).parties[0].lines.slice(0, -2);
  expect(where("12 Ajmeri Gate, Jaipur Road", "Ajmer")).toEqual(["12 Ajmeri Gate, Jaipur Road, Ajmer"]);
  expect(where("15 Demo Road, Udaipur", "UDAIPUR")).toEqual(["15 Demo Road, Udaipur"]);
  expect(where("Shop 12\nUdaipur", "Udaipur")).toEqual(["Shop 12", "Udaipur"]);
  expect(where("", "Udaipur")).toEqual(["Udaipur"]);
});

test("a later page's short header comes in runs, the bold ones marked as the prototype bolds them: the firm's name, the number, the date and the buyer's name (Ruling 1E-10)", () => {
  const p = printBill(bill({ customer: { ...(wireDetail().customer as object), gst_number: "08AAKFS4821M1ZQ" } }), { showBank: true });
  expect(p.short).toEqual([
    [{ text: "KIRAN GOLD HOUSE", bold: true }, { text: " · GSTIN 08ABCPK1234F1Z5" }],
    [{ text: "Invoice No. " }, { text: "KGH/2026-27/31", bold: true }, { text: " · Dated " }, { text: "08 Oct 2026", bold: true }],
    [{ text: "Buyer : " }, { text: "Anil Gupta", bold: true }, { text: " · GSTIN 08AAKFS4821M1ZQ" }],
    [{ text: "Place of Supply : Rajasthan (08)" }],
  ]);
});
