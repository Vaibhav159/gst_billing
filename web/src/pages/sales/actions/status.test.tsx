import { render, screen, within } from "@testing-library/react";
import { toBillDetail, toBillRow } from "@/core/sales/wire";
import { wireDetail, wireRow } from "@/core/sales/fixtures";
import { dataProblem, StatusCell, TaxTypeBadge } from "./StatusCell";

const row = (over: Record<string, unknown> = {}) => toBillRow(wireRow(over));
const CASH = { kind: "cash_limit", short: "Cash ≥ ₹2 lakh", text: "₹2,65,740.48 taken in cash is at or over the ₹2,00,000 limit for one bill (Income Tax Sec 269ST)." };

test("a bill's status: cancelled alone; else the number used twice, a check, the income-tax Check, filed and udhaar, two at most", () => {
  render(<>
    <div data-testid="a"><StatusCell bill={row({ status: "cancelled", checks: ["no_hsn"] })} /></div>
    <div data-testid="b"><StatusCell bill={row({ checks: ["duplicate", "no_hsn"], locked: true })} /></div>
    <div data-testid="c"><StatusCell bill={row({ itax: [CASH], locked: true, payment_mode: "credit" })} max={3} /></div>
    <div data-testid="d"><StatusCell bill={row({ payment_mode: "credit" })} hideUdhaar /></div>
  </>);
  expect(within(screen.getByTestId("a")).getByText("Cancelled")).toBeInTheDocument();
  expect(screen.getByTestId("a")).not.toHaveTextContent("Needs a check");
  expect(screen.getByTestId("b")).toHaveTextContent("Number used twice");
  expect(screen.getByTestId("b")).toHaveTextContent("Needs a check");
  expect(screen.getByTestId("b")).not.toHaveTextContent("Filed");
  expect(screen.getByTestId("c")).toHaveTextContent("Income-tax Check: Cash ≥ ₹2 lakh");
  expect(within(screen.getByTestId("c")).getByText("Filed")).toBeInTheDocument();
  expect(screen.getByTestId("c")).toHaveTextContent("Udhaar");
  expect(screen.getByTestId("d")).toBeEmptyDOMElement();
});

test("on the bill's own page the other bill with its number is named by its date", () => {
  const d = toBillDetail(wireDetail({ checks: ["duplicate"], duplicates: [{ id: 388, invoice_number: "KGH/2026-27/31", invoice_date: "2026-09-10", customer_name: "Hemant Dave", status: "active" }] }));
  render(<StatusCell bill={d} />);
  expect(screen.getByText("Same no. as 10 Sep")).toHaveAttribute("title", "KGH/2026-27/31 is also on the bill of 10 Sep 2026");
});

test("what stops GSTR-1, in words, and the sale's tax type", () => {
  expect(dataProblem(row({ checks: ["no_lines"] }))).toBe("No items on this bill");
  expect(dataProblem(row({ checks: ["tax_mismatch"] }))).toBe("Its tax needs a look");
  expect(dataProblem(row({ checks: ["no_hsn"], status: "cancelled" }))).toBe("");
  render(<><TaxTypeBadge bill={row()} /><TaxTypeBadge bill={row({ interstate: true })} /></>);
  expect(screen.getByText("Sale · local · CGST + SGST")).toBeInTheDocument();
  expect(screen.getByText("Sale · inter-state · IGST")).toBeInTheDocument();
});
