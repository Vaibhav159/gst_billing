import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { useState } from "react";
import { Search } from "lucide-react";
import { Field, Input, MoneyInput, QtyInput, readMoney, Segmented, Tabs } from "./index";
import { Checkbox, Chip, Disclosure, SearchInput, Select, Switch, Textarea } from "./index";

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

test("a field ties its error to its control", () => {
  wrap(<Field label="GSTIN" htmlFor="gstin" hint="15 characters" error="That GSTIN doesn't check out"><Input id="gstin" /></Field>);
  const input = screen.getByLabelText("GSTIN");
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(input).toHaveAttribute("aria-describedby", "gstin-error");
});

test("money: a decimal comma is read, and grouping shows only after leaving the field", async () => {
  expect(readMoney("4150,50")).toBe(415050);
  expect(readMoney("6,512.50")).toBe(651250);
  function Probe() { const [v, setV] = useState<number | null>(null); return <><MoneyInput aria-label="Rate" value={v} onChange={(p) => setV(p)} /><p>paise:{String(v)}</p></>; }
  wrap(<Probe />);
  const input = screen.getByLabelText("Rate");
  await userEvent.type(input, "6512.5");
  expect(input).toHaveValue("6512.5");
  expect(screen.getByText("paise:651250")).toBeInTheDocument();
  await userEvent.tab();
  expect(input).toHaveValue("6,512.50");
  await userEvent.click(input);
  expect(input).toHaveValue("6,512.50");
});

test("quantity keeps its decimals and reads a comma as the point", async () => {
  function Probe() { const [v, setV] = useState<number | null>(null); return <><QtyInput aria-label="Weight" value={v} onChange={(n) => setV(n)} /><p>n:{String(v)}</p></>; }
  wrap(<Probe />);
  const input = screen.getByLabelText("Weight");
  await userEvent.type(input, "12,5");
  expect(screen.getByText("n:12.5")).toBeInTheDocument();
  await userEvent.tab();
  expect(input).toHaveValue("12.500");
});

test("segmented and tabs move with the arrow keys", async () => {
  function Probe() {
    const [v, setV] = useState<"a" | "b">("a");
    const [t, setT] = useState<"x" | "y">("x");
    return <>
      <Segmented label="Mode" options={[{ value: "a", label: "A" }, { value: "b", label: "B" }]} value={v} onChange={setV} />
      <Tabs label="Views" tabs={[{ value: "x", label: "X" }, { value: "y", label: "Y" }]} value={t} onChange={setT} />
    </>;
  }
  wrap(<Probe />);
  screen.getByRole("tab", { name: "X" }).focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Y" })).toHaveAttribute("aria-selected", "true");
});

// Beyond the brief: the parts of each control's contract that its four tests don't reach.

test("a field ties only the control its htmlFor names: the hint when there's no error, select and textarea too, and the caller's own aria wins", () => {
  wrap(<>
    <Field label="Phone" htmlFor="phone" hint="10 digits"><Input id="phone" /></Field>
    <Field label="Unit" htmlFor="unit" error="Pick a unit"><Select id="unit" options={["g", { value: "ct", label: "Carat" }]} /></Field>
    <Field label="Note" htmlFor="note" hint="Printed on the bill" required><Textarea id="note" /></Field>
    <Field label="Rate" htmlFor="rate" error="That rate looks too high"><Input id="rate" aria-describedby="rate-warn" /><Input id="rate-per" aria-label="Rate per" /></Field>
  </>);
  const phone = screen.getByLabelText("Phone");
  expect(phone).toHaveAttribute("aria-describedby", "phone-hint");
  expect(phone).not.toHaveAttribute("aria-invalid");
  expect(screen.getByText("10 digits")).toHaveAttribute("id", "phone-hint");
  const unit = screen.getByLabelText("Unit");
  expect(unit).toHaveAttribute("aria-describedby", "unit-error");
  expect(unit).toHaveAttribute("aria-invalid", "true");
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["g", "Carat"]);
  expect(screen.getByLabelText("Note · required")).toHaveAttribute("aria-describedby", "note-hint");
  const rate = screen.getByLabelText("Rate");
  expect(rate).toHaveAttribute("aria-describedby", "rate-warn");
  expect(rate).toHaveAttribute("aria-invalid", "true");
  const per = screen.getByLabelText("Rate per");
  expect(per).not.toHaveAttribute("aria-describedby");
  expect(per).not.toHaveAttribute("aria-invalid");
});

