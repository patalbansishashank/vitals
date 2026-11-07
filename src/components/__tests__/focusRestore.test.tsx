/**
 * Focus returns to the opener when a sheet, a panel or a dialog closes (r071 audit B P1-1: after a phone Sheet closed on
 * Today, Train and Ring, `document.activeElement` was <body> for good). jsdom has no showModal and does not inert the
 * page, so the harness below behaves like a browser where it matters:
 * - `showModal()` opens the dialog and moves focus into it (before React's effects run, as Chromium does);
 * - while a modal dialog is open and attached, `focus()` on an element outside it does nothing (the page is blocked);
 * - removing the dialog from the DOM without close() restores nothing by itself (the native "previously focused
 *   element" only comes back through close()), which is how our Sheet and Dialog unmount after their exit.
 * One test per host, each also under React.StrictMode (development runs every effect twice on mount), plus the two
 * causes found: a host that closes by unmounting the overlay, and a screen that paints at 120 Hz.
 */
import { StrictMode, useState, type ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, Key, ResponsivePanel, Sheet, SidePanel } from '@/components';

// these tests wait like a person does (a sheet is read for seconds before it is closed), so they get more than 5 s under load
vi.setConfig({ testTimeout: 30_000 });

const dialogProto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
const elementProto = HTMLElement.prototype as unknown as { focus: (this: HTMLElement, o?: FocusOptions) => void };
const saved = { showModal: dialogProto.showModal, close: dialogProto.close, focus: elementProto.focus, matchMedia: window.matchMedia };
let modal: HTMLDialogElement | null = null;
const setModal = (d: HTMLDialogElement | null) => {
  modal = d;
};

beforeEach(() => {
  modal = null;
  dialogProto.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
    setModal(this);
    (this.querySelector('button, input') as HTMLElement | null)?.focus();
  };
  dialogProto.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    if (modal === this) setModal(null);
  };
  elementProto.focus = function (this: HTMLElement, o?: FocusOptions) {
    // the page behind a modal dialog is blocked: focus() on it is a no-op until the dialog is closed or removed
    if (modal && modal.isConnected && !modal.contains(this)) return;
    saved.focus.call(this, o);
  };
});
afterEach(() => {
  Object.assign(dialogProto, { showModal: saved.showModal, close: saved.close });
  elementProto.focus = saved.focus;
  window.matchMedia = saved.matchMedia;
});

/** How long a person looks at a sheet before closing it: longer than the 40 frames the first restore tried (≈ 0.7 s). */
const READING = 750;

/** Open from the keyboard, read for a while, press Escape, and expect the opener to hold focus again. */
async function opensAndRestores(ui: ReactNode, role: 'dialog' | 'complementary' = 'dialog') {
  const user = userEvent.setup();
  render(ui);
  const key = screen.getByRole('button', { name: 'Open it' });
  key.focus();
  expect(key).toHaveFocus();
  await user.keyboard('{Enter}');
  const panel = screen.getByRole(role, { hidden: true });
  expect(panel.contains(document.activeElement)).toBe(true);
  // React StrictMode's second round of effects (development) used to overwrite the captured opener with the dialog's
  // own title; the spurious restore that round started covered for it for 40 frames, so the bug only showed when the
  // sheet had been open longer than that, as in a real session
  await act(() => new Promise((r) => setTimeout(r, READING)));
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole(role, { hidden: true })).not.toBeInTheDocument());
  await waitFor(() => expect(key).toHaveFocus());
}

function Controlled({ children }: { children: (p: { open: boolean; close: () => void }) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Key onClick={() => setOpen(true)}>Open it</Key>
      {children({ open, close: () => setOpen(false) })}
    </>
  );
}

/** The host that closes by unmounting: `{sheet && <ResponsivePanel open …>}` (Today's sheets, Train, Ring). */
function Conditional({ children }: { children: (p: { close: () => void }) => ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <>
      <Key onClick={() => setShown(true)}>Open it</Key>
      {shown ? children({ close: () => setShown(false) }) : null}
    </>
  );
}

