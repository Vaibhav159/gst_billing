// Bills made or restored on another screen flash once where they're next shown (PROTO sales/lib.js:584-593): the bill
// form marks a bill it saved, Undo and Restore mark the bill that came back, and a list takes the marks for the rows
// it shows. A mark older than two minutes is forgotten.
const marks = new Map<number, number>();
const KEEP_MS = 120_000;

export function markFresh(id: number): void {
  marks.set(id, Date.now());
}

/** The marked ids among `ids` (every marked id, with none given), taken: each flashes once. */
export function takeFresh(ids?: Iterable<number>): Set<number> {
  const now = Date.now();
  for (const [id, at] of marks) if (now - at > KEEP_MS) marks.delete(id);
  const want = ids ? new Set(ids) : null;
  const out = new Set<number>();
  for (const id of [...marks.keys()]) {
    if (want && !want.has(id)) continue;
    out.add(id);
    marks.delete(id);
  }
  return out;
}