test("a field keeps its hint and error link when a control passes undefined, and an explicit value still wins", () => {
  wrap(<>
    <Field label="Rate" htmlFor="r" hint="h"><Input id="r" aria-describedby={undefined} /></Field>
    <Field label="Unit" htmlFor="u" error="Pick a unit"><Select id="u" options={["g"]} aria-describedby={undefined} aria-invalid={undefined} /></Field>
    <Field label="Note" htmlFor="n" hint="Printed on the bill"><Textarea id="n" aria-describedby={undefined} /></Field>
    <Field label="Making" htmlFor="m" hint="h"><Input id="m" aria-describedby="custom" /></Field>
    <Field label="Weight" htmlFor="w" error="Too heavy"><Input id="w" aria-invalid={false} /></Field>
  </>);
  expect(screen.getByLabelText("Rate")).toHaveAttribute("aria-describedby", "r-hint");
  const unit = screen.getByLabelText("Unit");
  expect(unit).toHaveAttribute("aria-describedby", "u-error");
  expect(unit).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("Note")).toHaveAttribute("aria-describedby", "n-hint");
  expect(screen.getByLabelText("Making")).toHaveAttribute("aria-describedby", "custom");
  const weight = screen.getByLabelText("Weight");
  expect(weight).toHaveAttribute("aria-invalid", "false");
  expect(weight).toHaveAttribute("aria-describedby", "w-error");
});

test("invalid marks a control without a field", () => {
  wrap(<><Input aria-label="Name" invalid /><Select aria-label="State" options={["Rajasthan"]} invalid /><Textarea aria-label="Address" invalid /></>);
  for (const name of ["Name", "State", "Address"]) expect(screen.getByLabelText(name)).toHaveAttribute("aria-invalid", "true");
});

test("an input's prefix can be words or an icon", () => {
  const { container } = wrap(<><Input aria-label="Phone" prefix="+91" /><Input aria-label="Find" prefix={Search} /></>);
  expect(screen.getByText("+91")).toBeInTheDocument();
  expect(container.querySelector("svg.lucide-search")).toBeInTheDocument();
  expect(screen.getByLabelText("Find")).toHaveClass("pl-9");
});

test("money set from outside shows grouped, or plain digits while the field has focus", async () => {
  function Probe() {
    const [rate, setRate] = useState<number | null>(null);
    // F2 stands in for a shortcut that fills the rate while the field keeps focus
    return <div onKeyDown={(e) => { if (e.key === "F2") setRate(10000000); }}>
      <MoneyInput aria-label="Rate" value={rate} onChange={(p) => setRate(p)} />
      <button type="button" onClick={() => setRate(651250)}>Fill</button>
    </div>;
  }
  wrap(<Probe />);
  const input = screen.getByLabelText("Rate");
  await userEvent.click(screen.getByRole("button", { name: "Fill" }));
  expect(input).toHaveValue("6,512.50");
  await userEvent.click(input);
  await userEvent.keyboard("{F2}");
  expect(input).toHaveValue("100000.00");
  await userEvent.tab();
  expect(input).toHaveValue("1,00,000.00");
});

test("a quantity set from outside shows its decimals, and takes no more than it keeps", async () => {
  function Probe() {
    const [w, setW] = useState<number | null>(null);
    return <><QtyInput aria-label="Weight" value={w} onChange={(n) => setW(n)} /><button type="button" onClick={() => setW(2)}>Fill</button></>;
  }
  wrap(<Probe />);
  await userEvent.click(screen.getByRole("button", { name: "Fill" }));
  const weight = screen.getByLabelText("Weight");
  expect(weight).toHaveValue("2.000");
  await userEvent.clear(weight);
  await userEvent.type(weight, "1.2345");
  expect(weight).toHaveValue("1.234");
});

test("segmented: the arrow keys wrap and skip a disabled choice, Home and End jump, and the focus goes along", async () => {
  function Probe() {
    const [v, setV] = useState<"a" | "b" | "c" | "d">("a");
    return <Segmented label="Mode" options={[{ value: "a", label: "A" }, { value: "b", label: "B", disabled: true }, { value: "c", label: "C" }, { value: "d", label: "D" }]} value={v} onChange={setV} />;
  }
  wrap(<Probe />);
  const checked = () => screen.getAllByRole("radio").find((r) => r.getAttribute("aria-checked") === "true")?.textContent;
  expect(screen.getByRole("radiogroup", { name: "Mode" })).toBeInTheDocument();
  const a = screen.getByRole("radio", { name: "A" });
  expect(a).toHaveAttribute("tabindex", "0");
  a.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(checked()).toBe("C");
  expect(a).toHaveAttribute("tabindex", "-1");
  await waitFor(() => expect(screen.getByRole("radio", { name: "C" })).toHaveFocus());
  await userEvent.keyboard("{ArrowRight}{ArrowRight}");
  expect(checked()).toBe("A");
  await userEvent.keyboard("{ArrowLeft}");
  expect(checked()).toBe("D");
  await userEvent.keyboard("{Home}");
  expect(checked()).toBe("A");
  await userEvent.keyboard("{End}");
  expect(checked()).toBe("D");
});

