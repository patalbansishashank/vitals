import type { ReactElement } from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from '@/components';
import { renderLiving } from '../../testing';
import FoodPage from '../FoodPage';
import { resetFoodStore, useFoodStore } from '../mealPlanStore';
import { FoodProfileContext, type FoodProfileView } from '../profile';
import { createMockRecipeProvider, RecipeProviderContext, type RecipeProvider } from '../recipes';

const ANSWERED: FoodProfileView = { dietAnswered: true, dietKind: 'vegetarian', familyFoodMode: false, kitchenScale: false, supplementStance: 'food_first', safetyFlags: [] };

function ui(o: { provider?: RecipeProvider; profile?: FoodProfileView } = {}): ReactElement {
  let el: ReactElement = (
    <>
      <FoodPage />
      <Toaster />
    </>
  );
  if (o.profile) el = <FoodProfileContext.Provider value={o.profile}>{el}</FoodProfileContext.Provider>;
  if (o.provider) el = <RecipeProviderContext.Provider value={o.provider}>{el}</RecipeProviderContext.Provider>;
  return el;
}

/** The Undo key of the toast that says `message`. */
async function undoIn(message: string | RegExp) {
  const msg = await screen.findByText(message, { selector: '.lm-toast__msg' });
  return within(msg.parentElement!).getByRole('button', { name: 'Undo' });
}

const groceries = () => document.getElementById('groceries')!;

beforeEach(() => resetFoodStore());

