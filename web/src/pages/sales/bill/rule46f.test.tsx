import { fireEvent, screen, within } from "@testing-library/react";
import { handClock, pass } from "@/test/clock";
import { wireDetail } from "@/core/sales/fixtures";
import { LOCKED_REASON } from "@/core/sales/words";
import { ANIL, formServer, WALKIN } from "../form/testing";
import EditBillPage from "../form/EditBillPage";
import { mount, VIEWER } from "@/pages/customers/testing";
import BillPage from "../BillPage";

const short = "Name and address needed";
const namedText = "A bill of ₹50,000 or more to a buyer without a GSTIN needs the buyer's address (CGST Rule 46(f)). Add Anil Gupta's address.";
const walkinText = "A bill of ₹50,000 or more to a buyer without a GSTIN needs the buyer's name and address (CGST Rule 46(f)). Put the bill in the buyer's name, with their address, not Walk-in.";
const flag = (text: string) => ({ kind: "b2c_address", short, text });
const routes = [
  { path: "/sales/:id", element: <BillPage /> },
  { path: "/sales/:id/edit", element: <EditBillPage /> },
];

beforeEach(() => { localStorage.clear(); handClock(new Date("2026-10-11T10:00:00+05:30")); });
afterEach(() => { vi.useRealTimers(); (window as unknown as { __phone?: boolean }).__phone = false; });

test.each([false, true])("Rule 46(f): a named buyer's address is fixed in place and refreshes the saved bill (phone=%s)", async (phone) => {
  (window as unknown as { __phone?: boolean }).__phone = phone;
  let customer = { ...ANIL, address: "" };
  const { calls } = formServer([
    ["GET", "sales/412/", () => wireDetail({ customer, itax: customer.address ? [] : [flag(namedText)] })],
    ["PATCH", "customers/7/", ({ body }) => { customer = { ...customer, ...(body as { address: string }) }; return customer; }],
  ]);
  const { router } = mount(routes, ["/sales/412"]);
  await pass(400);
  const banner = screen.getByText(namedText).closest("[role=status]") as HTMLElement;
  expect(banner).toHaveTextContent(short);
  fireEvent.click(within(banner).getByRole("button", { name: "Add the address" }));
  await pass(400);
  const sheet = screen.getByRole("dialog", { name: "Anil Gupta's address" });
  expect(sheet).toHaveTextContent("A bill of ₹50,000 or more to a buyer without a GSTIN needs the buyer's address (CGST Rule 46(f)).");
  fireEvent.change(within(sheet).getByRole("textbox", { name: "Address" }), { target: { value: "15 Demo Road" } });
  fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
  await pass(400);
  expect(calls.filter((call) => call.method === "PATCH").map((call) => call.body)).toEqual([{ address: "15 Demo Road" }]);
  expect(screen.queryByText(namedText)).not.toBeInTheDocument();
  expect(screen.getByText(/15 Demo Road, Udaipur/)).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/sales/412");
});

test.each([false, true])("Rule 46(f): the walk-in fix opens the bill's customer picker (phone=%s)", async (phone) => {
  (window as unknown as { __phone?: boolean }).__phone = phone;
  formServer([["GET", "sales/412/", () => wireDetail({ customer: WALKIN, itax: [flag(walkinText)] })]]);
  const { router } = mount(routes, ["/sales/412"]);
  await pass(400);
  const banner = screen.getByText(walkinText).closest("[role=status]") as HTMLElement;
  expect(banner).toHaveTextContent(short);
  fireEvent.click(within(banner).getByRole("button", { name: "Choose the buyer" }));
  await pass(400);
  expect(router.state.location.pathname + router.state.location.search).toBe("/sales/412/edit?focus=customer");
  const picker = screen.getByRole("dialog", { name: "Customer" });
  expect(within(picker).getByRole("button", { name: "New customer" })).toBeInTheDocument();
  fireEvent.click(within(picker).getByText("Anil Gupta"));
  await pass(400);
  expect(screen.queryByText(walkinText)).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "Customer" })).not.toBeInTheDocument();
});

test("Rule 46(f): the walk-in fix respects a filed month's bill lock", async () => {
  formServer([["GET", "sales/412/", () => wireDetail({ customer: WALKIN, itax: [flag(walkinText)], locked: true })]]);
  mount(routes, ["/sales/412"]);
  await pass(400);
  expect(screen.getByRole("button", { name: "Choose the buyer" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Choose the buyer" })).toHaveAttribute("title", LOCKED_REASON);
});

test.each([ANIL, WALKIN])("Rule 46(f): a viewer sees the flag without a write action for $name", async (customer) => {
  const text = customer.type === "walkin" ? walkinText : namedText;
  formServer([["GET", "sales/412/", () => wireDetail({ customer: { ...customer, address: "" }, itax: [flag(text)] })]]);
  mount(routes, ["/sales/412"], { me: VIEWER });
  await pass(400);
  const banner = screen.getByText(text).closest("[role=status]") as HTMLElement;
  expect(within(banner).queryByRole("button")).not.toBeInTheDocument();
});
