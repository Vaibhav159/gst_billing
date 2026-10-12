import { bytesOf, crc32 } from "@/core/files/zip";
import { caBundle } from "./bundle";

async function contents(blob: Blob) {
  const bytes = await bytesOf(blob); const view = new DataView(bytes.buffer); const entries: { name: string; text: string }[] = [];
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true); const length = view.getUint16(at + 26, true); const start = at + 30 + length;
    const data = bytes.subarray(start, start + size);
    expect(crc32(data)).toBe(view.getUint32(at + 14, true));
    entries.push({ name: new TextDecoder().decode(bytes.subarray(at + 30, start)), text: new TextDecoder().decode(data) });
    at = start + size;
  }
  return entries;
}

const args = () => ({ short: "KGH", month: "2026-09", gstr1: { name: "GSTR1_08VRHFA2322D1ZI_092026.json", blob: new Blob(['{"b2b":[]}']) }, gstr3b: { name: "GSTR3B_08VRHFA2322D1ZI_092026.json", blob: new Blob(['{"sup_details":{}}']) }, excel: { name: "GST_Report_KGH_Sep_2026.xlsx", blob: new Blob([new Uint8Array([80, 75, 3, 4])]) } });

test("the CA zip has the exact contract name and the fetched JSONs and workbook unchanged", async () => {
  const input = args(); const zip = await caBundle(input);
  expect(zip.name).toBe("GST_KGH_092026_for_CA.zip");
  expect(zip.blob.type).toBe("application/zip");
  expect(zip.parts).toEqual(["gstr1", "gstr3b", "excel"]);
  expect(await contents(zip.blob)).toEqual([{ name: input.gstr1.name, text: '{"b2b":[]}' }, { name: input.gstr3b.name, text: '{"sup_details":{}}' }, { name: input.excel.name, text: "PK\u0003\u0004" }]);
});

test("when checks block GSTR-1 the zip and recorded parts leave it out", async () => {
  const zip = await caBundle({ ...args(), gstr1: undefined });
  expect(zip.parts).toEqual(["gstr3b", "excel"]);
  expect((await contents(zip.blob)).map(entry => entry.name)).toEqual([args().gstr3b.name, args().excel.name]);
});

test("invalid months and path-like artifact names are refused before making a zip", async () => {
  await expect(caBundle({ ...args(), month: "2026-13" })).rejects.toThrow("Pick a month in YYYY-MM form.");
  await expect(caBundle({ ...args(), excel: { ...args().excel, name: "../book.xlsx" } })).rejects.toThrow("The file name must not contain a path.");
});
