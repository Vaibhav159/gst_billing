import { applyTheme } from "@/core/device";

// What the page looks like at the moment main.tsx hands the app to React: the first paint.
const atFirstPaint = vi.hoisted(() => ({ theme: null as string | null }));
vi.mock("react-dom/client", () => ({
  createRoot: () => ({ render: () => { atFirstPaint.theme = document.documentElement.className; } }),
}));
vi.mock("./App", () => ({ default: () => null }));

test("the saved theme is on the page before the app first renders", async () => {
  localStorage.setItem("gst3.theme", "pearl");
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  try {
    await import("./main");
    expect(atFirstPaint.theme).toBe("theme-pearl");
  } finally {
    applyTheme("obsidian");
    root.remove();
  }
});
