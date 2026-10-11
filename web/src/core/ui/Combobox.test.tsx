import { useState } from "react";
import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "@/test/render";
import { Combobox, Dialog, type ComboItem, type ComboOption } from "./index";

const PEOPLE = ["Anil Gupta", "Meena Jain", "Mahesh Soni"];

test.each(["Keep typing to search", "Searching…", "Couldn't search: the app couldn't get through", "No customer matches “Kamal”"])("a note without choices is announced without an empty listbox: %s", (note) => {
  vi.useFakeTimers();
  try {
    renderApp(<Combobox id="cb" ariaLabel="Customer" query="Kamal" onQuery={() => {}} options={[{ heading: note }]} onPick={() => {}} />);
    const box = screen.getByRole("combobox", { name: "Customer" });
    fireEvent.focus(box);
    expect(box).toHaveAttribute("aria-expanded", "false");
    expect(box).not.toHaveAttribute("aria-activedescendant");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    const status = screen.getByRole("status");
    expect(status).toHaveClass("sr-only");
    expect(status).toHaveTextContent(note);
    // Sighted users still get the note while the search has nothing to pick.
    expect(screen.getAllByText(note).some((node) => !node.closest(".sr-only"))).toBe(true);
  } finally { vi.useRealTimers(); }
});

test("matches are announced as a count, and a search note takes precedence when an action remains available", () => {
  vi.useFakeTimers();
  try {
    const props = { id: "cb", ariaLabel: "Customer", query: "a", onQuery: () => {}, onPick: () => {} };
    const { rerender } = renderApp(<Combobox {...props} options={[{ heading: "Customers" }, ...PEOPLE.map((title, value) => ({ key: title, title, value }))]} />);
    const box = screen.getByRole("combobox", { name: "Customer" });
    fireEvent.focus(box);
    expect(box).toHaveAttribute("aria-expanded", "true");
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(3);
    expect(screen.getByRole("status")).toHaveTextContent("3 matches");
    const note = "Couldn't search: you're offline";
    rerender(<Combobox {...props} note={note} options={[{ heading: note }, { key: "new", title: "+ New customer…", value: 0 }]} />);
    fireEvent.focus(screen.getByRole("combobox", { name: "Customer" }));
    expect(screen.getByRole("status")).toHaveTextContent(note);
  } finally { vi.useRealTimers(); }
});
/**
 * A customer box as a page holds one: what's typed, the matches under a heading, and the pick shown in the box. min: the
 * characters typed before it lists anything (a search box's minimum).
 */
function Picker({ onPick, autoFocus, min = 0 }: { onPick: (o: ComboOption<number>) => void; autoFocus?: boolean; min?: number }) {
  const [q, setQ] = useState("");
  const found = q.trim().length >= min ? PEOPLE.filter((n) => n.toLowerCase().includes(q.trim().toLowerCase())) : [];
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

test("in a real dialog, Esc with the list open closes only the list, and the next Esc closes the dialog", async () => {
  const closed = vi.fn();
  function InDialog() {
    const [open, setOpen] = useState(true);
    return <Dialog open={open} onClose={() => { closed(); setOpen(false); }} title="Pick the customer"><Picker onPick={() => {}} /></Dialog>;
  }
  renderApp(<InDialog />);
  const dialog = screen.getByRole("dialog", { name: "Pick the customer" });
  const box = within(dialog).getByRole("combobox", { name: "Customer" });
  await userEvent.type(box, "a");
  expect(screen.getByRole("listbox", { name: "Customers" })).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(closed).not.toHaveBeenCalled();
  expect(dialog).toBeInTheDocument();
  expect(box).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  expect(closed).toHaveBeenCalledTimes(1);
});

test("in a real dialog, a box with nothing listed keeps no Esc: one Esc closes the dialog, with nothing typed yet or nothing matching", async () => {
  for (const typed of ["", "zzz"]) {
    const closed = vi.fn();
    function InDialog() {
      const [open, setOpen] = useState(true);
      return <Dialog open={open} onClose={() => { closed(); setOpen(false); }} title="Pick the customer"><Picker onPick={() => {}} min={2} /></Dialog>;
    }
    const { unmount } = renderApp(<InDialog />);
    const box = within(screen.getByRole("dialog", { name: "Pick the customer" })).getByRole("combobox", { name: "Customer" });
    await userEvent.click(box);
    if (typed) await userEvent.type(box, typed);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    // expanded only with a list on screen
    expect(box, typed).toHaveAttribute("aria-expanded", "false");
    await userEvent.keyboard("{Escape}");
    expect(closed, typed).toHaveBeenCalledTimes(1);
    unmount();
  }
});

test("Esc while nothing is listed yet still shuts the list: matches that come after don't drop it open, and the key goes on", async () => {
  let answer: (o: ComboItem<number>[]) => void = () => {};
  /** A search box whose matches come later (the sales list's customer filter, waiting on the server). */
  function Later() {
    const [q, setQ] = useState("");
    const [options, setOptions] = useState<ComboItem<number>[]>([]);
    answer = setOptions;
    return <Combobox id="cb" ariaLabel="Customer" listLabel="Customers" query={q} onQuery={setQ} options={options} onPick={() => {}} />;
  }
  const outside = vi.fn();
  renderApp(<div onKeyDown={(e) => outside(e.key)}><Later /></div>);
  const box = screen.getByRole("combobox", { name: "Customer" });
  await userEvent.type(box, "an");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  // nothing on screen to close, so the key goes on (to a dialog around the box, say)
  expect(outside).toHaveBeenCalledWith("Escape");
  act(() => answer([{ key: "a", title: "Anil Gupta", value: 1 }]));
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(box).toHaveAttribute("aria-expanded", "false");
});

test("a box focused as its page opens waits for the person: its list opens on an arrow key", async () => {
  renderApp(<Picker onPick={() => {}} autoFocus />);
  const box = screen.getByRole("combobox", { name: "Customer" });
  expect(box).toHaveFocus();
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  await userEvent.keyboard("{ArrowDown}");
  expect(screen.getByRole("listbox", { name: "Customers" })).toBeInTheDocument();
});

test("an arrow pressed while the list has nothing to pick yet (a heading only) leaves the first match to come highlighted", async () => {
  const onPick = vi.fn();
  let answer = (_: boolean) => {};
  /** A list that says it's searching until its matches come. */
  function Later() {
    const [q, setQ] = useState("");
    const [ready, setReady] = useState(false);
    answer = setReady;
    const options: ComboItem<number>[] = ready ? PEOPLE.map((n, i) => ({ key: n, title: n, value: i })) : [{ heading: "Searching…" }];
    return <Combobox id="cb" ariaLabel="Customer" listLabel="Customers" query={q} onQuery={setQ} options={options} onPick={onPick} />;
  }
  renderApp(<Later />);
  const box = screen.getByRole("combobox", { name: "Customer" });
  await userEvent.type(box, "a");
  await userEvent.keyboard("{ArrowDown}{Enter}");
  expect(onPick).not.toHaveBeenCalled();
  act(() => answer(true));
  expect(box).toHaveAttribute("aria-activedescendant", "cb-o0");
  await userEvent.keyboard("{Enter}");
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ title: "Anil Gupta" }));
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
