import { addMonths, fyMonths, fyOf, todayIST } from '@/core/format';
export const SECTIONS = ['b2b','b2cl','b2c','rate','hsn','docs','cancelled'] as const;
export type Section = typeof SECTIONS[number];
export type GstTab = 'all' | 'returns' | 'recon' | 'credit';
export type GstNav = { firm: number | null; fy: string; month: string | null; tab: GstTab; sec: Section; fix: boolean };
export const validMonth = (s: string | null): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const validFy = (s: string | null): s is string => !!s && /^\d{4}-\d{2}$/.test(s) && (Number(s.slice(0,4))+1)%100 === Number(s.slice(5));
export function resolveGstNav(q: URLSearchParams, scope: { firm: number | 'all' | null; fy: string; firms: number[]; phone: boolean; defaultMonth: string | null }): GstNav {
  const asked = q.get('firm');
  const id = asked && /^\d+$/.test(asked) ? Number(asked) : null;
  const firm = id !== null && scope.firms.includes(id) ? id : typeof scope.firm === 'number' ? scope.firm : scope.firms[0] ?? null;
  const tabValue = q.get('tab');
  const tab: GstTab = tabValue === 'recon' || tabValue === 'credit' || tabValue === 'returns' ? tabValue : !scope.phone && (tabValue === 'all' || scope.firm === 'all' && !asked && !q.has('month')) ? 'all' : 'returns';
  const askedMonth = q.get('month');
  const fy = validMonth(askedMonth) ? fyOf(`${askedMonth}-01`) : validFy(q.get('fy')) ? q.get('fy')! : scope.fy;
  const months = fyMonths(fy);
  const previous = addMonths(todayIST().slice(0,7), -1);
  const fallback = scope.defaultMonth && months.includes(scope.defaultMonth) ? scope.defaultMonth : months.includes(previous) ? previous : months[11];
  return { firm, fy, month: fy < '2025-26' ? null : validMonth(askedMonth) ? askedMonth : fallback, tab, sec: SECTIONS.includes(q.get('sec') as Section) ? q.get('sec') as Section : 'b2b', fix: q.get('fix') === '1' };
}
export function gstHref(nav: GstNav, patch: Partial<GstNav> = {}): string {
  const n = {...nav,...patch,fix: patch.fix ?? false};
  if ((patch.firm !== undefined && patch.firm !== nav.firm || patch.month !== undefined && patch.month !== nav.month) && patch.sec === undefined) n.sec = 'b2b';
  const q = new URLSearchParams();
  if (n.tab !== 'all' && n.firm !== null) q.set('firm', String(n.firm));
  if (n.month) q.set('month', n.month); else q.set('fy',n.fy);
  if (n.tab !== 'returns') q.set('tab',n.tab);
  if (n.tab !== 'all' && n.sec !== 'b2b') q.set('sec',n.sec);
  if (n.fix) q.set('fix','1');
  return `/gst?${q}`;
}
