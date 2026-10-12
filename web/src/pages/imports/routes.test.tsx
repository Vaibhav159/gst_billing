import { isValidElement, Suspense } from 'react';
import { matchRoutes, Outlet } from 'react-router';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mount, serve } from '@/pages/customers/testing';
import { part2dRoutes } from './routes';
import { loadedPage } from '@/core/router/lazyPage';
const open = (path: string) => mount([{ element: <Suspense fallback="Loading page…"><Outlet /></Suspense>, children: part2dRoutes }], [path]);

describe('concrete supplier and import routes', () => {
  it('exports four ready-to-register lazy screens without injected bindings', () => {
    expect(part2dRoutes.map(r => r.path)).toEqual(['/suppliers', '/suppliers/:id', '/import', '/purchases/ai-import']);
    for (const route of part2dRoutes) {
      expect(isValidElement(route.element)).toBe(true);
      if (!isValidElement(route.element)) throw new Error('Missing route element');
      expect(route.element.type).toMatchObject({ $$typeof: Symbol.for('react.lazy'), load: expect.any(Function) });
    }
  });
  it('registers the same lazy elements ahead of the application placeholders', async () => {
    const { appRoutes } = await import('@/core/router/routes');
    for (const route of part2dRoutes) {
      const matches = matchRoutes(appRoutes, route.path!.replace(':id', '21'))!;
      expect(matches[matches.length - 1].route.element).toBe(route.element);
    }
  });
  it('mounts the real file importer through its lazy route', async () => {
    serve({});
    await loadedPage(part2dRoutes[2].element);
    open('/import?type=purchases');
    expect(await screen.findByRole('heading', { name: 'Import from Excel or Tally' })).toBeInTheDocument();
  });
  it('waits for firms before offering photo import', async () => {
    serve({ 'GET firms/': () => new Promise(() => {}) });
    await loadedPage(part2dRoutes[3].element);
    open('/purchases/ai-import');
    expect(await screen.findByText('Loading firms…')).toBeInTheDocument();
    expect(screen.queryByLabelText('Choose files', { exact: true })).not.toBeInTheDocument();
  });
  it('shows the firms load failure instead of offering import with no firms', async () => {
    serve({ 'GET firms/': () => ({ status: 503, data: { detail: 'Try again shortly.' } }) });
    await loadedPage(part2dRoutes[3].element);
    open('/purchases/ai-import');
    expect(await screen.findByText("Couldn't load firms")).toBeInTheDocument();
    expect(screen.queryByLabelText('Choose files', { exact: true })).not.toBeInTheDocument();
  });
  it('mounts the real photo page and editor dependency after the firm query settles', async () => {
    const calls = serve({ 'GET ai-reads/': { month: '2026-10', used: 0 } });
    await loadedPage(part2dRoutes[3].element);
    open('/purchases/ai-import');
    expect(await screen.findByRole('heading', { name: 'Import bill photos' })).toBeInTheDocument();
    expect(screen.getByLabelText('Choose files', { exact: true })).toBeInTheDocument();
    expect(calls.filter(c => c.url === 'firms/')).toHaveLength(1);
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(0);
  });
});
