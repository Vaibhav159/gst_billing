import { screen } from "@testing-library/react";
import type { Me } from "@/core/auth/AuthProvider";
import { renderApp } from "@/test/render";
import { BankSwitch, billsSpan, byFirm } from "./parts";

const NO_ACCOUNT = { name: "KIRAN GOLD HOUSE", bank_name: "", bank_account_number: " " };
const STAFF: Partial<Me> = { role: "staff", permissions: ["view", "bill.create", "bill.send", "customer.edit"] };

test("a firm with no bank account: nothing to switch, and why; the owner can add one, but a bill keeps the firm as the app made it", () => {
  const { unmount } = renderApp(<BankSwitch firm={{ ...NO_ACCOUNT, frozen: false }} firmId={3} checked onChange={() => {}} />);
  expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  expect(screen.getByText(/^KIRAN GOLD HOUSE has no bank account saved, so the bill prints without a bank block\./)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Add the account" })).toHaveAttribute("href", "/firms/3/edit");
  unmount();
  const staff = renderApp(<BankSwitch firm={{ ...NO_ACCOUNT, frozen: false }} firmId={3} checked onChange={() => {}} />, { me: STAFF });
  expect(screen.getByText(/The owner can add it under Firms\.$/)).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  staff.unmount();
  renderApp(<BankSwitch firm={{ ...NO_ACCOUNT, frozen: true }} firmId={3} checked onChange={() => {}} />);
  expect(screen.getByText("KIRAN GOLD HOUSE had no bank account saved when the app made this bill, so it prints without a bank block.")).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

test("several bills in words, by firm, never one number range across firms", () => {
  const kiran = (n: number, status = "active") => ({ invoice_number: `KGH/2026-27/${n}`, business: 3, business_name: "KIRAN GOLD HOUSE", status });
  const meera = (n: number) => ({ invoice_number: `MO/2026-27/${n}`, business: 2, business_name: "MEERA ORNAMENTS", status: "active" });
  expect(billsSpan([])).toBe("No bills");
  expect(billsSpan([kiran(31)])).toBe("KGH/2026-27/31");
  expect(billsSpan([kiran(31), kiran(32), kiran(33, "cancelled")])).toBe("2 bills and 1 cancelled bill from KIRAN GOLD HOUSE");
  expect(billsSpan([kiran(31), kiran(32), kiran(33)], { numbers: true })).toBe("3 bills from KIRAN GOLD HOUSE: KGH/2026-27/31, KGH/2026-27/32 and KGH/2026-27/33");
  expect(billsSpan([kiran(31), meera(7), kiran(32)])).toBe("3 bills from 2 firms: KIRAN GOLD HOUSE (2) and MEERA ORNAMENTS (1)");
  expect(billsSpan([kiran(31), meera(7), kiran(32)], { numbers: true })).toBe("3 bills from 2 firms: KIRAN GOLD HOUSE (KGH/2026-27/31, KGH/2026-27/32) and MEERA ORNAMENTS (MO/2026-27/7)");
  expect(byFirm([kiran(31), meera(7), kiran(32)]).map((g) => [g.name, g.list.length])).toEqual([["KIRAN GOLD HOUSE", 2], ["MEERA ORNAMENTS", 1]]);
});
