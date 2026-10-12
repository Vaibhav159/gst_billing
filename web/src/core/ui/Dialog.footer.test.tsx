import { fireEvent, screen } from '@testing-library/react';
import { pass } from '@/test/clock';
import { renderApp } from '@/test/render';
import { Button, Dialog } from './index';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test.each([false, true])('a footer requests the same guarded close as the dialog (dirty: %s)', async dirty => {
  const close = vi.fn();
  renderApp(<Dialog open onClose={close} title="Edit record" confirmClose={dirty ? 'Discard these edits?' : undefined}
    footer={requestClose => <Button onClick={requestClose}>Go back</Button>}>
    <input aria-label="Name" defaultValue="Typed name" />
  </Dialog>);
  await pass(400);
  const back = screen.getByRole('button', { name: 'Go back' }); fireEvent.click(back);
  if (dirty) {
    expect(close).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveTextContent('Discard these edits?');
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Typed name'); expect(close).not.toHaveBeenCalled();
    fireEvent.click(back); fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
  }
  expect(close).toHaveBeenCalledOnce();
});
