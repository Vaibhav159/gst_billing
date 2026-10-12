import { useEffect, useRef, useState } from "react";

/**
 * Ids that appeared after the list first rendered, for about 1.6 s.
 * Give their rows className="anim-flash" so a new or changed row is noticed.
 */
export function useNewIds(ids: string[], ms = 1600): Set<string> {
  const seen = useRef<Set<string> | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  if (seen.current === null) seen.current = new Set(ids);
  const key = ids.join("|");
  useEffect(() => {
    const known = seen.current!; // set during the first render, above
    const added = ids.filter((id) => !known.has(id));
    if (!added.length) return;
    added.forEach((id) => known.add(id));
    setFresh((f) => new Set([...f, ...added]));
    timers.current.push(setTimeout(() => setFresh((f) => { const n = new Set(f); added.forEach((id) => n.delete(id)); return n; }), ms));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return fresh;
}
