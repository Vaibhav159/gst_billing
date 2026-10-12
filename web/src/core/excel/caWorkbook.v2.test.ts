import * as XLSX from "xlsx-js-style";
import { generateReportExcel, type Business, type Customer, type Invoice, type InvoiceItem } from "./__fixtures__/v2Report";
import { bytesOf } from "@/core/files/zip";
import { workbookBlob, type WorkbookSection, type WorkbookTotals } from "./caWorkbook";
import { caFixture } from "./fixtures";

const DETAIL_HEAD = [
  "S.No.", "Bill No.", "Invoice Date", "Party Name", "GST Number", "Commodity", "HSN Code", "GST Rate",
  "Qty (gm)", "Rate (₹/gm)", "Taxable Value (₹)", "CGST (₹)", "SGST (₹)", "IGST (₹)", "Round Off (₹)", "Total Invoice Value (₹)",
];
const SUMMARY_HEAD = [
  "Firm Name", "Invoices", "Taxable Value (₹)", "CGST (₹)", "SGST (₹)", "IGST (₹)", "Round Off (₹)", "Total Invoice Value (₹)",
  "Invoices", "Taxable Value (₹)", "CGST (₹)", "SGST (₹)", "IGST (₹)", "Round Off (₹)", "Total Invoice Value (₹)", "Net Total (₹)",
];
const business: Business = { id: "3", name: "CA Fixture Jewellers", gst_number: "08VRHFA2322D1ZI" };
const customers: Customer[] = [
  { id: "1", name: "Registered Buyer", gst_number: "08ABCDE1234F1Z5" },
  { id: "2", name: "PAN Buyer", pan_number: "ABCDE1234F" },
  { id: "3", name: "Walk-in Buyer" },
  { id: "4", name: "Diamond Supplier", gst_number: "08ABCDE1234F1Z5" },
];

function item(values: Partial<InvoiceItem>): InvoiceItem {
  return { productId: "1", productName: "Silver", hsn: "711311", gstRate: 3, qty: 1, rate: 10, unit: "gms", amount: 10.30, cgst: 0, sgst: 0, igst: 0.30, ...values };
}

function bill(number: string, partyId: string, values: Partial<Invoice>): Invoice {
  const party = customers.find(customer => customer.id === partyId)!;
  return {
    id: number, invoiceNumber: number, invoice_date: "2026-09-12", customerId: partyId, customerName: party.name,
    businessId: business.id, businessName: business.name, type: "OUTWARD", isIGST: false,
    items: [item({})], subtotal: 10, totalCGST: 0, totalSGST: 0, totalIGST: 0.30, totalTax: 0.30,
    total: 10.30, roundedOff: 0, paymentMode: "bank", financialYear: "2026-27", createdAt: "", updatedAt: "", ...values,
  };
}

function invoices(): Invoice[] {
  return [
    bill("9", "1", { isIGST: true, items: [item({ qty: 10, rate: 1.005, amount: 10.35 })], subtotal: 10.05, total: 10.35 }),
    bill("10", "3", { invoice_date: "2026-09-13", items: [], subtotal: 0, totalIGST: 0, totalTax: 0, total: 0, paymentMode: "" }),
    bill("12", "2", {
      items: [
        item({ productName: "Gold Ring", hsn: "711319", qty: 2, rate: 1234.567, amount: 2543.21, cgst: 37.04, sgst: 37.04, igst: 0 }),
        item({ productName: "Chain", hsn: "711319", unit: "pcs", rate: 100, amount: 103, cgst: 1.50, sgst: 1.50, igst: 0 }),
      ],
      subtotal: 2569.13, totalCGST: 38.54, totalSGST: 38.54, totalIGST: 0, totalTax: 77.08,
      total: 2646, roundedOff: -0.21, paymentMode: "cash",
    }),
    bill("D/7", "4", {
      type: "INWARD", invoice_date: "2026-10-05",
      items: [item({ productName: "Diamond", hsn: "710239", gstRate: 0.25, qty: 6.4, unit: "ct", rate: 56400.123, amount: 361863.19, cgst: 451.20, sgst: 451.20, igst: 0 })],
      subtotal: 360960.79, totalCGST: 451.20, totalSGST: 451.20, totalIGST: 0, totalTax: 902.40,
      total: 361863, roundedOff: -0.19,
    }),
  ].reverse();
}

