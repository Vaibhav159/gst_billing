import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, type DataRouter } from 'react-router';
import { ToastProvider } from '@/core/ui';
import { RootLayout } from './AppLayout';
import { ScreenBoundary } from './ScreenBoundary';

const host = vi.hoisted(() => ({ mounted: vi.fn(), unmounted: vi.fn() }));
vi.mock('@/core/captures/useUploads', async () => {
  const { useEffect, useState } = await import('react');
  return { CaptureUploadHost: function Host() {
    const [failed, setFailed] = useState(false);
    useEffect(() => { host.mounted(); return () => { host.unmounted(); }; }, []);
    if (failed) throw new Error('Capture host failed to load');
    return <button onClick={() => setFailed(true)}>Fail capture host</button>;
  } };
});

const routers: DataRouter[] = [];
afterEach(() => { cleanup(); routers.splice(0).forEach(router => router.dispose()); vi.restoreAllMocks(); vi.clearAllMocks(); });

function TypedPage() {
  const [text, setText] = useState('');
  return <><h1>Unsaved bill</h1><label>Bill note<input value={text} onChange={event => setText(event.target.value)} /></label></>;
}
function mount(path: string) {
  // The outer boundary represents the app's root fallback. A background failure must not reach it.
  const router = createMemoryRouter([{ element: <ScreenBoundary><RootLayout /></ScreenBoundary>, children: [
    { path: '/purchases/capture', element: <h1>Capture route</h1> },
    { path: '/sales/new', element: <TypedPage /> },
    { path: '/login', element: <h1>Sign in</h1> },
  ] }], { initialEntries: [path] });
  routers.push(router);
  const view = render(<ToastProvider><RouterProvider router={router} /></ToastProvider>);
  return { router, ...view };
}

test('one root upload host stays mounted from Capture to another page and sign-in', async () => {
  const view = mount('/purchases/capture');
  await screen.findByRole('button', { name: 'Fail capture host' });
  expect(host.mounted).toHaveBeenCalledOnce();
  await act(async () => { await view.router.navigate('/sales/new'); });
  expect(screen.getByRole('heading', { name: 'Unsaved bill' })).toBeInTheDocument();
  await act(async () => { await view.router.navigate('/login'); });
  expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  expect(host.mounted).toHaveBeenCalledOnce();
  expect(host.unmounted).not.toHaveBeenCalled();
  view.unmount();
  expect(host.unmounted).toHaveBeenCalledOnce();
});

test('a failed upload host keeps the unrelated route and its typed work mounted', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const { router } = mount('/sales/new');
  await screen.findByRole('button', { name: 'Fail capture host' });
  const note = screen.getByRole('textbox', { name: 'Bill note' });
  fireEvent.change(note, { target: { value: 'Keep these unsaved bill details' } });
  fireEvent.click(screen.getByRole('button', { name: 'Fail capture host' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('heading', { name: 'Unsaved bill' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Bill note' })).toBe(note);
  expect(note).toHaveValue('Keep these unsaved bill details');
  expect(screen.getByRole('button', { name: 'Reload the app' })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/sales/new');
  await waitFor(() => expect(host.unmounted).toHaveBeenCalledOnce());
  await act(async () => { await router.navigate('/login'); });
  expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
});
