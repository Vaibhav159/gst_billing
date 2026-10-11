import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Type-only imports are erased from the build, so they cannot pull code into the entry. */
const imports = (file: string) => [...readFileSync(resolve(__dirname, file), "utf8").matchAll(/^import (?!type )[^;]*? from "([^"]+)";/gms)].map(m => m[1]);

test.each(["PhoneShell.tsx", "AppLayout.tsx", "DesktopShell.tsx", "Palette.tsx"])("the eager %s leaves AttentionPalette and badge building to lazy chunks (Ruling P5-8)", file => {
  expect(imports(file).filter(from => /AttentionPalette$|TabBadges$|core\/due\/(badges|cache)$/.test(from))).toEqual([]);
});