test("tabs: only the chosen tab is in the tab order and names its panel; ArrowLeft wraps, Home and End jump, and the focus goes along", async () => {
  function Probe() {
    const [t, setT] = useState<"b2b" | "b2cl" | "b2c">("b2b");
    return <Tabs label="GSTR-1 sections" idBase="g1" panelId="g1-panel" tabs={[{ value: "b2b", label: "B2B", count: 12 }, { value: "b2cl", label: "B2CL", count: 0 }, { value: "b2c", label: "B2C" }]} value={t} onChange={setT} />;
  }
  wrap(<Probe />);
  expect(screen.getByRole("tablist", { name: "GSTR-1 sections" })).toBeInTheDocument();
  const b2b = screen.getByRole("tab", { name: /^B2B/ });
  const b2c = screen.getByRole("tab", { name: "B2C" });
  expect(b2b).toHaveAttribute("id", "g1-b2b");
  expect(b2b).toHaveTextContent("B2B12");
  expect(screen.getByRole("tab", { name: /^B2CL/ })).toHaveTextContent("B2CL0");
  expect(b2b).toHaveAttribute("tabindex", "0");
  expect(b2b).toHaveAttribute("aria-controls", "g1-panel");
  expect(b2c).toHaveAttribute("tabindex", "-1");
  expect(b2c).not.toHaveAttribute("aria-controls");
  b2b.focus();
  await userEvent.keyboard("{ArrowLeft}");
  expect(b2c).toHaveAttribute("aria-selected", "true");
  expect(b2c).toHaveFocus();
  expect(b2c).toHaveAttribute("aria-controls", "g1-panel");
  await userEvent.keyboard("{Home}");
  expect(b2b).toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{End}");
  expect(b2c).toHaveAttribute("aria-selected", "true");
});

// Ruling 36: a resize measures the tab chosen now, not the one chosen when the row first showed
test("tabs: after a change of tab, a resize keeps the indicator under the chosen tab", async () => {
  const resize: (() => void)[] = [];
  vi.stubGlobal("ResizeObserver", class {
    constructor(private cb: ResizeObserverCallback) {}
    observe() { resize.push(() => this.cb([], this as unknown as ResizeObserver)); }
    unobserve() {}
    disconnect() {}
  });
  // jsdom has no layout: each tab is 80 px wide, 4 px apart
  const order = ["day", "week", "month"];
  const spies = [
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) { return this.dataset.v ? 80 : 0; }),
    vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) { return this.dataset.v ? 84 * order.indexOf(this.dataset.v) : 0; }),
  ];
  try {
    function Probe() {
      const [t, setT] = useState("day");
      return <Tabs label="Period" tabs={order.map((v) => ({ value: v, label: v }))} value={t} onChange={setT} />;
    }
    wrap(<Probe />);
    const bar = () => screen.getByRole("tablist", { name: "Period" }).querySelector<HTMLElement>("span.absolute");
    expect(bar()).toHaveStyle({ transform: "translateX(0px)", width: "80px" });
    await userEvent.click(screen.getByRole("tab", { name: "month" }));
    expect(bar()).toHaveStyle({ transform: "translateX(168px)" });
    act(() => resize.forEach((r) => r()));
    expect(bar()).toHaveStyle({ transform: "translateX(168px)", width: "80px" });
  } finally {
    spies.forEach((s) => s.mockRestore());
    vi.unstubAllGlobals();
  }
});

