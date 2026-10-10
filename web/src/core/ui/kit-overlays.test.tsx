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

/* ── Beyond the brief: the rest of the prototype's overlay behaviour, and what this port adds ── */
import { fireEvent, within } from "@testing-library/react";
import { useLocation } from "react-router";
import { applyTextSize } from "@/core/device";
import { Sheet, ToastHost, menuPlace, type DLRow } from "./index";
import { overlayLayer } from "./Overlay";

const phone = (on: boolean) => { (window as unknown as { __phone?: boolean }).__phone = on; };
afterEach(() => phone(false));
/** Past the ghost-tap guard: a dialog ignores clicks for 350 ms after it opens. */
const settle = () => act(async () => { vi.advanceTimersByTime(400); });

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
    await settle();
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
    await settle();
    drag("pointermove", 160);
    expect(screen.getByRole("dialog").style.transform).toBe("translateY(60px)");
    drag("pointerup", 160);
    expect(screen.getByRole("dialog").style.transform).toBe("");
    expect(screen.getByRole("dialog")).not.toHaveAttribute("data-closing");
    // 150 px, slowly: past 110 px, so it closes
    drag("pointerdown", 100);
    await settle();
    drag("pointermove", 250);
    drag("pointerup", 250);
    await settle();
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

test("a confirmation can wait for a tick, and while it saves nothing closes it", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const onClose = vi.fn();
    const record: DLRow[] = [["Firm", "Meera Ornaments"], ["GSTIN", "08BBBBB0000B1Z5"]];
    const props = { open: true, onClose, onConfirm: () => {}, title: "Remove Meera Ornaments?", confirmLabel: "Remove", ack: "I understand Meera Ornaments goes off every list.", record };
    const { rerender } = wrap(<ConfirmDialog {...props} />);
    await settle();
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
    await settle();
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
    await settle();
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
