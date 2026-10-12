import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { __resetDrafts } from "@/core/api/drafts";
import { __resetDeviceDrafts } from "@/core/deviceDrafts";
import { wireDetail, WIRE_LINES } from "@/core/sales/fixtures";
import { tick } from "@/test/clock";
import { ANIL, fakeToday, formServer, mountForm, settle, WALKIN } from "./testing";

const named = { ...ANIL, address: "" };
const namedText = "A bill of ₹50,000 or more to a buyer without a GSTIN needs the buyer's address (CGST Rule 46(f)). Add Anil Gupta's address.";
const walkinText = "A bill of ₹50,000 or more to a buyer without a GSTIN needs the buyer's name and address (CGST Rule 46(f)). Put the bill in the buyer's name, with their address, not Walk-in.";
const line = { ...WIRE_LINES[0], quantity: "1.000", rate: "50000.000", taxable: "50000.00", cgst: "750.00", sgst: "750.00", tax: "1500.00", amount: "51500.00" };

beforeEach(() => { localStorage.clear(); __resetDrafts(); __resetDeviceDrafts(); });
afterEach(() => { cleanup(); (window as unknown as { __phone: boolean }).__phone = false; vi.useRealTimers(); });

async function review(phone: boolean, customer = named) {
  (window as unknown as { __phone: boolean }).__phone = phone;
  const user = fakeToday();
  let current = customer;
  const server = formServer([
    ["GET", "sales/412/", () => wireDetail({ customer, lines: [line], taxable: "50000.00", total_amount: "51500.00" })],
    ["GET", `customers/${customer.id}/`, () => current],
    ["PATCH", `customers/${customer.id}/`, ({ body }) => { current = { ...current, ...(body as object) }; return current; }],
  ]);
  const view = mountForm("/sales/new?from=412");
  await screen.findByText("Copied from KGH/2026-27/31");
  await tick(400);
  await user.click(screen.getByRole("radio", { name: "UPI / bank" }));
  await user.click(screen.getByRole("button", { name: "Check and save" }));
  const dialog = await screen.findByRole("dialog", { name: phone ? "Check the bill" : "Check the bill before saving" });
  await tick(400);
  return { user, dialog, ...server, ...view };
}

describe.each([["desktop", false], ["phone", true]] as const)("%s Rule 46(f) review", (_, phone) => {
  test.each([["named buyer", named, namedText], ["walk-in", WALKIN, walkinText]] as const)("warns for a %s and still saves without fixing it", async (_, customer, text) => {
    const { user, dialog, calls, router } = await review(phone, customer);
    expect(within(dialog).getByText(text)).toBeInTheDocument();
    const save = within(dialog).getByRole("button", { name: "Save bill" });
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(router.state.location.pathname).toBe("/sales/501"));
    expect(calls.find((c) => c.method === "POST" && c.url === "sales/")?.body).toMatchObject({ customer: customer.id, payment_mode: "bank" });
  });

  test("adds a named buyer's address through the customer fix sheet and returns focus to review", async () => {
    const { user, dialog, calls } = await review(phone);
    expect(within(dialog).getByText(namedText)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Add the address" }));
    const sheet = await screen.findByRole("dialog", { name: "Anil Gupta's address" });
    await tick(400);
    await user.type(within(sheet).getByLabelText("Address"), "15 Demo Road");
    await user.click(within(sheet).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Anil Gupta's address" })).not.toBeInTheDocument());
    await settle();
    expect(within(dialog).queryByText(namedText)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save bill" })).toBeEnabled();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ address: "15 Demo Road" });
  });

  test("opens the customer picker for a walk-in, with new-customer entry, and picks the named buyer", async () => {
    const { user, dialog, calls } = await review(phone, WALKIN);
    expect(within(dialog).getByText(walkinText)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Choose customer" }));
    const picker = await screen.findByRole("dialog", { name: "Customer" });
    await tick(400);
    expect(within(picker).getByRole("button", { name: "New customer" })).toBeEnabled();
    await user.click(within(picker).getByRole("button", { name: /Anil Gupta/ }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Customer" })).not.toBeInTheDocument());
    await settle();
    expect(within(dialog).queryByText(walkinText)).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent("Anil Gupta");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.click(within(dialog).getByRole("button", { name: "Save bill" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "sales/")).toBe(true));
    expect(calls.find((c) => c.method === "POST" && c.url === "sales/")?.body).toMatchObject({ customer: ANIL.id });
  });
});
