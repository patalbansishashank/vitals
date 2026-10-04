import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { dispatch, outputOf, settleCommits } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { Toaster } from '@/components';
import { loadKitchen } from '@/content/catalogues/kitchenCatalogue';
import { PantryFaceplate } from '../PantryFaceplate';
import PantryPage from '../PantryPage';
import { RecipeEquipmentLine } from '../RecipeEquipmentLine';

vi.mock('@/features/components/Picker', async () => ({ CataloguePicker: (await import('./pickerStub')).PickerStub }));

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
  it('says what to do when nothing is listed, and links to the pantry page', async () => {
    inRouter(<PantryFaceplate />);
    expect(await screen.findByText('Nothing listed. You can also tell the Coach what you have at home.')).toBeInTheDocument();
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
    expect(screen.getByText('1 item')).toBeInTheDocument();
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
    expect(await screen.findByRole('heading', { level: 1, name: 'What’s in your kitchen now' })).toBeInTheDocument();
    expect(await screen.findByText(/Still have these\? Red onion\./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yes, still have them' }));
    await waitFor(async () => expect((await pantry()).askStillHave).toEqual([]));
    expect((await pantry()).items.map((i) => i.id)).toEqual(['pa.onion_red']);
    await waitFor(() => expect(screen.queryByText(/Still have these\?/)).toBeNull());
  });

  it('autosaves picks through the pantry list', async () => {
    const user = userEvent.setup();
    inRouter(<PantryPage />);
    await user.click(await screen.findByRole('button', { name: 'Add to What’s in your kitchen now' }));
    await waitFor(async () => expect((await pantry()).items.map((i) => i.id)).toEqual(['pa.onion_red']), LONG);
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
