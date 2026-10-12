import { act, fireEvent, screen, within } from "@testing-library/react";
import { ScopeProvider } from "@/core/scope";
import { salesServer } from "@/core/sales/fixtures";
import { handClock, pass } from "@/test/clock";
import { renderApp } from "@/test/render";
import { AttentionButton } from "./AttentionButton";

const missing = vi.hoisted(() => {
  let fail!: (error: Error) => void;
  return { arrival: new Promise<never>((_resolve, reject) => { fail = reject; }), fail: (error: Error) => fail(error) };
});
vi.mock("./AttentionSheet", () => missing.arrival);

test("a rejected sheet chunk offers recovery without removing unsaved work and returns focus on close", async () => {
  handClock();
  const reported = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    salesServer();
    renderApp(<ScopeProvider><label>Unsaved note<input /></label><AttentionButton /></ScopeProvider>);
    await pass();
    const note = screen.getByRole("textbox", { name: "Unsaved note" });
    fireEvent.change(note, { target: { value: "Keep this unsaved work" } });
    const bell = screen.getByRole("button", { name: "Needs attention" });
    bell.focus();
    fireEvent.click(bell);
    await act(async () => { missing.fail(new TypeError("Failed to fetch dynamically imported module")); });
    await pass();

    const dialog = screen.getByRole("dialog", { name: "Needs attention" });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Needs attention couldn't load");
    expect(dialog).toHaveTextContent("Save your changes before reloading the page to try again.");
    expect(note).toBeInTheDocument();
    expect(note).toHaveValue("Keep this unsaved work");
    await pass(351);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await pass();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(bell).toHaveFocus();
    expect(note).toHaveValue("Keep this unsaved work");

    fireEvent.click(bell);
    await pass();
    expect(screen.getByRole("dialog", { name: "Needs attention" })).toHaveTextContent("Needs attention couldn't load");
    expect(note).toHaveValue("Keep this unsaved work");
  } finally { reported.mockRestore(); vi.useRealTimers(); }
});
