import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const legacyRoot = resolve(here, "../../../../sweet-rebuild-suite-main");
const normalize = (text: string) => text.replace(/\r\n/g, "\n").split("\n").map(line => line.trimEnd()).join("\n").trimEnd() + "\n";

// Parse declarations instead of slicing on braces: the adapter contains nested
// objects, comments and template strings. Types/imports are intentionally local.
function declaration(source: ts.SourceFile, name: string): string {
  const matches = source.statements.filter(statement =>
    ts.isFunctionDeclaration(statement) ? statement.name?.text === name
      : ts.isVariableStatement(statement) && statement.declarationList.declarations.some(value =>
        ts.isIdentifier(value.name) && value.name.text === name));
  if (matches.length !== 1) throw new Error(`${source.fileName}: expected one declaration named ${name}, got ${matches.length}`);
  return normalize(matches[0].getText(source));
}

function sourceFile(path: string) {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

// SHA-256 covers the complete declaration, including its signature and body,
// from commit 112cacf0. Only LF/trailing line whitespace is normalized. These
// pins remain mandatory when the retired frontend directory has been removed.
const snapshots = [
  {
    fixture: "v2Adapter.ts", original: "src/hooks/useDataStore.ts",
    hashes: {
      getFinancialYear: "2b9b8dde120e5cd3e62a876b496a319670b3c1318eaf97c8a64a6dfdaa7f27d0",
      mapDjangoInvoice: "8465bdcac4352756d25ee97ee14477e022e1f9e341a6ec14241986b299faa568",
    },
  },
  {
    fixture: "v2Rates.ts", original: "src/utils/gstRate.ts",
    hashes: {
      GST_SLABS: "d7b8b8f7c99cf8b2996fd22025f26e87f7cedb4f83fdf5dd88f7a1f34d8036ed",
      EPS: "9e89b32807632de4786af444434aa20057c7b75f73c7f80a0c92e88951ee80c7",
      matchSlab: "bfc4f8bfe9336661a8679b08fe17fb7f20b0f141101294eae98e4c8ae73ae1b5",
      resolvePercent: "e9bd035c664e2f7d2663371153820c76780260c4438b957c526fff2dac4fad95",
      rateToPercent: "5939108796839624075b5d32dbe787bb8588843f15d013b76d1916c17046d887",
    },
  },
];

for (const snapshot of snapshots) {
  const frozen = sourceFile(join(here, "__fixtures__", snapshot.fixture));
  // Missing source files fail while the v2 tree exists. Only retiring the whole
  // tree removes this comparison; hashes continue guarding the frozen oracle.
  const original = existsSync(legacyRoot) ? sourceFile(join(legacyRoot, snapshot.original)) : null;
  for (const [name, hash] of Object.entries(snapshot.hashes)) {
    test(`the frozen v2 ${name} declaration matches its pinned source`, () => {
      const text = declaration(frozen, name);
      expect(createHash("sha256").update(text).digest("hex")).toBe(hash);
      if (original) expect(text).toBe(declaration(original, name));
    });
  }
}

function workbookLogic(source: ts.SourceFile): string {
  return source.statements.filter(statement =>
    !ts.isImportDeclaration(statement) && !ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)
    && !(ts.isFunctionDeclaration(statement) && ["fd", "downloadReportExcel"].includes(statement.name?.text ?? "")))
    .map(statement => normalize(statement.getText(source))).join("\n");
}

test("the frozen v2 workbook generator retains all original workbook logic", () => {
  const frozen = sourceFile(join(here, "__fixtures__", "v2Report.ts"));
  const logic = workbookLogic(frozen);
  // Runtime statements, in source order, from commit 112cacf0. Only the typed
  // fixture imports/types, isolated date adapter and download wrapper differ.
  expect(createHash("sha256").update(logic).digest("hex"))
    .toBe("47fb8b3295e02663834d8090a193b31156fa8220570f6caaa0a65d532db3998c");
  // Excluding fd from the shared logic comparison must not leave its accepted
  // replacement unguarded: pin the exact ISO-date-only fixture implementation.
  expect(createHash("sha256").update(declaration(frozen, "fd")).digest("hex"))
    .toBe("6fa77321ee228ed02f89406a6fbbeb75bb22d3ba1bd2515133a4eaf55f2d00ac");
  if (existsSync(legacyRoot)) {
    const original = sourceFile(join(legacyRoot, "src/utils/generateReportExcel.ts"));
    expect(logic).toBe(workbookLogic(original));
    expect(createHash("sha256").update(declaration(original, "fd")).digest("hex"))
      .toBe("327212206b88cc0e3b5b48aa373513e467207a56da7d198a9b28fa33f953d5e6");
  }
});
