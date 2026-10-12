// v2 generateReportExcel/reportExcelRoundTrip regressions ported to server-owned v3 figures.
import { bytesOf } from "@/core/files/zip";
import { excelBlob, type Sheet } from "./writer";
import { readExcel } from "./reader";

async function roundTrip(rows: (string | number)[][]) {
  const sheet: Sheet = { name: "Firm", cols: Array<number>(8).fill(120), rows: rows.map(row => ({ kind: "data", cells: row.map((v, i) => ({ v, num: i > 0 })) })) };
  return (await readExcel((await bytesOf(await excelBlob([sheet]))).buffer))[0].rows;
}

test("v2 signed round-offs cross-foot both bills and their server-supplied section total", async () => {
  // ₹971.23 + ₹14.57 + ₹14.57 − ₹0.37 = ₹1000; ₹486.17 + ₹7.29 + ₹7.29 + ₹0.25 = ₹501.
  const rows = await roundTrip([
    ["1", "971.23", "14.57", "14.57", "0.00", "-0.37", "1000.00"],
    ["2", "486.17", "7.29", "7.29", "0.00", "0.25", "501.00"],
    ["TOTAL", "1457.40", "21.86", "21.86", "0.00", "-0.12", "1501.00"],
  ]);
  expect(rows).toEqual([["1", 971.23, 14.57, 14.57, 0, -0.37, 1000], ["2", 486.17, 7.29, 7.29, 0, 0.25, 501], ["TOTAL", 1457.4, 21.86, 21.86, 0, -0.12, 1501]]);
});

test("v2 multiline rows retain net taxable value and a single bill value without doubling tax", async () => {
  // Two ₹10,000 lines, ₹150 in each local head per line: total ₹20,600.
  expect(await roundTrip([["S1", "10000.00", "150.00", "150.00", "0.00", "0.00", "20600.00"], ["", "10000.00", "150.00", "150.00", "0.00", "", ""]]))
    .toEqual([["S1", 10000, 150, 150, 0, 0, 20600], ["", 10000, 150, 150, 0, "", ""]]);
});

test("X36 sums server-rounded historical lines and never re-rounds their unrounded aggregate", async () => {
  // The server rounded each historical ₹0.025 line half-up to ₹0.03: the total is ₹0.06, not ₹0.05.
  expect(await roundTrip([["first", "0.03"], ["second", "0.03"], ["TOTAL", "0.06"]]))
    .toEqual([["first", 0.03], ["second", 0.03], ["TOTAL", 0.06]]);
});