// a count arriving after the first paint widens its tab, and the tabs after it move, while the row keeps its width
test("tabs: when a tab's own width changes, the indicator follows", async () => {
  /** As the browser does: each observer hears about the elements it watches whose size changed since it last looked. */
  const observers: { cb: ResizeObserverCallback; sizes: Map<Element, number> }[] = [];
  vi.stubGlobal("ResizeObserver", class {
    private o: { cb: ResizeObserverCallback; sizes: Map<Element, number> };
    constructor(cb: ResizeObserverCallback) { this.o = { cb, sizes: new Map() }; observers.push(this.o); }
    observe(el: Element) { this.o.sizes.set(el, (el as HTMLElement).offsetWidth); }
    unobserve(el: Element) { this.o.sizes.delete(el); }
    disconnect() { this.o.sizes.clear(); }
  });
  const settle = () => act(() => {
    for (const o of observers) {
      const changed = [...o.sizes].filter(([el, w]) => (el as HTMLElement).offsetWidth !== w).map(([el]) => el);
      changed.forEach((el) => o.sizes.set(el, (el as HTMLElement).offsetWidth));
      if (changed.length) o.cb(changed.map((target) => ({ target }) as unknown as ResizeObserverEntry), {} as ResizeObserver);
    }
  });
  // jsdom has no layout: a tab is as wide as its words (24 px and 6 px a character), tabs sit 4 px apart, and the row is 600 px
  const tabWidth = (el: HTMLElement) => 24 + (el.textContent ?? "").length * 6;
  const spies = [
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) { return this.dataset.v ? tabWidth(this) : this.getAttribute("role") === "tablist" ? 600 : 0; }),
    vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
      let left = 0;
      if (this.dataset.v) for (let el = this.previousElementSibling as HTMLElement | null; el; el = el.previousElementSibling as HTMLElement | null) left += tabWidth(el) + 4;
      return left;
    }),
  ];
  try {
    function Probe() {
      const [count, setCount] = useState<number | undefined>(undefined);
      const [extra, setExtra] = useState<number | null | undefined>(undefined); // undefined: no such tab yet; null: there, no count yet
      const tabs = [{ value: "b2b", label: "B2B", count }, ...(extra === undefined ? [] : [{ value: "exp", label: "EXP", count: extra ?? undefined }]), { value: "b2cl", label: "B2CL" }, { value: "b2c", label: "B2C" }];
      return <>
        <button type="button" onClick={() => setCount(12)}>Counts in</button>
        <button type="button" onClick={() => setExtra(null)}>Add a tab</button>
        <button type="button" onClick={() => setExtra(7)}>Its count in</button>
        <Tabs label="GSTR-1 sections" tabs={tabs} value="b2cl" onChange={() => {}} />
      </>;
    }
    wrap(<Probe />);
    const bar = () => screen.getByRole("tablist", { name: "GSTR-1 sections" }).querySelector<HTMLElement>("span.absolute");
    expect(bar()).toHaveStyle({ transform: "translateX(46px)", width: "48px" }); // B2B is 42 px, so B2CL starts at 46
    await userEvent.click(screen.getByRole("button", { name: "Counts in" })); // "B2B12" is 54 px
    settle();
    expect(bar()).toHaveStyle({ transform: "translateX(58px)", width: "48px" });
    // a tab that comes later is watched too
    await userEvent.click(screen.getByRole("button", { name: "Add a tab" })); // EXP, 42 px, before B2CL
    settle();
    expect(bar()).toHaveStyle({ transform: "translateX(104px)" });
    await userEvent.click(screen.getByRole("button", { name: "Its count in" })); // "EXP7" is 48 px
    settle();
    expect(bar()).toHaveStyle({ transform: "translateX(110px)", width: "48px" });
  } finally {
    spies.forEach((s) => s.mockRestore());
    vi.unstubAllGlobals();
  }
});

test("checkbox, switch, chip and disclosure say their state", async () => {
  function Probe() {
    const [keep, setKeep] = useState(false);
    const [bank, setBank] = useState(false);
    const [check, setCheck] = useState(false);
    return <>
      <Checkbox label="Keep me signed in" description="On this device only" checked={keep} onChange={setKeep} />
      <Checkbox hideLabel label="Tick bill 31" checked={false} onChange={() => {}} />
      <Switch label="Bank details on bills" checked={bank} onChange={setBank} />
      <Chip selected={check} onClick={() => setCheck(!check)} count={4}>Needs a check</Chip>
      <Disclosure title="Bill numbers" summary="Optional prefix">The first bill will be SR-1</Disclosure>
    </>;
  }
  wrap(<Probe />);
  await userEvent.click(screen.getByText("Keep me signed in"));
  expect(screen.getByRole("checkbox", { name: /^Keep me signed in/ })).toBeChecked();
  expect(screen.getByText("On this device only")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Tick bill 31" })).not.toBeChecked();
  const sw = screen.getByRole("switch", { name: "Bank details on bills" });
  expect(sw).toHaveAttribute("aria-checked", "false");
  await userEvent.click(sw);
  expect(sw).toHaveAttribute("aria-checked", "true");
  const chip = screen.getByRole("button", { name: /Needs a check/ });
  expect(chip).toHaveTextContent("Needs a check4");
  expect(chip).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(chip);
  expect(chip).toHaveAttribute("aria-pressed", "true");
  const toggle = screen.getByRole("button", { name: /Bill numbers/ });
  const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
  expect(toggle).toHaveTextContent("Bill numbersOptional prefix");
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(panel).toHaveAttribute("inert");
  await userEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(panel).not.toHaveAttribute("inert");
});

test("search: its label names the box, and Clear search empties it", async () => {
  function Probe() { const [q, setQ] = useState("Anil"); return <SearchInput value={q} onChange={setQ} placeholder="Name, phone or GSTIN" label="Search customers" />; }
  wrap(<Probe />);
  expect(screen.getByRole("search")).toBeInTheDocument();
  const box = screen.getByRole("searchbox", { name: "Search customers" });
  expect(box).toHaveValue("Anil");
  await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(box).toHaveValue("");
  expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
});
