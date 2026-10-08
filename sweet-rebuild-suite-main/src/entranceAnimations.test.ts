// @vitest-environment node
/**
 * Page entrance animations must not leave a transform behind (UX4).
 *
 * .animate-fade-in ended on transform: translateY(0) and kept it (fill mode
 * forwards). Any transform other than none makes the element the containing
 * block for position: fixed descendants, so on a phone the invoice form's
 * "fixed" Create bar sat at y≈1546 of a 1,726 px page, the invoice page's
 * Edit/Print bar at y≈1568, and the unsaved-changes card at top −108 px.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("./index.css", import.meta.url)), "utf8");

/** Every `.animate-x { animation: name … }` rule that runs once. */
const entrances = [...css.matchAll(/\.(animate-[\w-]+)\s*\{\s*animation:\s*([^;]+);/g)]
  .map(([, cls, value]) => ({ cls, value, keyframes: value.trim().split(/\s+/)[0] }))
  .filter(({ value }) => !/\binfinite\b/.test(value));

function finalFrame(name: string): string {
  const block = css.match(new RegExp(`@keyframes\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
  return block.match(/(?:\bto|100%)\s*\{([^}]*)\}/)?.[1] ?? "";
}

describe("page entrance animations (UX4)", () => {
  it("finds the entrance animations", () => {
    expect(entrances.map((e) => e.cls)).toEqual(expect.arrayContaining(["animate-fade-in", "animate-slide-up"]));
  });

  it.each(entrances)("$cls ends with no transform", ({ keyframes }) => {
    const end = finalFrame(keyframes);
    expect(end, `@keyframes ${keyframes} has no final frame`).not.toBe("");
    const transforms = [...end.matchAll(/transform\s*:\s*([^;]+)/g)].map(([, value]) => value.trim());
    expect(transforms.filter((value) => value !== "none")).toEqual([]);
  });

  it.each(entrances)("$cls doesn't hold its last frame once it has played", ({ value }) => {
    expect(value).not.toMatch(/\b(forwards|both)\b/);
  });
});
