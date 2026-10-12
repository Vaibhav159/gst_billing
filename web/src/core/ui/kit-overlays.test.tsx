import { pastGuard } from "@/test/clock";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { StrictMode, useRef, useState } from "react";
import { Button, ConfirmDialog, Dialog, Menu, ToastProvider, useToast } from "./index";

const wrap = (ui: React.ReactNode) => render(<MemoryRouter><ToastProvider>{ui}</ToastProvider></MemoryRouter>);

function DialogProbe() {
  const [open, setOpen] = useState(false);
  return <>
    <Button onClick={() => setOpen(true)}>Open</Button>
    <Dialog open={open} onClose={() => setOpen(false)} title="Add a customer"><input aria-label="Name" /><button type="button">Inside</button></Dialog>
  </>;
}

test("a dialog takes focus, keeps it inside, closes on Esc and gives focus back", async () => {
  wrap(<DialogProbe />);
  const opener = screen.getByRole("button", { name: "Open" });
  await userEvent.click(opener);
  const dialog = await screen.findByRole("dialog", { name: "Add a customer" });
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  for (let i = 0; i < 6; i++) await userEvent.tab();
  expect(dialog.contains(document.activeElement)).toBe(true);
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(opener).toHaveFocus();
});

test("a dialog's own field (initialFocus) has focus straight after opening, under StrictMode too, and Esc gives it back to the opener", () => {
  function Probe() {
    const [open, setOpen] = useState(false);
    const field = useRef<HTMLInputElement>(null);
    // mounted only while open, as search is: a dialog mounted closed would open as an update, which StrictMode doesn't re-run
    return <>
      <Button onClick={() => setOpen(true)}>Open</Button>
      {open && <Dialog open onClose={() => setOpen(false)} title="Search" initialFocus={field}><input ref={field} aria-label="Name" /></Dialog>}
    </>;
  }
  // StrictMode runs a new dialog's effects, cleans them up and runs them again, as development builds do
  render(<StrictMode><MemoryRouter><ToastProvider><Probe /></ToastProvider></MemoryRouter></StrictMode>);
  const opener = screen.getByRole("button", { name: "Open" });
  act(() => opener.focus());
  fireEvent.click(opener);
  // at once, not after the 20 ms fallback: keys typed straight after opening land in the field
  const field = screen.getByRole("textbox", { name: "Name" });
  expect(field).toHaveFocus();
  fireEvent.keyDown(field, { key: "Escape" });
  expect(opener).toHaveFocus();
});

test("a click landing within 350 ms of opening is ignored (the second tap of a double tap)", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const onConfirm = vi.fn();
  wrap(<ConfirmDialog open onClose={() => {}} onConfirm={onConfirm} title="Delete this bill?" confirmLabel="Delete" />);
  screen.getByRole("button", { name: "Delete" }).click();
  expect(onConfirm).not.toHaveBeenCalled();
  await act(async () => { vi.advanceTimersByTime(400); });
  screen.getByRole("button", { name: "Delete" }).click();
  expect(onConfirm).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});

test("changing a dialog's ghost guard key holds taps for 350 ms without moving focus, and the same key does not restart it", () => {
  vi.useFakeTimers();
  try {
    const onPick = vi.fn();
    function Probe({ item }: { item: number }) {
      return <MemoryRouter><ToastProvider><Dialog open onClose={() => {}} title="Add an item" ghostGuardKey={item}>
        <input aria-label="Search products" /><Button onClick={onPick}>An item that isn't in Products</Button>
      </Dialog></ToastProvider></MemoryRouter>;
    }
    const { rerender } = render(<Probe item={1} />);
    act(() => { vi.advanceTimersByTime(350); });
    const field = screen.getByRole("textbox", { name: "Search products" });
    const pick = screen.getByRole("button", { name: "An item that isn't in Products" });
    act(() => field.focus());
    expect(field).toHaveFocus();
    fireEvent.click(pick);
    expect(onPick).toHaveBeenCalledTimes(1);

    rerender(<Probe item={2} />);
    expect(field).toHaveFocus();
    fireEvent.click(pick);
    expect(onPick).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(349); });
    expect(field).toHaveFocus();
    fireEvent.click(pick);
    expect(onPick).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(1); });
    fireEvent.click(pick);
    expect(onPick).toHaveBeenCalledTimes(2);

    rerender(<Probe item={2} />);
    fireEvent.click(pick);
    expect(onPick).toHaveBeenCalledTimes(3);
  } finally { vi.useRealTimers(); }
});

