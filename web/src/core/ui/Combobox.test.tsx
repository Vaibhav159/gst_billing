import { useState } from "react";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "@/test/render";
import { Combobox, type ComboItem, type ComboOption } from "./index";

const PEOPLE = ["Anil Gupta", "Meena Jain", "Mahesh Soni"];
/** A customer box as a page holds one: what's typed, the matches under a heading, and the pick shown in the box. */
function Picker({ onPick, autoFocus }: { onPick: (o: ComboOption<number>) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const found = PEOPLE.filter((n) => n.toLowerCase().includes(q.trim().toLowerCase()));
  const options: ComboItem<number>[] = found.length ? [{ heading: "Customers" }, ...found.map((n) => ({ key: n, title: n, sub: "Udaipur", value: PEOPLE.indexOf(n) }))] : [];
  return <Combobox id="cb" ariaLabel="Customer" listLabel="Customers" query={q} onQuery={setQ} options={options} autoFocus={autoFocus} onPick={(o) => { setQ(o.title); onPick(o); }} />;
}

test("typing opens the matches under their heading; the arrows move the highlight, and Enter picks it", async () => {
  const onPick = vi.fn();
  renderApp(<Picker onPick={onPick} />);
  const box = screen.getByRole("combobox", { name: "Customer" });
  expect(box).toHaveAttribute("aria-expanded", "false");
  await userEvent.type(box, "a");
  const list = screen.getByRole("listbox", { name: "Customers" });
  // the heading is a label, not a choice
  expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["Anil GuptaUdaipur", "Meena JainUdaipur", "Mahesh SoniUdaipur"]);
  expect(within(list).getByText("Customers")).toHaveAttribute("role", "presentation");
  expect(box).toHaveAttribute("aria-expanded", "true");
  expect(box).toHaveAttribute("aria-activedescendant", "cb-o0");
  await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
  expect(box).toHaveAttribute("aria-activedescendant", "cb-o2"); // it stops at the last
  await userEvent.keyboard("{ArrowUp}");
  expect(screen.getByRole("option", { name: /Meena Jain/ })).toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{Enter}");
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ title: "Meena Jain", value: 1 }));
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(box).toHaveValue("Meena Jain");
});

test("Tab picks the highlighted match only once something is typed; Esc closes the list, picks nothing, and goes no further", async () => {
  const onPick = vi.fn();
  const outside = vi.fn();
  renderApp(<div onKeyDown={(e) => outside(e.key)}><Picker onPick={onPick} /><button type="button">Next</button></div>);
  const box = screen.getByRole("combobox", { name: "Customer" });
  await userEvent.click(box);
  expect(screen.getByRole("listbox", { name: "Customers" })).toBeInTheDocument();
  // nothing typed: Tab moves on and leaves the box as it was
  await userEvent.tab();
  expect(screen.getByRole("button", { name: "Next" })).toHaveFocus();
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  await userEvent.type(box, "jain");
  await userEvent.tab();
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ title: "Meena Jain" }));
  expect(box).toHaveFocus();
  // Esc with the list open closes only the list (a dialog around it stays open); with it closed, Esc goes on
  await userEvent.type(box, "{Backspace}");
  outside.mockClear();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(outside).not.toHaveBeenCalledWith("Escape");
  await userEvent.keyboard("{Escape}");
  expect(outside).toHaveBeenCalledWith("Escape");
  expect(onPick).toHaveBeenCalledTimes(1);
});

test("a box focused as its page opens waits for the person: its list opens on an arrow key", async () => {
  renderApp(<Picker onPick={() => {}} autoFocus />);
  const box = screen.getByRole("combobox", { name: "Customer" });
  expect(box).toHaveFocus();
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  await userEvent.keyboard("{ArrowDown}");
  expect(screen.getByRole("listbox", { name: "Customers" })).toBeInTheDocument();
});

test("a click on a match picks it, and the cursor stays in the box", async () => {
  const onPick = vi.fn();
  renderApp(<Picker onPick={onPick} />);
  const box = screen.getByRole("combobox", { name: "Customer" });
  await userEvent.type(box, "soni");
  await userEvent.click(screen.getByRole("option", { name: /Mahesh Soni/ }));
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ value: 2 }));
  expect(box).toHaveFocus();
  expect(box).toHaveValue("Mahesh Soni");
});
