import { fireEvent, screen, within } from "@testing-library/react";
import { mount, serve, VIEWER } from "@/pages/customers/testing";
import { SupplierDetail } from "./Suppliers";
const supplier = { id: 21, name: "Udaipur Bullion Suppliers", gst_number: "08AACFU5521R1ZN", state_code: "08", state_name: "RAJASTHAN", city: "Udaipur", address: "12 Lake Road", pan: "AACFU5521R", mobile_number: "9829041122", email: "office@example.test", gstin_valid: true, prefix: "UBS/26-27/" };
const detail = { supplier, figures: { bills: 12, total: "492645.00", tax: "14348.88", credit: "14000.00", last: { id: 905, invoice_date: "2026-10-04" } }, rates: [{ product_name: "Gold bullion 995", unit: "gms", quantity: "69.540", value: "478296.12", bills: 9, average: "6871.235", low: "6780.000", high: "6912.000" }], bills: [{ id: 905, business: 3, business_name: "KIRAN GOLD HOUSE", invoice_number: "UBS/26-27/0850", invoice_date: "2026-10-04", taxable: "478296.12", tax: "14348.88", total_amount: "492645.00", cgst: "7174.44", sgst: "7174.44", igst: "0.00", interstate: true, gst_percents: ["3"], line_count: 2, first_line: { product_name: "Gold bullion 995", quantity: "69.540", unit: "gms", amount_only: false }, credit: { eligible: true, claimed: "14000.00", late: true, month: "2026-10" }, needs_review: true, locked: true }] };
const routes = [{ path: "/suppliers/:id", element: <SupplierDetail /> }];
beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true }); vi.setSystemTime(new Date("2026-10-08T10:00:00+05:30")); });
afterEach(() => { vi.useRealTimers(); (window as unknown as { __phone?: boolean }).__phone = false; });
test("detail uses server figures, rates, stored heads and credit; links preserve firm and supplier", async () => {
  const calls = serve({ "GET suppliers/21/": detail });
  mount(routes, ["/suppliers/21"]);
  const bills = await screen.findByRole("table", { name: "Purchase bills from Udaipur Bullion Suppliers" });
  expect(bills).toHaveTextContent("CGST + SGST · 3%");
  expect(bills).toHaveTextContent("₹14,000.00");
  expect(bills).toHaveTextContent("Gold bullion 995 · 69.540 gms · 1 more item");
  expect(bills).toHaveTextContent("Needs a checkCredit in Oct 2026GSTR-3B filed");
  const rates = screen.getByRole("table", { name: "Average rates paid to Udaipur Bullion Suppliers" });
  expect(rates).toHaveTextContent("₹6,871.24");
  expect(rates).toHaveTextContent("per gms, by weight");
  expect(screen.getByRole("link", { name: "Add a purchase from them" })).toHaveAttribute("href", "/purchases/new?supplier=21&firm=3");
  expect(calls.find(c => c.url === "suppliers/21/")?.params).toEqual({ business_id: 3, fy: "2026-27" });
  fireEvent.click(screen.getByRole("button", { name: "Edit supplier" }));
  expect(screen.getByRole("dialog", { name: "Edit supplier" })).toBeInTheDocument();
  expect(screen.getByLabelText("Supplier name")).toHaveValue(supplier.name);
  expect(screen.getByLabelText("PAN")).toHaveValue(supplier.pan);
});
test("all firms with different states describes each firm rather than claiming the same tax everywhere", async () => {
  localStorage.setItem("gst3.scope.1", "all");
  serve({ "GET firms/": { results: [{ id: 3, name: "KIRAN GOLD HOUSE", gst_number: "08AAKFS4821M1ZQ", state_name: "RAJASTHAN" }, { id: 4, name: "MUMBAI GOLD", gst_number: "27AAKFS4821M1ZQ", state_name: "MAHARASHTRA" }] }, "GET suppliers/21/": detail });
  mount(routes, ["/suppliers/21"]);
  expect(await screen.findByText("CGST + SGST for firms in their state; IGST for the others")).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Firm" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Add a purchase from them" })).toHaveAttribute("href", "/purchases/new?supplier=21");
});
test("unregistered supplier explains no credit and the scoped empty state offers all firms", async () => {
  serve({ "GET suppliers/21/": { ...detail, supplier: { ...supplier, gst_number: "", gstin_valid: false }, rates: [], bills: [], figures: { bills: 0, total: "0", tax: "0", credit: "0", last: null } } });
  mount(routes, ["/suppliers/21"]);
  expect(await screen.findByText("None: no GSTIN, so no GST and no credit")).toBeInTheDocument();
  expect(screen.getByText("No bills from Udaipur Bullion Suppliers this year")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Show all firms" })).toBeInTheDocument();
});
test.each(["bad", "0", "-1", "1.5"])("invalid supplier id %s never asks the server", async id => {
  const calls = serve({});
  mount(routes, [`/suppliers/${id}`]);
  expect(await screen.findByText("There's no supplier with this link")).toBeInTheDocument();
  expect(calls.some(c => c.url.startsWith("suppliers/"))).toBe(false);
});
test("404 is the prototype's missing page", async () => {
  serve({ "GET suppliers/21/": () => ({ status: 404, data: { detail: "No supplier matches the given query." } }) });
  mount(routes, ["/suppliers/21"]);
  expect(await screen.findByText("There's no supplier with this link")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "All suppliers" })).toHaveAttribute("href", "/suppliers");
});
test("phone shows bills, rates and contact; viewer cannot edit or add", async () => {
  (window as unknown as { __phone?: boolean }).__phone = true;
  serve({ "GET suppliers/21/": detail });
  mount(routes, ["/suppliers/21"], { me: VIEWER });
  const row = await screen.findByRole("link", { name: /UBS\/26-27\/0850/ });
  expect(within(row).getByText("₹4,92,645.00")).toBeInTheDocument();
  expect(screen.getByText("What you paid them")).toBeInTheDocument();
  expect(screen.getByText("Contact and tax")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Add purchase" })).not.toBeInTheDocument();
});
test("a truncated detail offers every bill with the same firm, FY and supplier", async () => {
  serve({ "GET suppliers/21/": { ...detail, figures: { ...detail.figures, bills: 201 } } });
  mount(routes, ["/suppliers/21"]);
  expect(await screen.findByRole("link", { name: "See all 201 purchase bills" })).toHaveAttribute("href", "/purchases?supplier=21&firm=3&fy=2026-27");
});