/** A sheet whose action closes it and opens the next one (a program's sheet → "Edit all days" → the day editor). */
function Chain() {
  const [step, setStep] = useState<null | 'first' | 'second'>(null);
  return (
    <>
      <Key onClick={() => setStep('first')}>Open it</Key>
      {step === 'first' ? (
        <Sheet open onClose={() => setStep(null)} title="Program A">
          <Key onClick={() => setStep('second')}>Edit all days</Key>
        </Sheet>
      ) : null}
      {step === 'second' ? (
        <Sheet open onClose={() => setStep(null)} title="Day editor">
          <input aria-label="note" />
        </Sheet>
      ) : null}
    </>
  );
}

/** A dialog opened from a key inside an open sheet (a confirmation on a row's sheet). */
function Nested() {
  const [sheet, setSheet] = useState(false);
  const [dialog, setDialog] = useState(false);
  return (
    <>
      <Key onClick={() => setSheet(true)}>Open it</Key>
      {sheet ? (
        <Sheet open onClose={() => setSheet(false)} title="Row">
          <Key onClick={() => setDialog(true)}>Delete</Key>
          <Dialog open={dialog} onClose={() => setDialog(false)} title="Delete it?" footer={<Key onClick={() => setDialog(false)}>Cancel</Key>}>
            <p>This cannot be undone.</p>
          </Dialog>
        </Sheet>
      ) : null}
    </>
  );
}

const desktop = () => {
  window.matchMedia = ((query: string) => ({
    matches: /min-width: (64rem|80rem)/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
};

describe.each([
  ['plain', (ui: ReactNode) => ui],
  ['StrictMode', (ui: ReactNode) => <StrictMode>{ui}</StrictMode>],
])('focus returns to the opener (%s)', (_name, wrap) => {
  it('Sheet, controlled', async () => {
    await opensAndRestores(
      wrap(
        <Controlled>
          {({ open, close }) => (
            <Sheet open={open} onClose={close} title="Edit day">
              <input aria-label="note" />
            </Sheet>
          )}
        </Controlled>,
      ),
    );
  });

  it('Sheet, closed by unmounting it', async () => {
    await opensAndRestores(
      wrap(
        <Conditional>
          {({ close }) => (
            <Sheet open onClose={close} title="Edit day">
              <input aria-label="note" />
            </Sheet>
          )}
        </Conditional>,
      ),
    );
  });

  it('ResponsivePanel below 1024 px (a sheet), closed by unmounting it', async () => {
    await opensAndRestores(
      wrap(
        <Conditional>
          {({ close }) => (
            <ResponsivePanel open onClose={close} title="Log an activity">
              <input aria-label="note" />
            </ResponsivePanel>
          )}
        </Conditional>,
      ),
    );
  });

  it('SidePanel (desktop, non-modal)', async () => {
    await opensAndRestores(
      wrap(
        <Controlled>
          {({ open, close }) => (
            <SidePanel open={open} onClose={close} title="Explain">
              <input aria-label="note" />
            </SidePanel>
          )}
        </Controlled>,
      ),
      'complementary',
    );
  });

  it('ResponsivePanel from 1024 px (a side panel), closed by unmounting it', async () => {
    desktop();
    const user = userEvent.setup();
    render(
      wrap(
        <Conditional>
          {({ close }) => (
            <ResponsivePanel open onClose={close} title="Log an activity">
              <input aria-label="note" />
            </ResponsivePanel>
          )}
        </Conditional>,
      ),
    );
    const key = screen.getByRole('button', { name: 'Open it' });
    key.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    await act(() => new Promise((r) => setTimeout(r, READING)));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeInTheDocument());
    await waitFor(() => expect(key).toHaveFocus());
  });

  it('keeps a desktop panel in the overlay portal even when an older caller requests docking', () => {
    desktop();
    render(
      <main className="lm-main" data-testid="underlying-page">
        <ResponsivePanel open onClose={() => undefined} title="About Steps" dockAtXl>
          <p>Explanation</p>
        </ResponsivePanel>
      </main>,
    );
    const panel = screen.getByRole('complementary', { name: 'About Steps' });
    expect(panel).toHaveAttribute('data-mode', 'overlay');
    expect(screen.getByTestId('underlying-page')).not.toContainElement(panel);
  });

  it('a sheet that closes as the next one opens: nothing steals focus from the second, and closing it, however long after, returns to the FIRST opener', async () => {
    const user = userEvent.setup();
    render(wrap(<Chain />));
    const key = screen.getByRole('button', { name: 'Open it' });
    key.focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Edit all days' }));
    const editor = await screen.findByRole('dialog', { name: 'Day editor', hidden: true });
    // a person is in the editor for longer than any retry window (1.5 s): the first opener must be handed over, not retried
    await act(() => new Promise((r) => setTimeout(r, 1800)));
    // the first sheet's opener was not focused behind the editor (it would have been, without the hand-over)
    expect(editor.contains(document.activeElement)).toBe(true);
    expect(key).not.toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument());
    await waitFor(() => expect(key).toHaveFocus());
  });

  it('a dialog opened from a key inside an open sheet returns focus to that key, and the sheet stays open', async () => {
    const user = userEvent.setup();
    render(wrap(<Nested />));
    const key = screen.getByRole('button', { name: 'Open it' });
    key.focus();
    await user.keyboard('{Enter}');
    const del = await screen.findByRole('button', { name: 'Delete' });
    del.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: 'Delete it?', hidden: true });
    await act(() => new Promise((r) => setTimeout(r, READING)));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete it?', hidden: true })).not.toBeInTheDocument());
    await waitFor(() => expect(del).toHaveFocus());
    expect(screen.getByRole('dialog', { name: 'Row', hidden: true })).toBeInTheDocument();
    // and closing the sheet still goes back to the key that opened it
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument());
    await waitFor(() => expect(key).toHaveFocus());
  });

  it('Dialog', async () => {
    await opensAndRestores(
      wrap(
        <Controlled>
          {({ open, close }) => (
            <Dialog open={open} onClose={close} title="Reset everything?" footer={<Key onClick={close}>Cancel</Key>}>
              <input aria-label="confirmation" />
            </Dialog>
          )}
        </Controlled>,
      ),
    );
  });
});

