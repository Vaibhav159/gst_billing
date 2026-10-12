// What a PDF the app made says, for the specs that read one back, with Node's own zlib (nothing to install). react-pdf
// draws each page in one compressed content stream and names its fonts in the page's resources. The bill prints in the
// PDF's built-in Times fonts, whose text is stored as hex strings of Windows-1252 codes, so every word comes back as
// printed. The ₹, which Times doesn't have, is drawn in its own one-glyph font (RupeeSign, embedded): its codes are
// glyph numbers, read back through that font's own ToUnicode map, so it comes back as "₹" too.
const zlib = require("zlib");

const WIN = new TextDecoder("windows-1252");

/** Object n of the PDF: its dictionary, and its stream's bytes (inflated) when it has one. */
function objectOf(buf, s, n) {
  const at = new RegExp(`(?:^|\\n)${n} 0 obj\\s*`).exec(s);
  const head = /(<<[\s\S]*?>>)(?=\s*(?:stream|endobj))(\s*stream\r?\n)?/y;
  head.lastIndex = at ? at.index + at[0].length : s.length;
  const m = head.exec(s);
  if (!m) return { dict: "", body: null };
  if (!m[2]) return { dict: m[1], body: null };
  const raw = buf.subarray(head.lastIndex, head.lastIndex + Number(/\/Length (\d+)/.exec(m[1])[1]));
  return { dict: m[1], body: /\/FlateDecode/.test(m[1]) ? zlib.inflateSync(raw) : raw };
}

/**
 * Font object n: its name, the characters it holds when it's embedded (null for a built-in one), and how its text reads.
 * react-pdf's ToUnicode map gives each glyph number in ranges, "<first> <last> [<UTF-16> …]".
 */
function fontOf(buf, s, n) {
  const { dict } = objectOf(buf, s, n);
  const name = /\/BaseFont \/(\S+)/.exec(dict)?.[1] ?? "";
  const map = /\/ToUnicode (\d+) 0 R/.exec(dict);
  if (!map) return { name, chars: null, read: (hex) => WIN.decode(Buffer.from(hex, "hex")) };
  const glyphs = new Map();
  for (const [, first, list] of objectOf(buf, s, map[1]).body.toString("latin1").matchAll(/<([0-9a-f]+)>\s*<[0-9a-f]+>\s*\[([^\]]*)\]/gi)) {
    [...list.matchAll(/<([0-9a-f\s]+)>/gi)].forEach((u, i) => glyphs.set(parseInt(first, 16) + i, String.fromCharCode(...u[1].trim().split(/\s+/).map((h) => parseInt(h, 16)))));
  }
  const chars = [...glyphs.values()].filter((c) => c !== "\u0000").join(""); // glyph 0 is .notdef
  return { name, chars, read: (hex) => (hex.match(/.{4}/g) ?? []).map((g) => glyphs.get(parseInt(g, 16)) ?? "�").join("") };
}

/** Each page's text in drawing order, one string a page, its runs joined as they're drawn, each read in its own font. */
function pdfPages(buf) {
  const s = buf.toString("latin1");
  const kids = /\/Type \/Pages\s*\/Count \d+\s*\/Kids \[([^\]]*)\]/.exec(s)?.[1] ?? "";
  return [...kids.matchAll(/(\d+) 0 R/g)].map(([, n]) => {
    const page = objectOf(buf, s, n).dict;
    const resources = /\/Resources (\d+) 0 R/.exec(page);
    const named = /\/Font <<([^>]*)>>/.exec(resources ? objectOf(buf, s, resources[1]).dict : page)?.[1] ?? "";
    const fonts = new Map([...named.matchAll(/\/(\S+) (\d+) 0 R/g)].map(([, name, ref]) => [name, fontOf(buf, s, ref)]));
    const drawn = objectOf(buf, s, /\/Contents (\d+) 0 R/.exec(page)[1]).body.toString("latin1");
    let font = null;
    const runs = [];
    for (const m of drawn.matchAll(/\/(\S+) [\d.]+ Tf|\[([^\]]*)\]\s*TJ/g)) {
      if (m[1] !== undefined) font = fonts.get(m[1]);
      else runs.push([...m[2].matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => font.read(h[1])).join(""));
    }
    return runs.join("");
  });
}

/** The fonts the pages use: each one's name, and the characters it holds when it's embedded (null for a built-in one). */
function pdfFonts(buf) {
  const s = buf.toString("latin1");
  const refs = new Set([...s.matchAll(/\/Font <<([^>]*)>>/g)].flatMap((m) => [...m[1].matchAll(/(\d+) 0 R/g)].map((r) => r[1])));
  return [...refs].map((n) => {
    const { name, chars } = fontOf(buf, s, n);
    return { name, chars };
  });
}

/** The document's Subject: on a bill's PDF, what its QR code carries. */
function pdfSubject(buf) {
  const s = buf.toString("latin1");
  const ref = /\/Subject (\d+) 0 R/.exec(s);
  const m = ref ? new RegExp(`(?:^|\\n)${ref[1]} 0 obj\\s*\\(([^)]*)\\)`).exec(s) : /\/Subject \(([^)]*)\)/.exec(s);
  return m ? m[1] : null;
}

/** How many pages the PDF has. */
function pdfPageCount(buf) {
  return Number(/\/Type \/Pages\s*\/Count (\d+)/.exec(buf.toString("latin1"))?.[1] ?? 0);
}

module.exports = { pdfPages, pdfFonts, pdfSubject, pdfPageCount };
