import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { useFocusTrap } from "./Overlay";

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
