import { screen } from "@testing-library/react";
import type { Me } from "@/core/auth/AuthProvider";
import { renderApp } from "@/test/render";
import { BankSwitch, billsSpan, byFirm, MAX_BILLS, named, notLoadedWords } from "./parts";

const NO_ACCOUNT = { name: "KIRAN GOLD HOUSE", bank_name: "", bank_account_number: " " };
const STAFF: Partial<Me> = { role: "staff", permissions: ["view", "bill.create", "bill.send", "customer.edit"] };

test("print pages share the 30-bill cap and name missing bills when known, counting the rest", () => {
  expect(MAX_BILLS).toBe(30);
  expect(named(["KGH/2026-27/32", "MO/2026-27/7"])).toBe("KGH/2026-27/32 and MO/2026-27/7");
  expect(named(["KGH/2026-27/32", null])).toBe("KGH/2026-27/32 and 1 more bill");
  expect(named([null, null])).toBe("2 bills");
  expect(named(["31", "32", "33", "34", null])).toBe("5 bills");
});

test("print pages share the missing-bill explanation for offline, failed and refused reads", () => {
  expect(notLoadedWords({ kind: "offline", message: "You're offline" }, true, true)).toBe("You're offline, so the batch waits for it. It loads by itself when the internet is back, or leave it out to print the rest.");
  expect(notLoadedWords({ kind: "offline", message: "You're offline" }, false, false)).toBe("You're offline, so the batch waits for them. They load by themselves when the internet is back, or leave them out.");
  for (const kind of ["unreachable", "server"] as const) {
    expect(notLoadedWords({ kind, message: "The app couldn't get through" }, false, true)).toBe("The app couldn't reach the shop's records just now, so the batch waits for them. Try again, or leave them out to print the rest.");
  }
  const refused = { kind: "throttled" as const, message: "Too many tries. Wait a minute, then try again." };
  expect(notLoadedWords(refused, true, false)).toBe(refused.message);
  expect(notLoadedWords(refused, true, true)).toBe(`${refused.message} You can leave it out to print the rest.`);
});

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

test("for the audit log, every bill's number, firm by firm, however many", () => {
  const kiran = (n: number) => ({ invoice_number: `KGH/2026-27/${n}`, business: 3, business_name: "KIRAN GOLD HOUSE", status: "active" });
  const meera = (n: number) => ({ invoice_number: `MO/2026-27/${n}`, business: 2, business_name: "MEERA ORNAMENTS", status: "active" });
  const five = [31, 32, 33, 34, 35].map((n) => kiran(n));
  expect(billsSpan(five, { numbers: true })).toBe("5 bills from KIRAN GOLD HOUSE");
  expect(billsSpan(five, { numbers: "all" })).toBe("5 bills from KIRAN GOLD HOUSE: KGH/2026-27/31, KGH/2026-27/32, KGH/2026-27/33, KGH/2026-27/34 and KGH/2026-27/35");
  expect(billsSpan([...five, meera(7)], { numbers: "all" })).toBe("6 bills from 2 firms: KIRAN GOLD HOUSE (KGH/2026-27/31, KGH/2026-27/32, KGH/2026-27/33, KGH/2026-27/34, KGH/2026-27/35) and MEERA ORNAMENTS (MO/2026-27/7)");
  // a few read as they did
  expect(billsSpan([kiran(31), meera(7), kiran(32)], { numbers: "all" })).toBe(billsSpan([kiran(31), meera(7), kiran(32)], { numbers: true }));
  expect(billsSpan([kiran(31)], { numbers: "all" })).toBe("KGH/2026-27/31");
});
