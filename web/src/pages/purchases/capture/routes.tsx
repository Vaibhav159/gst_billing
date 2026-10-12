import type { RouteObject } from 'react-router';
import { lazyPage } from '@/core/router/lazyPage';
const CapturePage = lazyPage(() => import('./CapturePage'));
const CaptureInbox = lazyPage(() => import('./CaptureInbox'));
const FillCapturePage = lazyPage(() => import('./FillCapturePage'));
export const capturePages = [CapturePage, CaptureInbox, FillCapturePage];
export const captureRoutes: RouteObject[] = [
  { path: '/capture', element: <CapturePage /> },
  { path: '/purchases/capture', element: <CapturePage /> },
  { path: '/purchases/inbox', element: <CaptureInbox /> },
  { path: '/purchases/inbox/:id', element: <FillCapturePage />, handle: { hideNav: true } },
];
