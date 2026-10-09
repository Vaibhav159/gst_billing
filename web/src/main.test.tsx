import { applyTextSize, applyTheme } from "@/core/device";

// What the page looks like at the moment main.tsx hands the app to React: the first paint.
const atFirstPaint = vi.hoisted(() => ({ theme: null as string | null, zoom: null as string | null }));
vi.mock("react-dom/client", () => ({
  createRoot: () => ({ render: () => {
    atFirstPaint.theme = document.documentElement.className;
    atFirstPaint.zoom = document.getElementById("root")!.style.zoom;
  } }),
}));
vi.mock("./App", () => ({ default: () => null }));

test("the saved theme and text size are on the page before the app first renders", async () => {
  localStorage.setItem("gst3.theme", "pearl");
  localStorage.setItem("gst3.textSize", "1.2");
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  try {
    await import("./main");
    expect(atFirstPaint.theme).toBe("theme-pearl");
    expect(atFirstPaint.zoom).toBe("1.2"); // Ruling 16
  } finally {
    applyTextSize(1);
    applyTheme("obsidian");
    root.remove();
  }
});
