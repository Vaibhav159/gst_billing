import { capturePages, captureRoutes } from './routes';
import { loadedPage } from '@/core/router/lazyPage';
import CapturePage from './CapturePage';
import CaptureInbox from './CaptureInbox';
import FillCapturePage from './FillCapturePage';

test('capture routes use real lazy pages; only fill hides phone navigation', async () => {
  expect(captureRoutes.map(route => route.path)).toEqual(['/capture', '/purchases/capture', '/purchases/inbox', '/purchases/inbox/:id']);
  const capture = captureRoutes[0].element as React.ReactElement;
  const inbox = captureRoutes[2].element as React.ReactElement;
  expect(await loadedPage(capture)).toBe(CapturePage);
  expect(await loadedPage(inbox)).toBe(CaptureInbox);
  expect(await loadedPage(captureRoutes[3].element as React.ReactElement)).toBe(FillCapturePage);
  expect(captureRoutes[3].handle).toEqual({ hideNav: true });
  expect(capturePages).toHaveLength(3);
});