describe('Food', () => {
  it('renders the targets and the three meal slots with plain targets when there is no AI provider', async () => {
    renderLiving(ui(), { path: '/food', route: 'food' });
    expect(await screen.findByRole('heading', { level: 1, name: /^Food/ })).toHaveTextContent('Food · Thu 1 Oct');
    expect(screen.getByRole('heading', { name: 'Targets' })).toBeInTheDocument();
    // the Targets card is a channel strip: one line per nutrient with its target readout
    expect(document.getElementById('targets')!.textContent).toMatch(/energy\D*1\s\u2060?850 kcal[\s\S]*protein\D*150 g/);
    for (const slot of ['lunch', 'snack', 'dinner']) expect(screen.getByRole('heading', { level: 3, name: slot })).toBeInTheDocument();
    // the rows read as a readout; the food examples live in the meal's sheet
    expect(screen.queryAllByText(/for example/)).toHaveLength(0);
    // the reason is on the page once, and the disabled key is described by that same text (no hidden second copy)
    expect(screen.getAllByText('Connect an AI provider to get recipes.')).toHaveLength(1);
    const planKey = screen.getByRole('button', { name: 'Plan my day' });
    expect(planKey).toHaveAttribute('aria-disabled', 'true');
    expect(planKey).toHaveAccessibleDescription('Connect an AI provider to get recipes.');
    expect(within(groceries()).getByText('Groceries come from the recipes you accept.')).toBeInTheDocument();
    expect(screen.getByText('This week: no meals logged yet.')).toBeInTheDocument();
  });

  it('"I ate this" logs the slot as planned with an estimate and source, and Undo takes it back', async () => {
    const user = userEvent.setup();
    const h = renderLiving(ui(), { path: '/food', route: 'food' });
    await user.click(await screen.findByRole('button', { name: 'I ate this: lunch as planned' }));
    const label = await screen.findByText('lunch as planned');
    const row = label.closest('li')!;
    expect(within(row).getByText(/≈/)).toBeInTheDocument();
    expect(within(row).getByText(/\(\d+–\d+\)/)).toBeInTheDocument();
    expect(within(row).getByText('you · as planned')).toBeInTheDocument();
    expect(h.stub.inspect().entries).toHaveLength(1);
    expect(screen.getByText('This week: 1 meal as planned.')).toBeInTheDocument();

    await user.click(await undoIn('Lunch logged as planned'));
    await waitFor(() => expect(h.stub.inspect().entries).toHaveLength(0));
    await waitFor(() => expect(screen.queryByText('lunch as planned')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'I ate this: lunch as planned' })).toBeInTheDocument();
  });

  it('keeps Accept (plan it, groceries update) and I ate this (log it) apart', async () => {
    const user = userEvent.setup();
    const h = renderLiving(ui({ provider: createMockRecipeProvider(), profile: ANSWERED }), { path: '/food', route: 'food' });
    await user.click(await screen.findByRole('button', { name: 'Plan my day' }));
    await user.click(await screen.findByRole('button', { name: 'Accept paneer bhurji for lunch' }));

    expect(await within(groceries()).findByText((_, el) => !!el?.classList.contains('lv-food-grocery__label') && /paneer\s*200 g pack/.test(el.textContent ?? ''))).toBeInTheDocument();
    expect(within(groceries()).getByRole('heading', { name: 'dairy' })).toBeInTheDocument();
    expect(h.stub.inspect().entries).toHaveLength(0);
    expect(screen.getByText('accepted')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept paneer bhurji for lunch' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'I ate this: lunch as planned' }));
    await waitFor(() => expect(h.stub.inspect().entries).toHaveLength(1));
    expect(within(groceries()).getByText((_, el) => !!el?.classList.contains('lv-food-grocery__label') && /paneer\s*200 g pack/.test(el.textContent ?? ''))).toBeInTheDocument();
    expect(screen.getByText('accepted')).toBeInTheDocument();
  });

  it('"I ate this" on an accepted recipe logs one serving of the recipe, not the slot target (Q1B-B-05)', async () => {
    const user = userEvent.setup();
    const h = renderLiving(ui({ provider: createMockRecipeProvider(), profile: ANSWERED }), { path: '/food', route: 'food' });
    const logMeal = vi.spyOn(h.stub.actions, 'logMeal');
    await user.click(await screen.findByRole('button', { name: 'Plan my day' }));
    await user.click(await screen.findByRole('button', { name: 'Accept paneer bhurji for lunch' }));
    const recipe = useFoodStore.getState().accepted[Object.keys(useFoodStore.getState().accepted)[0]!]!.recipe;
    await user.click(screen.getByRole('button', { name: 'I ate this: lunch as planned' }));
    await waitFor(() => expect(logMeal).toHaveBeenCalledTimes(1));
    const input = logMeal.mock.calls[0]![1];
    expect(input).toMatchObject({ slot: 'lunch', asPlanned: true });
    expect(input.components).toEqual([
      {
        name: recipe.dish,
        energyKcal: recipe.perServing.energyKcal.value,
        proteinG: recipe.perServing.proteinG.value,
        carbG: recipe.perServing.carbG.value,
        fatG: recipe.perServing.fatG.value,
      },
    ]);
  });

  it('asks "Don’t suggest … again?" after a swap', async () => {
    const user = userEvent.setup();
    renderLiving(ui({ provider: createMockRecipeProvider(), profile: ANSWERED }), { path: '/food', route: 'food' });
    await user.click(await screen.findByRole('button', { name: 'Plan my day' }));
    await screen.findByRole('button', { name: 'Accept paneer bhurji for lunch' });
    expect(screen.getByText('Chana masala, rice, salad')).toBeInTheDocument();
    expect(screen.getByText('closest: protein short by 18 g', { exact: false })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Swap the lunch recipe' }));
    expect(await screen.findByText('Don’t suggest paneer bhurji again?')).toBeInTheDocument();
    expect(screen.getByText('Moong dal chilla with curd')).toBeInTheDocument();
    expect(screen.getByText('Chana masala, rice, salad')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Don’t suggest' }));
    expect(screen.queryByText('Don’t suggest paneer bhurji again?')).not.toBeInTheDocument();
    expect(useFoodStore.getState().dontSuggest).toContain('paneer bhurji');
  });

  it('shows a per-slot failure with Try again', async () => {
    const user = userEvent.setup();
    renderLiving(ui({ provider: createMockRecipeProvider({ fail: ['snack'] }), profile: ANSWERED }), { path: '/food', route: 'food' });
    await user.click(await screen.findByRole('button', { name: 'Plan my day' }));
    expect(await screen.findByText('Couldn’t make a recipe this time.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again: snack recipe' })).toBeInTheDocument();
    expect(screen.queryAllByText(/for example/)).toHaveLength(0);
  });

  it('asks for the food rules before recipes', async () => {
    renderLiving(ui({ provider: createMockRecipeProvider() }), { path: '/food', route: 'food' });
    const link = await screen.findByRole('link', { name: 'Tell us what you eat to get recipes' });
    expect(link).toHaveAttribute('href', '/onboarding/diet');
    expect(screen.getByRole('button', { name: 'Plan my day' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('heading', { name: 'Targets' })).toBeInTheDocument();
  });

  it('logs a typed meal from the manual logger', async () => {
    const user = userEvent.setup();
    const h = renderLiving(ui(), { path: '/food', route: 'food' });
    await user.click(await screen.findByRole('button', { name: 'More for snack' }));
    await user.click(await screen.findByRole('menuitem', { name: 'I ate something else' }));
    await user.type(await screen.findByRole('searchbox', { name: 'Search foods' }), 'dal');
    await user.click(await screen.findByRole('button', { name: 'Add dal' }));
    expect(screen.getByText('estimated composition')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Log snack' }));

    await waitFor(() => expect(h.stub.inspect().entries).toHaveLength(1));
    const e = h.stub.inspect().entries[0]!;
    expect(e.source.method).toBe('typed');
    expect(e.kind === 'meal' && e.slot).toBe('snack');
    expect(e.kind === 'meal' && e.components[0]!.name).toBe('dal · 1 × katori (155 mL)');
    expect(await screen.findByText('dal · 1 × katori (155 mL)')).toBeInTheDocument();
    expect(screen.getByText('This week: 1 typed by you.')).toBeInTheDocument();
  });

  it('"Tell the Coach instead" hands the Coach what was typed, with the slot and date (Q4-10)', async () => {
    const user = userEvent.setup();
    const h = renderLiving(ui(), { path: '/food', route: 'food', routes: [{ path: 'coach', element: <p>coach</p> }] });
    await user.click(await screen.findByRole('button', { name: 'More for lunch' }));
    await user.click(await screen.findByRole('menuitem', { name: 'I ate something else' }));
    await user.type(await screen.findByRole('searchbox', { name: 'Search foods' }), 'poha and chai');
    await user.click(screen.getByRole('button', { name: 'Tell the Coach instead' }));
    await waitFor(() => expect(h.router.state.location.pathname).toBe('/coach'));
    expect(h.router.state.location.state).toEqual({ draft: { text: 'poha and chai', prefill: true, context: { date: '2026-10-01', screen: 'food', slot: 'lunch', slotName: 'lunch' } } });
  });

  it('logs a described meal with its energy as other food', async () => {
    const user = userEvent.setup();
    const h = renderLiving(ui(), { path: '/food', route: 'food' });
    await user.click(await screen.findByRole('button', { name: 'Log other food' }));
    await user.type(await screen.findByRole('textbox', { name: 'Or describe it' }), '2 idlis with sambar');
    await user.type(screen.getByRole('spinbutton', { name: /Energy, if you know it/ }), '250{Enter}');
    await user.click(screen.getByRole('button', { name: 'Log it' }));
    await waitFor(() => expect(h.stub.inspect().entries).toHaveLength(1));
    const e = h.stub.inspect().entries[0]!;
    expect(e.kind === 'meal' && e.totals.energyKcal.value).toBe(250);
    expect(await screen.findByRole('heading', { name: 'Other food' })).toBeInTheDocument();
    expect(screen.getByText('2 idlis with sambar')).toBeInTheDocument();
  });

  it('shows a future date as a read-only preview', async () => {
    renderLiving(ui(), { path: '/food/2026-10-03', route: 'food/:date' });
    expect(await screen.findByRole('heading', { level: 1, name: /^Food/ })).toHaveTextContent('Food · Sat 3 Oct');
    expect(screen.getByText('Preview · the plan may still change')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 }).map((x) => x.textContent)).toEqual(expect.arrayContaining(['lunch', 'snack', 'dinner']));
    expect(screen.queryByRole('button', { name: /I ate this/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /I ate something else/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Log other food' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /as taken/ })).not.toBeInTheDocument();
  });

  it('hides kcal in quiet mode until "show numbers"', async () => {
    const user = userEvent.setup();
    const h = renderLiving(ui(), { path: '/food', route: 'food' });
    await screen.findByRole('heading', { name: 'Targets' });
    await act(async () => {
      await h.stub.actions.setQuietMode(true);
    });
    const key = await screen.findByRole('button', { name: 'show numbers' });
    expect(document.body.textContent).not.toMatch(/kcal/);
    expect(screen.getByText('eaten: nothing logged yet')).toBeInTheDocument();
    expect(screen.getAllByText(/^For example /)).toHaveLength(3);

    await user.click(key);
    // the Targets card is a channel strip: one line per nutrient with its target readout
    expect(document.getElementById('targets')!.textContent).toMatch(/energy\D*1\s\u2060?850 kcal[\s\S]*protein\D*150 g/);
    expect(screen.getByRole('button', { name: 'hide numbers' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('marks a supplement as taken', async () => {
    const user = userEvent.setup();
    renderLiving(ui(), { path: '/food', route: 'food' });
    await user.click(await screen.findByRole('button', { name: 'Mark creatine as taken' }));
    expect(await screen.findByRole('button', { name: 'Undo creatine taken' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Vegetarian diets are often low in vitamin B12 — consider a test; ask a doctor.')).toBeInTheDocument();
    expect(screen.queryByText(/third-party batch testing/)).not.toBeInTheDocument();
  });

  it('merges the plan\'s supplement with the person\'s own row: one line, both doses, one Taken key (Q6-11)', async () => {
    const user = userEvent.setup();
    const supplements = { _v: 2 as const, stance: 'food_first' as const, rows: [{ supplementId: 'creatine_monohydrate', state: 'taking' as const, dose: 7, unit: 'g', timesOfDay: ['morning' as const] }] };
    renderLiving(ui({ profile: { ...ANSWERED, supplements } }), { path: '/food', route: 'food' });
    const key = await screen.findByRole('button', { name: 'Mark Creatine monohydrate as taken' });
    const face = document.getElementById('supplements')!;
    expect(within(face).getAllByRole('button', { name: /^Mark .*creatine.* as taken/i })).toHaveLength(1);
    expect(within(face).getByText(/^· you take 7 g · morning · plan suggests \d+(\.\d+)? g$/)).toBeInTheDocument();
    expect(within(face).queryByRole('heading', { name: 'yours' })).not.toBeInTheDocument();
    await user.click(key);
    expect(await screen.findByRole('button', { name: 'Undo Creatine monohydrate taken' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows supplement cards with the testing line when the person chose "open"', async () => {
    renderLiving(ui({ profile: { ...ANSWERED, supplementStance: 'open', safetyFlags: ['milk_allergy'] } }), { path: '/food', route: 'food' });
    expect(await screen.findByText(/third-party batch testing/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^psyllium husk \(isabgol\)/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^plant protein powder/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^whey protein/ })).not.toBeInTheDocument();
    expect(screen.getByText(/not shown because of your safety answers/)).toBeInTheDocument();
  });

  it('moves one day with ] and opens the slot sheet from ?recipe=', async () => {
    const h = renderLiving(ui(), { path: '/food?recipe=lunch', route: 'food' });
    expect(await screen.findByRole('heading', { name: 'Lunch targets' })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: ']' });
    await waitFor(() => expect(h.router.state.location.pathname).toBe('/food/2026-10-02'));
  });
});
