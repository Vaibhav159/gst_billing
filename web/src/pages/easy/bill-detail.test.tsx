import { fireEvent, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { renderApp } from "@/test/render";
import { wireDetail } from "@/core/sales/fixtures";
import { toBillDetail } from "@/core/sales/wire";
import type { BillDetail } from "@/core/sales/types";
import { BillDetailBody } from "./BillDetailBody";

function show(bill: BillDetail, owner = true) {
  const full = vi.fn();
  renderApp(<BillDetailBody bill={bill} onFullView={full} sendTo={<span>Destination</span>} send={<button>Send the bill</button>} print={<button>Print</button>} cancel={<button>Cancel action</button>} remake={<button>Make it again</button>} />, { me: owner ? { role: "owner", permissions: "*" } : { role: "staff", permissions: ["view", "bill.create", "bill.send"] } });
  return full;
}

test("one bill shows stored paise, items and tax heads without making charges", () => {
  show(toBillDetail(wireDetail()));
  expect(screen.getAllByText("₹87,083.21")).toHaveLength(2);
  expect(screen.getByText("Gold Ring 22K ·")).toBeInTheDocument();
  expect(screen.getByText("₹6,512.50 a gram")).toBeInTheDocument();
  expect(screen.getByText("GST 3% (CGST + SGST)")).toBeInTheDocument();
  expect(screen.queryByText(/making/i)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send the bill" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Print" })).toBeInTheDocument();
});

test("owner duplicate fix navigates to the bill's firm and month", () => {
  const bill = toBillDetail(wireDetail({ duplicates: [{ id: 413, invoice_number: "KGH/2026-27/31", invoice_date: "2026-09-09", customer_name: "Anita Mehta", status: "active" }] }));
  const full = show(bill);
  expect(screen.getByText("Another bill also has number 31")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Fix it in the full view" }));
  expect(full).toHaveBeenCalledWith("/gst?firm=3&month=2026-10&fix=1");
  fireEvent.click(screen.getByRole("button", { name: "Open in the full view" }));
  expect(full).toHaveBeenCalledWith("/sales/412");
});

test("staff duplicate words name the owner and expose no edit action", () => {
  show(toBillDetail(wireDetail({ duplicates: [{ id: 413, invoice_number: "31", invoice_date: "2026-09-09", customer_name: "Anita Mehta", status: "active" }] })), false);
  expect(screen.getByText("Tell the owner: bill 31 has the same number as Anita Mehta's bill of 09 Sep 2026.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /full view/ })).not.toBeInTheDocument();
  expect(screen.getByText("Need to change it? Ask the owner.")).toBeInTheDocument();
});

test.each([true, false])("B2B missing HSN blocks send, preserves print and names the repair for owner=%s", (owner) => {
  const bill = toBillDetail(wireDetail());
  bill.customer.gst_number = "08AAKFS4821M1ZQ";
  bill.lines[0].hsn_code = "";
  const full = show(bill, owner);
  expect(screen.queryByRole("button", { name: "Send the bill" })).not.toBeInTheDocument();
  expect(screen.queryByText("Destination")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Print" })).toBeInTheDocument();
  if (owner) {
    expect(screen.getByText("Add the missing HSN code before sending.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add it in the full view" }));
    expect(full).toHaveBeenCalledWith("/sales/412/edit");
  } else expect(screen.getByText("The owner adds the missing HSN code before this bill goes out; a shop's bill needs it on every item.")).toBeInTheDocument();
});

test("B2C missing HSN explains the issue without suppressing sending", () => {
  const bill = toBillDetail(wireDetail()); bill.lines[0].hsn_code = "";
  show(bill);
  expect(screen.getByText("No HSN code (the GST code for this item). Add it in the full view.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send the bill" })).toBeInTheDocument();
});

test("empty imported bill has no send or print and does not invent a zero total", () => {
  const bill = toBillDetail(wireDetail({ lines: [], line_count: 0, payment_mode: "" }));
  bill.history.activity[0].action = "imported";
  show(bill, false);
  expect(screen.getByText("This bill has no items")).toBeInTheDocument();
  expect(screen.getByText("It was brought in from Excel without them, so it can't be sent. Tell the owner; they add the items.")).toBeInTheDocument();
  expect(screen.getByText("No items yet")).toBeInTheDocument();
  expect(screen.getByText("Not recorded")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Send the bill" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Print" })).not.toBeInTheDocument();
});

test("cancelled bill shows reason and remake but no send, print, edit or cancel", () => {
  show(toBillDetail(wireDetail({ status: "cancelled", cancel_reason: "Wrong customer" })));
  expect(screen.getByText("This bill is cancelled")).toBeInTheDocument();
  expect(screen.getByText("Wrong customer. It keeps its number so the GST list stays complete.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Make it again" })).toBeInTheDocument();
  for (const name of ["Send the bill", "Print", "Open in the full view", "Cancel action"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
});
