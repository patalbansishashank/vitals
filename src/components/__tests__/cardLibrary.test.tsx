/**
 * The card library (r071 0B, AUDIT §2.4, §2.5): the generalised MonitorSheet. Sections, locked hero, unavailable cards
 * with their reasons, sizes, search, the foot's count and Reset, and every behaviour MonitorSheet had (the keyboard
 * reorder, the remembered place, `max`).
 */
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Activity, Flame, Footprints, Moon, Scale, Utensils } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import {
  CardLibrary,
  SEARCH_ABOVE,
  defaultSelection,
  filterItems,
  groupItems,
  sameSelection,
  sizeOf,
  type CardLibraryProps,
  type LibraryItem,
  type LibrarySelection,
} from '../CardLibrary';

const ITEMS: LibraryItem[] = [
  { id: 'hero', label: 'Today', hue: 'plan', group: 'Plan', locked: true, description: 'Next up, the day and the next rows' },
  { id: 'eaten', label: 'Eaten so far', icon: Utensils, hue: 'food', group: 'Food', default: true, description: 'Energy and protein against today’s targets' },
  { id: 'energy', label: 'Energy', icon: Flame, hue: 'energy', group: 'Energy', default: true, valueText: '1 096 kcal' },
  { id: 'sleep', label: 'Sleep', icon: Moon, hue: 'sleep', group: 'Sleep', default: true, unavailable: 'Needs a ring' },
  { id: 'steps', label: 'Steps', icon: Footprints, hue: 'steps', group: 'Move', default: true, sizes: ['tile', 'card'], valueText: '7 605' },
  { id: 'weight', label: 'Weight', icon: Scale, hue: 'body', group: 'Body', default: true, sizes: ['tile', 'card'] },
  { id: 'hrv', label: 'HRV vs usual', icon: Activity, hue: 'recovery', group: 'Recovery', unavailable: 'Needs a ring' },
  { id: 'stress', label: 'Stress today', hue: 'recovery', group: 'Recovery', description: 'How calm the day has been' },
  { id: 'fast', label: 'Fast', hue: 'energy', group: 'Energy' },
];

const DEFAULT_SEL = defaultSelection(ITEMS);

function Harness({ items = ITEMS, initial = DEFAULT_SEL, onChange, ...rest }: Partial<CardLibraryProps> & { initial?: LibrarySelection[] }) {
  const [sel, setSel] = useState(initial);
  return (
    <CardLibrary
      open
      onOpenChange={() => {}}
      title="Today's cards"
      items={items}
      selected={sel}
      onChange={(next) => {
        setSel(next);
        onChange?.(next);
      }}
      onReset={() => setSel(defaultSelection(items))}
      {...rest}
    />
  );
}

const shownList = () => screen.getByRole('list', { name: /^Shown, / });
const shownLabels = () =>
  within(shownList())
    .getAllByRole('listitem')
    .map((li) => li.querySelector('.lm-lib__label')!.textContent);
const rowOf = (label: string) => within(shownList()).getByText(label).closest('li') as HTMLElement;

describe('the model', () => {
  it('sizeOf: a card with one size has none, a chosen size must exist, else the first', () => {
    expect(sizeOf({ sizes: undefined })).toBeUndefined();
    expect(sizeOf({ sizes: ['card'] })).toBeUndefined();
    expect(sizeOf({ sizes: ['tile', 'card'] })).toBe('tile');
    expect(sizeOf({ sizes: ['tile', 'card'] }, 'card')).toBe('card');
    expect(sizeOf({ sizes: ['tile', 'card'] }, 'huge')).toBe('tile');
  });

  it('defaultSelection: the default-flagged items in list order at their first size, the hero excluded', () => {
    expect(defaultSelection(ITEMS)).toEqual([{ id: 'eaten' }, { id: 'energy' }, { id: 'sleep' }, { id: 'steps', size: 'tile' }, { id: 'weight', size: 'tile' }]);
  });

  it('sameSelection compares ids in order and sizes (an absent size is the first)', () => {
    const by = new Map(ITEMS.map((i) => [i.id, i]));
    expect(sameSelection([{ id: 'steps' }], [{ id: 'steps', size: 'tile' }], by)).toBe(true);
    expect(sameSelection([{ id: 'steps', size: 'card' }], [{ id: 'steps', size: 'tile' }], by)).toBe(false);
    expect(sameSelection([{ id: 'eaten' }, { id: 'energy' }], [{ id: 'energy' }, { id: 'eaten' }], by)).toBe(false);
  });

  it('groupItems keeps first-seen order; filterItems needs every word, in label, description or group', () => {
    expect(groupItems(ITEMS.filter((i) => !i.locked)).map((g) => [g.group, g.items.length])).toEqual([['Food', 1], ['Energy', 2], ['Sleep', 1], ['Move', 1], ['Body', 1], ['Recovery', 2]]);
    expect(filterItems(ITEMS, 'calm').map((i) => i.id)).toEqual(['stress']);
    expect(filterItems(ITEMS, 'energy protein').map((i) => i.id)).toEqual(['eaten']);
    expect(filterItems(ITEMS, '  ').length).toBe(ITEMS.length);
  });
});

