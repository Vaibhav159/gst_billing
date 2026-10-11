import { cleanup, screen } from "@testing-library/react";
import { handClock, pass } from "@/test/clock";
import { WALKIN } from "@/pages/sales/form/testing";
import CustomerPage from "./CustomerPage";
import { ANIL, mount, NO_BILLS, serve } from "./testing";

beforeEach(() => { localStorage.clear(); handClock(new Date("2026-10-11T10:00:00+05:30")); });
afterEach(() => { cleanup(); vi.useRealTimers(); (window as unknown as { __phone?: boolean }).__phone = false; });

test.each([false, true])("the walk-in address banner counts every matching bill beyond the first 200 (phone=%s)", async (phone) => {
  (window as unknown as { __phone?: boolean }).__phone = phone;
  const text = "A bill of ₹50,000 or more to a buyer without a GSTIN needs the buyer's name and address (CGST Rule 46(f)). Put the bill in the buyer's name, with their address, not Walk-in.";
  const calls = serve({
    "GET customers/1/": WALKIN,
    "GET customers/1/statement/": NO_BILLS,
    "GET sales/": { count: 250, next: "sales/?page=2", results: Array.from({ length: 200 }, (_, i) => ({
      id: i + 1, invoice_number: `KGH/2026-27/${i + 1}`, invoice_date: "2026-10-08", total_amount: "51500.00",
      itax: [{ kind: "b2c_address", short: "Name and address needed", text }],
    })) },
  });
  mount([{ path: "/customers/:id", element: <CustomerPage /> }], ["/customers/1"]);
  await pass(400);
  expect(screen.getByText("Income-tax checks: 250 bills")).toBeInTheDocument();
  expect(screen.getByText("Name and address needed")).toBeInTheDocument();
  expect(screen.queryByText(/Name and address needed:/)).not.toBeInTheDocument();
  expect(screen.getByText(/For example, KGH\/2026-27\/1, KGH\/2026-27\/2, KGH\/2026-27\/3\./)).toBeInTheDocument();
  expect(screen.queryByText(/and 197 more/)).not.toBeInTheDocument();
  expect(calls.filter((call) => call.url === "sales/")).toHaveLength(1);
});

test.each([false, true])("a partial mix of checks counts all flagged bills without inventing per-kind totals (phone=%s)", async (phone) => {
  (window as unknown as { __phone?: boolean }).__phone = phone;
  serve({
    "GET customers/7/": { ...ANIL, address: "" },
    "GET customers/7/statement/": NO_BILLS,
    "GET sales/": { count: 250, next: "sales/?page=2", results: ["b2c_address", "pan", "cash_limit", "b2b_address"].map((kind, i) => ({
      id: i + 1, invoice_number: `KGH/2026-27/${i + 1}`, invoice_date: "2026-10-08", total_amount: "250000.00",
      itax: [{ kind, short: "Name and address needed", text: "Add Anil Gupta's address." }],
    })) },
  });
  mount([{ path: "/customers/:id", element: <CustomerPage /> }], ["/customers/7"]);
  await pass(400);
  expect(screen.getByText("Income-tax checks: 250 bills")).toBeInTheDocument();
  expect(screen.getByText("The buyer's address is missing")).toBeInTheDocument();
  expect(screen.getByText("PAN needed on bills over ₹2,00,000")).toBeInTheDocument();
  expect(screen.getByText("Cash at the limit")).toBeInTheDocument();
  expect(screen.getByText("Address needed on bills to a business")).toBeInTheDocument();
  expect(screen.queryByText(/: 1 bill/)).not.toBeInTheDocument();
});

test.each([false, true])("a named buyer's address banner uses the buyer-specific title (phone=%s)", async (phone) => {
  (window as unknown as { __phone?: boolean }).__phone = phone;
  serve({
    "GET customers/7/": { ...ANIL, address: "" },
    "GET customers/7/statement/": NO_BILLS,
    "GET sales/": { count: 1, next: null, results: [{
      id: 1, invoice_number: "KGH/2026-27/1", invoice_date: "2026-10-08", total_amount: "51500.00",
      itax: [{ kind: "b2c_address", short: "Name and address needed", text: "A bill of ₹50,000 or more to a buyer without a GSTIN needs the buyer's address (CGST Rule 46(f)). Add Anil Gupta's address." }],
    }] },
  });
  mount([{ path: "/customers/:id", element: <CustomerPage /> }], ["/customers/7"]);
  await pass(400);
  expect(screen.getByText("The buyer's address is missing: 1 bill")).toBeInTheDocument();
});
