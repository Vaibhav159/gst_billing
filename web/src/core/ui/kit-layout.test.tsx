import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigationType } from "react-router";
import { createRef } from "react";
import { Share2 } from "lucide-react";
import { Button, Card, DL, HideNavContext, ListRow, Page, SectionTitle, Steps, Table, Th, Td, Tr, scrollIntoViewSafe, useNewIds } from "./index";

const wrap = (ui: React.ReactNode, path = "/") => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);

test("a page names itself: one h1 that can take focus, and the tab title", () => {
  wrap(<Page title="Sales">body</Page>);
  const h1 = screen.getByRole("heading", { level: 1, name: "Sales" });
  expect(h1).toHaveAttribute("tabindex", "-1");
  expect(h1).toHaveAttribute("data-page-title");
  expect(document.title).toBe("Sales · GST Billing");
});

test("a list row with a destination is one link with its words", () => {
  wrap(<ListRow to="/customers/7" title="Anil Gupta" subtitle="98290 41122" right="₹12,000.00" />);
  const link = screen.getByRole("link", { name: /Anil Gupta/ });
  expect(link).toHaveAttribute("href", "/customers/7");
});

test("a table has a name and keeps its header cells", () => {
  wrap(<Table label="Bills"><thead><tr><Th>No.</Th><Th align="right">Total</Th></tr></thead><tbody><Tr><Td>KGH/2026-27/31</Td><Td align="right">₹1.00</Td></Tr></tbody></Table>);
  expect(screen.getByRole("table", { name: "Bills" })).toBeInTheDocument();
  expect(screen.getAllByRole("columnheader")).toHaveLength(2);
});

/* ── Beyond the brief: the phone header and action bar, the desktop header, cards and the list helpers ── */
const phone = (on: boolean) => { (window as unknown as { __phone?: boolean }).__phone = on; };
afterEach(() => { phone(false); window.history.replaceState(null, ""); });

/** Where the router is now, and how it got there (PUSH, REPLACE or POP). */
function Where() {
  const { pathname } = useLocation();
  return <p data-testid="where">{`${useNavigationType()} ${pathname}`}</p>;
}
const where = () => screen.getByTestId("where").textContent;

test("on a phone the header holds the page's one h1; Back returns to the page before, else goes up to `back`", async () => {
  phone(true);
  const open = (back: string | true, entries = ["/sales", "/customers/7"]) => render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <Page title="Anil Gupta" phoneSubtitle="98290 41122" back={back}>body</Page><Where />
    </MemoryRouter>,
  );

  // opened straight from a link (nothing before it in this tab): up to the list, in its place
  let page = open("/customers");
  const h1s = screen.getAllByRole("heading", { level: 1 });
  expect(h1s).toHaveLength(1);
  expect(h1s[0]).toHaveTextContent("Anil Gupta");
  expect(h1s[0]).toHaveAttribute("data-page-title");
  expect(h1s[0]).toHaveAttribute("tabindex", "-1");
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(where()).toBe("REPLACE /customers");
  page.unmount();

  // the tab has a page before this one: Back returns to it
  window.history.replaceState({ idx: 1 }, "");
  page = open("/customers");
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(where()).toBe("POP /sales");
  page.unmount();
  window.history.replaceState(null, "");

  // `back` with no path and nothing before: home, Easy's home in Easy
  page = open(true);
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(where()).toBe("REPLACE /");
  page.unmount();
  open(true, ["/e/bill/5"]);
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(where()).toBe("REPLACE /e");
});

test("the phone action bar drops the other buttons' words when any button's words would be cut", () => {
  phone(true);
  let cut = false;
  // jsdom has no layout: a label is cut when its words need more width than it has (clientWidth is 0)
  const width = vi.spyOn(Element.prototype, "scrollWidth", "get").mockImplementation(function (this: Element) {
    return cut && this.classList.contains("btn-label") ? 120 : 0;
  });
  try {
    const page = (hideNav: boolean) => (
      <MemoryRouter><HideNavContext.Provider value={hideNav}>
        <Page title="Bill KGH/2026-27/31" actionBar={<><Button icon={Share2}>Send on WhatsApp</Button><Button variant="primary">Print</Button></>}>body</Page>
      </HideNavContext.Provider></MemoryRouter>
    );
    const { container, rerender } = render(page(false));
    const bar = container.querySelector("[data-actionbar]");
    expect(bar).not.toHaveAttribute("data-compact");
    expect(bar).toHaveClass("pb-3");
    cut = true;
    rerender(page(true));
    expect(bar).toHaveAttribute("data-compact");
    // no tab bar under it: the bar clears the phone's home indicator itself
    expect(bar).toHaveClass("pb-[calc(12px+env(safe-area-inset-bottom,0px))]");
  } finally { width.mockRestore(); }
});

