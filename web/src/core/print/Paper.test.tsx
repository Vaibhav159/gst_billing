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
  expect(within(paper).getByRole("table")).toHaveTextContent("SGST/UTGST Amount");
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
  const cells = within(paper).getAllByRole("row").map((r) => [...r.querySelectorAll("th, td")].map((c) => c.textContent));
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

test("on a narrow screen the paper shrinks to fit, and a button shows it full size and back; where it fits, there's no button", async () => {
  const p = bill();
  const zoom = () => screen.getByRole("document").parentElement!.style.zoom;
  const { unmount } = renderApp(<ScaledPaper b={p} copy={COPY_MARKS[0]} page={p.pages[0]} />);
  expect(Number(zoom())).toBeCloseTo(358 / A4_W); // jsdom lays nothing out, so the box reads as a 358 px phone
  await userEvent.click(screen.getByRole("button", { name: "See it full size" }));
  expect(zoom()).toBe("");
  await userEvent.click(screen.getByRole("button", { name: "Fit to the screen" }));
  expect(Number(zoom())).toBeCloseTo(358 / A4_W);
  unmount();
  vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(1000);
  renderApp(<ScaledPaper b={p} copy={COPY_MARKS[0]} page={p.pages[0]} />);
  expect(zoom()).toBe("1");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
