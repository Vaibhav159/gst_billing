import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Me } from "@/core/auth/AuthProvider";
import { salesServer, wireRow } from "@/core/sales/fixtures";
import type { BillRow } from "@/core/sales/types";
import { toBillRow } from "@/core/sales/wire";
import { Menu } from "@/core/ui";
import { renderApp } from "@/test/render";
import { useBillDialogs } from "./BillDialogs";
import { useBillMenu, type MenuShow } from "./useBillMenu";

const STAFF: Partial<Me> = { role: "staff", permissions: ["view", "bill.create", "bill.send", "customer.edit"] };
function BillMenu({ bill, show }: { bill: BillRow; show?: MenuShow }) {
  const menu = useBillMenu();
  const d = useBillDialogs();
  return <><Menu title="Bill" items={menu(bill, d.open, show)} trigger={(p) => <button type="button" {...p}>Actions</button>} />{d.element}</>;
}
const open = async () => { await userEvent.click(screen.getByRole("button", { name: "Actions" })); };

test("counter staff send and duplicate; the owner's actions are greyed with who can do them", async () => {
  salesServer();
  renderApp(<BillMenu bill={toBillRow(wireRow())} show={{ eway: true, renumber: true, move: true }} />, { me: STAFF });
  await open();
  expect(await screen.findByRole("menuitem", { name: /^Send on WhatsApp/ })).toBeEnabled();
  expect(screen.getByRole("menuitem", { name: /^Duplicate/ })).toBeEnabled();
  for (const name of [/^Edit/, /^E-way bill…/, /^Renumber…/, /^Move to another firm…/, /^Cancel bill…/, /^Delete…/]) expect(screen.getByRole("menuitem", { name })).toBeDisabled();
  expect(screen.getByRole("menuitem", { name: /^Edit/ })).toHaveTextContent("Only the owner can change bills. Ask the owner if you need it.");
  expect(screen.getByRole("menuitem", { name: /^Cancel bill…/ })).toHaveTextContent("Only the owner can cancel bills. Ask the owner if you need it.");
});

test("a cancelled bill offers Make it again, can still be deleted, and can't be cancelled or edited; a paper bill offers a copy", async () => {
  salesServer();
  const view = renderApp(<BillMenu bill={toBillRow(wireRow({ status: "cancelled" }))} />);
  await open();
  expect(await screen.findByRole("menuitem", { name: /^Make it again/ })).toBeEnabled();
  expect(screen.queryByRole("menuitem", { name: /^Duplicate/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: /^Send/ })).not.toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: /^Cancel bill…/ })).toHaveTextContent("Already cancelled");
  expect(screen.getByRole("menuitem", { name: /^Cancel bill…/ })).toBeDisabled();
  expect(screen.getByRole("menuitem", { name: /^Edit/ })).toHaveTextContent("Cancelled bills can't be changed");
  expect(screen.getByRole("menuitem", { name: /^Delete…/ })).toBeEnabled();
  view.unmount();
  renderApp(<BillMenu bill={toBillRow(wireRow({ paper: true }))} />);
  await open();
  expect(await screen.findByRole("menuitem", { name: /^Send a copy on WhatsApp/ })).toHaveTextContent("The customer has the paper bill");
});

test("a filed month's bill can't be edited, cancelled or deleted, and says why; the owner's Cancel opens its dialog", async () => {
  salesServer();
  const view = renderApp(<BillMenu bill={toBillRow(wireRow({ locked: true }))} />);
  await open();
  expect(await screen.findByRole("menuitem", { name: /^Delete…/ })).toHaveTextContent("This bill's month is filed and locked. Unlock the month in GST returns first (owner only).");
  expect(screen.getByRole("menuitem", { name: /^Delete…/ })).toBeDisabled();
  view.unmount();
  renderApp(<BillMenu bill={toBillRow(wireRow())} />);
  await open();
  await userEvent.click(await screen.findByRole("menuitem", { name: /^Cancel bill…/ }));
  expect(await screen.findByRole("dialog", { name: "Cancel bill KGH/2026-27/31?" })).toBeInTheDocument();
});

/* ── Beyond the brief ── */

test("Send waits for the shop's WhatsApp message, as the list's Send does, so the shop's own message goes with it", async () => {
  let answer: (w: unknown) => void = () => {};
  salesServer([["GET", "shop-settings/", () => new Promise((resolve) => { answer = resolve; })]]);
  renderApp(<BillMenu bill={toBillRow(wireRow())} />);
  await open();
  const send = await screen.findByRole("menuitem", { name: /^Send on WhatsApp/ });
  expect(send).toBeDisabled();
  expect(send).toHaveTextContent("Getting the shop's WhatsApp message");
  await act(async () => { answer({ copies: "original", show_bank: true, share_message: "", updated_at: null, updated_by: null }); });
  await waitFor(() => expect(screen.getByRole("menuitem", { name: /^Send on WhatsApp/ })).toBeEnabled());
});

test("a filed month's bill can't take a new number, move firm or change its e-way bill either (the server refuses each): each says why", async () => {
  salesServer();
  renderApp(<BillMenu bill={toBillRow(wireRow({ locked: true }))} show={{ eway: true, renumber: true, move: true }} />);
  await open();
  for (const name of [/^E-way bill…/, /^Renumber…/, /^Move to another firm…/]) {
    const item = await screen.findByRole("menuitem", { name });
    expect(item).toBeDisabled();
    expect(item).toHaveTextContent("This bill's month is filed and locked. Unlock the month in GST returns first (owner only).");
  }
});
