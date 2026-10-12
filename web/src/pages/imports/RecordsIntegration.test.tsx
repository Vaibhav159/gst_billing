import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { mount, serve } from "@/pages/customers/testing";
import ImportPage from "./ImportPage";
import { IMPORT_KINDS } from "./kinds";

const kinds = ["customers", "products", "firms"] as const;

test("2D keeps its bills choice and exposes the three records choices with their permissions", () => {
  expect(IMPORT_KINDS).toEqual([
    { value: "bills", label: "Sales and purchase bills", permissions: ["bill.create", "purchase.import"], to: "/import?type=purchases" },
    { value: "customers", label: "Customers", permissions: ["customer.edit"], to: "/import?type=customers" },
    { value: "products", label: "Products", permissions: ["product.edit"], to: "/import?type=products" },
    { value: "firms", label: "Firms", permissions: ["firm.edit"], to: "/import?type=firms" },
  ]);
});

test.each(kinds)("2D's desktop route opens the %s records editor", (kind) => {
  serve({});
  mount([{ path: "/import", element: <ImportPage /> }], [`/import?type=${kind}`]);
  expect(screen.getByRole("heading", { level: 1, name: `Import ${kind} from Excel or Tally` })).toBeInTheDocument();
  expect(screen.getByLabelText("Excel or CSV file to import")).toBeInTheDocument();
});

test.each(kinds)("2D's phone handoff also covers %s without reading importer rows", (kind) => {
  (window as unknown as { __phone?: boolean }).__phone = true;
  try {
    const calls = serve({});
    mount([{ path: "/import", element: <ImportPage /> }], [`/import?type=${kind}`]);
    expect(screen.getByText("Imports are done on the computer")).toBeInTheDocument();
    expect(screen.queryByLabelText("Excel or CSV file to import")).not.toBeInTheDocument();
    expect(calls.some((call) => ["customers/", "catalog/", "firms/", "purchases/usual-rate/"].includes(call.url))).toBe(false);
  } finally { (window as unknown as { __phone?: boolean }).__phone = false; }
});

test("2D's real CSV decoder reaches records checking through its existing page", async () => {
  const calls = serve({ "GET catalog/": { results: [], next: null } });
  mount([{ path: "/import", element: <ImportPage /> }], ["/import?type=products"]);
  const text = "Name,HSN,GST Rate,Unit\nDiamond,7102,0.25%,ct";
  const file = new File([text], "Products.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", { value: async () => text });
  fireEvent.change(screen.getByLabelText("Excel or CSV file to import"), { target: { files: [file] } });
  fireEvent.click(await screen.findByRole("button", { name: "Check the rows" }));
  expect(await screen.findByText("0.25% · sold by ct")).toBeInTheDocument();
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});

test("records routes never start AI reads on mount or focus", async () => {
  for (const kind of kinds) {
    const calls = serve({});
    const view = mount([{ path: "/import", element: <ImportPage /> }], [`/import?type=${kind}`]);
    expect(screen.getByRole("heading", { level: 1, name: `Import ${kind} from Excel or Tally` })).toBeInTheDocument();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(calls.filter((call) => call.url === "ai-reads/" || call.url === "purchases/read/" || /^captures\/[^/]+\/read\/$/.test(call.url))).toHaveLength(0);
    view.unmount();
    cleanup();
  }
});
