/**
 * The phone's bottom sheets (UX3). After tapping a More item that changed the
 * route, the Expert drawer stayed over ~70% of the screen, X and the backdrop
 * no longer closed it, and taps meant for the bottom nav landed on drawer
 * items. All three sheets were hand-rolled: no dialog role, no focus trap, no
 * Escape. They are Radix dialogs now (the shadcn Sheet), and the More drawers
 * close whenever the route changes.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ComponentType } from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ logout: vi.fn() }) }));
vi.mock("@/contexts/MobileModeContext", () => ({ useMobileMode: () => ({ setMobileMode: vi.fn() }) }));

import MobileMoreDrawer from "./MobileMoreDrawer";
import EasyMoreDrawer from "./easy/EasyMoreDrawer";
import MobileFilterSheet from "./MobileFilterSheet";

type Drawer = ComponentType<{ open: boolean; onOpenChange: (open: boolean) => void }>;
let go: (to: string) => void = () => {};

function Shell({ Drawer }: { Drawer: Drawer }) {
  const [open, setOpen] = useState(true);
  const location = useLocation();
  go = useNavigate();
  return (
    <>
      <p data-testid="path">{location.pathname}</p>
      <Drawer open={open} onOpenChange={setOpen} />
    </>
  );
}

const renderDrawer = (Drawer: Drawer) =>
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes><Route path="*" element={<Shell Drawer={Drawer} />} /></Routes>
    </MemoryRouter>,
  );

// Read by the sheet's heading, which the hand-rolled sheets had too: a check
// on the dialog role alone would pass for a sheet that never was a dialog.
const shown = (name: string) => expect(screen.getByRole("heading", { name })).toBeInTheDocument();
const gone = (name = "More") => waitFor(() => {
  expect(screen.queryByRole("heading", { name })).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

describe.each([
  ["Expert", MobileMoreDrawer],
  ["Easy", EasyMoreDrawer],
] as [string, Drawer][])("%s More drawer (UX3)", (_mode, Drawer) => {
  it("is a dialog named More", () => {
    renderDrawer(Drawer);
    expect(screen.getByRole("dialog", { name: "More" })).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    renderDrawer(Drawer);
    shown("More");
    fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" });
    await gone();
  });

  it("closes from its X", async () => {
    renderDrawer(Drawer);
    shown("More");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await gone();
  });

  it("closes when one of its items navigates", async () => {
    renderDrawer(Drawer);
    shown("More");
    fireEvent.click(screen.getByRole("link", { name: /Backup/ }));
    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/billing/backup"));
    await gone();
  });

  it("closes when the route changes any other way", async () => {
    renderDrawer(Drawer);
    shown("More");
    act(() => go("/billing/invoice/list"));
    await waitFor(() => expect(screen.getByTestId("path")).toHaveTextContent("/billing/invoice/list"));
    await gone();
  });

  it("scrolls inside Expert's height, so Settings, Expert Mode and Logout aren't below the fold", () => {
    renderDrawer(Drawer);
    expect(screen.getByRole("dialog").querySelector(".max-h-\\[70vh\\]")).not.toBeNull();
  });
});

describe("MobileFilterSheet (UX3)", () => {
  function FilterShell() {
    const [open, setOpen] = useState(true);
    const [fy, setFy] = useState("all");
    return (
      <MobileFilterSheet
        open={open}
        onOpenChange={setOpen}
        onClear={() => setFy("all")}
        filters={[{ label: "Financial Year", value: fy, onChange: setFy, options: [{ label: "All", value: "all" }, { label: "2026-27", value: "2026-27" }] }]}
      />
    );
  }

  it("is a dialog named Filters", () => {
    render(<MemoryRouter><FilterShell /></MemoryRouter>);
    expect(screen.getByRole("dialog", { name: "Filters" })).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    render(<MemoryRouter><FilterShell /></MemoryRouter>);
    shown("Filters");
    fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" });
    await gone("Filters");
  });

  it("keeps its filters, and Apply closes it", async () => {
    render(<MemoryRouter><FilterShell /></MemoryRouter>);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "2026-27" } });
    expect(screen.getByRole("combobox")).toHaveValue("2026-27");
    fireEvent.click(screen.getByRole("button", { name: "Apply Filters" }));
    await gone("Filters");
  });
});
