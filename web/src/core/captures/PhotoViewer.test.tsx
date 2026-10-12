import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { render } from "@testing-library/react";
import { PhotoDialog, PhotoViewer, ReadingChecks } from "./PhotoViewer";
import { readFixture } from "./fixtures";
import type { CapturePage } from "./types";

const photoRead = readFixture({
  confidence: { supplier: "high", gstin: "high", bill_no: "medium", date: "medium", amounts: "medium" }, notes: [],
});
const pages: CapturePage[] = [
  { page: 1, kind: "photo", url: "/media/bill-1.jpg", preview_url: "/media/bill-1-small.jpg", size: 1520000 },
  { page: 2, kind: "pdf", url: "/media/bill-2.pdf", preview_url: null, size: 90000 },
];
const mount = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("capture photo viewer", () => {
  it("shows the actual full-resolution photo and changes to the uploaded PDF with the keyboard", () => {
    mount(<PhotoViewer pages={pages} label="Bill photo" />);
    expect(screen.getByRole("img", { name: "Bill photo, page 1" })).toHaveAttribute("src", pages[0].url);
    fireEvent.keyDown(screen.getByRole("radio", { name: "Page 1" }), { key: "ArrowRight" });
    expect(screen.getByTitle("Bill photo, page 2 (PDF)")).toHaveAttribute("src", "/media/bill-2.pdf#zoom=100");
    expect(screen.getByRole("link", { name: "Open original" })).toHaveAttribute("href", pages[1].url);
  });

  it("supports buttons, +, −, 0, double-click, and clamps zoom between 100% and 300%", () => {
    mount(<PhotoViewer pages={pages} />);
    const frame = screen.getByRole("group", { name: /Use \+ and − to zoom/ });
    fireEvent.keyDown(frame, { key: "+" });
    expect(screen.getByText("150%")).toBeInTheDocument();
    fireEvent.keyDown(frame, { key: "−" });
    expect(screen.getByText("100%")).toBeInTheDocument();
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("300%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled();
    fireEvent.keyDown(frame, { key: "0" });
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    fireEvent.doubleClick(frame);
    expect(screen.getByText("200%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fit the whole bill" }));
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("resets zoom on page changes and displays previews when a PDF supplies one", () => {
    mount(<PhotoViewer pages={[pages[0], { ...pages[1], preview_url: "/media/pdf-preview.jpg" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("radio", { name: "Page 2" }));
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Bill photo, page 2" })).toHaveAttribute("src", "/media/pdf-preview.jpg");
  });

  it("keeps the original available after an image fails and recovers for a replacement URL", () => {
    const { rerender } = mount(<PhotoViewer pages={[{ ...pages[0], preview_url: null }]} />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("status")).toHaveTextContent("The preview couldn't be opened. Open the original file.");
    expect(screen.getByRole("link", { name: "Open original" })).toHaveAttribute("href", pages[0].url);
    rerender(<MemoryRouter><PhotoViewer pages={[{ ...pages[0], url: "/media/replaced.jpg" }]} /></MemoryRouter>);
    expect(screen.getByRole("img")).toHaveAttribute("src", "/media/replaced.jpg");
  });

  it("falls back from an unsupported original to its browser-safe preview and keeps the original link", () => {
    mount(<PhotoViewer pages={[{ ...pages[0], url: "/media/bill.heic", preview_url: "/media/bill-preview.jpg" }]} />);
    expect(screen.getByRole("img")).toHaveAttribute("src", "/media/bill.heic");
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("img")).toHaveAttribute("src", "/media/bill-preview.jpg");
    expect(screen.getByRole("link", { name: "Open original" })).toHaveAttribute("href", "/media/bill.heic");
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("status")).toHaveTextContent("The preview couldn't be opened. Open the original file.");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open original" })).toHaveAttribute("href", "/media/bill.heic");
  });

  it("handles no pages and shortened page lists without a broken image", () => {
    const { rerender } = mount(<PhotoViewer pages={pages} />);
    fireEvent.click(screen.getByRole("radio", { name: "Page 2" }));
    rerender(<MemoryRouter><PhotoViewer pages={[pages[0]]} /></MemoryRouter>);
    expect(screen.getByRole("img")).toHaveAttribute("src", pages[0].url);
    rerender(<MemoryRouter><PhotoViewer pages={[]} /></MemoryRouter>);
    expect(screen.getByText("No photo is attached.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("uses the kit dialog with an accessible title and Escape close", () => {
    vi.useFakeTimers();
    const close = vi.fn();
    mount(<PhotoDialog open onClose={close} title="Photo of UBS/26-27/0866" pages={pages} />);
    expect(screen.getByRole("dialog", { name: "Photo of UBS/26-27/0866" })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(400); });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("reading checks", () => {
  it("outlines the transcription and confirms only the chosen medium group", () => {
    const confirm = vi.fn();
    mount(<ReadingChecks read={photoRead} confirmed={{ date: true }} onConfirm={confirm} focusKey="bill_no" />);
    expect(screen.getByRole("region", { name: "What was read" })).toHaveTextContent("Compare these words and figures with the original bill.");
    const bill = screen.getByRole("group", { name: "bill number" });
    expect(bill).toHaveClass("border-brand");
    expect(bill).toHaveAttribute("data-focused", "true");
    fireEvent.click(within(bill).getByRole("button", { name: "Looks right: bill number" }));
    expect(confirm).toHaveBeenCalledWith("bill_no");
    expect(within(screen.getByRole("group", { name: "date" })).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("₹2,98,817.00")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("keeps confidence visible for viewers without offering confirmation", () => {
    mount(<ReadingChecks read={photoRead} confirmed={{}} />);
    expect(screen.getAllByText("Needs a check")).toHaveLength(3);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows each amount-only line's taxable value when quantity and rate are unread", () => {
    const line = { ...photoRead.lines[0], amount_only: true, quantity: null, rate: null };
    mount(<ReadingChecks read={{ ...photoRead, printed_total: null, lines_total: "1352.87", lines: [
      { ...line, product_name: "Gold bullion", taxable: "1234.56" },
      { ...line, product_name: "Labour", taxable: "78.90" },
    ] }} confirmed={{}} />);
    const amounts = within(screen.getByRole("group", { name: "quantities and rates" }));
    expect(amounts.getByText("Gold bullion · Amount only ₹1,234.56 · GST 3%", { exact: true })).toBeVisible();
    expect(amounts.getByText("Labour · Amount only ₹78.90 · GST 3%", { exact: true })).toBeVisible();
    expect(amounts.getByText("Printed total", { exact: false })).toHaveTextContent("Printed total —");
  });

  it("keeps an unreadable date and an unsupported printed rate available to correct", () => {
    mount(<ReadingChecks read={{ ...photoRead, invoice_date: "7/??/2026", lines: [{ ...photoRead.lines[0], gst_percent: null, printed_rate: "2.5%" }] }} confirmed={{}} />);
    expect(screen.getByRole("group", { name: "date" })).toHaveTextContent("7/??/2026");
    expect(screen.getByRole("group", { name: "quantities and rates" })).toHaveTextContent("GST 2.5%");
  });

  it("uses IRN wording without claiming signed QR verification or exact figures", () => {
    mount(<ReadingChecks read={{ ...photoRead, source: "e-invoice", irn: "a".repeat(64) }} confirmed={{}} />);
    expect(screen.getByText("From the e-invoice")).toBeInTheDocument();
    expect(screen.getByText("An IRN was read from this bill. Check the GST slab and save.")).toBeInTheDocument();
    expect(screen.queryByText(/signed QR|verified|they're exact/)).not.toBeInTheDocument();
  });
});