describe('a host that places focus itself wins over the automatic restore', () => {
  it('after a close the host moves focus to another key (the Simulator: "keeping it returns focus to its row"): the restore leaves it there', async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      const [elsewhere, setElsewhere] = useState(0);
      return (
        <>
          <Key onClick={() => setOpen(true)}>Open it</Key>
          <button
            type="button"
            ref={(el) => {
              if (el && elsewhere > 0) el.focus();
            }}
          >
            Elsewhere
          </button>
          {open ? (
            <Sheet
              open
              onClose={() => {
                setOpen(false);
                setElsewhere((n) => n + 1);
              }}
              title="Row"
            >
              <input aria-label="note" />
            </Sheet>
          ) : null}
        </>
      );
    }
    const user = userEvent.setup();
    render(<Host />);
    const key = screen.getByRole('button', { name: 'Open it' });
    key.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('dialog', { hidden: true });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument());
    await act(() => new Promise((r) => setTimeout(r, 300))); // the deferred restore has had its chance
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
    expect(key).not.toHaveFocus();
  });
});

describe('the restore does not depend on the frame rate', () => {
  it('a 120 Hz screen (a frame every 4 ms) still gets focus back after the 320 ms exit', async () => {
    const raf = window.requestAnimationFrame;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 4)) as typeof window.requestAnimationFrame;
    try {
      await opensAndRestores(
        <Controlled>
          {({ open, close }) => (
            <Sheet open={open} onClose={close} title="Edit day">
              <input aria-label="note" />
            </Sheet>
          )}
        </Controlled>,
      );
    } finally {
      window.requestAnimationFrame = raf;
    }
  });
});

describe('when the opener is replaced while the sheet is open', () => {
  it('focus goes to the element that took its place (same id)', async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      const [version, setVersion] = useState(0);
      return (
        <>
          {/* a new element every time `version` changes, as a card that re-renders into its "logged" state */}
          <button key={version} id="log-weight" type="button" onClick={() => setOpen(true)}>
            Open it
          </button>
          <Sheet
            open={open}
            onClose={() => {
              setOpen(false);
              setVersion((v) => v + 1);
            }}
            title="Weigh in"
          >
            <input aria-label="weight" />
          </Sheet>
        </>
      );
    }
    const user = userEvent.setup();
    render(<Host />);
    const first = screen.getByRole('button', { name: 'Open it' });
    first.focus();
    await user.keyboard('{Enter}');
    await act(() => new Promise((r) => setTimeout(r, READING)));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument());
    const second = screen.getByRole('button', { name: 'Open it' });
    expect(second).not.toBe(first);
    await waitFor(() => expect(second).toHaveFocus());
  });
});
