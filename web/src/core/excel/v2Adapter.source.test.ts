import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import golden from "./fixtures/caWorkbook.v2.golden.json";

const here = dirname(fileURLToPath(import.meta.url));
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

// Generated from the real v2 adapter/report at ecf65238 before retiring its
// sources. Pin the result and its provenance, independently of v3's writer.
test("the frozen v2 output and its source provenance stay unchanged", () => {
  expect(sha256(join(here, "fixtures", "caWorkbook.v2.golden.json")))
    .toBe("7e6112693cae0e492b92f5eaba04eef1cc42132066a48d989e451f688eeb6986");
});

test.each(Object.entries(golden.provenance.inputSha256))(
  "the v2 golden still describes the real API fixture %s",
  (filename, hash) => expect(sha256(join(here, "__fixtures__", filename))).toBe(hash),
);

test("the golden retains every CA parity scenario and payment variant", () => {
  expect(Object.keys(golden.workbooks)).toEqual([
    "ordinary.plain", "ordinary.payment", "ties.payment", "collation.payment",
    "cancelled.plain", "cancelled.payment", "paise.payment",
  ]);
});
