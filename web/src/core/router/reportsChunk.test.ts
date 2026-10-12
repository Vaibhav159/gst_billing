// @vitest-environment node
import { build, type Rollup } from "vite";
import config from "../../../vite.config";

test("the workbook's tabs and spreadsheet code stay out of the shell's first download", async () => {
  const id = "\0report-chunk-probe";
  const result = await build({
    ...config, configFile: false, logLevel: "silent",
    plugins: [config.plugins!, {
      name: "report-chunk-probe",
      resolveId: source => source === id ? id : undefined,
      load: source => source === id ? 'import { Checkbox } from "@/core/ui/Choice"; window.probeChoice = Checkbox; window.openWorkbook = () => import("@/pages/gst/WorkbookDialog");' : undefined,
    }],
    build: { write: false, minify: false, rollupOptions: { input: id } },
  }) as Rollup.RollupOutput;
  const entry = result.output.find((chunk): chunk is Rollup.OutputChunk => chunk.type === "chunk" && chunk.isEntry)!;
  expect(Object.entries(entry.modules).some(([name, module]) => name.endsWith("/core/ui/Choice.tsx") && module.renderedExports.includes("Tabs"))).toBe(false);
  expect(Object.keys(entry.modules).filter(name => /\/(Tabs\.tsx|WorkbookDialog\.tsx|xlsx[^/]*\/)/.test(name))).toEqual([]);
  expect(result.output.some(chunk => chunk.type === "chunk" && !chunk.isEntry && Object.keys(chunk.modules).some(name => name.endsWith("/WorkbookDialog.tsx")))).toBe(true);
}, 20_000);
