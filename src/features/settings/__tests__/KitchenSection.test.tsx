import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { dispatch, outputOf, settleCommits } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { Toaster } from '@/components';
import { loadKitchen } from '@/content/catalogues/kitchenCatalogue';
import { KitchenSection } from '../KitchenSection';

vi.mock('@/features/components/Picker', async () => ({ CataloguePicker: (await import('@/features/food/__tests__/pickerStub')).PickerStub }));

const LONG = { timeout: 4000 };

beforeAll(async () => {
  await loadKitchen();
});
beforeEach(() => {
  freshState();
});

const ui = () =>
  render(
    <MemoryRouter>
      <KitchenSection />
      <Toaster />
    </MemoryRouter>,
  );

describe('Settings › Kitchen', () => {
  it('shows the region once and one closed row per list; a row opens its picker in place', async () => {
    const user = userEvent.setup();
    ui();
    const section = screen.getByRole('region', { name: 'Kitchen' });
    expect(within(section).getAllByText('Region')).toHaveLength(1);
    for (const name of ['Equipment', 'Cuisines', 'Staples', 'Pantry']) {
      expect(await screen.findByRole('button', { name: new RegExp(`^${name}`) })).toHaveAttribute('aria-expanded', 'false');
    }
    // nothing is expanded on load: no picker is on the page
    expect(screen.queryByRole('group', { name: 'Cooking equipment' })).toBeNull();
    for (const [row, picker] of [
      ['Equipment', 'Cooking equipment'],
      ['Cuisines', 'Cuisines you cook or eat'],
      ['Staples', 'Staples you keep and cook with'],
      ['Pantry', 'What’s in your kitchen now'],
    ] as const) {
      await user.click(screen.getByRole('button', { name: new RegExp(`^${row}`) }));
      expect(screen.getByRole('button', { name: new RegExp(`^${row}`) })).toHaveAttribute('aria-expanded', 'true');
      expect(await screen.findByRole('group', { name: picker })).toBeInTheDocument();
    }
    // one list open at a time
    expect(screen.queryByRole('group', { name: 'Cooking equipment' })).toBeNull();
  });

  it('summarises each list on its row', async () => {
    await dispatch('kitchen.set', { equipment: [{ id: 'eq.kadhai' }, { id: 'eq.tawa' }] });
    await settleCommits();
    ui();
    expect(await screen.findByRole('button', { name: /^Equipment.*2 items/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Staples.*None/ })).toBeInTheDocument();
  });

  it('saves a pick through the kitchen list, with Undo', async () => {
    const user = userEvent.setup();
    await dispatch('kitchen.set', { equipment: [{ id: 'eq.kadhai' }] });
    await settleCommits();
    ui();
    await user.click(await screen.findByRole('button', { name: /^Equipment/ }));
    await user.click(await screen.findByRole('button', { name: 'Add to Cooking equipment' }));
    await waitFor(async () => expect(outputOf(await dispatch('kitchen.get', {}))!.equipment.map((e) => e.id)).toEqual(['eq.kadhai', 'eq.tawa']), LONG);
    expect(await screen.findByText('Equipment saved.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect(outputOf(await dispatch('kitchen.get', {}))!.equipment.map((e) => e.id)).toEqual(['eq.kadhai']));
  });
});
