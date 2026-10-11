import { expect, test } from 'vitest';
import { gstHref, resolveGstNav } from './navigation';
const scope = { firm: 'all' as number | 'all' | null, fy: '2026-27', firms: [3,7], phone: false, defaultMonth: '2026-09' };
test('desktop all firms opens Month end, phone opens one firm and exact links win', () => {
  expect(resolveGstNav(new URLSearchParams(), scope)).toMatchObject({ tab:'all', firm:3, month:'2026-09' });
  expect(resolveGstNav(new URLSearchParams('tab=all'), {...scope,phone:true})).toMatchObject({tab:'returns',firm:3});
  expect(resolveGstNav(new URLSearchParams('firm=7&month=2026-03&sec=docs&fix=1'), scope)).toMatchObject({firm:7,month:'2026-03',fy:'2025-26',sec:'docs',fix:true,tab:'returns'});
});
test('bad ids and dates do not reach firm queries, old FY has no month, missing firm waits', () => {
  expect(resolveGstNav(new URLSearchParams('firm=NaN&month=2026-13&sec=wat'), scope)).toMatchObject({firm:3,month:'2026-09',sec:'b2b'});
  expect(resolveGstNav(new URLSearchParams('fy=2024-25'), scope)).toMatchObject({fy:'2024-25',month:null});
  expect(resolveGstNav(new URLSearchParams(), {...scope,firm:null,firms:[]})).toMatchObject({firm:null});
});
test('a firm/month change resets the section and fix flag; same-month section link keeps scope', () => {
  const nav = resolveGstNav(new URLSearchParams('firm=3&month=2026-09&sec=hsn&fix=1'),scope);
  expect(gstHref(nav,{firm:7})).toBe('/gst?firm=7&month=2026-09');
  expect(gstHref(nav,{sec:'docs'})).toBe('/gst?firm=3&month=2026-09&sec=docs');
  expect(gstHref(nav,{tab:'all'})).toBe('/gst?month=2026-09&tab=all');
});
