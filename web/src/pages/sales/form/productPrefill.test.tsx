import { screen } from "@testing-library/react";
import { fakeToday, formServer, mountForm, RING } from "./testing";
import { __resetDeviceDrafts } from "@/core/deviceDrafts";
beforeEach(() => { localStorage.clear(); __resetDeviceDrafts(); fakeToday(); });
afterEach(() => vi.useRealTimers());
test("New bill on a product preselects its name and HSN while leaving the paper rate empty", async () => {
  formServer([["GET", "products/", () => ({ count: 1, next: null, results: [{ ...RING, usual_rate: "6470.125" }] })]]);
  mountForm("/sales/new?product=5");
  expect(await screen.findByRole("combobox", { name: "Line 1 product" })).toHaveValue(RING.name);
  expect(screen.getByRole("textbox", { name: /Line 1 rate/ })).toHaveValue("");
});
test("a bought-only product link never puts that product on a new bill", async () => {
  formServer([["GET", "products/", () => ({ count: 1, next: null, results: [{ ...RING, purchase_only: true }] })]]);
  mountForm("/sales/new?product=5");
  expect(await screen.findByRole("combobox", { name: "Line 1 product" })).toHaveValue("");
});
