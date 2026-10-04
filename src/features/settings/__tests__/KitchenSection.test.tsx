import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('Settings › Kitchen', () => {
  it('shows equipment, cuisines, staples and pantry, each with its picker', async () => {
    render(<KitchenSection />);
    expect(screen.getByRole('heading', { name: 'Kitchen' })).toBeInTheDocument();
    for (const name of ['Equipment', 'Cuisines', 'Staples', 'Pantry']) expect(await screen.findByRole('heading', { name })).toBeInTheDocument();
    for (const name of ['Cooking equipment', 'Cuisines you cook or eat', 'Staples you keep and cook with', 'What’s in your kitchen now']) expect(await screen.findByRole('group', { name })).toBeInTheDocument();
  });

  it('saves a pick through the kitchen list, with Undo', async () => {
    const user = userEvent.setup();
    await dispatch('kitchen.set', { equipment: [{ id: 'eq.kadhai' }] });
    await settleCommits();
    render(
      <>
        <KitchenSection />
        <Toaster />
      </>,
    );
    await user.click(await screen.findByRole('button', { name: 'Add to Cooking equipment' }));
    await waitFor(async () => expect(outputOf(await dispatch('kitchen.get', {}))!.equipment.map((e) => e.id)).toEqual(['eq.kadhai', 'eq.tawa']), LONG);
    expect(await screen.findByText('Equipment saved.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect(outputOf(await dispatch('kitchen.get', {}))!.equipment.map((e) => e.id)).toEqual(['eq.kadhai']));
  });
});
