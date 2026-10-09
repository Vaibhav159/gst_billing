import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { Plus, Search } from "lucide-react";
import { RoleContext } from "@/core/auth/role";
import { Button, ButtonLink, IconButton, ListSkeleton, LoadError, Money, Banner, EmptyState } from "./index";

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

test("a loading button stays focusable, says it's busy and ignores clicks", async () => {
  const onClick = vi.fn();
  wrap(<Button loading onClick={onClick}>Save</Button>);
  const b = screen.getByRole("button", { name: /save/i });
  expect(b).toHaveAttribute("aria-disabled", "true");
  expect(b).not.toBeDisabled();
  await userEvent.click(b);
  expect(onClick).not.toHaveBeenCalled();
});

test("buttons with an icon keep their words as the name; icon buttons use their label", () => {
  wrap(<><Button icon={Plus}>New bill</Button><IconButton label="Search" icon={Search} /></>);
  expect(screen.getByRole("button", { name: "New bill" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
});

test("a button link is a real link", () => {
  wrap(<ButtonLink to="/sales/new">New bill</ButtonLink>);
  expect(screen.getByRole("link", { name: "New bill" })).toHaveAttribute("href", "/sales/new");
});

test("money shows rupees with paise set smaller", () => {
  const { container } = wrap(<Money value={8708321} />);
  expect(container.textContent).toBe("₹87,083.21");
  // As in the prototype, only the display style (a size) sets the paise smaller; screen readers get the amount once.
  const big = wrap(<Money value={8708321} size="2xl" />).container;
  expect(big.querySelector(".money-paise")?.textContent).toBe(".21");
  expect(big.querySelector(".sr-only")?.textContent).toBe("₹87,083.21");
});

test("a sized amount with no value shows a dash, not ₹0.00", () => {
  for (const value of [null, NaN]) {
    const { container, unmount } = wrap(<Money value={value} size="2xl" />);
    const seen = container.cloneNode(true) as HTMLElement;
    seen.querySelectorAll(".sr-only").forEach((n) => n.remove());
    expect(seen.textContent, `value ${value}`).toBe("—");
    expect(container).not.toHaveTextContent("₹0.00");
    unmount();
  }
});

test("errors and loading are announced in plain words", () => {
  wrap(<><LoadError problem={{ kind: "offline", message: "You're offline" }} what="the bills" retry={() => {}} /><ListSkeleton what="the bills" /></>);
  expect(screen.getByText(/You're offline/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(/loading the bills/i);
});

test("offline says what can't load and that nothing is lost", () => {
  wrap(<LoadError problem={{ kind: "offline", message: "You're offline" }} what="the bills" />);
  expect(screen.getByRole("alert")).toHaveTextContent("The bills can't load without the internet. Nothing you saved is lost; it shows again when you're back online.");
});

test("server trouble says nothing is lost and who to tell, by role; Try again comes only with retry", () => {
  const { unmount } = wrap(<LoadError problem={{ kind: "server", message: "The app couldn't get through" }} what="the bills" />);
  expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load the bills");
  expect(screen.getByRole("alert")).toHaveTextContent("The app couldn't reach the shop's records just now. Nothing is lost. Try again in a minute. If it keeps happening, tell the owner.");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  unmount();
  wrap(<RoleContext.Provider value="owner"><LoadError problem={{ kind: "unreachable", message: "The app couldn't get through" }} what="the bills" /></RoleContext.Provider>);
  expect(screen.getByRole("alert")).toHaveTextContent("If it keeps happening, call the person who looks after the app.");
});

test("any other problem says what the server said", () => {
  wrap(<LoadError problem={{ kind: "forbidden", message: "Your role can't do this. Ask the owner if you need it." }} what="the bills" />);
  expect(screen.getByRole("alert")).toHaveTextContent("Your role can't do this. Ask the owner if you need it.");
  expect(screen.getByRole("alert")).not.toHaveTextContent(/shop's records/);
});

test("banners and empty states render their words", () => {
  wrap(<><Banner title="Heads up">Body</Banner><EmptyState title="No bills yet">Make the first one</EmptyState></>);
  expect(screen.getByText("Heads up")).toBeInTheDocument();
  expect(screen.getByText("No bills yet")).toBeInTheDocument();
});