test("a desktop header's breadcrumbs link up, and it shows the context line and actions", () => {
  wrap(<Page title="KGH/2026-27/31" context="Anil Gupta · 08 Oct 2026" breadcrumbs={[{ label: "Sales", to: "/sales" }, { label: "Bill" }]} actions={<Button>Print</Button>}>body</Page>);
  const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
  expect(within(crumbs).getByRole("link", { name: "Sales" })).toHaveAttribute("href", "/sales");
  expect(within(crumbs).getByText("Bill").closest("a")).toBeNull();
  expect(screen.getByText("Anil Gupta · 08 Oct 2026")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Print" })).toBeInTheDocument();
});

test("a list row with only an action is one button, with neither it's plain, and its ref reaches the element", async () => {
  const onClick = vi.fn();
  const button = createRef<HTMLElement>();
  const link = createRef<HTMLElement>();
  wrap(<>
    <ListRow ref={button} onClick={onClick} title="Text size" subtitle="Normal" aria-haspopup="menu" />
    <ListRow ref={link} to="/customers/7" title="Anil Gupta" />
    <ListRow title="GSTIN" right="08AABCK1234M1Z5" />
  </>);
  const b = screen.getByRole("button", { name: /Text size/ });
  expect(b).toHaveAttribute("aria-haspopup", "menu");
  expect(button.current).toBe(b);
  expect(link.current).toBe(screen.getByRole("link", { name: "Anil Gupta" }));
  await userEvent.click(b);
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(screen.getByText("GSTIN").closest("a, button")).toBeNull();
});

test("a titled card is a region named by its title; DL skips empty rows; section titles count; steps say where you are", () => {
  wrap(<>
    <Card title="Bank details" subtitle="Printed on every bill"><DL rows={[["Bank", "HDFC Bank"], false, ["IFSC", "HDFC0001234", { strong: true }]]} /></Card>
    <SectionTitle title="Bills" count={3} />
    <Steps step={2} total={3} label="Items" />
  </>);
  const card = screen.getByRole("region", { name: "Bank details" });
  expect(within(card).getAllByRole("term").map((t) => t.textContent)).toEqual(["Bank", "IFSC"]);
  expect(screen.getByRole("heading", { level: 2, name: "Bills · 3" })).toBeInTheDocument();
  expect(screen.getByText("Step 2 of 3 · Items")).toBeInTheDocument();
});

test("ids that arrive after a list first shows are new for 1.6 s", () => {
  vi.useFakeTimers();
  try {
    function Probe({ ids }: { ids: string[] }) {
      return <p data-testid="fresh">{[...useNewIds(ids)].join(",")}</p>;
    }
    const { rerender } = render(<Probe ids={["kgh-0031", "kgh-0030"]} />);
    const fresh = () => screen.getByTestId("fresh").textContent;
    expect(fresh()).toBe("");
    rerender(<Probe ids={["kgh-0032", "kgh-0031", "kgh-0030"]} />);
    expect(fresh()).toBe("kgh-0032");
    act(() => { vi.advanceTimersByTime(1599); });
    expect(fresh()).toBe("kgh-0032");
    act(() => { vi.advanceTimersByTime(1); });
    expect(fresh()).toBe("");
  } finally { vi.useRealTimers(); }
});

test("scrolling to an element is instant when the person asked for less motion", () => {
  const el = document.createElement("div");
  const scroll = vi.spyOn(el, "scrollIntoView");
  scrollIntoViewSafe(el);
  expect(scroll).toHaveBeenLastCalledWith({ block: "start", behavior: "smooth" });
  const stub = window.matchMedia;
  window.matchMedia = ((q: string) => ({ ...stub(q), matches: q.includes("prefers-reduced-motion: reduce") })) as typeof window.matchMedia;
  try {
    scrollIntoViewSafe(el, { block: "center", behavior: "smooth" });
    expect(scroll).toHaveBeenLastCalledWith({ block: "center", behavior: "auto" });
  } finally { window.matchMedia = stub; }
  expect(() => scrollIntoViewSafe(null)).not.toThrow();
});
