// @vitest-environment node
/**
 * nginx serves the app with `style-src 'self' 'unsafe-inline'` and
 * `font-src 'self' data:` (nginx/conf.d/app.conf), so production refuses a
 * stylesheet or font from any other origin. index.css imported Google Fonts:
 * the browser refused it on every page, logging a CSP error each time. The
 * Vite dev server sends no CSP, which is why it never showed in development.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL(".", import.meta.url));

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

describe("the app's CSS", () => {
  it("loads no stylesheet or font from another origin", () => {
    const external = cssFiles(SRC).flatMap((path) =>
      (readFileSync(path, "utf8").match(/(?:@import\s+|url\()\s*["']?https?:\/\/[^"')\s]+/g) ?? [])
        .map((m) => `${path}: ${m}`),
    );
    expect(external).toEqual([]);
  });
});
