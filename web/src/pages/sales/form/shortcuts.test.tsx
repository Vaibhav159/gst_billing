import { fireEvent, render } from "@testing-library/react";
import { openFormOverlays, useFormShortcuts } from "./shortcuts";

test("both form views hold Ctrl S behind open dialogs and menus, and ignore closing overlays", () => {
  const review = vi.fn();
  const add = vi.fn();
  function Form() {
    useFormShortcuts(false, review, add);
    return null;
  }
  const { unmount } = render(<Form />);
  const overlay = document.createElement("div");
  document.body.append(overlay);
  try {
    for (const role of ["dialog", "menu"]) {
      overlay.setAttribute("role", role);
      expect(openFormOverlays()).toEqual([overlay]);
      expect(fireEvent.keyDown(window, { key: "s", ctrlKey: true })).toBe(false);
      fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
      expect(review).not.toHaveBeenCalled();
      expect(add).not.toHaveBeenCalled();
    }
    overlay.setAttribute("data-closing", "");
    expect(openFormOverlays()).toEqual([]);
    fireEvent.keyDown(window, { key: "s", metaKey: true });
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    expect(review).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "s", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true, altKey: true });
    expect(review).toHaveBeenCalledTimes(1);
    unmount();
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    expect(review).toHaveBeenCalledTimes(1);
  } finally {
    overlay.remove();
  }
});

test("the form lets its review own Save and the phone doesn't bind Ctrl Enter", () => {
  const review = vi.fn();
  function Form() { useFormShortcuts(true, review); return null; }
  render(<Form />);
  expect(fireEvent.keyDown(window, { key: "s", ctrlKey: true })).toBe(false);
  expect(fireEvent.keyDown(window, { key: "Enter", ctrlKey: true })).toBe(true);
  expect(review).not.toHaveBeenCalled();
});
