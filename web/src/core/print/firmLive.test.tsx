import { render, screen } from "@testing-library/react";
import { wireDetail } from "@/core/sales/fixtures";
import { toBillDetail } from "@/core/sales/wire";
import { BillDocument } from "./BillDocument";
import { Paper } from "./Paper";
import { makeBillPdf } from "./make";
import { copyPages, DECLARATION, printBill } from "./model";
import { expand, firmWith, flat, nodes, pdfText, rows, rupeeTexts, sheetsIn, words } from "./testing";
const bill = (firm: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => toBillDetail(wireDetail({ ...extra, firm: firmWith(firm) }));
const live = { city: "Jaipur", pin_code: "302003", short: "Kiran", jurisdiction_printed: "Jaipur", declaration_printed: "Our live declaration: ₹1 deposit.\nKeep this copy.", signature_on_bills: false, signature_url: "/api/media/signature", bank_account_number: "12345678901" };

test("a frozen bill keeps its identity and address but prints the live account and small print", () => {
  const d = bill({ ...live, frozen: true, name: "Earlier legal name", address: "Earlier street", gst_number: "08VRHFA2322D1ZI" });
  expect(d.firm).toMatchObject(live);
  const p = printBill(d, { showBank: true });
  expect(p.firm).toMatchObject({ name: "Earlier legal name", gstin: "08VRHFA2322D1ZI", signature: null });
  expect(p.firm.lines).toContain("Earlier street");
  expect(p.firm.lines.join(" ")).not.toMatch(/Jaipur|302003/);
  expect(p.firm.bank).toContainEqual(["A/c No.", "12345678901"]);
  expect(p).toMatchObject({ declaration: "Our live declaration: ₹1 deposit. Keep this copy.", jurisdiction: "Jaipur" });
});
test("older bill responses retain their signature and the old small-print defaults", () => {
  const p = printBill(bill({ signature_url: "/api/media/signature" }), { showBank: false });
  expect(p.firm.signature).toBe("/api/media/signature");
  expect(p).toMatchObject({ declaration: DECLARATION, jurisdiction: "Udaipur" });
  expect(printBill(bill({ city: "Jaipur", jurisdiction_printed: "", declaration_printed: "" }), { showBank: true }).jurisdiction).toBe("Jaipur");
});
test("the paper and PDF use the same live words and signature switch, with every rupee in its font", () => {
  const p = printBill(bill(live), { showBank: true });
  render(<Paper b={p} copy={copyPages("original")[0]} page={p.pages[0]} />);
  expect(screen.getByRole("document")).toHaveTextContent("Our live declaration: ₹1 deposit. Keep this copy.");
  expect(screen.getByRole("document")).toHaveTextContent("SUBJECT TO JAIPUR JURISDICTION");
  expect(screen.queryByRole("img", { name: /Signature for/ })).not.toBeInTheDocument();
  const document = expand(<BillDocument bills={[p]} copies={copyPages("original")} title="t" />)[0];
  if (typeof document === "string") throw new Error("Expected document");
  expect(words(document)).toContain("Our live declaration: ₹1 deposit. Keep this copy.");
  expect(nodes(document, "IMAGE")).toHaveLength(0);
  for (const text of rupeeTexts(document)) { expect(text.children).toEqual(["₹"]); expect(flat(text.props.style).fontFamily).toBe("RupeeSign"); }
});
test("maximum small print stays on the planned sheets in a real PDF", async () => {
  const long = { signature_on_bills: false, declaration_printed: "WIDE WORDS ".repeat(46).slice(0, 500), jurisdiction_printed: "WIDE CITY ".repeat(10).slice(0, 100) };
  const p = printBill(bill(long, { lines: rows(9) }), { showBank: true });
  expect(p.pages).toHaveLength(2);
  expect(sheetsIn(await pdfText(await makeBillPdf([p], "original", { title: "Live firm small print" })))).toBe(p.pages.length);
});

test("newline-dense valid small print stays one paragraph and the PDF follows the page plan", async () => {
  const p = printBill(bill({ declaration_printed: "W\n".repeat(250), jurisdiction_printed: "A\n".repeat(50), signature_on_bills: false }, { lines: rows(9) }), { showBank: true });
  expect(p.declaration).toBe("W ".repeat(250).trim());
  expect(p.jurisdiction).toBe("A ".repeat(50).trim());
  expect(p.pages.length).toBeLessThanOrEqual(2);
  expect(sheetsIn(await pdfText(await makeBillPdf([p], "original", { title: "Paragraphs" })))).toBe(p.pages.length);
});
