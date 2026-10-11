// @vitest-environment node
import { build } from "vite";
import config from "../vite.config";

// Use Vite's real build hook: a warning would leave CI green, and ₹ takes three UTF-8 bytes.
test.each(["x".repeat(500_001), "₹".repeat(170_000)])("the first download rejects an entry over 500,000 bytes %#", async (text) => {
  const id = "\0first-download-probe";
  const result = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [
      { name: "entry-probe", resolveId: (source) => source === id ? id : undefined, load: (source) => source === id ? `console.log(${JSON.stringify(text)})` : undefined },
      config.plugins!,
    ],
    build: { write: false, minify: false, rollupOptions: { input: id } },
  }).then(() => "Build succeeded", (error: Error) => error.message);
  expect(result).toMatch(/over the 500 kB first download/);
});
