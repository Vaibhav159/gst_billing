import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { wireDetail, WIRE_LINES } from "@/core/sales/fixtures";
import { toBillDetail } from "@/core/sales/wire";
import { renderApp } from "@/test/render";
import { COPY_MARKS, printBill } from "./model";
import { A4_W, Paper, PrintCopy, ScaledPaper } from "./Paper";

const bill = (over: Record<string, unknown> = {}) => printBill(toBillDetail(wireDetail(over)), { showBank: true });
afterEach(() => { vi.restoreAllMocks(); });

test("the paper on screen says what prints: the copy's mark, the rows, the total to the paisa, the words, the bank and the QR code", () => {
  const p = bill();
  render(<Paper b={p} copy={COPY_MARKS[1]} page={p.pages[0]} />);
  const paper = screen.getByRole("document", { name: "Bill KGH/2026-27/31 on paper, duplicate copy" });
  for (const w of ["(DUPLICATE FOR TRANSPORTER)", "Tax Invoice", "Gold Ring 22K", "Peacock design", "12.345 gms", "80,396.81", "₹ 87,083.21",
    "INR Eighty Seven Thousand Eighty Three Rupees and Twenty One Paise Only", "Company's Bank Details", ": 000000000003", "for KIRAN GOLD HOUSE", "SUBJECT TO UDAIPUR JURISDICTION"]) {
    expect(paper).toHaveTextContent(w);
  }
  expect(paper).not.toHaveTextContent("Rounded Off");
  expect(within(paper).getByRole("img", { name: "QR code: KGH/2026-27/31, 08ABCPK1234F1Z5, 08 Oct 2026, ₹87,083.21" })).toBeInTheDocument();
  expect(within(paper).getByRole("table", { name: "Tax by HSN/SAC" })).toHaveTextContent("SGST/UTGST Amount");
});

test("a page after the first has the short header, no QR, and the next page's number at its foot", () => {
  const lines = Array.from({ length: 60 }, (_, i) => ({ ...WIRE_LINES[0], id: i + 1, product_name: `Gold Ring 22K ${i + 1}` }));
  const p = bill({ lines, status: "cancelled" });
  render(<Paper b={p} copy={COPY_MARKS[0]} page={p.pages[1]} />);
  const paper = screen.getByRole("document", { name: "Bill KGH/2026-27/31 on paper, original copy, page 2 of 3" });
  expect(paper).toHaveTextContent("Tax Invoice (continued, page 2)");
  expect(paper).toHaveTextContent("Invoice No. KGH/2026-27/31 · Dated 08 Oct 2026");
  expect(paper).toHaveTextContent("continued on page 3");
  expect(within(paper).queryByRole("img", { name: /^QR code/ })).not.toBeInTheDocument();
  expect(within(paper).getByRole("img", { name: "Cancelled" })).toBeInTheDocument();
  expect(within(paper).getByRole("heading", { level: 2, name: "Tax Invoice (continued, page 2)" })).toBeInTheDocument();
  // the sheet's own lines and only them, under its copy's mark and its place among the pages
  expect(paper).toHaveTextContent("Page 2 of 3");
  expect(paper).toHaveTextContent("(ORIGINAL FOR RECIPIENT)");
  const own = p.pages[1].lines;
  expect(within(paper).getAllByText(/^Gold Ring 22K \d+$/)).toHaveLength(own.length);
  expect(within(paper).getByText(`Gold Ring 22K ${own[0] + 1}`)).toBeInTheDocument();
  expect(within(paper).getByText(`Gold Ring 22K ${own[own.length - 1] + 1}`)).toBeInTheDocument();
  expect(within(paper).queryByText("Gold Ring 22K 1")).not.toBeInTheDocument(); // page 1's
  expect(within(paper).queryByText("Gold Ring 22K 60")).not.toBeInTheDocument(); // page 3's
});

test("a later page's short header bolds the firm's name, the bill number, the date and the buyer's name, as the prototype does (Ruling 1E-10)", () => {
  const p = bill({ lines: Array.from({ length: 30 }, (_, i) => ({ ...WIRE_LINES[0], id: i + 1 })), customer: { ...(wireDetail().customer as object), gst_number: "08AAKFS4821M1ZQ" } });
  render(<Paper b={p} copy={COPY_MARKS[0]} page={p.pages[1]} />);
  const paper = screen.getByRole("document");
  const boldIn = (line: string) => [...within(paper).getByText((_, el) => el?.tagName === "DIV" && el.textContent === line).querySelectorAll(".font-bold")].map((el) => el.textContent);
  expect(boldIn("KIRAN GOLD HOUSE · GSTIN 08ABCPK1234F1Z5")).toEqual(["KIRAN GOLD HOUSE"]);
  expect(boldIn("Invoice No. KGH/2026-27/31 · Dated 08 Oct 2026")).toEqual(["KGH/2026-27/31", "08 Oct 2026"]);
  expect(boldIn("Buyer : Anil Gupta · GSTIN 08AAKFS4821M1ZQ")).toEqual(["Anil Gupta"]);
  expect(boldIn("Place of Supply : Rajasthan (08)")).toEqual([]);
});