test("menus open from their button and choose with the keyboard", async () => {
  const onSelect = vi.fn();
  wrap(<Menu title="Actions" trigger={(p) => <button {...p}>More</button>} items={[{ label: "Print", onSelect }, { label: "Delete", tone: "danger", onSelect: () => {} }]} />);
  await userEvent.click(screen.getByRole("button", { name: "More" }));
  const item = await screen.findByRole("menuitem", { name: "Print" });
  await waitFor(() => expect(item).toHaveFocus());
  await userEvent.keyboard("{Enter}");
  expect(onSelect).toHaveBeenCalled();
});

test("toasts replace one with the same title and keep at most three", async () => {
  function Probe() { const { show } = useToast(); return <Button onClick={() => { show({ title: "Saved" }); show({ title: "Saved" }); show({ title: "A" }); show({ title: "B" }); show({ title: "C" }); }}>Go</Button>; }
  wrap(<Probe />);
  await userEvent.click(screen.getByRole("button", { name: "Go" }));
  expect(screen.queryAllByText("Saved")).toHaveLength(0);
  expect(screen.getByText("A")).toBeInTheDocument();
  expect(screen.getByText("C")).toBeInTheDocument();
});

test("a toast on its way out ignores its action: a quick second press, or one after Dismiss, does nothing", () => {
  const mark = vi.fn();
  const undo = vi.fn();
  let t!: ReturnType<typeof useToast>;
  function Probe() { t = useToast(); return null; }
  wrap(<Probe />);
  act(() => { t.show({ title: "Not marked as sent", tone: "neg", action: { label: "Mark as sent", onClick: mark } }); });
  // both presses land while it animates out (170 ms): no time passes between them
  const press = screen.getByRole("button", { name: "Mark as sent" });
  fireEvent.click(press);
  fireEvent.click(press);
  expect(mark).toHaveBeenCalledTimes(1);
  act(() => { t.show({ title: "Deleted KGH/2026-27/31", action: { label: "Undo", onClick: undo } }); });
  const toast = screen.getByText("Deleted KGH/2026-27/31").closest(".card") as HTMLElement;
  fireEvent.click(within(toast).getByRole("button", { name: "Dismiss" }));
  fireEvent.click(within(toast).getByRole("button", { name: /^Undo/ }));
  expect(undo).not.toHaveBeenCalled();
});

/* ── Beyond the brief: the rest of the prototype's overlay behaviour, and what this port adds ── */
import { fireEvent, within } from "@testing-library/react";
import { useLocation } from "react-router";
import { applyTextSize } from "@/core/device";
import { ActionBarSlot, Page, Sheet, ToastHost, menuPlace, type DLRow } from "./index";
import { overlayLayer } from "./Overlay";

const phone = (on: boolean) => { (window as unknown as { __phone?: boolean }).__phone = on; };
afterEach(() => phone(false));
/** Past the ghost-tap guard: a dialog ignores clicks for 350 ms after it opens. */

