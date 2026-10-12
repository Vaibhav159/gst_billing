import { fireEvent, screen } from "@testing-library/react";
import { renderApp } from "@/test/render";
import { handClock, pass } from "@/test/clock";
import { serve } from "@/test/server";
import { LeaveBillDialog, type LeaveBillDialogProps } from "./BillLeave";

const props = (extra: Partial<LeaveBillDialogProps> = {}): LeaveBillDialogProps => ({
  open: true, name: "Anil Gupta", busy: false, onStay: vi.fn(), onKeep: vi.fn(), onThrow: vi.fn(), ...extra,
});
beforeEach(() => handClock());
afterEach(() => vi.useRealTimers());

test("leave names the buyer and offers keeping or throwing away with the prototype's words", async () => {
  const calls = serve({});
  const p = props();
  renderApp(<LeaveBillDialog {...p} />);
  expect(screen.getByRole("dialog", { name: "Keep this bill for later?" })).toHaveAccessibleDescription("Anil Gupta's bill isn't saved yet.");
  expect(screen.getByText("Kept bills wait on Home with Finish, with everything you typed. Throw it away if the customer isn't buying.")).toBeInTheDocument();
  await pass(400);
  fireEvent.click(screen.getByRole("button", { name: "Keep it as an unfinished bill" }));
  expect(p.onKeep).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Throw it away" }));
  expect(p.onThrow).toHaveBeenCalledTimes(1);
  expect(p.onStay).not.toHaveBeenCalled();
  expect(calls).toEqual([]);
});

test("Escape or Close stays on the bill without keeping or throwing", async () => {
  const p = props({ name: "Thomas" });
  renderApp(<LeaveBillDialog {...p} />);
  const dialog = screen.getByRole("dialog", { name: "Keep this bill for later?" });
  expect(dialog).toHaveAccessibleDescription("Thomas' bill isn't saved yet.");
  await pass(400);
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(p.onStay).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(p.onStay).toHaveBeenCalledTimes(2);
  expect(p.onKeep).not.toHaveBeenCalled();
  expect(p.onThrow).not.toHaveBeenCalled();
});

test("busy leaves every callback inactive, including Escape and Close", async () => {
  const p = props({ busy: true });
  renderApp(<LeaveBillDialog {...p} />);
  const dialog = screen.getByRole("dialog", { name: "Keep this bill for later?" });
  await pass(400);
  for (const label of ["Keep it as an unfinished bill", "Throw it away"]) {
    const button = screen.getByRole("button", { name: label });
    expect(button).toBeDisabled();
    fireEvent.click(button);
  }
  fireEvent.keyDown(dialog, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(p.onStay).not.toHaveBeenCalled();
  expect(p.onKeep).not.toHaveBeenCalled();
  expect(p.onThrow).not.toHaveBeenCalled();
});

test("the dialog is controlled and preserves the opening click guard", async () => {
  const p = props();
  const view = renderApp(<LeaveBillDialog {...p} />);
  const discard = screen.getByRole("button", { name: "Throw it away" });
  fireEvent.click(discard);
  expect(p.onThrow).not.toHaveBeenCalled();
  await pass(400);
  fireEvent.click(discard);
  expect(p.onThrow).toHaveBeenCalledTimes(1);
  view.unmount();
  renderApp(<LeaveBillDialog {...p} open={false} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("a failed keep stays in the dialog with retry and throw available", () => {
  renderApp(<LeaveBillDialog open name="Anil" busy={false} error="This browser doesn't store unfinished bills, so this one lasts only while this page is open." onStay={vi.fn()} onKeep={vi.fn()} onThrow={vi.fn()} />);
  expect(screen.getByRole('alert')).toHaveTextContent("This browser doesn't store unfinished bills");
  expect(screen.getByRole('button', {name:'Keep it as an unfinished bill'})).toBeEnabled();
  expect(screen.getByRole('button', {name:'Throw it away'})).toBeEnabled();
});