describe('<CardLibrary>', () => {
  it('can serve as an add/remove panel while direct grid editing owns move and width', () => {
    render(<Harness organize={false} />);
    expect(within(rowOf('Steps')).queryByRole('button', { name: /Move Steps/ })).toBeNull();
    expect(within(rowOf('Steps')).queryByRole('radiogroup', { name: /Size of Steps/ })).toBeNull();
    expect(within(rowOf('Steps')).getByRole('button', { name: 'Remove Steps' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Stress today' })).toBeInTheDocument();
  });
  it('title · ✕ only, the foot counts what is shown and offers Reset', () => {
    render(<Harness />);
    expect(screen.getByRole('heading', { name: "Today's cards" })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(cancel|done|save)$/i })).toBeNull();
    // the hero and five cards, of nine in the library
    expect(screen.getByText('6 of 9')).toBeInTheDocument();
    expect(screen.getByText('Showing').closest('.lm-lib__cap')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset to default' })).toBeInTheDocument();
  });

  it('the hero is a locked row: first, a lock instead of a grip, no remove key, never sortable', () => {
    render(<Harness />);
    const list = shownList();
    const first = within(list).getAllByRole('listitem')[0]!;
    expect(first).toHaveAttribute('data-locked', 'true');
    expect(first).not.toHaveAttribute('aria-roledescription');
    expect(within(first).queryByRole('button')).toBeNull();
    expect(within(first).getByText('Always first')).toBeInTheDocument();
    expect(first.querySelector('.lm-lib__lock')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove Today' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Move Today/ })).toBeNull();
    expect(shownLabels()).toEqual(['Today', 'Eaten so far', 'Energy', 'Sleep', 'Steps', 'Weight']);
  });

  it('rows carry the hue dot, the description in stone and the value; quiet hides the value', () => {
    const { container, rerender } = render(<Harness />);
    const eaten = rowOf('Eaten so far');
    expect(eaten).toHaveAttribute('data-hue', 'food');
    expect(eaten.querySelector('.lm-lib__dot')).not.toBeNull();
    expect(within(eaten).getByText('Energy and protein against today’s targets')).toHaveClass('lm-lib__desc');
    expect(within(rowOf('Energy')).getByText('1 096 kcal')).toBeInTheDocument();
    rerender(<Harness quiet />);
    expect(container.textContent).not.toContain('1 096 kcal');
  });

  it('a card the person chose but cannot have now stays in the list, greyed, with its reason in words', () => {
    render(<Harness />);
    const sleep = rowOf('Sleep');
    expect(sleep).toHaveAttribute('data-unavailable', 'true');
    expect(within(sleep).getByText('Needs a ring').closest('.lm-mono')).toBeInTheDocument();
    // it can still be removed
    expect(within(sleep).getByRole('button', { name: 'Remove Sleep' })).toBeInTheDocument();
  });

  it('the Add list is grouped, each group named in mono with its hue dot; an unavailable card cannot be added', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const add = screen.getByRole('heading', { name: 'Add' }).closest('section')!;
    expect(within(add).getByRole('list', { name: 'Recovery' })).toBeInTheDocument();
    expect(within(add).getByRole('list', { name: 'Energy' })).toBeInTheDocument();
    const dots = add.querySelectorAll('.lm-lib__groupname > .lm-lib__dot');
    expect(dots.length).toBe(2);
    const hrv = within(add).getByText('HRV vs usual').closest('li')!;
    expect(hrv).toHaveAttribute('data-unavailable', 'true');
    // the reason is on the row in words, and the add key's description says it too (a hidden tooltip text)
    expect(hrv.querySelector('.lm-lib__reason')).toHaveTextContent('Needs a ring');
    const key = within(hrv).getByRole('button', { name: 'Add HRV vs usual' });
    expect(key).toHaveAttribute('aria-disabled', 'true');
    expect(key).toHaveAccessibleDescription('Needs a ring');
    await userEvent.setup().click(key);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('adding puts the card at the end, at its first size; focus lands on its grip', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Add Stress today' }));
    expect(onChange).toHaveBeenLastCalledWith([{ id: 'eaten' }, { id: 'energy' }, { id: 'sleep' }, { id: 'steps', size: 'tile' }, { id: 'weight', size: 'tile' }, { id: 'stress' }]);
    expect(document.activeElement).toHaveAccessibleName(/Move Stress today, position 6 of 6/);
    expect(screen.getByText('7 of 9')).toBeInTheDocument();
  });

  it('a removed card comes back at its old place and size', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ id: 'eaten' }, { id: 'steps', size: 'card' }, { id: 'weight', size: 'tile' }]} />);
    expect(shownLabels()).toEqual(['Today', 'Eaten so far', 'Steps', 'Weight']);
    await user.click(screen.getByRole('button', { name: 'Remove Steps' }));
    expect(shownLabels()).toEqual(['Today', 'Eaten so far', 'Weight']);
    await user.click(screen.getByRole('button', { name: 'Add Steps' }));
    expect(shownLabels()).toEqual(['Today', 'Eaten so far', 'Steps', 'Weight']);
    expect(within(rowOf('Steps')).getByRole('radio', { name: 'Card' })).toBeChecked();
  });

  it('a card with more than one size has a size toggle; choosing writes the size into the selection', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const steps = rowOf('Steps');
    const bank = within(steps).getByRole('radiogroup', { name: 'Size of Steps' });
    expect(within(bank).getByRole('radio', { name: 'Tile' })).toBeChecked();
    await user.click(within(bank).getByRole('radio', { name: 'Card' }));
    expect(onChange).toHaveBeenLastCalledWith([{ id: 'eaten' }, { id: 'energy' }, { id: 'sleep' }, { id: 'steps', size: 'card' }, { id: 'weight', size: 'tile' }]);
    expect(within(rowOf('Steps')).getByRole('radio', { name: 'Card' })).toBeChecked();
    // a card with one size has none
    expect(within(rowOf('Energy')).queryByRole('radiogroup')).toBeNull();
  });

  it('Space picks up, arrows move, Space drops; the live region says where; focus stays on the row', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    screen.getByRole('button', { name: /^Move Energy/ }).focus();
    await user.keyboard(' ');
    await user.keyboard('{ArrowDown}');
    expect(document.querySelector('.lm-lib [aria-live="polite"]')).toHaveTextContent('Energy moved to position 3 of 5');
    await user.keyboard(' ');
    expect(shownLabels()).toEqual(['Today', 'Eaten so far', 'Sleep', 'Energy', 'Steps', 'Weight']);
    expect(onChange.mock.lastCall![0].map((s: LibrarySelection) => s.id)).toEqual(['eaten', 'sleep', 'energy', 'steps', 'weight']);
    expect(document.activeElement).toHaveAccessibleName(/Move Energy, position 3 of 5/);
  });

  it('Esc cancels a move and nothing is written', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    screen.getByRole('button', { name: /^Move Eaten so far/ }).focus();
    await user.keyboard(' {ArrowDown}{ArrowDown}{Escape}');
    expect(shownLabels()).toEqual(['Today', 'Eaten so far', 'Energy', 'Sleep', 'Steps', 'Weight']);
    expect(document.querySelector('.lm-lib [aria-live="polite"]')).toHaveTextContent('Move cancelled');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Home and End jump to the ends', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole('button', { name: /^Move Sleep/ }).focus();
    await user.keyboard(' {End} ');
    expect(shownLabels().at(-1)).toBe('Sleep');
    screen.getByRole('button', { name: /^Move Sleep/ }).focus();
    await user.keyboard(' {Home} ');
    expect(shownLabels()[1]).toBe('Sleep');
  });

  it('max counts the hero: at the limit every add key is disabled and explains why', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness max={6} onChange={onChange} copy={{ full: 'Today holds {max}. Remove one first.' }} />);
    expect(screen.getByText('6 of 6')).toBeInTheDocument();
    const key = screen.getByRole('button', { name: 'Add Stress today' });
    expect(key).toHaveAttribute('aria-disabled', 'true');
    await user.click(key);
    expect(onChange).not.toHaveBeenCalled();
    expect(key).toHaveAccessibleDescription('Today holds 6. Remove one first.');
  });

  it('Reset is disabled with its reason while the list is the default, and puts the default back otherwise', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Reset to default' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('button', { name: 'Remove Energy' }));
    const reset = screen.getByRole('button', { name: 'Reset to default' });
    expect(reset).not.toHaveAttribute('aria-disabled');
    await user.click(reset);
    expect(shownLabels()).toEqual(['Today', 'Eaten so far', 'Energy', 'Sleep', 'Steps', 'Weight']);
    expect(screen.getByRole('button', { name: 'Reset to default' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('a size change is not the default: Reset comes back on', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(within(rowOf('Weight')).getByRole('radio', { name: 'Card' }));
    expect(screen.getByRole('button', { name: 'Reset to default' })).not.toHaveAttribute('aria-disabled');
  });

  it('the row action slot renders on every row, shown and Add', () => {
    render(<Harness renderRowAction={(item) => <button type="button">{`Widget ${item.id}`}</button>} />);
    expect(screen.getByRole('button', { name: 'Widget eaten' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Widget stress' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Widget hero' })).toBeNull();
  });

  it('the copy comes from the copy prop', () => {
    render(<Harness copy={{ showing: 'On show', add: 'Add a card', reset: 'Start over', shown: 'On Today' }} />);
    expect(screen.getByText('On show')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Add a card' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'On Today' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start over' })).toBeInTheDocument();
  });

  it('nothing shown but the hero: the Add list is still there; with no hero and nothing chosen the empty line shows', () => {
    const { rerender } = render(<Harness initial={[]} />);
    expect(screen.queryByText(/Nothing shown/)).toBeNull();
    rerender(<Harness items={ITEMS.filter((i) => !i.locked)} initial={[]} />);
    expect(screen.getByText(/Nothing shown/)).toBeInTheDocument();
  });

  it('startAt="add" opens the panel at its Add section', () => {
    const scroll = vi.fn();
    const proto = Element.prototype as unknown as { scrollIntoView?: unknown };
    const had = proto.scrollIntoView;
    proto.scrollIntoView = scroll;
    try {
      const { unmount } = render(<Harness />);
      expect(scroll).not.toHaveBeenCalled();
      unmount();
      render(<Harness startAt="add" />);
      expect(scroll).toHaveBeenCalledWith({ block: 'start' });
      expect(scroll.mock.contexts[0]).toBe(screen.getByRole('heading', { name: 'Add' }).closest('section'));
    } finally {
      if (had) proto.scrollIntoView = had;
      else delete proto.scrollIntoView;
    }
  });

  it('ids no item has are ignored', () => {
    render(<Harness initial={[{ id: 'gone' }, { id: 'eaten' }]} />);
    expect(shownLabels()).toEqual(['Today', 'Eaten so far']);
  });
});

describe('search', () => {
  const MANY: LibraryItem[] = [
    ...ITEMS,
    ...Array.from({ length: SEARCH_ABOVE }, (_, i) => ({ id: `extra${i}`, label: `Extra card ${i}`, hue: 'body' as const, group: 'More', description: i === 3 ? 'something calm' : undefined })),
  ];

  it('is not offered with ten available cards or fewer', () => {
    render(<Harness />);
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('is offered above ten, filters the Add list and says when nothing matches', async () => {
    const user = userEvent.setup();
    render(<Harness items={MANY} initial={defaultSelection(MANY)} />);
    const box = screen.getByRole('searchbox', { name: 'Search cards' });
    await user.type(box, 'calm');
    const add = screen.getByRole('heading', { name: 'Add' }).closest('section')!;
    const names = within(add)
      .getAllByRole('listitem')
      .map((li) => li.querySelector('.lm-lib__label')!.textContent);
    expect(names).toEqual(['Stress today', 'Extra card 3']);
    await user.clear(box);
    await user.type(box, 'zzzz');
    expect(within(add).getByText('No card matches.')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: '' } });
    expect(within(add).getAllByRole('listitem').length).toBeGreaterThan(5);
  });
});