test("overlays portal into one layer on <body> that carries the view, and a closing dialog says so", async () => {
  function Probe() { const [open, setOpen] = useState(true); return <Dialog open={open} onClose={() => setOpen(false)} title="Add a customer"><p>Name and phone</p></Dialog>; }
  wrap(<Probe />);
  const dialog = screen.getByRole("dialog", { name: "Add a customer" });
  const layer = document.getElementById("overlay-root");
  expect(layer).toHaveClass("overlay-layer");
  expect(layer?.parentElement).toBe(document.body);
  expect(layer).toContainElement(dialog);
  expect(layer).toHaveAttribute("data-view", "desktop");
  expect(dialog).not.toHaveAttribute("data-closing");
  fireEvent.keyDown(dialog, { key: "Escape" });
  expect(dialog).toHaveAttribute("data-closing");
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
});

test("the overlay layer follows the text size and keyboard inset set on #root", async () => {
  document.getElementById("overlay-root")?.remove();
  const root = document.createElement("div");
  root.id = "root";
  document.body.prepend(root);
  try {
    applyTextSize(1.2);
    wrap(<Dialog open onClose={() => {}} title="Add a customer"><p>Name and phone</p></Dialog>);
    const layer = document.getElementById("overlay-root")!;
    expect(layer.style.zoom).toBe("1.2");
    applyTextSize(1.1);
    await waitFor(() => expect(layer.style.zoom).toBe("1.1"));
    root.style.setProperty("--kb", "280px");
    await waitFor(() => expect(layer.style.getPropertyValue("--kb")).toBe("280px"));
    applyTextSize(1);
    await waitFor(() => expect(layer.style.zoom).toBe(""));
  } finally {
    applyTextSize(1);
    root.remove();
    document.getElementById("overlay-root")?.remove();
  }
});

test("Esc closes only the top dialog, even before focus has moved into it", async () => {
  function Two() {
    const [bill, setBill] = useState(true);
    const [ask, setAsk] = useState(true);
    return <>
      <Dialog open={bill} onClose={() => setBill(false)} title="Edit the bill"><p>Lines</p></Dialog>
      <Dialog open={ask} onClose={() => setAsk(false)} title="Discard the changes?"><p>Your lines go.</p></Dialog>
    </>;
  }
  wrap(<Two />);
  fireEvent.keyDown(document.body, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Discard the changes?" })).not.toBeInTheDocument());
  expect(screen.getByRole("dialog", { name: "Edit the bill" })).toBeInTheDocument();
});

test("a dialog holding typing asks before it closes: Keep editing stays, Discard closes", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const onClose = vi.fn();
    // confirmClose is the sentence to ask; a bare `true` would show the bar with no words
    // @ts-expect-error confirmClose takes a string
    void (<Dialog open onClose={onClose} title="New customer" confirmClose><input aria-label="Name" /></Dialog>);
    wrap(<Dialog open onClose={onClose} title="New customer" confirmClose="Discard this customer?"><input aria-label="Name" /></Dialog>);
    await pastGuard();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Discard this customer?");
    expect(screen.getByRole("button", { name: "Keep editing" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

test("on phones a dialog is a bottom sheet: a long drag or a flick closes it, a short slow one springs back, and it reopens in place", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  phone(true);
  try {
    function Probe() { const [open, setOpen] = useState(true); return <><Button onClick={() => setOpen(true)}>Open</Button><Dialog open={open} onClose={() => setOpen(false)} title="Firm"><p>Kiran</p></Dialog></>; }
    wrap(<Probe />);
    const drag = (type: string, y: number) => fireEvent(screen.getByRole("heading", { name: "Firm" }), new MouseEvent(type, { bubbles: true, button: 0, clientY: y }));
    // 60 px, slowly: it follows the finger, then springs back and stays open
    drag("pointerdown", 100);
    await pastGuard();
    drag("pointermove", 160);
    expect(screen.getByRole("dialog").style.transform).toBe("translateY(60px)");
    drag("pointerup", 160);
    expect(screen.getByRole("dialog").style.transform).toBe("");
    expect(screen.getByRole("dialog")).not.toHaveAttribute("data-closing");
    // 150 px, slowly: past 110 px, so it closes
    drag("pointerdown", 100);
    await pastGuard();
    drag("pointermove", 250);
    drag("pointerup", 250);
    await pastGuard();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog", { name: "Firm" }).style.transform).toBe("");
    // 40 px at once: a flick closes it too
    drag("pointerdown", 100);
    drag("pointermove", 140);
    drag("pointerup", 140);
    expect(screen.getByRole("dialog")).toHaveAttribute("data-closing");
  } finally {
    vi.useRealTimers();
  }
});

test("with a real layout, focus starts in the first field (not Close) and Tab wraps at both ends", async () => {
  // jsdom lays nothing out (offsetParent is always null), so the trap sees only the focused element
  const was = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent")!;
  Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get() { return (this as HTMLElement).parentElement; } });
  try {
    wrap(<DialogProbe />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    const name = await screen.findByRole("textbox", { name: "Name" });
    await waitFor(() => expect(name).toHaveFocus());
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Inside" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Inside" })).toHaveFocus();
  } finally {
    Object.defineProperty(HTMLElement.prototype, "offsetParent", was);
  }
});

