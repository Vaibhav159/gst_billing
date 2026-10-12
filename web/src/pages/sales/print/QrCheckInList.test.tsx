// "Check a QR code" in the bills list (plan 1B's slots): first in the desktop header, first in the phone's ⋯ menu.
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { salesServer, wireFacets, wirePage, wireRow, type Call } from "@/core/sales/fixtures";
import { ScopeProvider } from "@/core/scope";
import { renderApp } from "@/test/render";
import SalesList from "../SalesList";

const isFacets = (c: Call) => c.params.facets === 1 && c.params.page_size === 1;
const mount = () => renderApp(<ScopeProvider><Routes><Route path="/sales" element={<SalesList />} /></Routes></ScopeProvider>, { path: "/sales" });

beforeEach(() => {
  localStorage.clear();
  salesServer([["GET", "sales/", (c) => (isFacets(c) ? { ...wirePage([]), facets: wireFacets() } : wirePage([wireRow()]))]]);
});
afterEach(() => { (window as unknown as { __phone?: boolean }).__phone = false; });

test("a desktop's bills list has Check a QR code first among its header's buttons, and it opens the check", async () => {
  mount();
  const button = await screen.findByRole("button", { name: "Check a QR code" });
  expect(button.parentElement?.firstElementChild).toBe(button);
  await userEvent.click(button);
  expect(await screen.findByRole("dialog", { name: "Check a bill's QR code" })).toBeInTheDocument();
});

test("a phone's bills list has Check a QR code first in its ⋯ menu", async () => {
  (window as unknown as { __phone?: boolean }).__phone = true;
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  try {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "More for bills" }));
    const items = await screen.findAllByRole("menuitem");
    expect(items[0]).toHaveTextContent("Check a QR code");
    act(() => { vi.advanceTimersByTime(400); }); // past the menu sheet's guard against a double tap's second tap
    await userEvent.click(items[0]);
    expect(await screen.findByRole("dialog", { name: "Check a bill's QR code" })).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

/* ── Beyond the brief ── */

test("everyone who can see the bills can check a code: a viewer has the button too (design §6)", async () => {
  renderApp(<ScopeProvider><Routes><Route path="/sales" element={<SalesList />} /></Routes></ScopeProvider>, { path: "/sales", me: { role: "viewer", permissions: ["view", "reports.export"] } });
  await userEvent.click(await screen.findByRole("button", { name: "Check a QR code" }));
  expect(await screen.findByRole("dialog", { name: "Check a bill's QR code" })).toBeInTheDocument();
});
