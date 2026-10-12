import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { renderApp } from "@/test/render";
import { Sheet } from "./Dialog";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); (window as unknown as { __phone?: boolean }).__phone = false; });

test.each([
  [false, "Escape"], [false, "outside"], [false, "Close"],
  [true, "Escape"], [true, "outside"], [true, "Close"],
] as const)("a sheet asks before discarding typed text (phone=%s, %s)", (isPhone, way) => {
  (window as unknown as { __phone?: boolean }).__phone = isPhone;
  const onClose = vi.fn();
  renderApp(<Sheet open onClose={onClose} title="New customer" confirmClose="Discard this customer?"><input aria-label="Name" /></Sheet>);
  act(() => vi.advanceTimersByTime(350));
  const field = screen.getByRole("textbox", { name: "Name" });
  fireEvent.change(field, { target: { value: "Kamal" } });
  act(() => field.focus());
  const close = () => {
    if (way === "Escape") fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    else if (way === "outside") fireEvent.click(screen.getByRole("dialog").previousElementSibling!);
    else fireEvent.click(screen.getByRole("button", { name: "Close" }));
  };
  close();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("Discard this customer?");
  const keep = screen.getByRole("button", { name: "Keep editing" });
  expect(keep).toHaveFocus();
  fireEvent.click(keep);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(field).toHaveValue("Kamal");
  act(() => field.focus());
  close();
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("a desktop sheet keeps its 350 ms click guard and drops the discard question when it closes", () => {
  function Probe() {
    const [open, setOpen] = useState(true);
    return <><button onClick={() => setOpen(true)}>Open</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="New customer" confirmClose="Discard this customer?"><input aria-label="Name" /></Sheet>
    </>;
  }
  renderApp(<Probe />);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(350));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.getByRole("alert")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Discard" }));
  act(() => vi.advanceTimersByTime(190));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(screen.getByRole("dialog", { name: "New customer" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