test("a dialog's body that scrolls with nothing to focus inside takes the keyboard as a region named by its title, but never the first focus (Ruling 1D-18)", async () => {
  // jsdom lays nothing out: the trap's focusables get a layout, and an element holding [data-tall] is taller than its box
  const was = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent")!;
  const sized = HTMLElement.prototype as unknown as Record<string, unknown>;
  Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get() { return (this as HTMLElement).parentElement; } });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get() { return (this as HTMLElement).querySelector("[data-tall]") ? 900 : 0; } });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return (this as HTMLElement).querySelector("[data-tall]") ? 500 : 0; } });
  // the bill's review: how it was paid asked inside the body until it's picked, Save and Go back in the footer
  function Review({ paid, long = true }: { paid: boolean; long?: boolean }) {
    return <MemoryRouter><ToastProvider>
      <Dialog open onClose={() => {}} title="Check the bill" footer={<><Button>Go back and edit</Button><Button variant="primary">Save bill</Button></>}>
        {paid ? null : <button type="button">Cash</button>}
        <p data-tall={long ? "" : undefined}>Every line, to the paisa</p>
      </Dialog>
    </ToastProvider></MemoryRouter>;
  }
  try {
    // something to focus inside: the body is as it was
    const { rerender, unmount } = render(<Review paid={false} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Cash" })).toHaveFocus());
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    // paid: a body that scrolls with nothing left to focus is reached by Tab, from Close, so the arrows can scroll it
    rerender(<Review paid />);
    const body = await screen.findByRole("region", { name: "Check the bill" });
    expect(body).toHaveAttribute("tabindex", "0");
    act(() => screen.getByRole("button", { name: "Close" }).focus());
    await userEvent.tab();
    expect(body).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Go back and edit" })).toHaveFocus();
    // a body that fits is no region
    rerender(<Review paid long={false} />);
    await waitFor(() => expect(screen.queryByRole("region")).not.toBeInTheDocument());
    expect(screen.getByText("Every line, to the paisa").parentElement).not.toHaveAttribute("tabindex");
    unmount();
    // opened paid, the first focus is the footer's first button, never the body
    render(<Review paid />);
    const opened = await screen.findByRole("region", { name: "Check the bill" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Go back and edit" })).toHaveFocus());
    expect(opened).not.toHaveFocus();
  } finally {
    Object.defineProperty(HTMLElement.prototype, "offsetParent", was);
    delete sized.scrollHeight;
    delete sized.clientHeight;
  }
});

test("a dialog that closed as a region doesn't reopen drawn as one, not even before it measures its body again", async () => {
  const sized = HTMLElement.prototype as unknown as Record<string, unknown>;
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get() { return (this as HTMLElement).querySelector("[data-tall]") ? 900 : 0; } });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return (this as HTMLElement).querySelector("[data-tall]") ? 500 : 0; } });
  function Review({ open, long }: { open: boolean; long: boolean }) {
    return <MemoryRouter><ToastProvider>
      <Dialog open={open} onClose={() => {}} title="Check the bill" footer={<Button>Go back and edit</Button>}>
        <p data-tall={long ? "" : undefined}>Every line, to the paisa</p>
      </Dialog>
    </ToastProvider></MemoryRouter>;
  }
  try {
    const { rerender } = render(<Review open long />);
    await screen.findByRole("region", { name: "Check the bill" });
    rerender(<Review open={false} long />);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // reopened with a body that fits: drawn as a region at any point, its role would be added or taken away again
    const seen: string[] = [];
    const look = (records: MutationRecord[]) => records.forEach((r) => {
      if (r.type === "attributes" && r.oldValue === "region") seen.push("its role was region, then taken away");
      r.addedNodes.forEach((n) => { if (n instanceof HTMLElement && n.querySelector('[data-dialog-body][role="region"]')) seen.push("drawn as a region"); });
    });
    const watch = new MutationObserver(look);
    watch.observe(document.body, { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ["role"] });
    rerender(<Review open long={false} />);
    await screen.findByRole("dialog", { name: "Check the bill" });
    look(watch.takeRecords());
    watch.disconnect();
    expect(seen).toEqual([]);
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  } finally {
    delete sized.scrollHeight;
    delete sized.clientHeight;
  }
});