function totals(bills: Invoice[]): WorkbookTotals {
  const sum = (field: "subtotal" | "totalCGST" | "totalSGST" | "totalIGST" | "roundedOff" | "total") =>
    (bills.reduce((value, invoice) => value + Math.round((invoice[field] ?? 0) * 100), 0) / 100).toFixed(2);
  return { bills: bills.length, taxable: sum("subtotal"), cgst: sum("totalCGST"), sgst: sum("totalSGST"), igst: sum("totalIGST"), round_off: sum("roundedOff"), value: sum("total") };
}

/** The same bills expressed as the existing server-owned, 20-column CA response. */
function section(bills: Invoice[], split: boolean): WorkbookSection {
  const rows = bills.flatMap((invoice, number) => (invoice.items.length ? invoice.items : [null]).map((line, index) => {
    const first = index === 0;
    const party = customers.find(customer => customer.id === invoice.customerId)!;
    const id = party.gst_number || (party.pan_number ? `${party.pan_number} (PAN)` : "-");
    return [
      ...(first ? [number + 1, invoice.invoiceNumber, invoice.invoice_date, invoice.customerName, id] : ["", "", "", "", ""]),
      ...(line ? [line.productName, line.hsn, String(line.gstRate), line.qty.toFixed(3), line.unit ?? "gms", line.rate.toFixed(3),
        (line.amount - line.cgst - line.sgst - line.igst).toFixed(2), line.cgst.toFixed(2), line.sgst.toFixed(2), line.igst.toFixed(2)]
        : ["(no items)", "", "", "", "", "", "0.00", "0.00", "0.00", "0.00"]),
      first ? (invoice.roundedOff ?? 0).toFixed(2) : "", first ? invoice.total.toFixed(2) : "", invoice.paymentMode ?? "",
      ...(invoice.type === "INWARD" ? ["2026-10", "to_claim"] : ["B2B", "08"]),
    ];
  }));
  const buckets = [...new Set(bills.map(invoice => invoice.paymentMode ?? ""))].map(mode => ({
    mode, ...totals(bills.filter(invoice => (invoice.paymentMode ?? "") === mode)),
  })).sort((a, b) => Number(b.value) - Number(a.value));
  const grossPaise = buckets.reduce((sum, bucket) => sum + Math.round(Number(bucket.value) * 100), 0);
  let used = 0;
  const payment = buckets.map((bucket, index) => {
    // Four decimal percentage points, with the residual assigned to the last mode.
    const share = index === buckets.length - 1 ? 1000000 - used
      : Math.round(Math.round(Number(bucket.value) * 100) * 1000000 / (grossPaise || 1));
    used += share;
    return { ...bucket, share: (share / 10000).toFixed(4) };
  });
  return { rows, totals: totals(bills), split: split ? payment : [] };
}

async function both(includePayment: boolean) {
  const bills = invoices();
  const data = caFixture();
  const sales = section(bills.filter(invoice => invoice.type === "OUTWARD"), includePayment);
  const purchases = section(bills.filter(invoice => invoice.type === "INWARD"), includePayment);
  data.firms[0].firm = { id: Number(business.id), name: business.name, gst_number: business.gst_number! };
  // The server emits every requested month/side, including those without bills.
  data.firms[0].months = ["2026-08", "2026-09", "2026-10", "2026-11"].map(month => ({
    month,
    sales: section(bills.filter(invoice => invoice.type === "OUTWARD" && invoice.invoice_date.startsWith(month)), includePayment),
    purchases: section(bills.filter(invoice => invoice.type === "INWARD" && invoice.invoice_date.startsWith(month)), includePayment),
  }));
  data.period = "Aug 2026 to Nov 2026";
  data.summary = [{ firm: business.name, sales: sales.totals, purchases: purchases.totals }];
  const before = JSON.stringify(data);
  const oldBlob = generateReportExcel({ invoices: bills, businesses: [business], customers, includePayment });
  const newBlob = await workbookBlob(data);
  expect(JSON.stringify(data)).toBe(before);
  return Promise.all([oldBlob, newBlob].map(async blob => XLSX.read(await bytesOf(blob), { type: "array", cellNF: true })));
}

