import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { renderApp } from "@/test/render";
import { serve } from "@/test/server";
import RecordsImport, { RecordsImportRoute } from "./RecordsImport";

const file = new File(["synthetic workbook"], "Products.csv", { type: "text/csv" });
const workbook = [{ name: "Products", rows: [["Product Name", "HSN/SAC", "GST Rate (%)", "UOM", "Bought only"], ["Diamond", "7102", "0.25", "CTS", "Yes"]] }];

test("choose, map, check and import rows through the contract; checking writes nothing", async () => {
  const calls = serve({ "GET catalog/": { results: [], next: null }, "POST catalog/": { id: 7 } });
  renderApp(<RecordsImport kind="products" readWorkbook={async () => workbook} />);
  fireEvent.change(screen.getByLabelText("Excel or CSV file to import"), { target: { files: [file] } });
  await screen.findByRole("heading", { name: "2. Match the columns" });
  expect(screen.getByLabelText("GST Rate (%) means")).toHaveValue("gst_percent");
  await userEvent.click(screen.getByRole("button", { name: "Check the rows" }));
  await screen.findByText("0.25% · sold by ct");
  expect(calls.every((call) => call.method === "GET")).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Continue to import" }));
  await userEvent.click(screen.getByRole("button", { name: "Import 1 product" }));
  await screen.findByText("Imported 1 product");
  expect(calls.find((call) => call.method === "POST")?.data).toMatchObject({ name: "Diamond", gst_percent: "0.25", unit: "ct", purchase_only: true });
});

test("an invalid rate stays editable and a changed row must be checked before import", async () => {
  serve({ "GET catalog/": { results: [], next: null } });
  renderApp(<RecordsImport kind="products" readWorkbook={async () => [{ name: "Products", rows: [["Name", "HSN", "GST rate"], ["Ring", "7113", "2.5%"]] }]} />);
  fireEvent.change(screen.getByLabelText("Excel or CSV file to import"), { target: { files: [file] } });
  await userEvent.click(await screen.findByRole("button", { name: "Check the rows" }));
  await screen.findByText(/Choose one of the GST rates:/);
  expect(screen.getByRole("button", { name: "Continue to import" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Row 2 GST rate"), { target: { value: "3" } });
  expect(screen.getByRole("button", { name: "Continue to import" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Check rows again" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Continue to import" })).toBeEnabled());
});

test("an unsupported file type names only the types the importer accepts", async () => {
  const read = vi.fn();
  renderApp(<RecordsImport kind="products" readWorkbook={read} />);
  fireEvent.change(screen.getByLabelText("Excel or CSV file to import"), { target: { files: [new File(["x"], "Products.ods")] } });
  expect(await screen.findByText("Products.ods: unsupported file type. Choose an Excel (.xlsx) or CSV file.")).toBeInTheDocument();
  expect(read).not.toHaveBeenCalled();
});

test("a viewer cannot read a file into the importer or save records", () => {
  const read = vi.fn();
  renderApp(<RecordsImport kind="products" readWorkbook={read} />, { me: { role: "viewer", permissions: ["view"] } });
  expect(screen.getByLabelText("Excel or CSV file to import")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Choose a file" })).toBeDisabled();
  expect(screen.getByText(/Only the owner/)).toBeInTheDocument();
  expect(read).not.toHaveBeenCalled();
});

test("firm imports map required and optional FirmBody columns and create new firms", async () => {
  const calls = serve({ "GET firms/": { results: [] }, "POST firms/": { id: 4 } });
  renderApp(<RecordsImport kind="firms" readWorkbook={async () => [{ name: "Firms", rows: [
    ["Firm name", "GSTIN", "Address", "Mobile", "Short name", "City", "PIN code", "Invoice prefix", "Paper full number from", "Signature on bills", "Jurisdiction", "Declaration"],
    ["New firm", "08AAMFR5567K1ZG", "12 Test Road", "9414122018", "NF", "Udaipur", "313001", "NF", "2027-04-01", "No", "Udaipur", "Test declaration"],
  ] }]} />);
  fireEvent.change(screen.getByLabelText("Excel or CSV file to import"), { target: { files: [new File(["synthetic"], "Firms.csv")] } });
  await screen.findByRole("heading", { name: "2. Match the columns" });
  expect(screen.getByLabelText("Address means")).toHaveValue("address");
  expect(screen.getByLabelText("Signature on bills means")).toHaveValue("signature_on_bills");
  await userEvent.click(screen.getByRole("button", { name: "Check the rows" }));
  await screen.findByRole("heading", { name: "3. Check the rows" });
  expect(calls.every((call) => call.method === "GET")).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Continue to import" }));
  expect(screen.getByText("1 firm will be added.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Import 1 firm" }));
  await screen.findByRole("heading", { name: "Imported 1 firm" });
  expect(calls.find((call) => call.method === "POST")?.data).toMatchObject({ name: "New firm", address: "12 Test Road", short_name: "NF", city: "Udaipur", pin_code: "313001", invoice_prefix: "NF", paper_full_number_from: "2027-04-01", signature_on_bills: false, jurisdiction: "Udaipur", declaration: "Test declaration" });
  expect(calls.some((call) => call.method === "PUT")).toBe(false);
});

test("firm imports require address and mobile columns before checking rows", async () => {
  const calls = serve({});
  renderApp(<RecordsImport kind="firms" readWorkbook={async () => [{ name: "Firms", rows: [["Name", "GSTIN"], ["New firm", "08AAMFR5567K1ZG"]] }]} />);
  fireEvent.change(screen.getByLabelText("Excel or CSV file to import"), { target: { files: [file] } });
  await screen.findByRole("heading", { name: "2. Match the columns" });
  expect(screen.getByText("Match these columns: Mobile, Address.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Check the rows" })).toBeDisabled();
  expect(calls).toHaveLength(0);
});

test("duplicate field mappings are refused before rows are checked", async () => {
  const calls = serve({});
  renderApp(<RecordsImport kind="products" readWorkbook={async () => workbook} />);
  fireEvent.change(screen.getByLabelText("Excel or CSV file to import"), { target: { files: [file] } });
  await screen.findByRole("heading", { name: "2. Match the columns" });
  await userEvent.selectOptions(screen.getByLabelText("HSN/SAC means"), "name");
  expect(screen.getByText("Use each field once. Two columns cannot fill the same field.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Check the rows" })).toBeDisabled();
  expect(calls).toHaveLength(0);
});

test("the import route keeps 2D's bills branch and selects each records branch by query", () => {
  const read = vi.fn();
  const first = renderApp(<RecordsImportRoute bills={<p>Part 2D bill import</p>} readWorkbook={read} />, { path: "/import?type=purchases" });
  expect(screen.getByText("Part 2D bill import")).toBeInTheDocument();
  first.unmount();
  for (const kind of ["customers", "products", "firms"]) {
    const view = renderApp(<RecordsImportRoute bills={<p>Part 2D bill import</p>} readWorkbook={read} />, { path: `/import?type=${kind}` });
    expect(screen.getByRole("heading", { level: 1, name: `Import ${kind} from Excel or Tally` })).toBeInTheDocument();
    expect(screen.queryByText("Part 2D bill import")).not.toBeInTheDocument();
    view.unmount();
  }
  expect(read).not.toHaveBeenCalled();
});
