import { fireEvent, screen } from "@testing-library/react";
import { renderApp } from "@/test/render";
import { useToast } from "./toast";

vi.hoisted(() => { Object.defineProperty(navigator, "platform", { configurable: true, value: "MacIntel" }); });

function UndoToast() {
  const { show } = useToast();
  return <button onClick={() => show({ title: "Deleted", action: { label: "Undo", onClick: () => {} } })}>Delete</button>;
}

test("the Mac Undo hint names Command and exposes both supported shortcuts", () => {
  renderApp(<UndoToast />);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  const undo = screen.getByRole("button", { name: /^Undo/ });
  expect(undo).toHaveTextContent("⌘ Z");
  expect(undo).toHaveAttribute("aria-keyshortcuts", "Control+Z Meta+Z");
});

test("Undo keeps keyboard shortcuts available on a phone without showing the hint", () => {
  (window as unknown as { __phone?: boolean }).__phone = true;
  try {
    renderApp(<UndoToast />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const undo = screen.getByRole("button", { name: /^Undo/ });
    expect(undo).toHaveAttribute("aria-keyshortcuts", "Control+Z Meta+Z");
    expect(undo.querySelector("kbd")).toBeNull();
  } finally { (window as unknown as { __phone?: boolean }).__phone = false; }
});
