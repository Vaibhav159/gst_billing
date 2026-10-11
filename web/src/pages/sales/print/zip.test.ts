import { bytesOf, crc32, zipFiles } from "./zip";

/** Read through the central directory, checking the matching stored local entries. */
function unzip(z: Uint8Array) {
  const v = new DataView(z.buffer, z.byteOffset, z.byteLength);
  const end = z.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  const count = v.getUint16(end + 10, true);
  expect(v.getUint16(end + 8, true)).toBe(count);
  expect(v.getUint16(end + 4, true)).toBe(0);
  expect(v.getUint16(end + 6, true)).toBe(0);
  expect(v.getUint16(end + 20, true)).toBe(0);
  const directory = v.getUint32(end + 16, true);
  expect(directory + v.getUint32(end + 12, true)).toBe(end);
  let at = directory;
  let localEnd = 0;
  const out: { name: string; crc: number; data: string; time: number; day: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    expect(v.getUint32(at, true)).toBe(0x02014b50);
    expect(v.getUint16(at + 4, true)).toBe(20);
    expect(v.getUint16(at + 6, true)).toBe(20);
    expect(v.getUint16(at + 8, true)).toBe(0x0800);
    expect(v.getUint16(at + 10, true)).toBe(0);
    const time = v.getUint16(at + 12, true);
    const day = v.getUint16(at + 14, true);
    const crc = v.getUint32(at + 16, true);
    const size = v.getUint32(at + 24, true);
    expect(v.getUint32(at + 20, true)).toBe(size);
    const nameLen = v.getUint16(at + 28, true);
    const local = v.getUint32(at + 42, true);
    expect(local).toBe(localEnd);
    const name = new TextDecoder().decode(z.subarray(at + 46, at + 46 + nameLen));
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    expect(v.getUint16(local + 4, true)).toBe(20);
    expect(v.getUint16(local + 6, true)).toBe(0x0800);
    expect(v.getUint16(local + 8, true)).toBe(0);
    expect(v.getUint16(local + 10, true)).toBe(time);
    expect(v.getUint16(local + 12, true)).toBe(day);
    expect(v.getUint32(local + 14, true)).toBe(crc);
    expect(v.getUint32(local + 18, true)).toBe(size);
    expect(v.getUint32(local + 22, true)).toBe(size);
    expect(v.getUint16(local + 26, true)).toBe(nameLen);
    expect(v.getUint16(local + 28, true)).toBe(0);
    expect(new TextDecoder().decode(z.subarray(local + 30, local + 30 + nameLen))).toBe(name);
    const start = local + 30 + nameLen;
    const bytes = z.subarray(start, start + size);
    expect(crc32(bytes)).toBe(crc);
    out.push({ name, crc, data: new TextDecoder().decode(bytes), time, day });
    localEnd = start + size;
    at += 46 + nameLen;
  }
  expect(at).toBe(end);
  expect(localEnd).toBe(directory);
  return out;
}

test("CRC-32 is zip's own: the check value of 123456789", () => {
  expect(crc32(new TextEncoder().encode("123456789")).toString(16)).toBe("cbf43926");
  expect(crc32(new Uint8Array())).toBe(0);
});

test("bytesOf preserves a Blob's binary bytes", async () => {
  const data = new Uint8Array([0, 1, 127, 128, 255]);
  expect(await bytesOf(new Blob([data]))).toEqual(data);
});

test("a zip of PDFs holds each file whole, under its own name, with its CRC and date", async () => {
  const files = [{ name: "KGH_2026-27_31.pdf", blob: new Blob(["%PDF-1.3 one"]) }, { name: "MO_2026-27_7.pdf", blob: new Blob(["%PDF-1.3 two, a little longer"]) }];
  const z = await zipFiles(files, new Date(2026, 9, 8, 10, 42, 6));
  expect(z.type).toBe("application/zip");
  const back = unzip(await bytesOf(z));
  expect(back.map((f) => [f.name, f.data])).toEqual([["KGH_2026-27_31.pdf", "%PDF-1.3 one"], ["MO_2026-27_7.pdf", "%PDF-1.3 two, a little longer"]]);
  expect(back[0].crc).toBe(crc32(new TextEncoder().encode("%PDF-1.3 one")));
  expect(back.map(({ time, day }) => [time, day])).toEqual([[21827, 23880], [21827, 23880]]);
});

test("UTF-8 names and an empty file round-trip through both headers", async () => {
  const z = await zipFiles([{ name: "किरण_₹_31.pdf", blob: new Blob([]) }]);
  expect(unzip(await bytesOf(z))).toEqual([{ name: "किरण_₹_31.pdf", crc: 0, data: "", time: expect.any(Number), day: expect.any(Number) }]);
});

test("an empty archive is a complete zip with an empty directory", async () => {
  const z = await zipFiles([]);
  expect(z.type).toBe("application/zip");
  expect(z.size).toBe(22);
  expect(unzip(await bytesOf(z))).toEqual([]);
});

test("the zip reads each PDF before asking the producer to make the next", async () => {
  const events: string[] = [];
  const first = new Blob(["first PDF"]);
  const second = new Blob(["second PDF"]);
  const read = FileReader.prototype.readAsArrayBuffer;
  const spy = vi.spyOn(FileReader.prototype, "readAsArrayBuffer").mockImplementation(function (this: FileReader, blob: Blob) {
    this.addEventListener("load", () => events.push(blob === first ? "read first" : "read second"), { once: true });
    read.call(this, blob);
  });
  async function* files() {
    events.push("make first");
    yield { name: "first.pdf", blob: first };
    expect(events).toEqual(["make first", "read first"]);
    events.push("make second");
    yield { name: "second.pdf", blob: second };
    expect(events).toEqual(["make first", "read first", "make second", "read second"]);
  }
  let z: Blob;
  try { z = await zipFiles(files()); } finally { spy.mockRestore(); }
  expect(unzip(await bytesOf(z)).map(({ name, data }) => [name, data])).toEqual([["first.pdf", "first PDF"], ["second.pdf", "second PDF"]]);
});
