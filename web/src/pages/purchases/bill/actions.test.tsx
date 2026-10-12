import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { salesServer, refuse } from "@/core/sales/fixtures";
import { purchaseBinWire, purchaseDetailWire, purchaseRowWire } from "@/core/purchases/fixtures";
import { toPurchaseRow } from "@/core/purchases/wire";
import { renderApp } from "@/test/render";
import PurchasePage from "../PurchasePage";
import { DeletePurchases } from "./parts";

const pause = () => act(async () => { vi.setSystemTime(Date.now() + 400); });
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true }); vi.setSystemTime(new Date("2026-10-08T12:30:00+05:30")); });
afterEach(() => vi.useRealTimers());

test("a partial delete retries only what remains, and Undo restores that bill to the dialog", async () => {
  let secondFails = true;
  const { calls } = salesServer([
    ["DELETE", "purchases/905/", () => purchaseBinWire()],
    ["DELETE", "purchases/906/", () => { if (secondFails) refuse(0, null); return purchaseBinWire({ id: 5, original_id: 906 }); }],
    ["POST", "purchases/bin/4/restore/", () => purchaseDetailWire()],
  ]);
  const done = vi.fn();
  renderApp(<DeletePurchases bills={[toPurchaseRow(purchaseRowWire()), toPurchaseRow(purchaseRowWire({ id: 906, invoice_number: "UBS/26-27/0851" }))]} onClose={() => {}} onDone={done} />);
  await pause();
  await userEvent.click(screen.getByRole("button", { name: "Delete 2 purchase bills" }));
  expect(await screen.findByText(/Stopped after 1 of 2/)).toBeInTheDocument();
  expect(within(screen.getByRole("dialog")).getByRole("heading", { name: "Delete 1 purchase bill?" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /^Undo/ }));
  expect(await within(screen.getByRole("dialog")).findByRole("heading", { name: "Delete 2 purchase bills?" })).toBeInTheDocument();
  secondFails = false;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["purchases/905/", "purchases/906/", "purchases/905/", "purchases/906/"]);
});

test("a bill restored by someone else leaves the deleted page after already_restored", async () => {
  let gone = true;
  salesServer([["GET", "purchases/905/", () => { if (gone) refuse(404, { code: "deleted", binned: purchaseBinWire(), detail: "This purchase was deleted." }); return purchaseDetailWire(); }], ["POST", "purchases/bin/4/restore/", () => { gone = false; refuse(409, { code: "already_restored", detail: "UBS/26-27/0850 is back already.", purchase: null }); }]]);
  renderApp(<Routes><Route path="/purchases/:id" element={<PurchasePage />} /></Routes>, { path: "/purchases/905" });
  await userEvent.click(await screen.findByRole("button", { name: "Restore it" }));
  expect(await screen.findByRole("heading", { name: "Tax and total" })).toBeInTheDocument();
});

test("staff may attach only to their own purchase made within the last day", async () => {
  salesServer([["GET", "purchases/905/", () => purchaseDetailWire({ files: [], has_files: false, created_at: "2026-10-08T09:00:00+05:30", needs_review: true })]]);
  renderApp(<Routes><Route path="/purchases/:id" element={<PurchasePage />} /></Routes>, { path: "/purchases/905", me: { id: 7, role: "staff", permissions: ["view", "purchase.create"] } });
  await screen.findByRole("heading", { name: "Source" });
  expect(screen.queryByRole("button", { name: "Attach a photo or PDF" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Looks right" })).not.toBeInTheDocument();
  expect(screen.getByText("Only the owner and the accountant can change purchases. Ask the owner if you need it.")).toBeInTheDocument();
});

test.each(["captured page", "staff's own source file"])("%s has no Remove action", async (kind) => {
  const source = purchaseDetailWire().files as Record<string, unknown>[];
  salesServer([["GET", "purchases/905/", () => purchaseDetailWire({ created_at: "2026-10-08T09:00:00+05:30", files: [{ ...source[0], id: kind === "captured page" ? "p1" : "src" }] })]]);
  renderApp(<Routes><Route path="/purchases/:id" element={<PurchasePage />} /></Routes>, { path: "/purchases/905", ...(kind === "staff's own source file" ? { me: { id: 1, role: "staff" as const, permissions: ["view", "purchase.create"] } } : {}) });
  await screen.findByRole("heading", { name: "Source" });
  expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
});

test("Undo counts a bill someone else already restored and goes on to the next", async () => {
  const { calls } = salesServer([
    ["DELETE", "purchases/905/", () => purchaseBinWire()],
    ["DELETE", "purchases/906/", () => purchaseBinWire({ id: 5, original_id: 906 })],
    ["POST", "purchases/bin/4/restore/", () => refuse(409, { code: "already_restored", detail: "Someone already restored this purchase." })],
    ["POST", "purchases/bin/5/restore/", () => purchaseDetailWire({ id: 906 })],
  ]);
  renderApp(<DeletePurchases bills={[toPurchaseRow(purchaseRowWire()), toPurchaseRow(purchaseRowWire({ id: 906, invoice_number: "UBS/26-27/0851" }))]} onClose={() => {}} onDone={() => {}} />);
  await pause();
  await userEvent.click(screen.getByRole("button", { name: "Delete 2 purchase bills" }));
  await userEvent.click(await screen.findByRole("button", { name: /^Undo/ }));
  expect(await screen.findByText("Restored 2 purchase bills")).toBeInTheDocument();
  expect(screen.queryByText("Not all purchases were restored")).not.toBeInTheDocument();
  expect(calls.filter((c) => c.method === "POST").map((c) => c.url)).toEqual(["purchases/bin/4/restore/", "purchases/bin/5/restore/"]);
});
test("a bill deleted elsewhere is skipped, not counted, and never sent again", async () => {
  let thirdFails = true;
  const { calls } = salesServer([
    ["DELETE", "purchases/905/", () => refuse(404, { detail: "Not found." })],
    ["DELETE", "purchases/906/", () => purchaseBinWire({ id: 5, original_id: 906 })],
    ["DELETE", "purchases/907/", () => { if (thirdFails) refuse(0, null); return purchaseBinWire({ id: 6, original_id: 907 }); }],
  ]);
  const done = vi.fn();
  renderApp(<DeletePurchases bills={[905, 906, 907].map((id) => toPurchaseRow(purchaseRowWire({ id, invoice_number: `UBS/26-27/${id}` })))} onClose={() => {}} onDone={done} />);
  await pause();
  await userEvent.click(screen.getByRole("button", { name: "Delete 3 purchase bills" }));
  expect(await screen.findByText(/Stopped after 1 of 3\. 1 was already deleted elsewhere\./)).toBeInTheDocument();
  expect(within(screen.getByRole("dialog")).getByRole("heading", { name: "Delete 1 purchase bill?" })).toBeInTheDocument();
  thirdFails = false;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["purchases/905/", "purchases/906/", "purchases/907/", "purchases/907/"]);
});
