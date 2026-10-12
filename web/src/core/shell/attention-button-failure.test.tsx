import { act, fireEvent, screen } from "@testing-library/react";
import { ScopeProvider } from "@/core/scope";
import { salesServer } from "@/core/sales/fixtures";
import { handClock, pass } from "@/test/clock";
import { renderApp } from "@/test/render";
import { DesktopShell } from "./DesktopShell";

const missing = vi.hoisted(() => {
  let fail!: (error: Error) => void;
  return { arrival: new Promise<never>((_resolve, reject) => { fail = reject; }), fail: (error: Error) => fail(error) };
});
vi.mock("./AttentionButton", () => missing.arrival);

test("a rejected bell chunk preserves the desktop page, input and focus", async () => {
  handClock();
  const reported = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    salesServer();
    renderApp(<ScopeProvider><DesktopShell openPalette={() => {}}>
      <main><label>Unsaved note<input /></label></main>
    </DesktopShell></ScopeProvider>);
    await pass();
    const main = screen.getByRole("main");
    const note = screen.getByRole("textbox", { name: "Unsaved note" });
    fireEvent.change(note, { target: { value: "Keep this unsaved work" } });
    note.focus();
    await act(async () => { missing.fail(new TypeError("Failed to fetch dynamically imported module")); });
    expect(screen.getByRole("main")).toBe(main);
    expect(note).toHaveValue("Keep this unsaved work");
    expect(note).toHaveFocus();
    expect(screen.getByRole("button", { name: "Search (Ctrl K)" })).toBeInTheDocument();
  } finally { reported.mockRestore(); vi.useRealTimers(); }
});
