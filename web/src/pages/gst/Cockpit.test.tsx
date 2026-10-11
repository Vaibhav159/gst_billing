import { fireEvent, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { renderApp } from '@/test/render';
import { endFixture } from '@/core/gst/fixtures';
import { Cockpit } from './Cockpit';
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
