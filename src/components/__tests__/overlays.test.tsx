import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, Key, Sheet, TextInput } from '@/components';

function DialogHarness({ dismissible = true }: { dismissible?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Key onClick={() => setOpen(true)}>Reset everything</Key>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        dismissible={dismissible}
        title="Reset everything?"
        footer={
          <>
            <Key onClick={() => setOpen(false)}>Cancel</Key>
            <Key variant="danger">Delete everything</Key>
          </>
        }
      >
        <TextInput aria-label="confirmation" />
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('opens with focus on the title, traps Tab inside and closes on Escape, restoring focus', async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const trigger = screen.getByRole('button', { name: 'Reset everything' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Reset everything?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Reset everything?' })).toHaveFocus();

    // Tab cycles: close key → input → Cancel → Delete → back to close key
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('textbox', { name: 'confirmation' })).toHaveFocus();
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Delete everything' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Delete everything' })).toHaveFocus();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('ignores Escape when not dismissible (first-run consent)', async () => {
    const user = userEvent.setup();
    render(<DialogHarness dismissible={false} />);
    await user.click(screen.getByRole('button', { name: 'Reset everything' }));
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    await act(() => new Promise((r) => setTimeout(r, 250)));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

function SheetHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Key onClick={() => setOpen(true)}>Edit day</Key>
      <Sheet open={open} onClose={() => setOpen(false)} title="Tue 14 Oct" footer={<Key onClick={() => setOpen(false)}>Done</Key>}>
        <TextInput aria-label="note" />
      </Sheet>
    </>
  );
}

describe('Sheet', () => {
  it('is modal at the default detent, traps focus and closes on Escape', async () => {
    const user = userEvent.setup();
    render(<SheetHarness />);
    await user.click(screen.getByRole('button', { name: 'Edit day' }));
    const sheet = screen.getByRole('dialog', { name: 'Tue 14 Oct' });
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(sheet).toHaveAttribute('data-detent', 'half');
    expect(screen.getByRole('heading', { name: 'Tue 14 Oct' })).toHaveFocus();
    // last tabbable wraps to the first
    screen.getByRole('button', { name: 'Done' }).focus();
    await user.tab();
    expect(sheet.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Edit day' })).toHaveFocus();
  });
});

describe('focus return with a browser-like showModal (V1h)', () => {
  // Chromium's showModal() moves focus into the dialog before React's effects run; jsdom has no showModal.
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  const saved = { showModal: proto.showModal, close: proto.close };
  beforeEach(() => {
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
      (this.querySelector('button, input') as HTMLElement | null)?.focus();
    };
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    };
  });
  afterEach(() => Object.assign(proto, saved));

  it('Escape on a sheet returns focus to the key that opened it', async () => {
    const user = userEvent.setup();
    render(<SheetHarness />);
    const opener = screen.getByRole('button', { name: 'Edit day' });
    opener.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
