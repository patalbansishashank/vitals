import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { CirclePause, ClipboardCheck, CloudAlert, Inbox, ScanSearch, Settings, WifiOff } from 'lucide-react';
import { Chip, EmptyStage, Faceplate, IconKey, Key, Menu, Notice, ResponsivePanel, Sheet, StatusCapsule, Toaster, dismissToast, toast, type MenuEntry } from '@/components';
import { StatusSlotProvider, useStatusSlot } from '@/components/StatusCapsule';

describe('Menu (the one ⋯): dividers, sections, icons', () => {
  function Harness({ items }: { items: MenuEntry[] }) {
    return <Menu label="More" items={items} trigger={(p) => <IconKey {...p} icon={Settings} label="More" />} />;
  }

  it('splits page actions from global items with a hairline and labels a section as a group', async () => {
    const user = userEvent.setup();
    const picked: string[] = [];
    const sel = (id: string) => () => picked.push(id);
    render(
      <Harness
        items={[
          { id: 'replan', label: 'Re-plan the rest', onSelect: sel('replan') },
          { id: 'away', label: 'I’m busy or away', onSelect: sel('away') },
          { kind: 'divider', id: 'd1' },
          { id: 'settings', label: 'Settings', icon: Settings, onSelect: sel('settings') },
          { kind: 'section', id: 's1', label: 'Planning' },
          { id: 'tools', label: 'Planning tools', onSelect: sel('tools') },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'More' }));
    const menu = screen.getByRole('menu', { name: 'More' });
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Re-plan the rest', 'I’m busy or away', 'Settings', 'Planning tools']);
    // one rule for the divider, one above the (non-first) section
    expect(within(menu).getAllByRole('separator')).toHaveLength(2);
    const group = within(menu).getByRole('group', { name: 'Planning' });
    expect(within(group).getByRole('menuitem', { name: 'Planning tools' })).toBeInTheDocument();
    // the optional icon renders inside the item, decorative
    expect(within(menu).getByRole('menuitem', { name: 'Settings' }).querySelector('svg')).not.toBeNull();
    // arrow keys still walk every item across groups
    expect(within(menu).getAllByRole('menuitem')[0]).toHaveFocus();
    await user.keyboard('{End}');
    expect(within(menu).getByRole('menuitem', { name: 'Planning tools' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(picked).toEqual(['tools']);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('draws no rule for a leading or trailing divider', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        items={[
          { kind: 'divider', id: 'd0' },
          { id: 'a', label: 'Alpha', onSelect: () => undefined },
          { kind: 'divider', id: 'd1' },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(within(screen.getByRole('menu')).queryAllByRole('separator')).toHaveLength(0);
  });
});

describe('StatusCapsule (the header status icon, SPEC §9)', () => {
  it('is an icon button without words: its label is the accessible name; the gold dot only when it wants attention', async () => {
    const user = userEvent.setup();
    let opened = 0;
    const { container } = render(
      <>
        <StatusCapsule icon={ClipboardCheck} label="Weekly check-in ready" attention aria-haspopup="dialog" onClick={() => opened++} />
        <StatusCapsule icon={CirclePause} label="Plan paused" onClick={() => {}} />
      </>,
    );
    const checkIn = screen.getByRole('button', { name: 'Weekly check-in ready' });
    expect(checkIn).toHaveClass('lm-status-icon');
    expect(checkIn).toHaveTextContent('');
    expect(checkIn.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(checkIn).toHaveAttribute('aria-haspopup', 'dialog');
    expect(checkIn.querySelector('.lm-status-icon__dot')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('button', { name: 'Plan paused' }).querySelector('.lm-status-icon__dot')).toBeNull();
    await user.click(checkIn);
    expect(opened).toBe(1);
    expect(container.querySelectorAll('.lm-capsule')).toHaveLength(0);
  });

  it('is a link with `to`; `pulse` breathes its dot and `tone="danger"` turns it rose', () => {
    render(
      <MemoryRouter>
        <StatusCapsule icon={CirclePause} label="Plan paused" to="/plan/active" />
        <StatusCapsule icon={ScanSearch} label="Long search 40 %" pulse to="/plan/run" />
        <StatusCapsule icon={CloudAlert} label="Sync: Error" attention tone="danger" to="/settings/sync" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Plan paused' })).toHaveAttribute('href', '/plan/active');
    expect(screen.getByRole('link', { name: 'Long search 40 %' }).querySelector('.lm-status-icon__dot')).toHaveAttribute('data-pulse', 'true');
    expect(screen.getByRole('link', { name: 'Sync: Error' })).toHaveAttribute('data-tone', 'danger');
  });

  it('shows its label as a tooltip on hover', async () => {
    const user = userEvent.setup();
    render(<StatusCapsule icon={Inbox} label="2 changes waiting" attention onClick={() => {}} />);
    await user.hover(screen.getByRole('button', { name: '2 changes waiting' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('2 changes waiting');
  });

  it('a long-press on touch shows the tooltip and does not press it', () => {
    vi.useFakeTimers();
    try {
      let opened = 0;
      render(<StatusCapsule icon={Inbox} label="2 changes waiting" attention onClick={() => opened++} />);
      const key = screen.getByRole('button', { name: '2 changes waiting' });
      fireEvent.pointerDown(key, { pointerType: 'touch', clientX: 10, clientY: 10 });
      act(() => vi.advanceTimersByTime(600));
      expect(screen.getByRole('tooltip')).toHaveTextContent('2 changes waiting');
      fireEvent.pointerUp(key, { pointerType: 'touch' });
      fireEvent.pointerLeave(key, { pointerType: 'touch' });
      fireEvent.click(key);
      expect(opened).toBe(0);
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(2000));
      expect(screen.queryByRole('tooltip')).toBeNull();
      // a plain tap still presses it
      fireEvent.pointerDown(key, { pointerType: 'touch', clientX: 10, clientY: 10 });
      fireEvent.pointerUp(key, { pointerType: 'touch' });
      fireEvent.click(key);
      expect(opened).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('with nothing to open, a press shows what it means', async () => {
    const user = userEvent.setup();
    render(<StatusCapsule icon={WifiOff} label="You’re offline" />);
    await user.click(screen.getByRole('button', { name: 'You’re offline' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('You’re offline');
  });

  it('in a slot, shows at most the limit (attention first, then order) and hands the rest over', async () => {
    const user = userEvent.setup();
    const picked: string[] = [];
    function Slot({ limit }: { limit: number }) {
      const slot = useStatusSlot(limit);
      return (
        <>
          <StatusSlotProvider value={slot.value}>
            <StatusCapsule icon={CirclePause} label="Plan paused" onClick={() => picked.push('paused')} />
            <StatusCapsule icon={ClipboardCheck} label="Weekly check-in ready" attention onClick={() => picked.push('checkIn')} />
            <StatusCapsule icon={WifiOff} label="You’re offline" />
            <StatusCapsule icon={Inbox} label="2 changes waiting" attention onClick={() => picked.push('changes')} />
          </StatusSlotProvider>
          <ul aria-label="moved">
            {slot.overflow.map((e) => (
              <li key={e.id}>
                <button type="button" disabled={!e.select} onClick={() => e.select?.()}>
                  {e.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      );
    }
    const { rerender } = render(<Slot limit={2} />);
    const shown = () => screen.queryAllByRole('button').filter((b) => b.classList.contains('lm-status-icon')).map((b) => b.getAttribute('aria-label'));
    await waitFor(() => expect(shown()).toEqual(['Weekly check-in ready', '2 changes waiting']));
    const moved = within(screen.getByRole('list', { name: 'moved' }));
    expect(moved.getAllByRole('button').map((b) => b.textContent)).toEqual(['Plan paused', 'You’re offline']);
    expect(moved.getByRole('button', { name: 'You’re offline' })).toBeDisabled();
    // the moved item does what the icon does
    await user.click(moved.getByRole('button', { name: 'Plan paused' }));
    expect(picked).toEqual(['paused']);
    rerender(<Slot limit={1} />);
    await waitFor(() => expect(shown()).toEqual(['Weekly check-in ready']));
  });
});

describe('Chip kind="status"', () => {
  it('draws a 6 px severity dot instead of a mark', () => {
    const { container } = render(
      <Chip kind="status" severity="caution">
        Not backed up yet
      </Chip>,
    );
    const chip = container.querySelector('.lm-chip')!;
    expect(chip).toHaveAttribute('data-severity', 'caution');
    expect(chip.querySelector('.lm-chip__dot')).not.toBeNull();
    expect(chip.querySelector('svg')).toBeNull();
  });
});

describe('Notice (banner)', () => {
  it('has no icon for info and ok, the drawn mark for caution and danger', () => {
    const { container, rerender } = render(<Notice severity="info" title="Update available" />);
    const notice = () => container.querySelector('.lm-notice')!;
    expect(notice().querySelector('.lm-notice__mark')).toBeNull();
    expect(notice()).not.toHaveAttribute('data-mark');
    expect(screen.getByText('Note:')).toHaveClass('lm-sr');
    rerender(<Notice severity="danger" title="Energy is under 800 kcal" />);
    expect(notice().querySelector('.lm-notice__mark svg')).not.toBeNull();
    expect(notice()).toHaveAttribute('data-mark', 'true');
  });
});

describe('Key', () => {
  it('accepts the Ember variants and no longer draws the indicator light', () => {
    render(
      <>
        <Key variant="primary">Log meal</Key>
        <Key variant="action">Start fast</Key>
        <Key variant="text">Add food</Key>
        <Key variant="outlined" indicator>
          Edit
        </Key>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Log meal' })).toHaveAttribute('data-variant', 'primary');
    expect(screen.getByRole('button', { name: 'Start fast' })).toHaveAttribute('data-variant', 'action');
    expect(screen.getByRole('button', { name: 'Add food' })).toHaveAttribute('data-variant', 'text');
    const edit = screen.getByRole('button', { name: 'Edit' });
    expect(edit).toHaveAttribute('data-variant', 'outlined');
    expect(edit.querySelector('.lm-key__dot')).toBeNull();
  });
});

describe('Faceplate', () => {
  it('renders the caption as a fact line under the title, with no divider element', () => {
    const { container } = render(<Faceplate title="Adherence" caption="6 of 7 days logged" />);
    const label = container.querySelector('.lm-face-head__label')!;
    expect(label.children[0]).toHaveTextContent('Adherence');
    expect(label.children[1]).toHaveClass('lm-eng');
    expect(label.children[1]).toHaveTextContent('6 of 7 days logged');
  });
});

describe('EmptyStage', () => {
  it('is one fact and one action, without art or the perforated stage by default', () => {
    const { container } = render(<EmptyStage title="No meals logged" action={<Key>Log meal</Key>} perforated />);
    const el = container.querySelector('.lm-empty')!;
    expect(el).not.toHaveClass('lm-stage');
    expect(el.querySelector('.lm-empty__art')).toBeNull();
    expect(screen.getByRole('heading', { name: 'No meals logged' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log meal' })).toBeInTheDocument();
  });
});

describe('Sheet header row', () => {
  function Confirm({ onDone }: { onDone: () => void }) {
    const [open, setOpen] = useState(true);
    return (
      <Sheet open={open} onClose={() => setOpen(false)} title="Log weight" onDone={onDone}>
        <p>body</p>
      </Sheet>
    );
  }

  it('is Cancel · title · Done with onDone; Cancel closes', async () => {
    const user = userEvent.setup();
    let done = 0;
    render(<Confirm onDone={() => done++} />);
    const sheet = screen.getByRole('dialog', { name: 'Log weight' });
    expect(within(sheet).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Done' }));
    expect(done).toBe(1);
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps title · Close without onDone (ResponsivePanel below 1024 px too)', () => {
    render(
      <ResponsivePanel open onClose={() => undefined} title="Pantry">
        <p>body</p>
      </ResponsivePanel>,
    );
    const sheet = screen.getByRole('dialog', { name: 'Pantry' });
    expect(within(sheet).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
  });

  it('one grammar for Sheet and SidePanel (r068 L1/L19): title · Cancel in the head, the commit a filled primary key at a phone sheet’s foot', () => {
    render(
      <ResponsivePanel open onClose={() => undefined} title="Pause plan" onDone={() => undefined} doneLabel="Pause">
        <p>body</p>
      </ResponsivePanel>,
    );
    const sheet = screen.getByRole('dialog', { name: 'Pause plan' });
    const head = sheet.querySelector('.lm-panel__head')!;
    expect(head).toHaveAttribute('data-confirm', 'true');
    const cells = Array.from(head.children).filter((c) => !c.classList.contains('lm-sr'));
    expect(cells.map((c) => c.textContent)).toEqual(['Pause plan', 'Cancel']);
    expect(cells[0]).toHaveClass('lm-panel__title');
    expect(within(cells[1] as HTMLElement).getByRole('button', { name: 'Cancel' })).toHaveClass('lm-panel__cancel');
    const done = within(sheet).getByRole('button', { name: 'Pause' });
    expect(done).toHaveClass('lm-panel__done');
    expect(done).toHaveAttribute('data-variant', 'primary');
    expect(done).toHaveAttribute('data-block', 'true');
    expect(done.closest('.lm-panel__foot')).not.toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });

  // jsdom/user-event only looks for submit keys inside the <form>, so implicit submission (Enter) through the
  // form-associated header key is checked in a real browser, not here.
  it('doneForm: the verb is the body form’s submit key and submits it once', async () => {
    const user = userEvent.setup();
    let saved = 0;
    render(
      <Sheet open onClose={() => undefined} title="Weight" doneForm="weigh" doneLabel="Save">
        <form
          id="weigh"
          onSubmit={(e) => {
            e.preventDefault();
            saved++;
          }}
        >
          <input aria-label="Weight" />
          <input aria-label="Note" />
        </form>
      </Sheet>,
    );
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toHaveAttribute('type', 'submit');
    expect(save).toHaveAttribute('form', 'weigh');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    await user.click(save);
    expect(saved).toBe(1);
  });

  it('doneDisabledReason keeps the verb focusable and inert: clicking it does not submit the form', async () => {
    const user = userEvent.setup();
    let saved = 0;
    render(
      <Sheet open onClose={() => undefined} title="What did you eat?" doneForm="log" doneLabel="Log" doneDisabledReason="Search or describe a food first.">
        <form
          id="log"
          onSubmit={(e) => {
            e.preventDefault();
            saved++;
          }}
        >
          <input aria-label="Search foods" />
          <input aria-label="Describe it" />
        </form>
      </Sheet>,
    );
    const log = screen.getByRole('button', { name: 'Log' });
    expect(log).toHaveAttribute('aria-disabled', 'true');
    await user.click(log);
    expect(saved).toBe(0);
  });

  it('a disabled Done stays focusable and does nothing', async () => {
    const user = userEvent.setup();
    let done = 0;
    render(
      <Sheet open onClose={() => undefined} title="Log weight" onDone={() => done++} doneDisabled doneLabel="Save">
        <p>body</p>
      </Sheet>,
    );
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toHaveAttribute('aria-disabled', 'true');
    await user.click(save);
    expect(done).toBe(0);
  });
});

describe('toast (snackbar)', () => {
  it('shows one at a time: a new toast replaces the last', () => {
    render(<Toaster />);
    let second = '';
    act(() => {
      toast('Meal logged');
      second = toast('Day marked as planned', { action: { label: 'Undo', onClick: () => undefined } });
    });
    expect(screen.queryByText('Meal logged')).not.toBeInTheDocument();
    const msg = screen.getByText('Day marked as planned');
    expect(within(msg.parentElement!).getByRole('button', { name: 'Undo' })).toHaveAttribute('data-variant', 'text');
    act(() => dismissToast(second));
    expect(screen.queryByText('Day marked as planned')).not.toBeInTheDocument();
  });
});
