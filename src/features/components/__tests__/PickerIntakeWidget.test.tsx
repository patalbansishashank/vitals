/**
 * The picker as an intake turn, hosted by the real QuestionCard: the step's one forward key (Next, Save when changing)
 * saves the list and commits it; the turn draws no Done or "Skip this list" key and no footer of its own.
 */
import type { ComponentType } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from '@/components';
import { dispatch, outputOf, settleCommits } from '@/commands';
import type * as Commands from '@/commands';
import type * as Kitchen from '@/content/catalogues/kitchenCatalogue';
import { freshState } from '@/commands/__tests__/harness';
import { loadKitchen } from '@/content/catalogues/kitchenCatalogue';
import { INTAKE_PARTS } from '@/features/intake/chapters/food-kitchen';
import { QuestionCard } from '@/features/intake/components/QuestionCard';
import type { WidgetProps } from '@/features/intake/components/widgetTypes';
import type { Question } from '@/features/intake/flow';
import { PickerIntakeWidget } from '../PickerIntakeWidget';
import type { PickerValue } from '../PickerTypes';

// a switch on the command bus: `failWrites` makes the picker's kitchen/pantry write fail (the rest passes through)
const bus = vi.hoisted(() => ({ failWrites: false }));
vi.mock('@/commands', async (importOriginal) => {
  const real = await importOriginal<typeof Commands>();
  return {
    ...real,
    dispatch: ((id: string, input: unknown, opts?: unknown) =>
      bus.failWrites && (id === 'kitchen.set' || id === 'pantry.add')
        ? Promise.resolve({ ok: false, error: { code: 'internal', message: 'disk full' } })
        : (real.dispatch as (i: string, x: unknown, o?: unknown) => unknown)(
            id,
            input,
            opts,
          )) as typeof real.dispatch,
  };
});

// a switch on the catalogue: `fail` makes it fail to load, as an offline chunk fetch does
const catalogue = vi.hoisted(() => ({ fail: false }));
vi.mock('@/content/catalogues/kitchenCatalogue', async (importOriginal) => {
  const real = await importOriginal<typeof Kitchen>();
  return {
    ...real,
    loadKitchen: () => (catalogue.fail ? Promise.reject(new Error('offline')) : real.loadKitchen()),
    kitchenNow: () => (catalogue.fail ? null : real.kitchenNow()),
  };
});

beforeAll(async () => {
  await loadKitchen();
});
beforeEach(() => {
  freshState();
  bus.failWrites = false;
  catalogue.fail = false;
});

const question = (id: string): Question => INTAKE_PARTS[0]!.questions.find((x) => x.id === id)!;
const widgets: Readonly<Record<string, ComponentType<WidgetProps<never>>>> = Object.fromEntries(
  ['equipment', 'cuisines', 'staples', 'pantry'].map((k) => [
    `cataloguePicker:${k}`,
    PickerIntakeWidget as unknown as ComponentType<WidgetProps<never>>,
  ]),
);

function renderTurn(
  id: string,
  opts: { value?: unknown; values?: Record<string, unknown>; india?: boolean; changing?: boolean } = {},
) {
  const commits: PickerValue[] = [];
  render(
    <>
      <Toaster />
      <QuestionCard
        q={question(id)}
        value={opts.value}
        values={opts.values ?? {}}
        ctx={{ india: opts.india ?? false, gentle: false }}
        widgets={widgets}
        onCommit={(v) => commits.push(v as PickerValue)}
        changing={opts.changing}
        onBack={() => undefined}
        onLater={opts.changing ? undefined : () => undefined}
        onCancel={opts.changing ? () => undefined : undefined}
      />
    </>,
  );
  const card = () => document.querySelector<HTMLElement>('.lm-ik-card')!;
  const steps = () => card().querySelector<HTMLElement>('.lm-ik-nav')!;
  return { commits, card, steps };
}

