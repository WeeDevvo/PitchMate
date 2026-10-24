/**
 * The dialog holds focus while open, closes on Escape and on the scrim, and
 * returns focus to the control that opened it.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button, Dialog } from '.';

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const close = () => {
    onClose();
    setOpen(false);
  };
  return (
    <>
      <Button onClick={() => setOpen(true)}>Delete squad</Button>
      <Dialog
        open={open}
        title="Delete this squad?"
        icon="trash"
        tone="danger"
        onClose={close}
        actions={
          <>
            <Button variant="ghost" onClick={close}>
              Keep squad
            </Button>
            <Button variant="destructive">Delete</Button>
          </>
        }
      >
        <p className="pm-dialog__body">Everyone loses access.</p>
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('renders nothing while closed', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is a modal named by its title, with focus on its first control', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete squad' }));

    const dialog = screen.getByRole('dialog', { name: 'Delete this squad?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Keep squad' })).toHaveFocus();
  });

  it('wraps Tab and Shift+Tab inside itself', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete squad' }));

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Keep squad' })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus();
  });

  it('closes on Escape and hands focus back', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Delete squad' });
    await userEvent.click(opener);

    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('closes on a click on the scrim but not inside the panel', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete squad' }));

    await userEvent.click(screen.getByText('Everyone loses access.'));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('dialog').parentElement!);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
