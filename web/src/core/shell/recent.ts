// Records each person opened lately (bills, customers, purchases, products, suppliers), newest first, for search's
// "Opened recently". Kept on this device, per person: the last 8. The page frame notes each visit (PageFrame.tsx).
type Visit = { to: string; label: string };
const key = (meId: number) => `gst3.recent.${meId}`;
export function recentVisits(meId: number): Visit[] {
  try { return (JSON.parse(localStorage.getItem(key(meId)) || "[]") as Visit[]).slice(0, 8); } catch { return []; }
}
export function noteVisit(meId: number, v: Visit) {
  try { localStorage.setItem(key(meId), JSON.stringify([v, ...recentVisits(meId).filter((x) => x.to !== v.to)].slice(0, 8))); } catch { /* storage refused */ }
}