test("the print copy sits outside the app, hidden from screen readers: the browser's print shows it alone (styles.css)", () => {
  const p = bill();
  render(<div id="app"><PrintCopy><Paper b={p} copy={COPY_MARKS[0]} page={p.pages[0]} /></PrintCopy></div>);
  const copy = document.querySelector("[data-print-copy]")!;
  expect(copy.parentElement).toBe(document.body);
  expect(copy).toHaveAttribute("aria-hidden", "true");
  expect(document.getElementById("app")).toBeEmptyDOMElement();
  expect(screen.queryByRole("document")).not.toBeInTheDocument();
  expect(copy.querySelector("[data-paper]")).toHaveTextContent("ORIGINAL FOR RECIPIENT");
});

test("the A4 sheet without margins holds only while a print copy is mounted, not for every Ctrl P in the app (Ruling 1E-10)", () => {
  const p = bill();
  const pageRules = () => [...document.styleSheets].flatMap((s) => [...s.cssRules]).map((r) => r.cssText).filter((t) => t.includes("@page"));
  expect(pageRules()).toEqual([]);
  const { unmount } = render(<PrintCopy><Paper b={p} copy={COPY_MARKS[0]} page={p.pages[0]} /></PrintCopy>);
  expect(pageRules()).toEqual([expect.stringMatching(/^@media print \{\s*@page \{\s*size: A4; margin: 0;?\s*\}\s*\}$/)]);
  unmount();
  expect(pageRules()).toEqual([]);
  // and the app's own stylesheet sets none, so Ctrl P anywhere else keeps the browser's sheet and margins
  expect(readFileSync(resolve(__dirname, "../../styles.css"), "utf8")).not.toMatch(/@page/);
});

test("a firm without a GSTIN: the QR code's name leaves the GSTIN out, with no empty part", () => {
  const p = bill({ firm: { ...(wireDetail().firm as object), gst_number: "" } });
  render(<Paper b={p} copy={COPY_MARKS[0]} page={p.pages[0]} />);
  expect(screen.getByRole("img", { name: /^QR code/ })).toHaveAccessibleName("QR code: KGH/2026-27/31, 08 Oct 2026, ₹87,083.21");
});

test("typed text shows as typed, a ₹ too (Ruling 1E-5), and the bill's note keeps its line breaks, as the PDF prints them", () => {
  const p = bill({
    notes: "₹5,000 paid in advance\nBalance on delivery",
    customer: { ...(wireDetail().customer as object), address: "Shop 4, ₹ Market" },
    lines: [{ ...WIRE_LINES[0], product_name: "Ring ₹ motif 22K", note: "Stone worth ₹1,200 inside" }],
  });
  render(<Paper b={p} copy={COPY_MARKS[0]} page={p.pages[0]} />);
  const paper = screen.getByRole("document");
  for (const w of ["Ring ₹ motif 22K", "Stone worth ₹1,200 inside", "Shop 4, ₹ Market, Udaipur", "Note: ₹5,000 paid in advance"]) expect(paper).toHaveTextContent(w);
  const note = within(paper).getByText("₹5,000 paid in advance Balance on delivery");
  expect(note.textContent).toBe("₹5,000 paid in advance\nBalance on delivery");
  expect(note).toHaveStyle({ whiteSpace: "pre-line" });
});

test("a line typed twice in an address prints twice, each in its place: lines are keyed by their place, not their words", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const p = bill({
    firm: { ...(wireDetail().firm as object), address: "Johari Bazaar\nJohari Bazaar" },
    customer: { ...(wireDetail().customer as object), address: "Near Clock Tower\nNear Clock Tower", city: "" },
  });
  render(<Paper b={p} copy={COPY_MARKS[0]} page={p.pages[0]} />);
  expect(screen.getAllByText("Johari Bazaar")).toHaveLength(2);
  expect(screen.getAllByText("Near Clock Tower")).toHaveLength(4); // twice for the consignee, twice for the buyer
  expect(error).not.toHaveBeenCalled(); // React's "Encountered two children with the same key"
});

