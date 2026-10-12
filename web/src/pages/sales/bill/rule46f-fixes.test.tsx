import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { handClock, pass } from "@/test/clock";
import { wireDetail } from "@/core/sales/fixtures";
import { ANIL, formServer } from "../form/testing";
import { mount } from "@/pages/customers/testing";
import BillPage from "../BillPage";

const text = "A bill of ₹50,000 or more to a buyer without a GSTIN needs the buyer's address (CGST Rule 46(f)). Add Anil Gupta's address.";

beforeEach(() => { localStorage.clear(); handClock(new Date("2026-10-11T10:00:00+05:30")); });
afterEach(() => { cleanup(); vi.useRealTimers(); (window as unknown as { __phone?: boolean }).__phone = false; });

test.each([false, true])("saving the buyer's address keeps focus on the bill title before and after a delayed refetch (phone=%s)", async (phone) => {
  (window as unknown as { __phone?: boolean }).__phone = phone;
  let customer = { ...ANIL, address: "" };
  let refreshed = false;
  formServer([
    ["GET", "sales/412/", async () => {
      if (customer.address) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        refreshed = true;
      }
      return wireDetail({ customer, itax: customer.address ? [] : [{ kind: "b2c_address", short: "Name and address needed", text }] });
    }],
    ["PATCH", "customers/7/", ({ body }) => { customer = { ...customer, ...(body as { address: string }) }; return customer; }],
  ]);
  mount([{ path: "/sales/:id", element: <main id="app-main"><BillPage /></main> }], ["/sales/412"]);
  await pass(400);
  const title = document.querySelector<HTMLElement>("#app-main [data-page-title]")!;
  const opener = screen.getByRole("button", { name: "Add the address" });
  act(() => opener.focus());
  fireEvent.click(opener);
  await pass(400);
  const sheet = screen.getByRole("dialog", { name: "Anil Gupta's address" });
  const address = within(sheet).getByRole("textbox", { name: "Address" });
  act(() => address.focus());
  fireEvent.change(address, { target: { value: "15 Demo Road" } });
  fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
  await pass(20);
  expect(refreshed).toBe(false);
  expect(opener).toBeInTheDocument();
  expect(title).toHaveFocus();
  await pass(230);
  expect(screen.queryByRole("dialog", { name: "Anil Gupta's address" })).not.toBeInTheDocument();
  expect(refreshed).toBe(false);
  expect(title).toHaveFocus();
  await pass(100);
  expect(refreshed).toBe(true);
  expect(screen.queryByText(text)).not.toBeInTheDocument();
  expect(opener).not.toBeInTheDocument();
  expect(title).toHaveFocus();
});