function cell(sheet: XLSX.WorkSheet, row: number, column: number): XLSX.CellObject {
  return sheet[XLSX.utils.encode_cell({ r: row, c: column })] as XLSX.CellObject;
}
function prefix(sheet: XLSX.WorkSheet, row: number, width: number) {
  return Array.from({ length: width }, (_, column) => {
    const value = cell(sheet, row, column);
    return value ? { v: value.v, t: value.t, z: value.z ?? "General" } : null;
  });
}
function findRows(sheet: XLSX.WorkSheet, column: number, value: string): number[] {
  const range = XLSX.utils.decode_range(sheet["!ref"]!);
  return Array.from({ length: range.e.r + 1 }, (_, row) => row).filter(row => cell(sheet, row, column)?.v === value);
}
function detailSections(sheet: XLSX.WorkSheet, width: number) {
  return findRows(sheet, 0, "S.No.").map(header => {
    const rows = [];
    for (let row = header + 1; cell(sheet, row, 0)?.v !== "TOTAL"; row += 1) {
      if (row > XLSX.utils.decode_range(sheet["!ref"]!).e.r) throw new Error("Missing invoice section total");
      rows.push(prefix(sheet, row, width));
    }
    return { header: prefix(sheet, header, width), rows };
  });
}

test.each([false, true])("X-81 preserves the actual v2 Summary columns and figures (payment split %s)", async includePayment => {
  const [oldBook, newBook] = await both(includePayment);
  expect(newBook.SheetNames.slice(0, oldBook.SheetNames.length)).toEqual(oldBook.SheetNames);
  const oldSheet = oldBook.Sheets.Summary;
  const newSheet = newBook.Sheets.Summary;
  expect(prefix(oldSheet, 2, 16).map(value => value?.v)).toEqual(SUMMARY_HEAD);
  expect(prefix(newSheet, 2, 16)).toEqual(prefix(oldSheet, 2, 16));
  expect(prefix(newSheet, 3, 16)).toEqual(prefix(oldSheet, 3, 16));
  const oldTotal = findRows(oldSheet, 0, "GRAND TOTAL");
  const newTotal = findRows(newSheet, 0, "GRAND TOTAL");
  expect(newTotal).toHaveLength(1);
  expect(prefix(newSheet, newTotal[0], 16)).toEqual(prefix(oldSheet, oldTotal[0], 16));
});

test.each([false, true])("X-81 keeps v2's detail prefix, all item figures and cell formats (payment split %s)", async includePayment => {
  const [oldBook, newBook] = await both(includePayment);
  const width = includePayment ? 17 : 16;
  const oldSections = detailSections(oldBook.Sheets[business.name], width);
  const newSections = detailSections(newBook.Sheets[business.name], width);
  expect(oldSections).toHaveLength(2);
  expect(oldSections.map(value => value.rows.length)).toEqual([4, 1]);
  const expected = [...DETAIL_HEAD, ...(includePayment ? ["Payment"] : [])];
  for (const value of oldSections) expect(value.header.map(entry => entry?.v)).toEqual(expected);
  expect(newSections).toEqual(oldSections);
});

test.each([false, true])("X-81 preserves v2's section and period totals and omits empty months/sides (payment split %s)", async includePayment => {
  const [oldBook, newBook] = await both(includePayment);
  const oldSheet = oldBook.Sheets[business.name];
  const newSheet = newBook.Sheets[business.name];
  const oldTotals = findRows(oldSheet, 0, "TOTAL");
  const newTotals = findRows(newSheet, 0, "TOTAL");
  expect(newTotals).toHaveLength(2);
  expect(newTotals.map(row => prefix(newSheet, row, 16))).toEqual(oldTotals.map(row => prefix(oldSheet, row, 16)));
  for (const label of [
    "Outward Supply", "Inward Supply", "Month: Sep 2026", "Month: Oct 2026",
    "PERIOD SUMMARY (Sep 2026 to Oct 2026)", "Supply Type",
    "Outward Supply (3 invoices)", "Inward Supply (1 invoices)", "GRAND TOTAL",
  ]) {
    const oldRows = findRows(oldSheet, 0, label);
    const newRows = findRows(newSheet, 0, label);
    expect(oldRows, label).toHaveLength(1);
    expect(newRows, label).toHaveLength(1);
    expect(prefix(newSheet, newRows[0], 16), label).toEqual(prefix(oldSheet, oldRows[0], 16));
  }
  expect(findRows(newSheet, 0, "Month: Aug 2026")).toEqual([]);
  expect(findRows(newSheet, 0, "Month: Nov 2026")).toEqual([]);
  const saleRows = detailSections(newSheet, 16)[0].rows;
  expect(saleRows.map(row => row[1]?.v)).toEqual(["9", "12", "", "10"]);
  expect(saleRows.map(row => row[0]?.v)).toEqual([1, 2, "", 3]);
});