test("a closing sheet says so, as a closing dialog does, on desktop and on phones", async () => {
  function Probe() { const [open, setOpen] = useState(true); return <Sheet open={open} onClose={() => setOpen(false)} title="Filter customers"><p>Owing</p></Sheet>; }
  for (const onPhone of [false, true]) {
    phone(onPhone);
    const { unmount } = wrap(<Probe />);
    const sheet = screen.getByRole("dialog", { name: "Filter customers" });
    expect(sheet).not.toHaveAttribute("data-closing");
    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(sheet, onPhone ? "phone" : "desktop").toHaveAttribute("data-closing");
    await waitFor(() => expect(sheet).not.toBeInTheDocument());
    unmount();
  }
});

test("a sheet is a side panel on desktop and a bottom sheet on phones", () => {
  const ui = <Sheet open onClose={() => {}} title="Filter customers" width={420}><p>Owing</p></Sheet>;
  const { unmount } = wrap(ui);
  expect(screen.getByRole("dialog", { name: "Filter customers" }).style.width).toBe("420px");
  unmount();
  phone(true);
  wrap(ui);
  const sheet = screen.getByRole("dialog", { name: "Filter customers" });
  expect(sheet.style.width).toBe("");
  expect(sheet).toHaveClass("rounded-t-xl");
});

test("a page drawn inside a sheet keeps its action bar in the sheet, never in the phone shell's place behind the overlay", () => {
  phone(true);
  const place = document.createElement("div"); // the phone shell's place for the page's bar (ActionBarSlot)
  document.body.appendChild(place);
  try {
    wrap(<ActionBarSlot.Provider value={place}><Sheet open onClose={() => {}} title="New customer">
      <Page title="New customer" actionBar={<Button>Save customer</Button>}>The form</Page>
    </Sheet></ActionBarSlot.Provider>);
    const bar = screen.getByRole("button", { name: "Save customer" }).closest<HTMLElement>("[data-actionbar]")!;
    expect(screen.getByRole("dialog", { name: "New customer" })).toContainElement(bar);
    expect(place).toBeEmptyDOMElement();
  } finally {
    place.remove();
  }
});

