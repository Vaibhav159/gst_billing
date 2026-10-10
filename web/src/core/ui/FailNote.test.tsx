import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { failText } from "@/core/sales/words";
import { renderApp } from "@/test/render";
import { FailNote } from "./index";

test("a failed save says in place what happened and what to do, with Try again that shows it's trying", async () => {
  const onRetry = vi.fn();
  const lost = failText({ kind: "unreachable", message: "The app couldn't get through" });
  renderApp(<>
    <FailNote error={null} onRetry={onRetry} />
    <FailNote error={lost} onRetry={onRetry} />
    <FailNote error={lost} onRetry={onRetry} busy />
    <FailNote error={{ title: "Not cancelled", body: "" }} />
  </>);
  // no error, no note
  const [note, trying, refused] = screen.getAllByRole("alert");
  expect(screen.getAllByRole("alert")).toHaveLength(3);
  expect(note).toHaveTextContent("Not saved: the app couldn't get through");
  expect(note).toHaveTextContent("Nothing was changed. What you typed is still here. Try again in a minute.");
  await userEvent.click(within(note).getByRole("button", { name: "Try again" }));
  expect(onRetry).toHaveBeenCalledTimes(1);
  expect(within(trying).getByRole("button", { name: "Trying…" })).toHaveAttribute("aria-busy", "true");
  // a refusal has nothing to try again: just its words
  expect(refused).toHaveTextContent(/^Not cancelled$/);
  expect(within(refused).queryByRole("button")).not.toBeInTheDocument();
});