test("X-81 preserves the optional v2 payment split's first six columns, values and number formats", async () => {
  const [oldBook, newBook] = await both(true);
  const oldSheet = oldBook.Sheets[business.name];
  const newSheet = newBook.Sheets[business.name];
  const oldBlocks = findRows(oldSheet, 0, "PAYMENT SPLIT (cash / bank)");
  const newBlocks = findRows(newSheet, 0, "PAYMENT SPLIT (cash / bank)");
  expect(oldBlocks).toHaveLength(2);
  expect(newBlocks).toHaveLength(2);
  const counts = [3, 1];
  for (const [index, oldRow] of oldBlocks.entries()) {
    const newRow = newBlocks[index];
    expect(prefix(oldSheet, oldRow + 1, 6).map(value => value?.v))
      .toEqual(["MODE", "INVOICES", "GROSS (₹)", "TAXABLE (₹)", "GST (₹)", "SHARE %"]);
    for (let offset = 1; offset <= counts[index] + 1; offset += 1) {
      expect(prefix(newSheet, newRow + offset, 6)).toEqual(prefix(oldSheet, oldRow + offset, 6));
    }
    const shares = Array.from({ length: counts[index] }, (_, row) => Number(cell(newSheet, newRow + row + 2, 5).v));
    expect(shares.reduce((sum, value) => sum + Math.round(value * 10000), 0)).toBe(1000000);
  }
  expect([2, 3, 4].map(offset => cell(newSheet, newBlocks[0] + offset, 0).v)).toEqual(["Cash", "Bank", "(not set)"]);
  const [, plainBook] = await both(false);
  expect(findRows(plainBook.Sheets[business.name], 0, "PAYMENT SPLIT (cash / bank)")).toEqual([]);
});

test("X-81 appends the original unit and precise rate without converting carats or changing multiline blanks", async () => {
  const [, newBook] = await both(true);
  const sheet = newBook.Sheets[business.name];
  const header = findRows(sheet, 0, "S.No.")[0];
  expect(prefix(sheet, header, 19).map(value => value?.v)).toEqual([...DETAIL_HEAD, "Payment", "Unit", "Rate per unit"]);
  const diamond = findRows(sheet, 5, "Diamond")[0];
  expect(cell(sheet, diamond, 7)).toMatchObject({ t: "s", v: "0.25%" });
  expect(cell(sheet, diamond, 8)).toMatchObject({ t: "n", v: 6.4, z: "#,##0.000" });
  expect(cell(sheet, diamond, 9)).toMatchObject({ t: "n", v: 56400.12, z: "#,##0.00" });
  expect(cell(sheet, diamond, 17)).toMatchObject({ t: "s", v: "ct" });
  expect(cell(sheet, diamond, 18)).toMatchObject({ t: "n", v: 56400.123, z: "#,##0.000" });
  const silver = findRows(sheet, 5, "Silver")[0];
  // The original three-decimal rate is retained after the legacy rounded rate.
  expect(cell(sheet, silver, 18)).toMatchObject({ t: "n", v: 1.005, z: "#,##0.000" });
  const chain = findRows(sheet, 5, "Chain")[0];
  for (const column of [0, 1, 2, 3, 4, 14, 15, 16]) expect(cell(sheet, chain, column)?.v).toBe("");
  expect(cell(sheet, chain, 17)?.v).toBe("pcs");
  const empty = findRows(sheet, 1, "10")[0];
  expect([5, 6, 7].map(column => cell(sheet, empty, column)?.v)).toEqual(["", "", ""]);
  expect(cell(sheet, empty, 8)).toMatchObject({ t: "n", v: 0, z: "#,##0.000" });
  expect(cell(sheet, empty, 9)).toMatchObject({ t: "n", v: 0, z: "#,##0.00" });
});