describe('picker as an intake turn', () => {
  it('one forward key: Next saves the pre-ticked list to the kitchen and commits it; no Done, no picker footer', async () => {
    const user = userEvent.setup();
    const { commits, card, steps } = renderTurn('food.equipment', {
      values: { 'food.cuisines': [{ id: 'cu.kerala' }] },
      india: true,
    });
    expect(await screen.findByText(/^Pre-ticked for a Kerala kitchen$/)).toBeInTheDocument();
    // the step row is the only row of keys: Back · Skip · Next, and nothing in the turn moves forward
    expect([...steps().querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Back',
      'Skip',
      'Next',
    ]);
    expect(within(card()).queryByRole('button', { name: /^Done/ })).toBeNull();
    expect(within(card()).queryByRole('button', { name: 'Skip this list' })).toBeNull();
    expect(card().querySelector('.lm-pk__intake-footer, .lm-ik-done')).toBeNull();
    expect(screen.getAllByRole('button', { name: /^(Next|Done|Save)\b/ })).toHaveLength(1);

    await user.click(within(steps()).getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(commits).toHaveLength(1));
    expect(commits[0]!.length).toBeGreaterThan(5);
    expect(commits[0]!.some((e) => 'assumed' in e)).toBe(false);
    // each catalogue item carries its name for the answered list (Q3-J1-08), and only in the answer
    expect(
      commits[0]!.every((e) => typeof e.name === 'string' && e.name.length > 0 && !e.name.includes('.')),
    ).toBe(true);
    await settleCommits();
    const view = outputOf(await dispatch('kitchen.get', {}))!;
    expect(view.equipment.map((e) => e.id)).toEqual(commits[0]!.map((e) => e.id));
    expect(view.equipment.every((e) => !('name' in e))).toBe(true);
    // no nudge: Next committed rather than asking for an answer
    expect(card().querySelector('.lm-ik-nudge')!.textContent).toBe('');
  });

  it('Next commits the choices as edited; a press during the write commits once', async () => {
    const user = userEvent.setup();
    const { commits, steps } = renderTurn('food.cuisines', { india: true });
    // an Indian kitchen with no cuisine yet pre-ticks nothing: open a group and tick one
    const picker = await screen.findByRole('region', { name: question('food.cuisines').prompt });
    const group = await waitFor(() =>
      picker.querySelector<HTMLButtonElement>('.lm-pk__group-key[aria-expanded="false"]')!,
    );
    await user.click(group);
    const chip = within(picker).getAllByRole('checkbox')[0]!;
    await user.click(chip);
    expect(chip).toHaveAttribute('aria-checked', 'true');
    const next = within(steps()).getByRole('button', { name: 'Next' });
    // a second press while the list is still being written does not commit again
    fireEvent.click(next);
    fireEvent.click(next);
    await waitFor(() => expect(commits).toHaveLength(1));
    await settleCommits();
    expect(commits).toHaveLength(1);
    expect(commits[0]!.map((e) => e.name)).toEqual([chip.getAttribute('aria-label')]);
  });

  it('pantry: clearing the pre-ticked items and pressing Next answers with an empty list and writes an empty pantry', async () => {
    const user = userEvent.setup();
    await dispatch('pantry.add', { items: [{ label: 'jaggery' }] });
    await settleCommits();
    const pantryIds = async () =>
      (outputOf(await dispatch('pantry.get', {})) as { items: Array<{ id: string }> }).items.map((i) => i.id);
    expect(await pantryIds()).toHaveLength(1);
    const { commits, steps } = renderTurn('food.pantry', { india: false });
    await user.click(await screen.findByRole('button', { name: 'Clear defaults' }));
    expect(screen.queryByText(/selected$/)).toBeNull();
    await user.click(within(steps()).getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(commits).toEqual([[]]));
    await settleCommits();
    expect(await pantryIds()).toEqual([]);
    // the empty pantry reads as a choice in the answered list
    expect(question('food.pantry').receipt!([], { india: false, gentle: false })).toBe('skipped, by choice');
  });

  it('change mode: a reopened answer is restored and Save writes the edited list', async () => {
    const user = userEvent.setup();
    const before: PickerValue = [{ id: 'eq.pressure_cooker_medium', name: 'pressure cooker' }];
    const { commits, steps } = renderTurn('food.equipment', { value: before, changing: true });
    expect(await screen.findByText('1 selected')).toBeInTheDocument();
    expect([...steps().querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Back',
      'Cancel',
      'Save',
    ]);
    await user.click(within(steps()).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(commits).toHaveLength(1));
    expect(commits[0]!.map((e) => e.id)).toEqual(['eq.pressure_cooker_medium']);
    await settleCommits();
    expect(outputOf(await dispatch('kitchen.get', {}))!.equipment.map((e) => e.id)).toEqual([
      'eq.pressure_cooker_medium',
    ]);
  });

  it('a catalogue that fails to load says so; Try again loads it and Next then saves', async () => {
    const user = userEvent.setup();
    catalogue.fail = true;
    const { commits, steps } = renderTurn('food.equipment');
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the list. Try again.");
    await user.click(within(steps()).getByRole('button', { name: 'Next' }));
    expect(commits).toHaveLength(0);
    catalogue.fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/selected$/)).toBeInTheDocument();
    await user.click(within(steps()).getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(commits).toHaveLength(1));
  });

  it('a failed write keeps the turn open: nothing is committed and Next can try again', async () => {
    const user = userEvent.setup();
    const { commits, steps } = renderTurn('food.staples', {
      values: { 'food.cuisines': [{ id: 'cu.kerala' }] },
      india: true,
    });
    await screen.findByText(/^Pre-ticked for a Kerala kitchen$/);
    bus.failWrites = true;
    await user.click(within(steps()).getByRole('button', { name: 'Next' }));
    expect(await screen.findByText("Couldn't save the list. Try again.")).toBeInTheDocument();
    expect(commits).toHaveLength(0);
    bus.failWrites = false;
    await user.click(within(steps()).getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(commits).toHaveLength(1));
  });
});
