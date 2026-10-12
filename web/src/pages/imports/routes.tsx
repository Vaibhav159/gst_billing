import type { RouteObject } from 'react-router';
import { lazyPage } from '@/core/router/lazyPage';
const Suppliers = lazyPage(async () => ({ default: (await import('@/pages/suppliers/Suppliers')).SupplierList }));
const Supplier = lazyPage(async () => ({ default: (await import('@/pages/suppliers/Suppliers')).SupplierDetail }));
const ImportPage = lazyPage(() => import('./ImportPage'));
const Photos = lazyPage(() => import('./photos/PhotoPage'));
/** Each page and its shared editors load only when the route opens (X-47). */
export const part2dRoutes: RouteObject[] = [
  { path: '/suppliers', element: <Suppliers /> },
  { path: '/suppliers/:id', element: <Supplier /> },
  { path: '/import', element: <ImportPage /> },
  { path: '/purchases/ai-import', element: <Photos /> },
];