test("an inter-state bill sets out IGST in the HSN summary; bank details off print no bank block; the firm's signature sits above the signatory", () => {
  const d = toBillDetail(wireDetail({
    interstate: true, cgst: "0.00", sgst: "0.00", igst: "2536.40", place_of_supply: "24",
    lines: WIRE_LINES.map((l) => ({ ...l, cgst: "0.00", sgst: "0.00", igst: l.tax })),
    slabs: [{ gst_percent: "3", taxable: "84546.81", cgst: "0.00", sgst: "0.00", igst: "2536.40", tax: "2536.40" }],
    hsn_summary: [
      { hsn_code: "711319", gst_percent: "3", unit: "gms", quantity: "12.345", taxable: "80396.81", cgst: "0.00", sgst: "0.00", igst: "2411.90", tax: "2411.90" },
      { hsn_code: "711319", gst_percent: "3", unit: "pcs", quantity: "1.000", taxable: "4150.00", cgst: "0.00", sgst: "0.00", igst: "124.50", tax: "124.50" },
    ],
    firm: { ...(wireDetail().firm as object), signature_url: "/api/media/signatures/3.png?s=abc" },
  }));
  const p = printBill(d, { showBank: false });
  render(<Paper b={p} copy={COPY_MARKS[0]} page={p.pages[0]} />);
  const paper = screen.getByRole("document");
  const cells = within(within(paper).getByRole("table", { name: "Tax by HSN/SAC" })).getAllByRole("row").map((r) => [...r.querySelectorAll("th, td")].map((c) => c.textContent));
  expect(cells).toEqual([
    ["HSN/SAC", "Taxable Value", "IGST Rate", "IGST Amount", "Total Tax Amount"],
    ["711319", "80,396.81", "3%", "2,411.90", "2,411.90"],
    ["711319", "4,150.00", "3%", "124.50", "124.50"],
    ["Total", "84,546.81", "", "2,536.40", "2,536.40"],
  ]);
  expect(paper).toHaveTextContent("IGST3%2,536.40"); // the tax row: its head, rate and amount in their columns
  expect(paper).not.toHaveTextContent("Company's Bank Details");
  expect(within(paper).getByRole("img", { name: "Signature for KIRAN GOLD HOUSE" })).toHaveAttribute("src", "/api/media/signatures/3.png?s=abc");
});

test("an empty box and a one-page bill's copy-mark line keep the prototype's non-breaking space, so they keep their height", () => {
  const p = bill();
  render(<Paper b={p} copy={COPY_MARKS[0]} page={p.pages[0]} />);
  const paper = screen.getByRole("document");
  expect(within(paper).getByText("Reference No. & Date.").nextElementSibling!.textContent).toBe("\u00a0");
  expect(within(paper).getByText("(ORIGINAL FOR RECIPIENT)").previousElementSibling!.textContent).toBe("\u00a0");
});

test("a screen reader reads the title and the declaration as headings and the goods as a table, with nothing changed on the paper", () => {
  const p = bill();
  render(<Paper b={p} copy={COPY_MARKS[0]} page={p.pages[0]} />);
  const paper = screen.getByRole("document");
  expect(within(paper).getByRole("heading", { level: 2 })).toHaveTextContent(/^Tax Invoice$/);
  expect(within(paper).getByRole("heading", { level: 3 })).toHaveTextContent(/^Declaration$/);
  const goods = within(paper).getByRole("table", { name: "Goods" });
  expect(within(goods).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Sl No.", "Description of Goods", "HSN/SAC", "Quantity", "Rate", "per", "Amount"]);
  expect(within(goods).getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell").map((c) => c.textContent))).toEqual([
    ["1", "Gold Ring 22K", "711319", "12.345 gms", "6,512.50", "gms", "80,396.81"],
    ["2", "Gold Pendant 22KPeacock design", "711319", "1 pcs", "4,150.00", "pcs", "4,150.00"], // the line's note sits under its name
    ["", "CGST", "", "", "1.5%", "", "1,268.20"],
    ["", "SGST", "", "", "1.5%", "", "1,268.20"],
    ["", "Total", "", "", "", "", "₹ 87,083.21"],
  ]);
  // the empty row that stretches the table down the sheet says nothing
  expect(goods.querySelectorAll('[role="row"][aria-hidden="true"]')).toHaveLength(1);
});

test("on a narrow screen the paper shrinks to fit, and a button shows it full size and back; where it fits, there's no button", async () => {
  const p = bill();
  const zoom = () => screen.getByRole("document").parentElement!.style.zoom;
  const { unmount } = renderApp(<ScaledPaper b={p} copy={COPY_MARKS[0]} page={p.pages[0]} />);
  expect(Number(zoom())).toBeCloseTo(358 / A4_W); // jsdom lays nothing out, so the box reads as a 358 px phone
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "See it full size" }));
  expect(zoom()).toBe("");
  expect(screen.getByRole("region", { name: "The bill at full size" })).toHaveAttribute("tabindex", "0"); // the keyboard can scroll it
  await userEvent.click(screen.getByRole("button", { name: "Fit to the screen" }));
  expect(Number(zoom())).toBeCloseTo(358 / A4_W);
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
  unmount();
  vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(1000);
  renderApp(<ScaledPaper b={p} copy={COPY_MARKS[0]} page={p.pages[0]} />);
  expect(zoom()).toBe("1");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
