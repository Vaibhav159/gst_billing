// A .zip of PDFs for bulk download, written by hand: each file stored as it is (a PDF is compressed inside already),
// with the zip's local headers, central directory and CRC-32. No library: the format's stored form is this small.

let table: Uint32Array | null = null;
/** CRC-32 (IEEE), as zip checks each file with. */
export function crc32(data: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A Blob's bytes (a FileReader: jsdom's Blob has no arrayBuffer()). */
export function bytesOf(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((done, fail) => {
    const r = new FileReader();
    r.onload = () => done(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => fail(r.error);
    r.readAsArrayBuffer(blob);
  });
}

/** The files as one .zip, each stored (not compressed again), named in UTF-8, dated `now` in the device's time.
 * An async producer makes the next PDF only after this writer has read and added the last one. */
export async function zipFiles(files: { name: string; blob: Blob }[] | AsyncIterable<{ name: string; blob: Blob }>, now: Date = new Date()): Promise<Blob> {
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const day = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  let count = 0;
  for await (const f of files) {
    const data = await bytesOf(f.blob);
    const name = new TextEncoder().encode(f.name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    // signature, version 2.0, UTF-8 names, stored, time, date, CRC, sizes, name length, no extra field
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, time, 2], [12, day, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, name.length, 2], [28, 0, 2]]
      .forEach(([at, v, n]) => (n === 4 ? local.setUint32(at, v >>> 0, true) : local.setUint16(at, v, true)));
    const entry = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, time, 2], [14, day, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4],
      [28, name.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, offset, 4]]
      .forEach(([at, v, n]) => (n === 4 ? entry.setUint32(at, v >>> 0, true) : entry.setUint16(at, v, true)));
    parts.push(new Uint8Array(local.buffer), name, data);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + data.length;
    count += 1;
  }
  const size = central.reduce((a, c) => a + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, count, 2], [10, count, 2], [12, size, 4], [16, offset, 4], [20, 0, 2]]
    .forEach(([at, v, n]) => (n === 4 ? end.setUint32(at, v >>> 0, true) : end.setUint16(at, v, true)));
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
}
