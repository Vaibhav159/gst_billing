// X-40: run after 6B and 4C land. Only the selected firm is fixed; the real Easy query, page frame and firm mapper run.
import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@/core/api/client";
import { fyOf, todayIST } from "@/core/format";
import { ANIL, mount, serve } from "@/pages/customers/testing";
import Customers, { CustomerEdit, CustomerNew } from "./CustomerRoutes";
const selection = vi.hoisted(() => ({ firmId: 3 as number | null, loading: false, error: false, problem: null }));
vi.mock("./state", () => ({ useEasyFirm: () => selection }));
beforeEach(() => { Object.assign(selection, { firmId: 3, loading: false, error: false }); });
const firm = { id: 3, name: "KIRAN GOLD HOUSE", short: "Kiran", short_name: "Kiran", gst_number: "08ABCPK1234F1Z5", state_name: "RAJASTHAN", state_code: "08", city: "Jaipur", invoice_prefix: "KGH", paper_full_number_from: null };
const adapter = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = adapter; });
it("requests 40 rows in this Easy firm's current FY, not the full-view scope", async () => {
  const calls = serve({ "GET firms/": { results: [firm] }, "GET customers/": { count: 1, next: null, results: [ANIL] } });
  mount([{ path: "/e/customers", element: <Customers /> }], ["/e/customers"]);
  await screen.findByRole("button", { name: /Anil Gupta/ });
  expect(calls.filter((c) => c.url === "customers/")).toHaveLength(1);
  expect(calls.find((c) => c.url === "customers/")?.params).toMatchObject({ figures: 1, figures_business_id: 3, start_date: `${fyOf(todayIST()).slice(0, 4)}-04-01`, end_date: todayIST(), ordering: "-last_bill", page_size: 40 });
});
it("starts a standalone form from the live firm's city and prefilled mobile", async () => {
  serve({ "GET firms/": { results: [firm] }, "GET customers/": { results: [] } });
  mount([{ path: "/e/customers/new", element: <CustomerNew /> }], ["/e/customers/new?phone=94141"]);
  expect(await screen.findByLabelText("Town or city")).toHaveValue("Jaipur");
  expect(screen.getByLabelText("Mobile number")).toHaveValue("94141");
});
it("refuses to edit walk-in and never fetches a malformed customer id", async () => {
  const calls = serve({ "GET firms/": { results: [firm] }, "GET customers/1/": { ...ANIL, id: 1, type: "walkin" } });
  const { router } = mount([{ path: "/e/customers/:id/edit", element: <CustomerEdit /> }], ["/e/customers/1/edit"]);
  expect(await screen.findByText("Walk-in customers have no details to change")).toBeVisible();
  await act(async () => { await router.navigate("/e/customers/not-a-number/edit"); });
  await waitFor(() => expect(screen.getByText("We can't find this customer")).toBeVisible());
  expect(calls.some((c) => /customers\/(?:null|NaN|not-a-number)\//.test(c.url))).toBe(false);
});

it("waits for default resolution before asking for customers or showing an empty shop", async () => {
  Object.assign(selection, { firmId: null, loading: true });
  const calls = serve({ "GET firms/": { results: [firm] } });
  mount([{ path: "/e/customers", element: <Customers /> }], ["/e/customers"]);
  expect(screen.getByRole("status")).toHaveTextContent("Loading the firm for this phone");
  expect(screen.queryByText("Choose a firm first")).not.toBeInTheDocument();
  await waitFor(() => expect(calls.some((c) => c.url === "firms/")).toBe(true));
  expect(calls.some((c) => c.url === "customers/")).toBe(false);
});
it("failed default resolution stays a failure even when the firm list is cached", async () => {
  Object.assign(selection, { firmId: null, error: true });
  serve({ "GET firms/": { results: [firm] } });
  mount([{ path: "/e/customers/new", element: <CustomerNew /> }], ["/e/customers/new"]);
  expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load the firm for this phone");
  expect(screen.queryByRole("button", { name: "Save customer" })).not.toBeInTheDocument();
});