test("a confirmation can wait for a tick, and while it saves nothing closes it", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const onClose = vi.fn();
    const record: DLRow[] = [["Firm", "Meera Ornaments"], ["GSTIN", "08BBBBB0000B1Z5"]];
    const props = { open: true, onClose, onConfirm: () => {}, title: "Remove Meera Ornaments?", confirmLabel: "Remove", ack: "I understand Meera Ornaments goes off every list.", record };
    const { rerender } = wrap(<ConfirmDialog {...props} />);
    await pastGuard();
    expect(screen.getByText("08BBBBB0000B1Z5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "I understand Meera Ornaments goes off every list." }));
    expect(screen.getByRole("button", { name: "Remove" })).toBeEnabled();
    rerender(<MemoryRouter><ToastProvider><ConfirmDialog {...props} busy busyLabel="Removing…" /></ToastProvider></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Removing…" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test("on phones a sheet that asks first springs back while it asks", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  phone(true);
  try {
    const onClose = vi.fn();
    wrap(<Dialog open onClose={onClose} title="New customer" confirmClose="Discard this customer?"><input aria-label="Name" /></Dialog>);
    const drag = (type: string, y: number) => fireEvent(screen.getByRole("heading", { name: "New customer" }), new MouseEvent(type, { bubbles: true, button: 0, clientY: y }));
    drag("pointerdown", 100);
    await pastGuard();
    drag("pointermove", 250);
    drag("pointerup", 250);
    expect(screen.getByRole("alert")).toHaveTextContent("Discard this customer?");
    expect(screen.getByRole("dialog").style.transform).toBe("");
    expect(onClose).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test("a confirmation shows its record as a list, each label beside its value", () => {
  wrap(<ConfirmDialog open onClose={() => {}} onConfirm={() => {}} title="Delete this bill?" confirmLabel="Delete" record={[["Firm", "KIRAN"], ["Bill", "KGH/2026-27/31"]]} />);
  const dialog = screen.getByRole("dialog", { name: "Delete this bill?" });
  const labels = within(dialog).getAllByRole("term");
  const values = within(dialog).getAllByRole("definition");
  expect(labels.map((el) => el.textContent)).toEqual(["Firm", "Bill"]);
  expect(values.map((el) => el.textContent)).toEqual(["KIRAN", "KGH/2026-27/31"]);
  expect(labels[0].nextElementSibling).toBe(values[0]);
});

test("on phones a drag cut short by the app closing the sheet leaves no offset when it reopens", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  phone(true);
  try {
    function Probe() { const [open, setOpen] = useState(true); return <><Button onClick={() => setOpen(true)}>Open</Button><Button onClick={() => setOpen(false)}>Shut</Button><Dialog open={open} onClose={() => setOpen(false)} title="Firm"><p>Kiran</p></Dialog></>; }
    wrap(<Probe />);
    const drag = (type: string, y: number) => fireEvent(screen.getByRole("heading", { name: "Firm" }), new MouseEvent(type, { bubbles: true, button: 0, clientY: y }));
    drag("pointerdown", 100);
    drag("pointermove", 180);
    expect(screen.getByRole("dialog").style.transform).toBe("translateY(80px)");
    // the app closes it mid-drag (a save came back, say): no release ever comes
    fireEvent.click(screen.getByRole("button", { name: "Shut" }));
    await pastGuard();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog", { name: "Firm" }).style.transform).toBe("");
    // and that drag is over: moving without pressing again doesn't move the sheet
    drag("pointermove", 200);
    expect(screen.getByRole("dialog").style.transform).toBe("");
  } finally {
    vi.useRealTimers();
  }
});

test("menu items can go to a page and show the current choice; arrows skip headings, Esc gives focus back", async () => {
  function Where() { return <p>at {useLocation().pathname}</p>; }
  wrap(<>
    <Menu title="Account" trigger={(p) => <button {...p}>Account</button>} items={[
      { heading: "Theme" }, { label: "Obsidian", checked: true, onSelect: () => {} }, { label: "Pearl", onSelect: () => {} },
      { divider: true }, { label: "Settings", disabled: true }, { label: "Profile and password", to: "/profile" },
    ]} />
    <Where />
  </>);
  const trigger = screen.getByRole("button", { name: "Account" });
  await userEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  const obsidian = await screen.findByRole("menuitem", { name: "Obsidian" });
  expect(obsidian).toHaveAttribute("aria-current", "true");
  expect(screen.getByRole("menuitem", { name: "Pearl" })).not.toHaveAttribute("aria-current");
  await waitFor(() => expect(obsidian).toHaveFocus());
  await userEvent.keyboard("{ArrowDown}{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "Profile and password" })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
  await userEvent.click(trigger);
  await userEvent.click(await screen.findByRole("menuitem", { name: "Profile and password" }));
  await waitFor(() => expect(screen.getByText("at /profile")).toBeInTheDocument());
});

// Ruling 57: a menu is as tall as the room beside its trigger, so the account menu shows whole on a 1440×900 screen

test("a desktop menu fills the room beside its trigger: under it, or over it when it doesn't fit below and there's more room above; past that it scrolls inside", () => {
  // the account menu on a 1440×900 screen: 16 rows, guessed at 656 px, fit in the 836 px under the avatar
  expect(menuPlace({ top: 14, bottom: 50 }, 900, 656)).toEqual({ top: 56, maxH: 836 });
  // a row's menu near the foot of the screen opens upwards, from its trigger, as tall as the room over it
  expect(menuPlace({ top: 800, bottom: 836 }, 900, 296)).toEqual({ bottom: 106, maxH: 786 });
  // taller than the room either way: it opens where there's more, and scrolls inside
  expect(menuPlace({ top: 100, bottom: 136 }, 600, 900)).toEqual({ top: 142, maxH: 450 });
  expect(menuPlace({ top: 400, bottom: 436 }, 600, 900)).toEqual({ bottom: 206, maxH: 386 });
  // never shorter than two rows, even in a window too short for that
  expect(menuPlace({ top: 20, bottom: 56 }, 120, 400).maxH).toBe(96);
});

test("an open menu takes its room from the screen as measured, in the overlay layer's px when text is larger, with no flat 420 px cap", async () => {
  const layer = overlayLayer();
  const rect = (top: number, bottom: number, left: number, right: number) => ({ top, bottom, left, right, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  const onScreen = vi.spyOn(layer, "getBoundingClientRect").mockReturnValue(rect(0, 900, 0, 1440)); // a 1440×900 window
  const rows = Array.from({ length: 16 }, (_, i) => ({ label: `Row ${i + 1}`, onSelect: () => {} }));
  wrap(<Menu title="Account" width={260} items={rows} trigger={(p) => <button {...p}>Account</button>} />);
  const trigger = screen.getByRole("button", { name: "Account" });
  const at = vi.spyOn(trigger, "getBoundingClientRect");
  const openMenu = async () => { await userEvent.click(trigger); return screen.findByRole("menu"); };
  const closeMenu = async () => { await userEvent.keyboard("{Escape}"); await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument()); };
  try {
    // the avatar in the top bar: the whole menu fits under it
    at.mockReturnValue(rect(14, 50, 1380, 1416));
    let menu = await openMenu();
    expect([menu.style.top, menu.style.bottom, menu.style.maxHeight]).toEqual(["56px", "", "836px"]);
    expect(menu).toHaveClass("overflow-y-auto");
    expect(menu.className).not.toMatch(/max-h-/);
    await closeMenu();
    // Larger text: the layer is zoomed 1.2, so the 900 screen px are 750 of its own
    layer.style.zoom = "1.2";
    at.mockReturnValue(rect(16.8, 60, 1656, 1699.2));
    menu = await openMenu();
    expect([menu.style.top, menu.style.maxHeight]).toEqual(["56px", "686px"]);
    await closeMenu();
    layer.style.zoom = "";
    // a trigger near the foot of the screen: the menu opens upwards, its foot 6 px over the trigger
    at.mockReturnValue(rect(800, 836, 600, 700));
    menu = await openMenu();
    expect([menu.style.top, menu.style.bottom, menu.style.maxHeight]).toEqual(["", "106px", "786px"]);
    await closeMenu();
  } finally {
    layer.style.zoom = "";
    onScreen.mockRestore();
  }
});

test("with the provider above the router, ToastHost shows each toast once; inside a router the provider hosts them", () => {
  let t!: ReturnType<typeof useToast>;
  function Probe() { t = useToast(); return null; }
  const above = render(<ToastProvider><MemoryRouter><Probe /><ToastHost /></MemoryRouter></ToastProvider>);
  act(() => { t.show({ title: "Saved", body: "KGH/2026-27/31" }); });
  expect(screen.getAllByText("Saved")).toHaveLength(1);
  expect(screen.getByText("KGH/2026-27/31")).toBeInTheDocument();
  // the same title again replaces it rather than stacking
  act(() => { t.show({ title: "Saved", body: "KGH/2026-27/32" }); });
  expect(screen.getAllByText("Saved")).toHaveLength(1);
  expect(screen.getByText("KGH/2026-27/32")).toBeInTheDocument();
  expect(screen.queryByText("KGH/2026-27/31")).not.toBeInTheDocument();
  above.unmount();
  wrap(<><Probe /><ToastHost /></>);
  act(() => { t.show({ title: "Saved" }); });
  expect(screen.getAllByText("Saved")).toHaveLength(1);
});

test("on phones a page change clears toasts that have shown a while; Undo and fresh ones stay", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  phone(true);
  try {
    let t!: ReturnType<typeof useToast>;
    function Probe() { t = useToast(); return null; }
    wrap(<Probe />);
    act(() => { t.show({ title: "Saved" }); t.show({ title: "Bill cancelled", action: { label: "Undo", onClick: () => {} } }); });
    await act(async () => { vi.advanceTimersByTime(1500); });
    act(() => { t.show({ title: "Sent" }); });
    await act(async () => { vi.advanceTimersByTime(300); });
    act(() => { t.clearPlain(); });
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(screen.getByText("Bill cancelled")).toBeInTheDocument();
    expect(screen.getByText("Sent")).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test("a toast still leaving when its provider goes leaves no timer behind, so nothing sets state after the provider", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const errors = vi.spyOn(console, "error");
  try {
    let t!: ReturnType<typeof useToast>;
    function Probe() { t = useToast(); return null; }
    const view = wrap(<Probe />);
    let id = "";
    act(() => { id = t.show({ title: "Saved" }); });
    act(() => { t.dismiss(id); }); // on its way out: it would go 170 ms from now
    view.unmount();
    // no toast timer is left waiting: a test file can end here, with nothing to fire once its window has gone
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(errors).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
    errors.mockRestore();
  }
});

test("on desktop toasts outlast a page change, last 6 s, 10 s for a problem, 15 s with an action, and can be dismissed", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    let t!: ReturnType<typeof useToast>;
    function Probe() { t = useToast(); return null; }
    wrap(<Probe />);
    const at = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
    act(() => { t.show({ title: "Saved" }); t.show({ title: "Couldn't send", tone: "neg" }); t.show({ title: "Bill cancelled", action: { label: "Undo", onClick: () => {} } }); });
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't send");
    await at(1500);
    act(() => { t.clearPlain(); });
    await at(200);
    expect(screen.getByText("Saved")).toBeInTheDocument();
    await at(4600); // 6.3 s
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(screen.getByText("Couldn't send")).toBeInTheDocument();
    await at(4000); // 10.3 s
    expect(screen.queryByText("Couldn't send")).not.toBeInTheDocument();
    expect(screen.getByText("Bill cancelled")).toBeInTheDocument();
    await at(5000); // 15.3 s
    expect(screen.queryByText("Bill cancelled")).not.toBeInTheDocument();
    let id = "";
    act(() => { id = t.show({ title: "Sent" }); });
    act(() => { t.dismiss(id); });
    await at(200);
    expect(screen.queryByText("Sent")).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});
