import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { applyTextSize, applyTheme, storedTextSize, storedTheme, useIsPhone, useTextSize, useTheme } from "./device";
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

test("v2's old name for its light theme opens Pearl", () => {
  localStorage.setItem("gst-theme", "light-clean");
  expect(storedTheme()).toBe("pearl");
});

test("text size zooms the app and keeps it exactly the window's size", () => {
  const root = document.createElement("div"); root.id = "root"; document.body.appendChild(root);
  applyTextSize(1.2);
  expect(root.style.zoom).toBe("1.2");
  expect(root.style.width).toBe(`${Math.floor(window.innerWidth / 1.2)}px`);
  applyTextSize(1);
  expect(root.style.zoom).toBe("");
  root.remove();
});

test("larger text never makes the app overflow the window: #root's size rounds down", () => {
  const root = document.createElement("div"); root.id = "root"; document.body.appendChild(root);
  vi.stubGlobal("innerWidth", 1275); vi.stubGlobal("innerHeight", 800);
  try {
    applyTextSize(1.2);
    expect(root.style.width).toBe("1062px"); // rounding gives 1063 px: × 1.2 = 1275.6, past the 1275 px window
    expect(root.style.height).toBe("666px");
  } finally { applyTextSize(1); vi.unstubAllGlobals(); root.remove(); }
});

test("the saved text size reads back for the first paint; anything else is Normal", () => {
  expect(storedTextSize()).toBe(1);
  localStorage.setItem("gst3.textSize", "1.2");
  expect(storedTextSize()).toBe(1.2);
  for (const junk of ["7", "big"]) { localStorage.setItem("gst3.textSize", junk); expect(storedTextSize()).toBe(1); }
});

test("useTextSize opens at the saved size and applies it", () => {
  const root = document.createElement("div"); root.id = "root"; document.body.appendChild(root);
  localStorage.setItem("gst3.textSize", "1.1");
  function Probe() { const [s] = useTextSize(); return <p>{s}</p>; }
  render(<Probe />);
  expect(screen.getByText("1.1")).toBeInTheDocument();
  expect(root.style.zoom).toBe("1.1");
  applyTextSize(1); root.remove();
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

test("a phone on its side stays a phone: a short touch screen counts at any width", () => {
  const stub = window.matchMedia;
  // An 844 × 390 phone in landscape matches only the short-touch-screen half of the query.
  window.matchMedia = ((q: string) => ({ ...stub(q), matches: q.includes("(max-height: 499px) and (pointer: coarse)") })) as typeof window.matchMedia;
  function Probe() { return <p>{String(useIsPhone())}</p>; }
  try { render(<Probe />); expect(screen.getByText("true")).toBeInTheDocument(); } finally { window.matchMedia = stub; }
});

test("useIsPhone is false on a desktop-sized window", () => {
  function Probe() { return <p>{String(useIsPhone())}</p>; }
  render(<Probe />);
  expect(screen.getByText("false")).toBeInTheDocument();
  act(() => {});
});
