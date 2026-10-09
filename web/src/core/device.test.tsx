import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { applyTextSize, applyTheme, useIsPhone, useTheme } from "./device";
import { useView } from "./view";

beforeEach(() => { localStorage.clear(); document.documentElement.className = ""; (window as unknown as { __phone?: boolean }).__phone = false; });

test("a theme is a class on <html>; Obsidian is the bare default", () => {
  applyTheme("pearl");
  expect(document.documentElement.classList.contains("theme-pearl")).toBe(true);
  applyTheme("obsidian");
  expect(document.documentElement.className).toBe("");
});

test("the theme is remembered on this device and picks up v2's choice the first time", () => {
  localStorage.setItem("gst-theme", "forest");
  function Probe() { const [t] = useTheme(); return <p>{t}</p>; }
  render(<Probe />);
  expect(screen.getByText("forest")).toBeInTheDocument();
  expect(localStorage.getItem("gst3.theme")).toBe("forest");
});

test("text size zooms the app and keeps it exactly the window's size", () => {
  const root = document.createElement("div"); root.id = "root"; document.body.appendChild(root);
  applyTextSize(1.2);
  expect(root.style.zoom).toBe("1.2");
  expect(root.style.width).toBe(`${Math.round(window.innerWidth / 1.2)}px`);
  applyTextSize(1);
  expect(root.style.zoom).toBe("");
  root.remove();
});

test("phone detection and the view", () => {
  (window as unknown as { __phone?: boolean }).__phone = true;
  function Probe() { const v = useView(); return <p>{v.view}</p>; }
  const { unmount } = render(<MemoryRouter initialEntries={["/e/bills"]}><Probe /></MemoryRouter>);
  expect(screen.getByText("easy")).toBeInTheDocument();
  unmount();
  render(<MemoryRouter initialEntries={["/sales"]}><Probe /></MemoryRouter>);
  expect(screen.getByText("expert")).toBeInTheDocument();
});

test("useIsPhone is false on a desktop-sized window", () => {
  function Probe() { return <p>{String(useIsPhone())}</p>; }
  render(<Probe />);
  expect(screen.getByText("false")).toBeInTheDocument();
  act(() => {});
});
