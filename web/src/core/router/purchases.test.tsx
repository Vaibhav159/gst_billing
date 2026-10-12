import { matchRoutes } from 'react-router';
import { appRoutes, V2_REDIRECTS } from './routes';
test('purchases list, detail and forms are real lazy pages, with the phone tabs hidden only on forms', () => {
  for (const path of ['/purchases', '/purchases/905', '/purchases/new', '/purchases/905/edit']) {
    const route = matchRoutes(appRoutes, path)?.at(-1)?.route;
    expect(route?.element).toBeTruthy();
    const element = route?.element as { props: Record<string, unknown> };
    expect(element.props).not.toHaveProperty('part');
    expect(route?.handle?.hideNav ?? false).toBe(path.endsWith('/new') || path.endsWith('/edit'));
  }
});
test('v2 inward routes open the purchase and preserve route ID', () => {
  expect(V2_REDIRECTS.find(([path]) => path === '/inward-bills/:id')?.[1]({ id: '905' })).toBe('/purchases/905');
  expect(V2_REDIRECTS.find(([path]) => path === '/billing/inward-bills/:id')?.[1]({ id: '905' })).toBe('/purchases/905');
});
