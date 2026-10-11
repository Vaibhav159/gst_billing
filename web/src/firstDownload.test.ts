// @vitest-environment node
import { build, type ModulePreloadOptions } from "vite";
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

test("import routes keep stylesheet loading while unrelated pages keep JavaScript preloads", async () => {
  const preload = config.build!.modulePreload as ModulePreloadOptions;
  expect(preload.resolveDependencies).toBeTypeOf("function");
  const resolve = preload.resolveDependencies!;
  const seen: { file: string; before: string[]; after: string[] }[] = [];
  const pages = ["Suppliers", "ImportPage", "PhotoPage", "OtherPage"];
  const sources: Record<string, string> = {
    main: `globalThis.__preloadProbe = { ${pages.map(name => `${name}: () => import("probe:${name}")`).join(", ")} };`,
    shared: "export function shared(name) { return document.title + name; }",
    ...Object.fromEntries(pages.flatMap(name => [
      [name, `import { shared } from "probe:shared"; import "probe:${name}.css"; export default () => shared("${name}");`],
      [`${name}.css`, `:root { --preload-probe-${name}: red; }`],
    ])),
  };
  const prefix = "/__preload_probe__/";
  const result = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [{
      name: "route-preload-probe",
      resolveId: source => source.startsWith("probe:") ? prefix + source.slice(6) : undefined,
      load: id => id.startsWith(prefix) ? sources[id.slice(prefix.length)] : undefined,
    }],
    build: {
      write: false,
      minify: false,
      rollupOptions: { input: "probe:main" },
      modulePreload: { ...preload, resolveDependencies: (file, deps, context) => {
        const before = [...deps];
        const after = resolve(file, deps, context);
        seen.push({ file, before, after });
        return after;
      } },
    },
  });
  for (const name of pages.slice(0, 3)) {
    const call = seen.find(item => item.file.startsWith(`assets/${name}-`));
    expect(call?.before.some(file => file.endsWith(".js"))).toBe(true);
    expect(call?.after).toEqual([]);
  }
  const other = seen.find(item => item.file.startsWith("assets/OtherPage-"));
  expect(other?.before.some(file => file.endsWith(".js"))).toBe(true);
  expect(other?.after).toEqual(other?.before);
  const output = Array.isArray(result) ? result[0].output : "output" in result ? result.output : [];
  const entry = output.find(item => item.type === "chunk" && item.isEntry);
  const styles = output.filter(item => item.type === "asset" && item.fileName.endsWith(".css"));
  expect(styles).toHaveLength(pages.length);
  if (!entry || entry.type !== "chunk") throw new Error("The probe must emit an entry.");
  for (const name of pages) {
    const css = styles.find(item => item.type === "asset" && String(item.source).includes(`--preload-probe-${name}:`));
    expect(css, `${name} must have its own stylesheet`).toBeDefined();
    if (!css) throw new Error(`Missing ${name} stylesheet`);
    expect(entry.code, `${name} keeps its stylesheet preload`).toContain(css.fileName);
    expect(entry.code).toMatch(new RegExp(`import\\("\\./${name}-[^"/]+\\.js"\\)`));
  }
});
