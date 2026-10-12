import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { useFocusTrap } from "./Overlay";
import { Dialog, Sheet } from "./Dialog";
import { renderApp } from "@/test/render";

function Probe() {
  const [open, setOpen] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  useFocusTrap(dialog, open, () => { setDisabled(true); setOpen(false); }, field);
  return <main id="app-main">
    <h1 data-page-title="" tabIndex={-1}>Sales</h1>
    <button disabled={disabled} onClick={() => setOpen(true)}>Open</button>
    {open ? <div ref={dialog} role="dialog"><input ref={field} aria-label="Name" /></div> : null}
  </main>;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

test("an overlay returns to the page title when its opener became disabled", () => {
  render(<Probe />);
  const opener = screen.getByRole("button", { name: "Open" });
  act(() => opener.focus());
  fireEvent.click(opener);
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Name" }), { key: "Escape" });
  expect(opener).toBeDisabled();
  expect(screen.getByRole("heading", { name: "Sales" })).toHaveFocus();
});

test.each([["dialog", Dialog], ["sheet", Sheet]] as const)("when an opener disappears, focus returns to the topmost open overlay's title (%s)", (_, Parent) => {
  function Stack() {
    const [top, setTop] = useState(false);
    const [removed, setRemoved] = useState(false);
    return <>
      <main id="app-main"><h1 data-page-title="" tabIndex={-1}>Sales</h1></main>
      <Dialog open onClose={() => {}} title="Bill"><p>The bill stays open</p></Dialog>
      <Parent open onClose={() => {}} title="Customer">
        {!removed && <button onClick={() => setTop(true)}>Confirm</button>}
      </Parent>
      <Dialog open={top} onClose={() => { setRemoved(true); setTop(false); }} title="Confirmation"><input data-autofocus="" aria-label="Reason" /></Dialog>
    </>;
  }
  renderApp(<Stack />);
  act(() => vi.advanceTimersByTime(350));
  const opener = screen.getByRole("button", { name: "Confirm" });
  act(() => opener.focus());
  fireEvent.click(opener);
  act(() => vi.advanceTimersByTime(20));
  const field = screen.getByRole("textbox", { name: "Reason" });
  expect(field).toHaveFocus();
  fireEvent.keyDown(field, { key: "Escape" });
  expect(opener).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Customer" })).toHaveFocus();
  expect(screen.getByRole("heading", { name: "Sales" })).not.toHaveFocus();
});
