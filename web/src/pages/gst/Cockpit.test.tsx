import { fireEvent, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { renderApp } from '@/test/render';
import { serve } from '@/test/server';
import { useGstMonthEnd } from '@/core/api/gst';
import { prepareCaBundle } from '@/core/api/gstExports';
import { endFixture } from '@/core/gst/fixtures';
import { CaBundleButton } from './CaBundleButton';
import { Cockpit } from './Cockpit';
vi.mock('@/core/api/gstExports', async original => ({ ...await original<typeof import('@/core/api/gstExports')>(), prepareCaBundle: vi.fn() }));
vi.mock('@/core/print/files', () => ({ saveFile: vi.fn() }));
test('keyboard D downloads only with permission and keyboard Enter opens the focused firm', () => {
  const onOpen=vi.fn(),onDownload=vi.fn();renderApp(<Cockpit data={endFixture()} onOpen={onOpen} onDownload={onDownload} onMark={vi.fn()} />);
  const row=screen.getByRole('row',{name:/KIRAN GOLD HOUSE: Ready to file/});
  fireEvent.keyDown(row,{key:'d'});expect(onDownload).toHaveBeenCalledWith(3);
  fireEvent.keyDown(row,{key:'Enter'});expect(onOpen).toHaveBeenCalledWith(3,false);
});
test('viewer keyboard cannot download or mark; filing sheet shows literal zero cash and legacy status', () => {
  const data=endFixture();data.firms[0].cash={amount:0,kind:'paid'};data.firms[0].stage='filed';data.firms[0].record.legacy=true;
  const onDownload=vi.fn(),onMark=vi.fn();renderApp(<Cockpit data={data} onOpen={vi.fn()} onDownload={onDownload} onMark={onMark}/>,{me:{role:'viewer',permissions:['view','reports.export']}});
  const row=screen.getByRole('row',{name:/KIRAN GOLD HOUSE/});fireEvent.keyDown(row,{key:'d'});fireEvent.keyDown(row,{key:'m'});
  expect(onDownload).not.toHaveBeenCalled();expect(onMark).not.toHaveBeenCalled();
  expect(screen.getAllByText(/Filed before the app/)).toHaveLength(2);
  fireEvent.click(screen.getByRole('button',{name:'Print filing sheet'}));
  expect(screen.getByRole('dialog',{name:/Filing sheet/})).toBeInTheDocument();expect(screen.getAllByText('₹0.00').length).toBeGreaterThan(0);
});
test('cockpit does not count the firms and shows every shortcut key as a key', () => {
  const {container}=renderApp(<Cockpit data={endFixture()} onOpen={vi.fn()} onDownload={vi.fn()} onMark={vi.fn()} />);
  expect(screen.queryByText(/for the three/)).not.toBeInTheDocument();
  expect([...container.querySelectorAll('kbd')].map(k=>k.textContent)).toEqual(expect.arrayContaining(['J','K','F','D','M','Enter']));
});
test('a completed CA bundle refreshes the Cockpit and later bill changes show its out-of-date warning', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-08T06:00:00Z'));
  vi.mocked(prepareCaBundle).mockResolvedValue({ name: 'GST_Kiran_092026_for_CA.zip', blob: new Blob(['zip']), parts: ['gstr1', 'gstr3b', 'excel'] });
  let bundled = false, changed = false;
  const calls = serve({
    'POST gst/files/bundle/': () => { bundled = true; return { status: 204 }; },
    'GET gst/month-end/': () => {
      const data = endFixture();
      if (bundled) data.firms[0].download = { by: { id: 1, name: 'Kailash' }, at: '2026-10-08T12:00:00+05:30', via: 'download', stale: changed,
        changed: changed ? [{ id: 9, invoice_number: 'KGH/2026-27/9', action: 'updated', at: '2026-10-08T12:01:00+05:30', by: 'Kailash' }] : [] };
      return { status: 200, data };
    },
  });
  function Harness() {
    const query = useGstMonthEnd('2026-09');
    return <><CaBundleButton input={{ businessId: 3, month: '2026-09', short: 'Kiran', gstin: '08VRHFA2322D1ZI', split: false, includeGstr1: true }} />
      <button onClick={() => { changed = true; void query.refetch(); }}>Read changed bills</button>
      {query.data ? <Cockpit data={query.data} onOpen={vi.fn()} onDownload={vi.fn()} onMark={vi.fn()} /> : null}</>;
  }
  renderApp(<Harness />);
  expect(await screen.findByText('Not yet')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'CA bundle' }));
  expect(await screen.findByText(/Downloaded by Kailash/)).toBeInTheDocument();
  expect(calls.find(c => c.url === 'gst/files/bundle/')?.data).toMatchObject({ parts: ['gstr1', 'gstr3b', 'excel'] });
  expect(screen.queryByText(/File out of date/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Read changed bills' }));
  expect(await screen.findByText('File out of date: KGH/2026-27/9 changed since')).toBeInTheDocument();
});
