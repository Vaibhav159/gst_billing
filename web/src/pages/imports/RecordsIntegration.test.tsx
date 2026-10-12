import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { mount, serve, type Call } from "@/pages/customers/testing";
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

test("a failed row shows X-71's exact partial result, stops the run, and a corrected re-run skips saved rows", async () => {
  const stored: { id: number; name: string }[] = [];
  const calls = serve({
    "GET catalog/": () => ({ status: 200, data: { results: stored, next: null } }),
    "POST catalog/": (call: Call) => {
      const { name } = call.data as { name: string };
      if (name === "Ring") return { status: 400, data: { detail: "Use a different name." } };
      stored.push({ id: stored.length + 1, name });
      return { status: 201, data: stored.at(-1) };
    },
  });
  mount([{ path: "/import", element: <ImportPage /> }], ["/import?type=products"]);
  const text = "Name,HSN,GST Rate,Unit\nDiamond,7102,0.25%,ct\n\nRing,7113,3%,gms\nChain,7113,3%,gms";
  const file = new File([text], "Products.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", { value: async () => text });
  fireEvent.change(screen.getByLabelText("Excel or CSV file to import"), { target: { files: [file] } });
  fireEvent.click(await screen.findByRole("button", { name: "Check the rows" }));
  await screen.findByText("0.25% · sold by ct");
  fireEvent.click(screen.getByRole("button", { name: "Continue to import" }));
  fireEvent.click(screen.getByRole("button", { name: "Import 3 products" }));
  const failure = "Added 1 of 3. Row 4: Use a different name. Fix it and import again; rows already added are skipped.";
  expect(await screen.findByText(failure)).toBeVisible();
  expect(calls.filter(call => call.method === "POST")).toHaveLength(2);
  expect(stored.map(row => row.name)).toEqual(["Diamond"]);
  fireEvent.click(screen.getByRole("button", { name: "Check rows again" }));
  expect(await screen.findByText("Already in products: Diamond. Will be skipped.")).toBeVisible();
  expect(screen.queryByText(failure)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Row 4 Name"), { target: { value: "Ring revised" } });
  fireEvent.click(screen.getByRole("button", { name: "Check rows again" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Continue to import" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Continue to import" }));
  fireEvent.click(await screen.findByRole("button", { name: "Import 2 products" }));
  expect(await screen.findByRole("heading", { name: "Imported 2 products" })).toBeVisible();
  expect(calls.filter(call => call.method === "POST").map(call => (call.data as { name: string }).name)).toEqual(["Diamond", "Ring", "Ring revised", "Chain"]);
});
