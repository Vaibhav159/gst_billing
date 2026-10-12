import { toDraftData as readDraft } from "@/core/draftData";
import { fromDraftData, toDraftData as writeDraft } from "./model";

const oldLine = { productId: null, name: "Custom ring", hsn: "7113", gst: "3", unit: "gms", qty: 12.345, rate: "6512.50", note: "", custom: true };
const raw = (line: Record<string, unknown>) => ({
  v: 1, firmId: 3, customer: null, date: "2026-09-30", number: "38", numberTyped: true,
  paper: true, posOverride: null, payment: "cash", notes: "", replaces: null, lines: [line],
});
const roundtrip = (line: Record<string, unknown>) => {
  const parsed = readDraft(JSON.parse(JSON.stringify(raw(line))));
  return writeDraft(fromDraftData(parsed), parsed.replaces);
};

test.each([
  { kind: "gold", purity: "22K" },
  { kind: null, purity: "" },
  { kind: "future-material", purity: "999" },
])("custom material survives JSON, the shared reader and the form serializer: %j", (material) => {
  expect(roundtrip({ ...oldLine, ...material })).toEqual(raw({ ...oldLine, ...material }));
});

test("older drafts keep their exact line shape without invented material fields", () => {
  const kept = roundtrip(oldLine);
  expect(kept).toEqual(raw(oldLine));
  expect(kept.lines[0]).not.toHaveProperty("kind");
  expect(kept.lines[0]).not.toHaveProperty("purity");
});

test.each([
  { kind: 22, purity: 22 },
  { kind: true, purity: null },
  { kind: { name: "gold" }, purity: ["22K"] },
  { kind: undefined, purity: undefined },
])("malformed or absent optional material is omitted without changing the old line: %j", (material) => {
  expect(roundtrip({ ...oldLine, ...material })).toEqual(raw(oldLine));
});
