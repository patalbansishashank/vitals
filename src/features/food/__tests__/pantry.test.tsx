import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { dispatch, outputOf, settleCommits } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { Toaster } from '@/components';
import { loadKitchen } from '@/content/catalogues/kitchenCatalogue';
import { documentGrocerySource } from '@/features/living/food/groceries';
import { resetFoodStore } from '@/features/living/food/mealPlanStore';
import { PantryFaceplate } from '../PantryFaceplate';
import PantryPage from '../PantryPage';
import { pantryGroupsHiddenFor } from '../pantryData';
import { RecipeEquipmentLine } from '../RecipeEquipmentLine';

vi.mock('@/features/components/Picker', async () => ({
  CataloguePicker: (await import('./pickerStub')).PickerStub,
}));

const pantry = async () => outputOf(await dispatch('pantry.get', {}))!;
const LONG = { timeout: 4000 };

beforeAll(async () => {
  await loadKitchen();
});
beforeEach(() => {
  freshState();
});
afterEach(() => vi.useRealTimers());

const inRouter = (el: React.ReactElement) =>
  render(
    <MemoryRouter>
      {el}
      <Toaster />
    </MemoryRouter>,
  );

describe('Food tab › Pantry faceplate', () => {
  it('says nothing is listed in one line, and links to the pantry page', async () => {
    inRouter(<PantryFaceplate />);
    expect(await screen.findByText('Nothing listed')).toBeInTheDocument();
    expect(screen.queryByText(/tell the Coach/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Edit pantry' })).toHaveAttribute('href', '/food/pantry');
  });

  it('quick-adds a staple to the pantry, and Undo takes it back', async () => {
    const user = userEvent.setup();
    await dispatch('kitchen.set', { staples: [{ id: 'st.onion' }, { id: 'st.basmati' }] });
    await settleCommits();
    inRouter(<PantryFaceplate />);
    await user.click(await screen.findByRole('button', { name: /Add Onion/ }));
    await waitFor(async () => expect((await pantry()).items.map((i) => i.id)).toEqual(['st.onion']));
    const list = await screen.findByRole('list', { name: 'Recently added' });
    expect(within(list).getByText('Onion')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add Onion/ })).toBeNull();
    expect(screen.getByRole('img', { name: '1 item at home' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/kcal|kJ|protein/);
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect((await pantry()).items).toHaveLength(0));
  });
});

describe('/food/pantry', () => {
  it('confirms perishables the Coach may ask about with "Yes, still have them", removing nothing', async () => {
    const user = userEvent.setup();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() - 30 * 86_400_000));
    await dispatch('pantry.add', { items: [{ id: 'pa.onion_red', label: 'Red onion' }] });
    await settleCommits();
    vi.useRealTimers();
    expect((await pantry()).askStillHave).toEqual(['pa.onion_red']);
    inRouter(<PantryPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Pantry' })).toBeInTheDocument();
    expect(await screen.findByText('Still have these?')).toBeInTheDocument();
    expect(screen.getByText('Red onion')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yes, still have them' }));
    await waitFor(async () => expect((await pantry()).askStillHave).toEqual([]));
    expect((await pantry()).items.map((i) => i.id)).toEqual(['pa.onion_red']);
    await waitFor(() => expect(screen.queryByText(/Still have these\?/)).toBeNull());
  });

  it('has its title in the header and no explainer paragraphs', async () => {
    inRouter(<PantryPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Pantry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to Food' })).toBeInTheDocument();
    expect(screen.queryByText(/Recipes can start from what you already have/)).toBeNull();
    expect(screen.queryByText(/^Optional\./)).toBeNull();
    expect(screen.getByRole('button', { name: 'About At home' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '0 items at home' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Shelves stocked' })).toBeInTheDocument();
  });

  it('autosaves picks through the pantry list', async () => {
    const user = userEvent.setup();
    inRouter(<PantryPage />);
    await user.click(await screen.findByRole('button', { name: 'Add to Pantry' }));
    await waitFor(
      async () => expect((await pantry()).items.map((i) => i.id)).toEqual(['pa.onion_red']),
      LONG,
    );
    expect(screen.getByRole('img', { name: '1 item at home' })).toBeInTheDocument();
    expect(screen.getByText(/1 of \d+ shelves stocked/)).toBeInTheDocument();
  });
});

describe('one pantry', () => {
  it('"have it" on the grocery list writes the pantry document the pantry page edits', async () => {
    resetFoodStore();
    documentGrocerySource.setHave('paneer', true);
    await waitFor(
      async () => expect((await pantry()).items.map((i) => i.label.toLowerCase())).toContain('paneer'),
      LONG,
    );
    expect(documentGrocerySource.pantry().map((n) => n.toLowerCase())).toContain('paneer');
  });

  it('hides the pantry groups a diet rules out', () => {
    expect(pantryGroupsHiddenFor('vegetarian')).toEqual(['eggs-meat', 'fish-seafood']);
    expect(pantryGroupsHiddenFor('vegan')).toEqual(['eggs-meat', 'fish-seafood', 'dairy-cheese']);
    expect(pantryGroupsHiddenFor('eggetarian')).toEqual(['fish-seafood']);
    expect(pantryGroupsHiddenFor('omnivore')).toEqual([]);
    expect(pantryGroupsHiddenFor(null)).toEqual([]);
  });
});

describe('recipe equipment line', () => {
  it('shows what the recipe needs and what the kitchen may lack', async () => {
    await dispatch('kitchen.set', { equipment: [{ id: 'eq.pressure_cooker_medium' }] });
    await settleCommits();
    render(<RecipeEquipmentLine equipment={['pressure cooker', 'tawa']} />);
    expect(await screen.findByText(/you may not have: tawa/)).toBeInTheDocument();
    expect(screen.getByText(/^Needs: pressure cooker, tawa/)).toBeInTheDocument();
  });
});
